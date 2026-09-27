import type { Source, Summary } from "../../shared/types";
import { parseWordLimit } from "../../shared/rules";

interface Props {
  sources: Source[];
  summaries: Summary[];
  selected: Set<string>;
  view: View;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onOpen: (view: View) => void;
  onAddSource: () => void;
  rules: string[];
  onEditRules: () => void;
  onExportAll: () => void;
  onLoadDemo: () => void;
}

export type View = { kind: "summary"; id: string } | { kind: "source"; id: string } | { kind: "home" };

export function Sidebar(props: Props) {
  const { sources, summaries, selected, view } = props;
  const allOn = sources.length > 0 && sources.every((s) => selected.has(s.id));

  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => props.onOpen({ kind: "home" })}>
        <span className="logo">◐</span> Source Lens
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
        {sources.length === 0 && <p className="muted small">Add articles, papers, or notes to summarise.</p>}
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
          <span>Style rules</span>
          <button className="link" onClick={props.onEditRules}>edit</button>
        </div>
        {props.rules.length === 0 && <p className="muted small">No rules. Add writing rules to check drafts against.</p>}
        <ul className="side-rules">
          {props.rules.map((r, i) => (
            <li key={i} title={parseWordLimit(r) ? "Counted by the app" : "Checked by Claude"}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="side-section grow">
        <div className="side-head">
          <span>Notebook</span>
          {summaries.length > 0 && (
            <button className="link" onClick={props.onExportAll}>export</button>
          )}
        </div>
        {summaries.length === 0 && <p className="muted small">Summaries you generate are saved here.</p>}
        <ul className="side-list">
          {summaries.map((s) => {
            const verified = Object.values(s.review).filter((v) => v === "ok").length;
            const flagged = Object.values(s.review).filter((v) => v === "flag").length;
            return (
              <li key={s.id} className={view.kind === "summary" && view.id === s.id ? "current" : ""}>
                <button className="side-item" onClick={() => props.onOpen({ kind: "summary", id: s.id })}>
                  <span className="side-title">{s.title}</span>
                  <span className="side-meta">
                    {s.sourceIds.length} source{s.sourceIds.length === 1 ? "" : "s"}
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
        <button className="link" onClick={props.onLoadDemo}>Load example</button>
      </div>
    </aside>
  );
}

function words(text: string): string {
  return (text.match(/\S+/g)?.length ?? 0).toLocaleString();
}
