// Style rules are written in plain English. Rules the app can check exactly (word limits)
// are handled in code; everything else is judged by Claude.

export const DEFAULT_RULES = [
  "Always in past tense",
  "Text only includes facts from the sources, do not inject any assessment or inference",
  "No more than 250 words",
];

export interface WordLimit {
  max: number;
  /** "under 250 words" means at most 249. */
  strict: boolean;
}

const WORD_LIMIT = /\b(no more than|not more than|at most|max(?:imum)?(?: of)?|up to|under|fewer than|less than|below)\s+(\d[\d,]*)\s+words?\b/i;

export function parseWordLimit(rule: string): WordLimit | null {
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
