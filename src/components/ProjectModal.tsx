import { useState } from "react";
import type { Pack, Project, RuleSet } from "../../shared/types";

interface Props {
  project: Project;
  packs: Pack[];
  ruleSets: RuleSet[];
  isNew: boolean;
  canDelete: boolean;
  onSave: (patch: Pick<Project, "name" | "question" | "packIds" | "brief" | "defaultRuleSetId">) => void;
  onDelete: () => void;
  onOpenLibrary: () => void;
  onClose: () => void;
}

export function ProjectModal({ project, packs, ruleSets, isNew, canDelete, onSave, onDelete, onOpenLibrary, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [question, setQuestion] = useState(project.question);
  const [packIds, setPackIds] = useState<string[]>(project.packIds.filter((id) => packs.some((p) => p.id === id)));
  const [brief, setBrief] = useState(project.brief);
  const [defaultRuleSetId, setDefaultRuleSetId] = useState(
    ruleSets.find((r) => r.id === project.defaultRuleSetId)?.id ?? ruleSets[0]?.id,
  );

  const attached = packs.filter((p) => packIds.includes(p.id));
  const defaultBrief = attached.map((p) => p.brief.trim()).filter(Boolean).join("\n");
  const toggle = (id: string) => setPackIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Project settings">
        <div className="modal-head">
          <h2>{isNew ? "New project" : "Project settings"}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverton tree canopy briefing" autoFocus />
        </label>
        <label className="field">
          <span>Research question (optional; used as the summary focus when you leave that box empty)</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should the briefing answer?" />
        </label>

        <label className="field">
          <span>Default rule set for new drafts</span>
          <select value={defaultRuleSetId} onChange={(e) => setDefaultRuleSetId(e.target.value)}>
            {ruleSets.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Knowledge packs the expert draws on (one or two usually works best)</span>
          {packs.length === 0 ? (
            <p className="muted small">
              No knowledge packs yet. <button className="link" onClick={onOpenLibrary}>Open the library</button> to create one.
            </p>
          ) : (
            <ul className="pack-picks">
              {packs.map((p) => {
                const ready = p.papers.filter((x) => x.status === "ready").length;
                return (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={packIds.includes(p.id)} onChange={() => toggle(p.id)} />
                      <strong>{p.name}</strong>
                      <span className="muted small">
                        {ready} paper{ready === 1 ? "" : "s"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <label className="field">
          <span>Expert brief: what counts as important for this project</span>
          <textarea
            className="brief-input"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={defaultBrief || "e.g. Anything with policy implications, or new information that was not previously known."}
          />
          <span className="muted small">
            {brief.trim()
              ? "This project's own brief replaces the packs' defaults."
              : defaultBrief
                ? "Empty: the attached packs' default briefs (shown greyed out) are used."
                : "Empty: the expert uses a general idea of importance."}
          </span>
        </label>

        <div className="modal-foot">
          {canDelete && !isNew ? (
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Delete "${project.name}" with all its sources and summaries? This can't be undone.`)) onDelete();
              }}
            >
              Delete project
            </button>
          ) : (
            <span />
          )}
          <button className="primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), question: question.trim(), packIds, brief, defaultRuleSetId })}>
            {isNew ? "Create project" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
