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

/** A limit on the whole draft's length. Limits on parts ("each bullet under 30 words") are left for Claude to judge. */
export function parseWordLimit(rule: string): WordLimit | null {
  if (/\b(each|every|per|bullets?|sentences?|paragraphs?|points?|lines?|headings?|titles?)\b/i.test(rule)) return null;
  const m = rule.match(WORD_LIMIT);
  if (!m) return null;
  const strict = /^(under|fewer than|less than|below)$/i.test(m[1]);
  return { max: Number(m[2].replace(/,/g, "")), strict };
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,]*/gu)?.length ?? 0;
}

export function withinLimit(words: number, limit: WordLimit): boolean {
  return limit.strict ? words < limit.max : words <= limit.max;
}
