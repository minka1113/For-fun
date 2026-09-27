import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRequestDocumentBlock, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages";
import { htmlToText } from "./extract.js";
import type { Citation, FetchUrlResponse, Segment, SummarizeRequest, SummarizeResponse, SummaryStyle } from "../shared/types.js";

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
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    res.status(500).json({ error: "The server has no ANTHROPIC_API_KEY. Add it to .env and restart." });
    return;
  }

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
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(401).json({ error: "The Anthropic API rejected the API key. Check ANTHROPIC_API_KEY." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Rate limited by the Anthropic API. Wait a moment and try again." });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `Anthropic API error: ${err.message}` });
    } else {
      res.status(500).json({ error: "Unexpected server error while summarising." });
    }
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
