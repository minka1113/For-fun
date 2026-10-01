import { useState } from "react";
import type { RuleSet } from "../../shared/types";
import { parseWordLimit } from "../../shared/rules";
import { uid } from "../lib/storage";

interface Props {
  ruleSets: RuleSet[];
  /** The set to open first. */
  initialId?: string;
  /** How many drafts use each set, by id. */
  usage: Record<string, number>;
  onSave: (ruleSets: RuleSet[]) => void;
  onClose: () => void;
}

/** Edited as text: one rule per line. */
interface DraftSet {
  id: string;
  name: string;
  text: string;
}

const toLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export function RuleSetsModal({ ruleSets, initialId, usage, onSave, onClose }: Props) {
  const [sets, setSets] = useState<DraftSet[]>(() => ruleSets.map((r) => ({ id: r.id, name: r.name, text: r.rules.join("\n") })));
  const [selectedId, setSelectedId] = useState(initialId && ruleSets.some((r) => r.id === initialId) ? initialId : ruleSets[0]?.id);
  const selected = sets.find((s) => s.id === selectedId) ?? sets[0];

  const update = (patch: Partial<DraftSet>) => setSets((all) => all.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  const add = (from?: DraftSet) => {
    const set: DraftSet = from
      ? { id: uid("rules"), name: `${from.name} (copy)`, text: from.text }
      : { id: uid("rules"), name: "New rule set", text: "" };
    setSets((all) => [...all, set]);
    setSelectedId(set.id);
  };
  const remove = () => {
    const used = usage[selected.id] ?? 0;
    const warning = used
      ? `${used} draft${used === 1 ? " uses" : "s use"} "${selected.name}". They'll switch to their project's default rule set. Delete it?`
      : `Delete "${selected.name}"?`;
    if (!confirm(warning)) return;
    const rest = sets.filter((s) => s.id !== selected.id);
    setSets(rest);
    setSelectedId(rest[0].id);
  };

  const lines = selected ? toLines(selected.text) : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Rule sets">
        <div className="modal-head">
          <h2>Rule sets</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          Each rule set is a list of writing rules, one per line, in plain English. Pick a set when you summarise; the draft follows it and{" "}
          <strong>Check style</strong> reviews against it. Word limits (“no more than 250 words”) are counted by the app; Claude judges the rest.
        </p>

        <div className="ruleset-editor">
          <ul className="ruleset-list">
            {sets.map((s) => (
              <li key={s.id}>
                <button className={s.id === selected.id ? "on" : ""} onClick={() => setSelectedId(s.id)}>
                  <span className="side-title">{s.name || "Untitled"}</span>
                  <span className="side-meta">
                    {toLines(s.text).length} rule{toLines(s.text).length === 1 ? "" : "s"}
                    {usage[s.id] ? ` · ${usage[s.id]} draft${usage[s.id] === 1 ? "" : "s"}` : ""}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button className="add-btn" onClick={() => add()}>+ New set</button>
            </li>
          </ul>

          {selected && (
            <div className="ruleset-detail">
              <div className="style-card-head">
                <input value={selected.name} onChange={(e) => update({ name: e.target.value })} placeholder="Rule set name" aria-label="Rule set name" />
                <button onClick={() => add(selected)}>Duplicate</button>
                <button className="danger" onClick={remove} disabled={sets.length === 1}>Delete</button>
              </div>
              <textarea
                className="rules-textarea"
                value={selected.text}
                onChange={(e) => update({ text: e.target.value })}
                placeholder={"Always in past tense\nNo more than 250 words"}
                aria-label="Rules, one per line"
              />
              <ul className="rule-preview">
                {lines.map((l, i) => (
                  <li key={i}>
                    <span className={`badge ${parseWordLimit(l) ? "by-app" : "by-claude"}`}>{parseWordLimit(l) ? "counted" : "Claude"}</span>
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span />
          <button
            className="primary"
            onClick={() => onSave(sets.map((s) => ({ id: s.id, name: s.name.trim() || "Untitled rule set", rules: toLines(s.text) })))}
          >
            Save rule sets
          </button>
        </div>
      </div>
    </div>
  );
}
