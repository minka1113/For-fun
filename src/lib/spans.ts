import type { Segment } from "../../shared/types";

/** A run of source text and the summary segments whose citations cover it. */
export interface Fragment {
  start: number;
  end: number;
  segIds: string[];
}

/** Split a source's text into fragments at every citation boundary. */
export function fragmentSource(text: string, sourceId: string, segments: Segment[]): Fragment[] {
  const ranges: { start: number; end: number; segId: string }[] = [];
  for (const seg of segments) {
    for (const c of seg.citations) {
      if (c.sourceId === sourceId && c.end > c.start) ranges.push({ start: c.start, end: c.end, segId: seg.id });
    }
  }
  const cuts = new Set([0, text.length]);
  for (const r of ranges) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const fragments: Fragment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const segIds = [...new Set(ranges.filter((r) => r.start <= start && r.end >= end).map((r) => r.segId))];
    fragments.push({ start, end, segIds });
  }
  return fragments;
}

/** Fraction of a source's characters cited at least once. */
export function coverage(text: string, sourceId: string, segments: Segment[]): number {
  if (!text.length) return 0;
  const covered = fragmentSource(text, sourceId, segments)
    .filter((f) => f.segIds.length > 0)
    .reduce((n, f) => n + (f.end - f.start), 0);
  return covered / text.length;
}

/** Uncited text that reads like a claim (not just a bullet marker or line break). */
export function isUnsupported(seg: Segment): boolean {
  return seg.citations.length === 0 && seg.text.trim().split(/\s+/).filter((w) => /\w/.test(w)).length >= 4;
}
