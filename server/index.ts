import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BetaRequestDocumentBlock, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages";
import { htmlToText } from "./extract.js";
import type {
  Citation,
  FetchUrlResponse,
  Segment,
  StyleCheckRequest,
  StyleCheckResponse,
  SummarizeRequest,
  SummarizeResponse,
  SummaryStyle,
} from "../shared/types.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
const MAX_SOURCE_CHARS = 600_000;

const app = express();
app.use(express.json({ limit: "20mb" }));

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const STYLE_INSTRUCTIONS: Record<SummaryStyle, string> = {
  brief: "Write a brief summary: one or two short paragraphs capturing only the most important points.",
  detailed:
    "Write a thorough summary organised into short paragraphs. Cover the main arguments, key evidence, figures, and conclusions.",
  bullets: "Write the summary as a list of concise bullet points, one idea per bullet, each starting with \"- \".",
};

const SYSTEM_PROMPT = `You are a careful research assistant. You summarise source documents so that a reader can verify every statement against the original text.

Ground every factual statement in the provided documents and cite the passages that support it. Do not add facts, numbers, or opinions that are not in the documents. When several documents are provided, synthesise across them and point out where they agree or disagree. If the documents do not address the requested focus, say so plainly rather than guessing.

Output only the summary itself, with no preamble such as "Here is a summary".`;

function rulesBlock(rules: string[] | undefined): string {
  const list = (rules ?? []).map((r) => r.trim()).filter(Boolean);
  if (list.length === 0) return "";
  return `The summary must follow every one of these writing rules:\n${list.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}

/** Map an API failure onto a response the client can show. */
function sendApiError(res: express.Response, err: unknown, action: string): void {
  console.error(err);
  if (err instanceof Anthropic.AuthenticationError) {
    res.status(401).json({ error: "The Anthropic API rejected the API key. Check ANTHROPIC_API_KEY." });
  } else if (err instanceof Anthropic.RateLimitError) {
    res.status(429).json({ error: "Rate limited by the Anthropic API. Wait a moment and try again." });
  } else if (err instanceof Anthropic.APIError) {
    res.status(502).json({ error: `Anthropic API error: ${err.message}` });
  } else {
    res.status(500).json({ error: `Unexpected server error while ${action}.` });
  }
}

function hasCredentials(res: express.Response): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  res.status(500).json({ error: "The server has no ANTHROPIC_API_KEY. Add it to .env and restart." });
  return false;
}

/**
 * The API reports character offsets into the document text. Map them onto JS string
 * indices and make sure the span really contains the quoted text, searching nearby
 * if the offsets disagree (e.g. code point vs UTF-16 differences with emoji).
 */
function resolveSpan(text: string, start: number, end: number, quote: string): { start: number; end: number } {
  if (text.slice(start, end) === quote) return { start, end };

  // Treat the offsets as code point indices.
  const codepoints = Array.from(text);
  const cpStart = codepoints.slice(0, start).join("").length;
  const cpEnd = cpStart + codepoints.slice(start, end).join("").length;
  if (text.slice(cpStart, cpEnd) === quote) return { start: cpStart, end: cpEnd };

  // Fall back to finding the quote closest to the reported position.
  const trimmed = quote.trim();
  if (trimmed) {
    let best = -1;
    for (let i = text.indexOf(trimmed); i !== -1; i = text.indexOf(trimmed, i + 1)) {
      if (best === -1 || Math.abs(i - start) < Math.abs(best - start)) best = i;
    }
    if (best !== -1) return { start: best, end: best + trimmed.length };
  }

  const s = Math.max(0, Math.min(start, text.length));
  return { start: s, end: Math.max(s, Math.min(end, text.length)) };
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

  const style: SummaryStyle = body.style in STYLE_INSTRUCTIONS ? body.style : "detailed";
  const documents: BetaRequestDocumentBlock[] = sources.map((s) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: s.text },
    title: s.title || "Untitled source",
    citations: { enabled: true },
  }));
  const instruction: BetaTextBlockParam = {
    type: "text",
    text: [
      STYLE_INSTRUCTIONS[style],
      body.focus?.trim() ? `Focus the summary on this question or topic: ${body.focus.trim()}` : "",
      rulesBlock(body.rules),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      // If the primary model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: [...documents, instruction] }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to summarise these sources." });
      return;
    }

    const segments: Segment[] = [];
    for (const block of message.content) {
      if (block.type !== "text") continue;
      const citations: Citation[] = [];
      for (const c of block.citations ?? []) {
        if (c.type !== "char_location") continue;
        const source = sources[c.document_index];
        if (!source) continue;
        const span = resolveSpan(source.text, c.start_char_index, c.end_char_index, c.cited_text);
        citations.push({ sourceId: source.id, ...span, quote: c.cited_text });
      }
      segments.push({ id: `seg-${segments.length}`, text: block.text, citations });
    }

    const payload: SummarizeResponse = { segments, model: message.model };
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

  const documents: BetaRequestDocumentBlock[] = (body.sources ?? [])
    .filter((s) => s.text?.trim())
    .map((s) => ({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: s.text },
      title: s.title || "Untitled source",
    }));

  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: STYLE_SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(StyleCheckSchema) },
      messages: [
        {
          role: "user",
          content: [
            ...documents,
            {
              type: "text",
              text: `Rules (numbered from 1):\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n<draft>\n${body.text}\n</draft>`,
            },
          ],
        },
      ],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to review this draft." });
      return;
    }
    const parsed = message.parsed_output;
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
  const raw = String((req.body as { url?: string }).url ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    res.status(400).json({ error: "Enter a full http(s) URL." });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: { "user-agent": "SourceLens/0.1 (research summariser)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: `The page returned HTTP ${response.status}.` });
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();
    const extracted = contentType.includes("html") ? htmlToText(bodyText) : { title: "", text: bodyText.trim() };
    if (!extracted.text) {
      res.status(422).json({ error: "Couldn't find readable text on that page. Try pasting it instead." });
      return;
    }
    const payload: FetchUrlResponse = {
      title: extracted.title || url.hostname + url.pathname,
      text: extracted.text,
      url: url.toString(),
    };
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Couldn't fetch that URL. Some sites block automated requests; try pasting the text." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

// In production, serve the built client.
const dist = path.resolve(import.meta.dirname, "../dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Source Lens server on http://localhost:${PORT} (model: ${MODEL})`);
});
