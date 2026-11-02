// The project home screen, and the preview shown when a source is opened on its own.

import type { Project, Source } from "../../shared/types";

export function SourcePreview({
  source,
  usedBy,
  onRename,
  onDelete,
}: {
  source: Source;
  usedBy: number;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="preview">
      <header className="compare-header">
        <div className="compare-title">
          <input className="title-input" value={source.title} onChange={(e) => onRename(e.target.value)} aria-label="Source title" />
          <div className="meta">
            {source.origin ?? "Pasted text"} · {source.text.length.toLocaleString()} characters
          </div>
        </div>
        <div className="toolbar">
          <button
            className="danger"
            onClick={() => {
              const warning = usedBy
                ? `This source is used by ${usedBy} summar${usedBy === 1 ? "y" : "ies"}; they will lose their side-by-side view. Delete anyway?`
                : "Delete this source?";
              if (confirm(warning)) onDelete();
            }}
          >
            Delete
          </button>
        </div>
      </header>
      <div className="pane-scroll">
        <div className="source-text standalone">{source.text}</div>
      </div>
    </div>
  );
}

export function Home({ project, onAdd, onDemo, onSettings }: { project: Project; onAdd: () => void; onDemo: () => void; onSettings: () => void }) {
  return (
    <div className="home">
      <h1>{project.name || "Summaries you can check."}</h1>
      <p>
        Add the sources for this briefing, generate a draft, and read it side by side with the originals. Every sentence links to
        the passages it came from, and a subject-matter expert helps you focus on what matters.
      </p>
      <ol>
        <li><strong>Add sources</strong>: paste text, upload files or PDFs, or fetch a URL.</li>
        <li><strong>Summarise</strong> the ones you've ticked, in the drafting style you choose.</li>
        <li><strong>Compare</strong>: hover a sentence to highlight its source passages, then mark it verified or flagged.</li>
        <li><strong>Check style</strong> against the rules for the draft's briefing style and apply the fixes.</li>
        <li><strong>Ask the expert</strong>: attach knowledge packs, then run an expert review or chat about what matters most.</li>
        <li><strong>Compile</strong>: drafts export to Markdown with quoted footnotes and, optionally, the expert's context notes.</li>
      </ol>
      <div className="home-actions">
        <button className="primary" onClick={onAdd}>{project.sources.length ? "Add another source" : "Add your first source"}</button>
        <button onClick={onSettings}>Project settings</button>
        <button onClick={onDemo}>Explore an example</button>
      </div>
    </div>
  );
}
