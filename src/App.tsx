import { useEffect, useMemo, useState } from "react";
import type { Source, Summary, SummaryStyle } from "../shared/types";
import { AddSourceModal } from "./components/AddSourceModal";
import { CompareView } from "./components/CompareView";
import { RulesModal } from "./components/RulesModal";
import { Sidebar, type View } from "./components/Sidebar";
import { summarize } from "./lib/api";
import { DEMO_SOURCES, demoSummary } from "./lib/demo";
import { download, notebookToMarkdown } from "./lib/export";
import { loadWorkspace, saveWorkspace, uid } from "./lib/storage";
import { DEFAULT_RULES } from "../shared/rules";

export function App() {
  const initial = useMemo(() => loadWorkspace(), []);
  const [sources, setSources] = useState<Source[]>(initial?.sources ?? []);
  const [summaries, setSummaries] = useState<Summary[]>(initial?.summaries ?? []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.sources.map((s) => s.id) ?? []));
  const [view, setView] = useState<View>(() =>
    initial?.summaries[0] ? { kind: "summary", id: initial.summaries[0].id } : { kind: "home" },
  );
  const [rules, setRules] = useState<string[]>(initial?.rules ?? DEFAULT_RULES);
  const [adding, setAdding] = useState(false);
  const [editingRules, setEditingRules] = useState(false);

  const [style, setStyle] = useState<SummaryStyle>("detailed");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => saveWorkspace({ sources, summaries, rules }), [sources, summaries, rules]);

  const selectedSources = sources.filter((s) => selected.has(s.id));

  const addSources = (added: Source[]) => {
    setSources((prev) => [...prev, ...added]);
    setSelected((prev) => new Set([...prev, ...added.map((s) => s.id)]));
    setAdding(false);
    if (added.length === 1) setView({ kind: "source", id: added[0].id });
  };

  const loadDemo = () => {
    const summary = demoSummary();
    setSources((prev) => [...prev.filter((s) => !DEMO_SOURCES.some((d) => d.id === s.id)), ...DEMO_SOURCES]);
    setSummaries((prev) => [summary, ...prev.filter((s) => s.id !== summary.id)]);
    setSelected((prev) => new Set([...prev, ...DEMO_SOURCES.map((s) => s.id)]));
    setView({ kind: "summary", id: summary.id });
  };

  const generate = async () => {
    if (selectedSources.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await summarize({
        sources: selectedSources.map(({ id, title, text }) => ({ id, title, text })),
        style,
        focus: focus.trim() || undefined,
        rules,
      });
      const summary: Summary = {
        id: uid("sum"),
        title: focus.trim() || (selectedSources.length === 1 ? selectedSources[0].title : `${selectedSources.length} sources`),
        sourceIds: selectedSources.map((s) => s.id),
        style,
        focus: focus.trim() || undefined,
        segments: res.segments,
        model: res.model,
        createdAt: Date.now(),
        review: {},
        notes: "",
      };
      setSummaries((prev) => [summary, ...prev]);
      setView({ kind: "summary", id: summary.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const currentSummary = view.kind === "summary" ? summaries.find((s) => s.id === view.id) : undefined;
  const currentSource = view.kind === "source" ? sources.find((s) => s.id === view.id) : undefined;

  return (
    <div className="app">
      <Sidebar
        sources={sources}
        summaries={summaries}
        selected={selected}
        view={view}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={(on) => setSelected(new Set(on ? sources.map((s) => s.id) : []))}
        onOpen={setView}
        onAddSource={() => setAdding(true)}
        rules={rules}
        onEditRules={() => setEditingRules(true)}
        onExportAll={() => download("research-notebook.md", notebookToMarkdown(summaries, sources))}
        onLoadDemo={loadDemo}
      />

      <main className="main">
        <div className="composer">
          <span className="composer-count">
            {selectedSources.length === 0
              ? "No sources selected"
              : `${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"} selected`}
          </span>
          <select value={style} onChange={(e) => setStyle(e.target.value as SummaryStyle)} aria-label="Summary style">
            <option value="brief">Brief</option>
            <option value="detailed">Detailed</option>
            <option value="bullets">Bullet points</option>
          </select>
          <input
            className="focus-input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
            placeholder="Optional focus or research question…"
          />
          <button className="primary" disabled={busy || selectedSources.length === 0} onClick={generate}>
            {busy ? "Summarising…" : "Summarise"}
          </button>
        </div>
        {error && (
          <div className="banner error">
            {error}
            <button className="link" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}
        {busy && <div className="progress" />}

        <div className="content">
          {currentSummary ? (
            <CompareView
              summary={currentSummary}
              sources={sources}
              rules={rules}
              onEditRules={() => setEditingRules(true)}
              onChange={(updated) => setSummaries((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))}
              onDelete={() => {
                setSummaries((prev) => prev.filter((s) => s.id !== currentSummary.id));
                setView({ kind: "home" });
              }}
            />
          ) : currentSource ? (
            <SourcePreview
              source={currentSource}
              usedBy={summaries.filter((s) => s.sourceIds.includes(currentSource.id)).length}
              onRename={(title) => setSources((prev) => prev.map((s) => (s.id === currentSource.id ? { ...s, title } : s)))}
              onDelete={() => {
                setSources((prev) => prev.filter((s) => s.id !== currentSource.id));
                setView({ kind: "home" });
              }}
            />
          ) : (
            <Home hasSources={sources.length > 0} onAdd={() => setAdding(true)} onDemo={loadDemo} />
          )}
        </div>
      </main>

      {adding && <AddSourceModal onAdd={addSources} onClose={() => setAdding(false)} />}
      {editingRules && (
        <RulesModal
          rules={rules}
          onSave={(next) => {
            setRules(next);
            setEditingRules(false);
          }}
          onClose={() => setEditingRules(false)}
        />
      )}
    </div>
  );
}

function SourcePreview({
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

function Home({ hasSources, onAdd, onDemo }: { hasSources: boolean; onAdd: () => void; onDemo: () => void }) {
  return (
    <div className="home">
      <h1>Summaries you can check.</h1>
      <p>
        Add your sources, generate a summary, and read it side by side with the original. Every sentence links to the
        passages it came from, and anything the sources don't back up is flagged.
      </p>
      <ol>
        <li><strong>Add sources</strong>: paste text, upload files, or fetch a URL.</li>
        <li><strong>Summarise</strong> the ones you've ticked, optionally around a research question.</li>
        <li><strong>Compare</strong>: hover a sentence to highlight its source passages, then mark it verified or flagged.</li>
        <li><strong>Check style</strong>: review the draft against your own writing rules and apply the suggested fixes.</li>
        <li><strong>Compile</strong>: your summaries collect in the notebook and export to Markdown with quoted footnotes.</li>
      </ol>
      <div className="home-actions">
        <button className="primary" onClick={onAdd}>{hasSources ? "Add another source" : "Add your first source"}</button>
        <button onClick={onDemo}>Explore an example</button>
      </div>
    </div>
  );
}
