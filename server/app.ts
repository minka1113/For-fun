import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { htmlToText } from "./extract.js";
import { expertRouter } from "./expert.js";
import { researchRouter } from "./research.js";
import { type FetchedPage, UrlFetchError, fetchPublicUrl } from "./urlfetch.js";
import { type LlmDoc, getProvider } from "./llm/index.js";
import { packsRouter } from "./packs.js";
import { abortOnClose, hasCredentials, sendApiError } from "./respond.js";
import { resolveSpan } from "./spans.js";
import { MAX_PDF_BYTES, studyCopyFromPdf } from "./study.js";
import type {
  Citation,
  ExtractPdfResponse,
  FetchUrlResponse,
  Segment,
  StyleCheckRequest,
  StyleCheckResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "../shared/types.js";

const MAX_SOURCE_CHARS = 600_000;
const MAX_STYLE_CHARS = 4_000;

export const app = express();
app.use(express.json({ limit: "40mb" }));
app.use("/api/packs", packsRouter);
app.use("/api/expert", expertRouter);
app.use("/api/research", researchRouter);

const SYSTEM_PROMPT = `You are a careful research assistant. You summarise source documents so that a reader can verify every statement against the original text.

Ground every factual statement in the provided documents and cite the passages that support it. Do not add facts, numbers, or opinions that are not in the documents. When several documents are provided, synthesise across them and point out where they agree or disagree. If the documents do not address the requested focus, say so plainly rather than guessing.

Output only the summary itself, with no preamble such as "Here is a summary".`;

function rulesBlock(rules: string[] | undefined): string {
  const list = (rules ?? []).map((r) => r.trim()).filter(Boolean);
  if (list.length === 0) return "";
  return `The summary must follow every one of these writing rules:\n${list.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}

function prioritiesBlock(priorities: string[] | undefined): string {
  const list = (priorities ?? []).map((p) => p.trim()).filter(Boolean);
  if (list.length === 0) return "";
  return `A subject-matter expert ranked these as the most important points in the sources, most important first. Build the summary around them, in roughly this order, giving less space to other material:\n${list.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}

app.post("/api/summarize", async (req, res) => {
  const body = req.body as SummarizeRequest;
  const sources = (body.sources ?? []).filter((s) => s.text?.trim());
  if (sources.length === 0) {
    res.status(400).json({ error: "Add at least one source with some text." });
    return;
  }
  const totalChars = sources.reduce((n, s) => n + s.text.length, 0);
  if (totalChars > MAX_SOURCE_CHARS) {
    res.status(413).json({
      error: `Selected sources total ${totalChars.toLocaleString()} characters; the limit is ${MAX_SOURCE_CHARS.toLocaleString()}. Select fewer sources.`,
    });
    return;
  }
  if (!hasCredentials(res)) return;

  const styleInstructions =
    body.styleInstructions?.trim().slice(0, MAX_STYLE_CHARS) ||
    "Write a thorough summary organised into short paragraphs. Cover the main arguments, key evidence, figures, and conclusions.";
  const documents: LlmDoc[] = sources.map((s) => ({ title: s.title || "Untitled source", text: s.text, citations: true }));
  const instruction = [
    styleInstructions,
    body.focus?.trim() ? `Focus the summary on this question or topic: ${body.focus.trim()}` : "",
    prioritiesBlock(body.priorities),
    rulesBlock(body.rules),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await getProvider().generate({
      system: SYSTEM_PROMPT,
      maxTokens: 32000,
      messages: [{ role: "user", text: instruction, docs: documents }],
      signal: abortOnClose(res),
    });

    if (result.stopReason === "refusal") {
      res.status(422).json({ error: "The model declined to summarise these sources." });
      return;
    }

    const segments: Segment[] = [];
    for (const block of result.blocks) {
      const citations: Citation[] = [];
      for (const c of block.citations) {
        const source = sources[c.docIndex];
        if (!source || c.start === undefined || c.end === undefined) continue;
        const span = resolveSpan(source.text, c.start, c.end, c.quote);
        citations.push({ sourceId: source.id, ...span, quote: c.quote });
      }
      segments.push({ id: `seg-${segments.length}`, text: block.text, citations });
    }
    if (segments.length === 0) {
      res.status(502).json({ error: "The model returned no text. Try again." });
      return;
    }

    const payload: SummarizeResponse = { segments, model: result.model };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "summarising");
  }
});

const STYLE_SYSTEM_PROMPT = `You are a meticulous copy editor. You check a draft summary against a numbered list of writing rules and report every place the draft breaks a rule.

The source documents the summary was written from are provided so you can judge rules about faithfulness to the sources. Do not summarise or critique the sources themselves, only the draft.

For each rule, decide whether the whole draft passes, with a one-sentence note. For each violation:
- "quote" must be copied character-for-character from the draft: the shortest complete phrase or sentence that contains the problem. Never paraphrase it, and never span more than one sentence.
- "suggestion" is replacement text for exactly that quote which fixes the problem, keeps the rest of the meaning, and stays faithful to the sources. Use an empty string if the text should simply be deleted.
- Report each problem once, under the rule it breaks.
Be strict but precise: flag real violations only, not stylistic preferences outside the rules.`;

const StyleCheckSchema = z.object({
  results: z.array(z.object({ rule: z.number().int(), passed: z.boolean(), note: z.string() })),
  violations: z.array(
    z.object({ rule: z.number().int(), quote: z.string(), explanation: z.string(), suggestion: z.string() }),
  ),
});

app.post("/api/check-style", async (req, res) => {
  const body = req.body as StyleCheckRequest;
  const rules = (body.rules ?? []).map((r) => r.trim()).filter(Boolean);
  if (!body.text?.trim() || rules.length === 0) {
    res.status(400).json({ error: "Nothing to check: the summary or the rule list is empty." });
    return;
  }
  if (!hasCredentials(res)) return;

  const documents: LlmDoc[] = (body.sources ?? [])
    .filter((s) => s.text?.trim())
    .map((s) => ({ title: s.title || "Untitled source", text: s.text }));

  try {
    const result = await getProvider().structured({
      system: STYLE_SYSTEM_PROMPT,
      signal: abortOnClose(res),
      docs: documents,
      prompt: `Rules (numbered from 1):\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n<draft>\n${body.text}\n</draft>`,
      schema: StyleCheckSchema,
      maxTokens: 32000,
    });

    if (result.refused) {
      res.status(422).json({ error: "The model declined to review this draft." });
      return;
    }
    const parsed = result.value;
    if (!parsed) {
      res.status(502).json({ error: "The style check came back in an unexpected format. Try again." });
      return;
    }

    // Rules are numbered from 1 in the prompt; the client uses 0-based indexes.
    const inRange = (n: number) => n >= 1 && n <= rules.length;
    const payload: StyleCheckResponse = {
      results: parsed.results.filter((r) => inRange(r.rule)).map((r) => ({ ...r, rule: r.rule - 1 })),
      violations: parsed.violations
        // Violations whose quote isn't found verbatim are kept; the client lists them without a highlight.
        .filter((v) => inRange(v.rule) && v.quote.trim())
        .map((v) => ({ ...v, rule: v.rule - 1 })),
    };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "checking style");
  }
});

app.post("/api/fetch-url", async (req, res) => {
  const raw = String((req.body as { url?: string }).url ?? "");
  let page: FetchedPage;
  try {
    // Refuses private and internal addresses, and stops downloading past the size limit.
    page = await fetchPublicUrl(raw, { maxBytes: MAX_PDF_BYTES });
  } catch (err) {
    if (err instanceof UrlFetchError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(502).json({ error: "Couldn't fetch that URL. Some sites block automated requests; try pasting the text." });
    }
    return;
  }

  const { url, contentType, body } = page;
  const fallbackTitle = url.hostname + url.pathname;
  if (contentType.includes("pdf") || body.subarray(0, 5).toString() === "%PDF-") {
    // PDF reports (common in government and academic research) go through the study-copy conversion.
    if (!hasCredentials(res)) return;
    try {
      const { title, text } = await studyCopyFromPdf(body, abortOnClose(res));
      const payload: FetchUrlResponse = { title: title || fallbackTitle, text, url: url.toString() };
      res.json(payload);
    } catch (err) {
      sendApiError(res, err, "reading the PDF");
    }
    return;
  }
  const bodyText = body.toString("utf8");
  const extracted = contentType.includes("html") ? htmlToText(bodyText) : { title: "", text: bodyText.trim() };
  if (!extracted.text) {
    res.status(422).json({ error: "Couldn't find readable text on that page. Try pasting it instead." });
    return;
  }
  const payload: FetchUrlResponse = { title: extracted.title || fallbackTitle, text: extracted.text, url: url.toString() };
  res.json(payload);
});

// Convert a PDF source into text (tables transcribed, figures described) for summarising.
app.post("/api/extract-pdf", express.raw({ type: () => true, limit: MAX_PDF_BYTES }), async (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString() !== "%PDF-") {
    res.status(415).json({ error: "That file isn't a PDF." });
    return;
  }
  if (!hasCredentials(res)) return;
  try {
    const { title, text } = await studyCopyFromPdf(body, abortOnClose(res));
    const payload: ExtractPdfResponse = { title, text };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "reading the PDF");
  }
});

app.get("/api/health", (_req, res) => {
  const provider = getProvider();
  const ready = provider.credentialsError() === null;
  res.json({ ok: true, provider: provider.id, model: provider.model, ready, hasKey: ready });
});

// In production, serve the built client.
const dist = path.resolve(import.meta.dirname, "../dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
