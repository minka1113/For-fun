// Style rules are written in plain English. Rules the app can check exactly (word limits)
// are handled in code; everything else is judged by Claude.

/** Rules every drafting style follows, on top of its own. */
export const DEFAULT_SHARED_RULES = [
  "Always in past tense",
  "Only facts from the sources, no assessment or inference",
];

export interface WordLimit {
  max: number;
  /** "under 250 words" means at most 249. */
  strict: boolean;
}

const WORD_LIMIT = /\b(no more than|not more than|at most|max(?:imum)?(?: of)?|up to|under|fewer than|less than|below)\s+(\d[\d,]*)\s+words?\b/i;

/** Words that can lead into a whole-draft limit ("Keep it under 250 words", "Total length: no more than…"). */
const LEAD_IN = new Set(["keep", "it", "the", "to", "be", "should", "must", "a", "total", "in", "length", "overall", "of", "is", "at", "with"]);
/** Nouns that make a limit clearly about the whole draft. */
const WHOLE_DRAFT = /\b(summary|summaries|draft|briefing|brief|document|report|overall|total|whole|entire)\b/i;

/**
 * A limit on the whole draft's length. Limits on parts ("each bullet under 30 words", "Headline of
 * no more than 12 words") are left for Claude to judge.
 */
export function parseWordLimit(rule: string): WordLimit | null {
  if (/\b(each|every|per|bullets?|sentences?|paragraphs?|points?|lines?|headings?|headlines?|titles?|quotes?|captions?)\b/i.test(rule)) return null;
  const m = rule.match(WORD_LIMIT);
  if (!m) return null;
  // Whatever comes before the limit must be a plain lead-in, or name the whole draft.
  const before = rule.slice(0, m.index).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!before.every((w) => LEAD_IN.has(w)) && !WHOLE_DRAFT.test(rule)) return null;
  const strict = /^(under|fewer than|less than|below)$/i.test(m[1]);
  return { max: Number(m[2].replace(/,/g, "")), strict };
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,]*/gu)?.length ?? 0;
}

export function withinLimit(words: number, limit: WordLimit): boolean {
  return limit.strict ? words < limit.max : words <= limit.max;
}
