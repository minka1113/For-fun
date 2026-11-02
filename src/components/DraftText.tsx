// A draft sentence as shown in the compare view: its citation chips, review mark and highlights.

import type { Citation, Segment, Verdict } from "../../shared/types";
import type { MarkKind, SegmentMark } from "../lib/style";

interface SegmentViewProps {
  seg: Segment;
  active: boolean;
  pinned: boolean;
  linked: boolean;
  verdict?: Verdict;
  unsupported: boolean;
  citeNumbers: Map<Citation, number>;
  marks?: SegmentMark[];
  activeMark: string | null;
  onMark: (id: string, kind: MarkKind) => void;
  onHover: () => void;
  onClick: () => void;
  onCite: (c: Citation) => void;
}

export function SegmentView(props: SegmentViewProps) {
  const { seg, active, pinned, linked, verdict, unsupported, citeNumbers, onHover, onClick, onCite } = props;
  const interactive = seg.citations.length > 0 || unsupported;
  const body = <MarkedText text={seg.text} marks={props.marks} active={props.activeMark} onPick={props.onMark} />;
  if (!interactive) return <span>{body}</span>;
  const cls = [
    "seg",
    seg.citations.length ? "cited" : "",
    unsupported ? "unsupported" : "",
    active ? "active" : "",
    pinned ? "pinned" : "",
    linked ? "linked" : "",
    verdict ? `verdict-${verdict}` : "",
  ].join(" ");
  return (
    <>
      <span className={cls} data-seg={seg.id} onMouseEnter={onHover} onClick={onClick}>
        {body}
        {verdict === "ok" && <span className="verdict-mark ok" aria-label="verified">✓</span>}
        {verdict === "flag" && <span className="verdict-mark flag" aria-label="flagged">⚑</span>}
      </span>
      {seg.citations.map((c) => (
        <button
          key={`${c.sourceId}:${c.start}:${c.end}`}
          className="cite-chip"
          title={c.quote}
          onMouseEnter={onHover}
          onClick={(e) => {
            e.stopPropagation();
            onCite(c);
          }}
        >
          {citeNumbers.get(c)}
        </button>
      ))}
    </>
  );
}

const MARK_TITLE: Record<MarkKind, string> = {
  style: "Breaks a style rule; click for details",
  edit: "The expert suggests an edit here; click for details",
  "low-value": "The expert rates this as lower-value; click for details",
};

/** Segment text with style-violation and expert highlights. */
function MarkedText({
  text,
  marks,
  active,
  onPick,
}: {
  text: string;
  marks?: SegmentMark[];
  active: string | null;
  onPick: (id: string, kind: MarkKind) => void;
}) {
  if (!marks?.length) return <>{text}</>;
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos) continue; // overlapping violation; the first one wins
    if (m.start > pos) parts.push(text.slice(pos, m.start));
    parts.push(
      <span
        key={m.id}
        data-mark={m.id}
        className={`${m.kind}-mark ${active === m.id ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onPick(m.id, m.kind);
        }}
        title={MARK_TITLE[m.kind]}
      >
        {text.slice(m.start, m.end)}
      </span>,
    );
    pos = m.end;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}
