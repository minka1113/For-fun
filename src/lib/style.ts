import type { Segment, StyleCheck, Summary, Verdict, Violation } from "../../shared/types";
import { countWords, parseWordLimit, withinLimit } from "../../shared/rules";

export function fullText(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

export interface Located {
  violation: Violation;
  /** Range in the full summary text, or null if the quote no longer appears. */
  range: { start: number; end: number } | null;
}

export function locateViolations(check: StyleCheck | undefined, text: string): Located[] {
  if (!check) return [];
  return check.violations.map((violation) => {
    const start = text.indexOf(violation.quote);
    return { violation, range: start === -1 ? null : { start, end: start + violation.quote.length } };
  });
}

export type MarkKind = "style" | "edit" | "low-value";

/** A piece of draft text to highlight, located in the full summary text. */
export interface DraftAnnotation {
  id: string;
  kind: MarkKind;
  range: { start: number; end: number } | null;
}

/** Find where each quoted piece of draft text currently is. */
export function locateInDraft(items: { id: string; quote: string }[], kind: MarkKind, text: string): DraftAnnotation[] {
  return items.map(({ id, quote }) => {
    const start = quote ? text.indexOf(quote) : -1;
    return { id, kind, range: start === -1 ? null : { start, end: start + quote.length } };
  });
}

/** A highlight clipped to one segment, in that segment's own offsets. */
export interface SegmentMark {
  id: string;
  kind: MarkKind;
  start: number;
  end: number;
}

export function marksBySegment(segments: Segment[], annotations: DraftAnnotation[]): Map<string, SegmentMark[]> {
  const out = new Map<string, SegmentMark[]>();
  let offset = 0;
  for (const seg of segments) {
    const segEnd = offset + seg.text.length;
    for (const { id, kind, range } of annotations) {
      if (!range || range.end <= offset || range.start >= segEnd) continue;
      const list = out.get(seg.id) ?? [];
      list.push({ id, kind, start: Math.max(range.start, offset) - offset, end: Math.min(range.end, segEnd) - offset });
      out.set(seg.id, list);
    }
    offset = segEnd;
  }
  return out;
}

/**
 * Replace a range of the full summary text. Segments the range touches are merged into one
 * (keeping all of their citations) so the replacement text stays linked to its sources.
 * Returns the new segments and the ids of segments whose text changed.
 */
export function replaceRange(
  segments: Segment[],
  start: number,
  end: number,
  replacement: string,
): { segments: Segment[]; changed: string[] } {
  const out: Segment[] = [];
  let offset = 0;
  let merged: Segment | null = null;
  let mergedIndex = -1;
  const changed: string[] = [];
  for (const seg of segments) {
    const segStart = offset;
    const segEnd = offset + seg.text.length;
    offset = segEnd;
    if (start >= segEnd || end <= segStart) {
      out.push(seg);
      continue;
    }
    changed.push(seg.id);
    const before = start > segStart ? seg.text.slice(0, start - segStart) : "";
    const after = end < segEnd ? seg.text.slice(end - segStart) : "";
    if (!merged) {
      merged = { ...seg, text: before + replacement + after, citations: [...seg.citations], edited: true };
      mergedIndex = out.length;
      out.push(merged);
    } else {
      merged.text += after;
      merged.citations.push(...seg.citations);
    }
  }
  return { segments: mergedIndex === -1 ? out : tidy(out, mergedIndex), changed };
}

/**
 * Collapse doubled spaces left behind by an edit, then drop segments that are now empty. Only the
 * edited segment, the whitespace-only segments around it and the edges of its neighbours are
 * touched, so text elsewhere in the draft (such as "a ratio of 3 : 1") is never altered.
 */
function tidy(segments: Segment[], edited: number): Segment[] {
  const text = segments.map((s) => s.text);
  const blank = (i: number) => /^\s*$/.test(text[i]);
  let first = edited;
  let last = edited;
  while (first > 0 && blank(first - 1)) first--;
  while (last < text.length - 1 && blank(last + 1)) last++;
  const lo = Math.max(0, first - 1); // neighbours: only their touching edge is trimmed
  const hi = Math.min(text.length - 1, last + 1);

  for (let i = first; i <= last; i++) text[i] = text[i].replace(/ {2,}/g, " ").replace(/ +([.,;:\n])/g, "$1");
  // The nearest segment before i that still has text (an edit can leave segments empty).
  const before = (i: number) => {
    let j = i - 1;
    while (j >= lo && text[j] === "") j--;
    return j;
  };
  for (let i = lo + 1; i <= hi; i++) {
    const p = before(i);
    if (p < lo || text[i] === "") continue;
    // A space at the end of one segment followed by one at the start of the next.
    if (text[i].startsWith(" ") && /\s$/.test(text[p])) text[i] = text[i].slice(1);
    // A space before punctuation that starts the next segment.
    if (/^[.,;:]/.test(text[i]) && / $/.test(text[p]) && p >= first) text[p] = text[p].replace(/ +$/, "");
  }
  // Trailing spaces before a line break that starts a later segment (skipping emptied ones).
  for (let i = hi; i > lo; i--) {
    if (!text[i].startsWith("\n")) continue;
    for (let j = i - 1; j >= lo; j--) {
      text[j] = text[j].replace(/ +$/, "");
      if (text[j]) break;
    }
  }
  return segments
    .map((s, i) => (s.text === text[i] ? s : { ...s, text: text[i] }))
    .filter((s) => s.text.length > 0 || s.citations.length > 0);
}

/** Apply a new segment list to a summary; edited segments go back to unreviewed. */
export function withSegments(summary: Summary, segments: Segment[], changed: string[]): Summary {
  const review: Record<string, Verdict> = {};
  for (const [id, v] of Object.entries(summary.review)) if (!changed.includes(id)) review[id] = v;
  return { ...summary, segments, review };
}

export type RuleStatus = "pass" | "fail" | "recheck" | "unchecked";

export interface RuleRow {
  rule: string;
  checkedBy: "app" | "claude";
  status: RuleStatus;
  note: string;
  violations: Located[];
}

/** Current status of every rule, combining live app checks with the last Claude check. */
export function ruleRows(rules: string[], summary: Summary, text: string, located: Located[]): RuleRow[] {
  const check = summary.styleCheck;
  const changed = check ? check.checkedText !== text : false;
  return rules.map((rule) => {
    const limit = parseWordLimit(rule);
    if (limit) {
      const words = countWords(text);
      const ok = withinLimit(words, limit);
      return {
        rule,
        checkedBy: "app",
        status: ok ? "pass" : "fail",
        note: `${words} words${ok ? "" : `: ${words - limit.max + (limit.strict ? 1 : 0)} over the limit`}.`,
        violations: [],
      };
    }
    const index = check?.rules.indexOf(rule) ?? -1;
    const result = check?.results.find((r) => r.rule === index);
    if (!check || index === -1 || !result) {
      return { rule, checkedBy: "claude", status: "unchecked", note: "Not checked yet.", violations: [] };
    }
    const mine = located.filter((l) => l.violation.rule === index);
    const open = mine.filter((l) => l.range || !changed);
    let status: RuleStatus;
    if (open.length > 0) status = "fail";
    else if (changed) status = "recheck";
    else status = result.passed ? "pass" : "fail";
    return { rule, checkedBy: "claude", status, note: result.note, violations: open };
  });
}

/** Replace the first occurrence of `quote` in the draft; null if it's no longer there. */
export function applyQuoteEdit(summary: Summary, quote: string, replacement: string): Summary | null {
  const start = quote ? fullText(summary.segments).indexOf(quote) : -1;
  if (start === -1) return null;
  const { segments, changed } = replaceRange(summary.segments, start, start + quote.length, replacement);
  return withSegments(summary, segments, changed);
}
