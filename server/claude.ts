// Shared Anthropic client setup and helpers used by every route.

import type express from "express";
import Anthropic from "@anthropic-ai/sdk";

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/** Request fields shared by every call: if the primary model declines, the API retries on a fallback model. */
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as string[],
  fallbacks: "default" as const,
};

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function hasCredentials(res: express.Response): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  res.status(500).json({ error: "The server has no ANTHROPIC_API_KEY. Add it to .env and restart." });
  return false;
}

/** Map an API failure onto a response the client can show. */
export function sendApiError(res: express.Response, err: unknown, action: string): void {
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

/**
 * The API reports character offsets into the document text. Map them onto JS string
 * indices and make sure the span really contains the quoted text, searching nearby
 * if the offsets disagree (e.g. code point vs UTF-16 differences with emoji).
 */
export function resolveSpan(text: string, start: number, end: number, quote: string): { start: number; end: number } {
  if (text.slice(start, end) === quote) return { start, end };

  // Treat the offsets as code point indices.
  const codepoints = Array.from(text);
  const cpStart = codepoints.slice(0, start).join("").length;
  const cpEnd = cpStart + codepoints.slice(start, end).join("").length;
  if (text.slice(cpStart, cpEnd) === quote) return { start: cpStart, end: cpEnd };

  // Fall back to finding the quote closest to the reported position.
  const found = findQuote(text, quote, start);
  if (found) return found;

  const s = Math.max(0, Math.min(start, text.length));
  return { start: s, end: Math.max(s, Math.min(end, text.length)) };
}

/**
 * Find a quote the model copied from a document. Tries an exact match first, then a match
 * that tolerates differences in whitespace and quote characters. Picks the occurrence
 * nearest `near` when there are several.
 */
export function findQuote(text: string, quote: string, near = 0): { start: number; end: number } | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;

  let best = -1;
  for (let i = text.indexOf(trimmed); i !== -1; i = text.indexOf(trimmed, i + 1)) {
    if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  if (best !== -1) return { start: best, end: best + trimmed.length };

  const pattern = trimmed
    .split(/\s+/)
    .map((word) =>
      word
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/["“”]/g, "[\"“”]")
        .replace(/['‘’]/g, "['‘’]")
        .replace(/[-–—]/g, "[-–—]"),
    )
    .join("\\s+");
  let match: { start: number; end: number } | null = null;
  for (const m of text.matchAll(new RegExp(pattern, "g"))) {
    if (!match || Math.abs(m.index - near) < Math.abs(match.start - near)) match = { start: m.index, end: m.index + m[0].length };
  }
  return match;
}

/** The page a character offset falls on, from "[Page N]" markers in a study copy. */
export function pageAt(text: string, offset: number): number | undefined {
  let page: number | undefined;
  for (const m of text.slice(0, offset + 1).matchAll(/\[Page (\d+)\]/g)) page = Number(m[1]);
  return page;
}
