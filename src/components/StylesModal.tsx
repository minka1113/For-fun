import { useState } from "react";
import type { DraftStyle } from "../../shared/types";
import { DEFAULT_STYLES } from "../../shared/styles";
import { uid } from "../lib/storage";

interface Props {
  styles: DraftStyle[];
  onSave: (styles: DraftStyle[]) => void;
  onClose: () => void;
}

export function StylesModal({ styles, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<DraftStyle[]>(() => structuredClone(styles));
  const update = (id: string, patch: Partial<DraftStyle>) => setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const valid = draft.filter((s) => s.name.trim() && s.instructions.trim());

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Drafting styles">
        <div className="modal-head">
          <h2>Drafting styles</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          The options in the style menu next to Summarise. Each style's instructions tell Claude how to shape the draft. Your style
          rules still apply on top of whichever style you pick.
        </p>
        <div className="style-editor">
          {draft.map((s) => (
            <div key={s.id} className="style-card">
              <div className="style-card-head">
                <input value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} placeholder="Style name" aria-label="Style name" />
                <button className="danger" onClick={() => setDraft((d) => d.filter((x) => x.id !== s.id))} disabled={draft.length === 1}>
                  Remove
                </button>
              </div>
              <textarea
                value={s.instructions}
                onChange={(e) => update(s.id, { instructions: e.target.value })}
                placeholder="How should the draft be written? Structure, length, audience, tone…"
                aria-label={`Instructions for ${s.name}`}
              />
            </div>
          ))}
          <button className="add-btn" onClick={() => setDraft((d) => [...d, { id: uid("style"), name: "", instructions: "" }])}>
            + Add style
          </button>
        </div>
        <div className="modal-foot">
          <button className="link" onClick={() => setDraft(structuredClone(DEFAULT_STYLES))}>Reset to defaults</button>
          <button className="primary" disabled={valid.length === 0} onClick={() => onSave(valid)}>
            Save styles
          </button>
        </div>
      </div>
    </div>
  );
}
