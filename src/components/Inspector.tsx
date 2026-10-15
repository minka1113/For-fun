// The claim inspector: one draft sentence, its quoted evidence, and verify / flag / edit.

import { useEffect, useState } from "react";
import type { Citation, Segment, Source, Verdict } from "../../shared/types";

interface InspectorProps {
  seg?: Segment;
  sources: Source[];
  verdict?: Verdict;
  citeNumbers: Map<Citation, number>;
  onVerdict: (v: Verdict | null) => void;
  onCite: (c: Citation) => void;
  onEdit: (text: string) => void;
  onClose: () => void;
}

export function Inspector({ seg, sources, verdict, citeNumbers, onVerdict, onCite, onEdit, onClose }: InspectorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [seg?.id]);

  if (!seg) {
    return (
      <div className="inspector empty">
        Hover a sentence to see where it came from. Click to pin it and review. <kbd>j</kbd>/<kbd>k</kbd> step through
        claims, <kbd>v</kbd> verify, <kbd>f</kbd> flag.
      </div>
    );
  }
  const titleOf = (id: string) => sources.find((s) => s.id === id)?.title ?? "Unknown source";
  return (
    <div className="inspector">
      <div className="inspector-head">
        <strong>Claim</strong>
        <div className="verdict-buttons">
          <button className={verdict === "ok" ? "on ok" : ""} onClick={() => onVerdict(verdict === "ok" ? null : "ok")}>
            ✓ Supported
          </button>
          <button className={verdict === "flag" ? "on flag" : ""} onClick={() => onVerdict(verdict === "flag" ? null : "flag")}>
            ⚑ Flag
          </button>
          {draft === null && <button onClick={() => setDraft(seg.text)}>Edit</button>}
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      {draft === null ? (
        <p className="inspector-claim">
          {seg.text.trim()}
          {seg.edited && <span className="edited-tag">edited</span>}
        </p>
      ) : (
        <div className="edit-box">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="edit-actions">
            <span className="muted small">Links to the source stay attached. The sentence goes back to unreviewed.</span>
            <button onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                onEdit(draft);
                setDraft(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      {seg.citations.length === 0 ? (
        <p className="warn-text">No citation. This statement isn't tied to any passage in the sources, so check it or remove it.</p>
      ) : (
        <ul className="quotes">
          {seg.citations.map((c) => (
            <li key={`${c.sourceId}:${c.start}`} onClick={() => onCite(c)}>
              <span className="cite-chip static">{citeNumbers.get(c)}</span>
              <blockquote>{c.quote.trim()}</blockquote>
              <span className="quote-source">{titleOf(c.sourceId)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
