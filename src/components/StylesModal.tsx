import { useState } from "react";
import type { DraftStyle } from "../../shared/types";
import { DEFAULT_SHARED_RULES, parseWordLimit } from "../../shared/rules";
import { DEFAULT_STYLES } from "../../shared/styles";
import { uid } from "../lib/storage";

interface Props {
  styles: DraftStyle[];
  sharedRules: string[];
  /** The style to open first; "shared" opens the rules every style follows. */
  initialId?: string;
  /** How many drafts use each style, by id. */
  usage: Record<string, number>;
  onSave: (styles: DraftStyle[], sharedRules: string[]) => void;
  onClose: () => void;
}

const SHARED = "shared";

/** Styles are edited with their rules as text, one rule per line. */
interface DraftStyleText {
  id: string;
  name: string;
  instructions: string;
  rulesText: string;
}

const toLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const toText = (s: DraftStyle): DraftStyleText => ({ id: s.id, name: s.name, instructions: s.instructions, rulesText: s.rules.join("\n") });

export function StylesModal({ styles, sharedRules, initialId, usage, onSave, onClose }: Props) {
  const [drafts, setDrafts] = useState<DraftStyleText[]>(() => styles.map(toText));
  const [shared, setShared] = useState(sharedRules.join("\n"));
  const [selectedId, setSelectedId] = useState(initialId === SHARED || styles.some((s) => s.id === initialId) ? initialId! : styles[0].id);
  const selected = drafts.find((d) => d.id === selectedId);

  const update = (patch: Partial<DraftStyleText>) => setDrafts((all) => all.map((d) => (d.id === selectedId ? { ...d, ...patch } : d)));
  const add = (from?: DraftStyleText) => {
    const d: DraftStyleText = from
      ? { ...from, id: uid("style"), name: `${from.name} (copy)` }
      : { id: uid("style"), name: "New style", instructions: "", rulesText: "" };
    setDrafts((all) => [...all, d]);
    setSelectedId(d.id);
  };
  const remove = (d: DraftStyleText) => {
    const used = usage[d.id] ?? 0;
    const warning = used
      ? `${used} draft${used === 1 ? " was" : "s were"} written in "${d.name}". They'll keep their text, but style checks will use another style's rules. Delete it?`
      : `Delete "${d.name}"?`;
    if (!confirm(warning)) return;
    const rest = drafts.filter((x) => x.id !== d.id);
    setDrafts(rest);
    setSelectedId(rest[0].id);
  };
  const resetDefaults = () => {
    if (!confirm("Replace all styles and shared rules with the defaults? Your own styles will be removed.")) return;
    setDrafts(DEFAULT_STYLES.map(toText));
    setShared(DEFAULT_SHARED_RULES.join("\n"));
    setSelectedId(DEFAULT_STYLES[0].id);
  };

  const valid = drafts.filter((d) => d.name.trim() && d.instructions.trim());
  const save = () =>
    onSave(
      valid.map((d) => ({ id: d.id, name: d.name.trim(), instructions: d.instructions.trim(), rules: toLines(d.rulesText) })),
      toLines(shared),
    );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Briefing styles">
        <div className="modal-head">
          <h2>Briefing styles</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          Each style has instructions for shaping the draft and its own writing rules. Drafts follow the shared rules plus their style's
          rules, and <strong>Check style</strong> reviews against both. Word limits for the whole draft are counted by the app; Claude judges
          the rest.
        </p>

        <div className="ruleset-editor">
          <ul className="ruleset-list">
            <li>
              <button className={selectedId === SHARED ? "on" : ""} onClick={() => setSelectedId(SHARED)}>
                <span className="side-title">Always apply</span>
                <span className="side-meta">{toLines(shared).length} shared rules · every style</span>
              </button>
            </li>
            {drafts.map((d) => (
              <li key={d.id}>
                <button className={d.id === selectedId ? "on" : ""} onClick={() => setSelectedId(d.id)}>
                  <span className="side-title">{d.name || "Untitled style"}</span>
                  <span className="side-meta">
                    {toLines(d.rulesText).length} rule{toLines(d.rulesText).length === 1 ? "" : "s"}
                    {usage[d.id] ? ` · ${usage[d.id]} draft${usage[d.id] === 1 ? "" : "s"}` : ""}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button className="add-btn" onClick={() => add()}>+ New style</button>
            </li>
          </ul>

          {selectedId === SHARED ? (
            <div className="ruleset-detail">
              <strong>Rules every style follows</strong>
              <span className="muted small">For rules that apply to all briefings, such as tense or sticking to the sources.</span>
              <RulesEditor text={shared} onChange={setShared} />
            </div>
          ) : (
            selected && (
              <div className="ruleset-detail">
                <div className="style-card-head">
                  <input value={selected.name} onChange={(e) => update({ name: e.target.value })} placeholder="Style name" aria-label="Style name" />
                  <button onClick={() => add(selected)}>Duplicate</button>
                  <button className="danger" onClick={() => remove(selected)} disabled={drafts.length === 1}>Delete</button>
                </div>
                <label className="field">
                  <span>Instructions: how to shape the draft</span>
                  <textarea
                    value={selected.instructions}
                    onChange={(e) => update({ instructions: e.target.value })}
                    placeholder="Structure, audience, what to lead with…"
                    aria-label="Style instructions"
                  />
                </label>
                <div className="field">
                  <span>Rules for this style (in addition to the shared rules)</span>
                  <RulesEditor text={selected.rulesText} onChange={(rulesText) => update({ rulesText })} />
                </div>
                {!selected.instructions.trim() && <p className="warn-text small">Add instructions, or this style won't be saved.</p>}
              </div>
            )
          )}
        </div>

        <div className="modal-foot">
          <button className="link" onClick={resetDefaults}>Reset to defaults</button>
          <button className="primary" disabled={valid.length === 0} onClick={save}>Save styles</button>
        </div>
      </div>
    </div>
  );
}

function RulesEditor({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const lines = toLines(text);
  return (
    <>
      <textarea className="rules-textarea" value={text} onChange={(e) => onChange(e.target.value)} placeholder="One rule per line" aria-label="Rules, one per line" />
      <ul className="rule-preview">
        {lines.map((l, i) => (
          <li key={i}>
            <span className={`badge ${parseWordLimit(l) ? "by-app" : "by-claude"}`}>{parseWordLimit(l) ? "counted" : "Claude"}</span>
            {l}
          </li>
        ))}
      </ul>
    </>
  );
}
