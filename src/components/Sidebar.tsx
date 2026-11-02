import type { DraftStyle, Pack, Project } from "../../shared/types";
import { parseWordLimit } from "../../shared/rules";

export type View =
  | { kind: "home" }
  | { kind: "research" }
  | { kind: "summary"; id: string }
  | { kind: "source"; id: string }
  | { kind: "library" }
  | { kind: "pack"; id: string }
  | { kind: "paper"; packId: string; paperId: string };

interface Props {
  projects: Project[];
  project: Project;
  packs: Pack[];
  selected: Set<string>;
  view: View;
  styles: DraftStyle[];
  /** The style selected for new drafts. */
  composerStyle: DraftStyle;
  sharedRules: string[];
  onSwitchProject: (id: string) => void;
  onNewProject: () => void;
  onProjectSettings: () => void;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onOpen: (view: View) => void;
  onAddSource: () => void;
  onEditRules: () => void;
  onExportAll: () => void;
  onLoadDemo: () => void;
}

export function Sidebar(props: Props) {
  const { project, packs, selected, view } = props;
  const { sources, summaries } = project;
  const allOn = sources.length > 0 && sources.every((s) => selected.has(s.id));
  const attached = packs.filter((p) => project.packIds.includes(p.id));

  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => props.onOpen({ kind: "home" })}>
        <span className="logo">◐</span> Source Lens
      </div>

      <div className="side-section project-block">
        <div className="side-head">
          <span>Project</span>
          <button className="link" onClick={props.onNewProject}>+ new</button>
        </div>
        <div className="project-row">
          <select value={project.id} onChange={(e) => props.onSwitchProject(e.target.value)} aria-label="Current project">
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={props.onProjectSettings} title="Project settings" aria-label="Project settings">⚙</button>
        </div>
        {project.question && <p className="muted small question">“{project.question}”</p>}
        <button className={`research-link ${view.kind === "research" ? "current" : ""}`} onClick={() => props.onOpen({ kind: "research" })}>
          <span className="side-title">🔎 Research</span>
          <span className="side-meta">{researchMeta(project)}</span>
        </button>
      </div>

      <div className="side-section">
        <div className="side-head">
          <span>Sources</span>
          {sources.length > 1 && (
            <button className="link" onClick={() => props.onToggleAll(!allOn)}>
              {allOn ? "none" : "all"}
            </button>
          )}
        </div>
        {sources.length === 0 && <p className="muted small">Add the articles, papers, or notes this briefing draws on.</p>}
        <ul className="side-list">
          {sources.map((s) => (
            <li key={s.id} className={view.kind === "source" && view.id === s.id ? "current" : ""}>
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => props.onToggle(s.id)}
                aria-label={`Include ${s.title} in the next summary`}
              />
              <button className="side-item" onClick={() => props.onOpen({ kind: "source", id: s.id })}>
                <span className="side-title">{s.title}</span>
                <span className="side-meta">{words(s.text)} words</span>
              </button>
            </li>
          ))}
        </ul>
        <button className="add-btn" onClick={props.onAddSource}>+ Add source</button>
      </div>

      <div className="side-section">
        <div className="side-head">
          <span>Expert knowledge</span>
          <button className="link" onClick={props.onProjectSettings}>{attached.length ? "change" : "attach"}</button>
        </div>
        {attached.length === 0 ? (
          <p className="muted small">No knowledge packs attached. The expert will use general knowledge only.</p>
        ) : (
          <ul className="side-list">
            {attached.map((p) => {
              const ready = p.papers.filter((x) => x.status === "ready").length;
              const busy = p.papers.some((x) => x.status === "processing");
              return (
                <li key={p.id} className={view.kind === "pack" && view.id === p.id ? "current" : ""}>
                  <button className="side-item" onClick={() => props.onOpen({ kind: "pack", id: p.id })}>
                    <span className="side-title">📚 {p.name}</span>
                    <span className="side-meta">
                      {ready} paper{ready === 1 ? "" : "s"}
                      {busy && " · converting…"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">
          <span>Rules: {props.composerStyle.name}</span>
          <button className="link" onClick={props.onEditRules}>edit</button>
        </div>
        {props.sharedRules.length + props.composerStyle.rules.length === 0 && (
          <p className="muted small">No rules for this style. Add writing rules to check drafts against.</p>
        )}
        <ul className="side-rules">
          {[...props.sharedRules, ...props.composerStyle.rules.filter((r) => !props.sharedRules.includes(r))].map((r, i) => (
            <li key={i} title={parseWordLimit(r) ? "Counted by the app" : "Checked by Claude"}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="side-section grow">
        <div className="side-head">
          <span>Drafts</span>
          {summaries.length > 0 && (
            <button className="link" onClick={props.onExportAll}>export</button>
          )}
        </div>
        {summaries.length === 0 && <p className="muted small">Summaries you generate for this project are saved here.</p>}
        <ul className="side-list">
          {summaries.map((s) => {
            const verified = Object.values(s.review).filter((v) => v === "ok").length;
            const flagged = Object.values(s.review).filter((v) => v === "flag").length;
            return (
              <li key={s.id} className={view.kind === "summary" && view.id === s.id ? "current" : ""}>
                <button className="side-item" onClick={() => props.onOpen({ kind: "summary", id: s.id })}>
                  <span className="side-title">{s.title}</span>
                  <span className="side-meta">
                    {s.style} · {s.sourceIds.length} source{s.sourceIds.length === 1 ? "" : "s"}
                    {verified > 0 && <span className="ok"> · ✓{verified}</span>}
                    {flagged > 0 && <span className="flag"> · ⚑{flagged}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="side-foot">
        <button className="link" onClick={() => props.onOpen({ kind: "library" })}>📚 Knowledge library</button>
        <button className="link" onClick={props.onLoadDemo}>Load example</button>
      </div>
    </aside>
  );
}

function researchMeta(project: Project): string {
  const r = project.research;
  if (!r || (r.chat.length === 0 && r.candidates.length === 0)) return "Plan and gather sources with the research agent";
  const found = r.candidates.filter((c) => c.status !== "dismissed").length;
  const added = r.candidates.filter((c) => c.status === "added").length;
  return `${found} source${found === 1 ? "" : "s"} found · ${added} added · ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`;
}

function words(text: string): string {
  return (text.match(/\S+/g)?.length ?? 0).toLocaleString();
}
