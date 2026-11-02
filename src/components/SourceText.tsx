// A source document with the passages the draft cites, and the expert's key passages, marked.

import { useMemo } from "react";
import type { KeyPoint, Segment, Source, Verdict } from "../../shared/types";
import { fragmentSource, type KeyRange } from "../lib/spans";

const TAG_SHORT: Record<string, string> = { policy: "Policy", new: "New", contradicts: "Contradicts", confirms: "Confirms" };

interface SourceTextProps {
  source: Source;
  segments: Segment[];
  activeId: string | null;
  flagged: Record<string, Verdict>;
  keyPoints: KeyPoint[];
  selectedPoint: string | null;
  onPickPoint: (id: string) => void;
  onHover: (segIds: string[]) => void;
  onPick: (segId: string) => void;
}

export function SourceText({ source, segments, activeId, flagged, keyPoints, selectedPoint, onPickPoint, onHover, onPick }: SourceTextProps) {
  const mine = useMemo(() => keyPoints.filter((k) => k.source.sourceId === source.id && k.source.start >= 0), [keyPoints, source.id]);
  const keyRanges = useMemo<KeyRange[]>(() => mine.map((k) => ({ id: k.id, start: k.source.start, end: k.source.end })), [mine]);
  const fragments = useMemo(() => fragmentSource(source.text, source.id, segments, keyRanges), [source, segments, keyRanges]);
  const startsAt = useMemo(() => new Map(mine.map((k) => [k.source.start, k])), [mine]);
  return (
    <div className="source-text" onMouseLeave={() => onHover([])}>
      {source.origin && <div className="origin">{source.origin}</div>}
      {fragments.map((f) => {
        const text = source.text.slice(f.start, f.end);
        const point = startsAt.get(f.start);
        const tag = point && (
          <button key={`tag-${point.id}`} className={`key-tag ${point.id === selectedPoint ? "selected" : ""}`} onClick={() => onPickPoint(point.id)} title={point.point}>
            ✦ {point.tags.map((t) => TAG_SHORT[t]).join(" · ") || "Key"}
          </button>
        );
        if (f.segIds.length === 0 && f.pointIds.length === 0) return <span key={f.start}>{text}</span>;
        const isActive = activeId !== null && f.segIds.includes(activeId);
        const isFlagged = f.segIds.some((id) => flagged[id] === "flag");
        const cls = [
          f.segIds.length ? "cited" : "",
          isActive ? "active" : "",
          isFlagged ? "flagged" : "",
          f.segIds.length > 1 ? "multi" : "",
          f.pointIds.length ? "key" : "",
          selectedPoint && f.pointIds.includes(selectedPoint) ? "key-selected" : "",
        ].join(" ");
        return (
          <span key={f.start}>
            {tag}
            <mark
              data-start={f.start}
              className={cls}
              onMouseEnter={() => onHover(f.segIds)}
              onClick={() => (f.segIds.length ? onPick(f.segIds[0]) : onPickPoint(f.pointIds[0]))}
              title={
                f.segIds.length
                  ? `Cited by ${f.segIds.length} part${f.segIds.length === 1 ? "" : "s"} of the summary`
                  : "A key passage marked by the expert"
              }
            >
              {text}
            </mark>
          </span>
        );
      })}
    </div>
  );
}
