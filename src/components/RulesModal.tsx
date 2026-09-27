import { useState } from "react";
import { DEFAULT_RULES, parseWordLimit } from "../../shared/rules";

interface Props {
  rules: string[];
  onSave: (rules: string[]) => void;
  onClose: () => void;
}

export function RulesModal({ rules, onSave, onClose }: Props) {
  const [text, setText] = useState(rules.join("\n"));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Style rules">
        <div className="modal-head">
          <h2>Style rules</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          One rule per line, in plain English. New summaries are written to follow them, and <strong>Check style</strong> reviews a
          draft against them. Word limits (“no more than 250 words”) are counted by the app; Claude judges the rest.
        </p>
        <label className="field grow">
          <span>Rules</span>
          <textarea className="rules-textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        <ul className="rule-preview">
          {lines.map((l, i) => (
            <li key={i}>
              <span className={`badge ${parseWordLimit(l) ? "by-app" : "by-claude"}`}>{parseWordLimit(l) ? "counted" : "Claude"}</span>
              {l}
            </li>
          ))}
        </ul>
        <div className="modal-foot">
          <button className="link" onClick={() => setText(DEFAULT_RULES.join("\n"))}>Reset to defaults</button>
          <button className="primary" onClick={() => onSave(lines)}>Save rules</button>
        </div>
      </div>
    </div>
  );
}
