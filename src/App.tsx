import { useCallback, useEffect, useState } from "react";
import type { Pack, Project, Source, Summary } from "../shared/types";
import { AddSourceModal } from "./components/AddSourceModal";
import { CompareView } from "./components/CompareView";
import { LibraryView, PackView, PaperView } from "./components/Library";
import { ProjectModal } from "./components/ProjectModal";
import { RuleSetsModal } from "./components/RuleSetsModal";
import { Sidebar, type View } from "./components/Sidebar";
import { StylesModal } from "./components/StylesModal";
import { listPacks, summarize } from "./lib/api";
import { DEMO_PROJECT_ID, demoProject } from "./lib/demo";
import { download, notebookToMarkdown } from "./lib/export";
import { copyRuleSet, loadWorkspace, newProject, ruleSetFor, saveWorkspace, uid, type Workspace } from "./lib/storage";
import { DEFAULT_RULE_SET } from "../shared/rules";

const EDIT_STYLES = "__edit-styles";
const MANAGE_RULES = "__manage-rules";

/** The project's default rule set if it still exists, else the first one. */
function defaultRuleSetId(ws: Workspace, project: Project): string {
  return ws.ruleSets.find((r) => r.id === project.defaultRuleSetId)?.id ?? ws.ruleSets[0].id;
}

export function App() {
  const [ws, setWs] = useState<Workspace>(loadWorkspace);
  const [storageFull, setStorageFull] = useState(false);
  const project = ws.projects.find((p) => p.id === ws.activeProjectId) ?? ws.projects[0];

  const [packs, setPacks] = useState<Pack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(project.sources.map((s) => s.id)));
  const [view, setView] = useState<View>(() => (project.summaries[0] ? { kind: "summary", id: project.summaries[0].id } : { kind: "home" }));
  const [modal, setModal] = useState<null | "add-source" | "rules" | "styles" | "new-project" | "project-settings">(null);
  const [rulesModalAt, setRulesModalAt] = useState<string | undefined>(undefined);
  const openRules = (ruleSetId?: string) => {
    setRulesModalAt(ruleSetId);
    setModal("rules");
  };

  const [styleId, setStyleId] = useState(() => ws.styles.find((s) => s.id === "detailed")?.id ?? ws.styles[0].id);
  const [ruleSetId, setRuleSetId] = useState(() => defaultRuleSetId(ws, project));
  const composerRuleSet = ws.ruleSets.find((r) => r.id === ruleSetId) ?? ws.ruleSets[0];
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStorageFull(!saveWorkspace(ws)), [ws]);

  /* ----- Knowledge packs live on the server; poll while papers are converting ----- */

  const refreshPacks = useCallback(() => {
    listPacks().then(setPacks, () => {});
  }, []);
  useEffect(refreshPacks, [refreshPacks]);
  const converting = packs.some((p) => p.papers.some((x) => x.status === "processing"));
  useEffect(() => {
    if (!converting) return;
    const t = setInterval(refreshPacks, 4000);
    return () => clearInterval(t);
  }, [converting, refreshPacks]);

  /* ----- Workspace updates ----- */

  const updateProject = (fn: (p: Project) => Project) =>
    setWs((w) => ({ ...w, projects: w.projects.map((p) => (p.id === w.activeProjectId ? fn(p) : p)) }));

  const switchProject = (id: string) => {
    const next = ws.projects.find((p) => p.id === id);
    if (!next) return;
    setWs((w) => ({ ...w, activeProjectId: id }));
    setSelected(new Set(next.sources.map((s) => s.id)));
    setView(next.summaries[0] ? { kind: "summary", id: next.summaries[0].id } : { kind: "home" });
    setRuleSetId(defaultRuleSetId(ws, next));
    setFocus("");
    setError(null);
  };

  const addSources = (added: Source[]) => {
    updateProject((p) => ({ ...p, sources: [...p.sources, ...added] }));
    setSelected((prev) => new Set([...prev, ...added.map((s) => s.id)]));
    setModal(null);
    if (added.length === 1) setView({ kind: "source", id: added[0].id });
  };

  const loadDemo = () => {
    const demo = demoProject();
    // The example is written for the default "Policy briefing" rules; add that set if it's gone.
    setWs((w) => ({
      ...w,
      ruleSets: w.ruleSets.some((r) => r.id === DEFAULT_RULE_SET.id) ? w.ruleSets : [...w.ruleSets, copyRuleSet(DEFAULT_RULE_SET)],
      projects: [...w.projects.filter((p) => p.id !== DEMO_PROJECT_ID), demo],
      activeProjectId: demo.id,
    }));
    setRuleSetId(DEFAULT_RULE_SET.id);
    setSelected(new Set(demo.sources.map((s) => s.id)));
    setView({ kind: "summary", id: demo.summaries[0].id });
  };

  /* ----- Generating drafts ----- */

  const generate = async (opts: { sourceIds?: string[]; priorities?: string[]; styleName?: string; focus?: string; ruleSetId?: string } = {}) => {
    const sources = opts.sourceIds ? project.sources.filter((s) => opts.sourceIds!.includes(s.id)) : project.sources.filter((s) => selected.has(s.id));
    if (sources.length === 0) return;
    const style = ws.styles.find((s) => s.name === opts.styleName) ?? ws.styles.find((s) => s.id === styleId) ?? ws.styles[0];
    const focusText = (opts.focus ?? focus).trim() || project.question.trim();
    const rules = ws.ruleSets.find((r) => r.id === opts.ruleSetId) ?? composerRuleSet;
    setBusy(true);
    setError(null);
    try {
      const res = await summarize({
        sources: sources.map(({ id, title, text }) => ({ id, title, text })),
        styleInstructions: style.instructions,
        focus: focusText || undefined,
        rules: rules.rules,
        priorities: opts.priorities,
      });
      const base = focusText || (sources.length === 1 ? sources[0].title : `${sources.length} sources`);
      const summary: Summary = {
        id: uid("sum"),
        title: opts.priorities ? `${base} (expert priorities)` : base,
        sourceIds: sources.map((s) => s.id),
        style: style.name,
        ruleSetId: rules.id,
        focus: focusText || undefined,
        segments: res.segments,
        model: res.model,
        createdAt: Date.now(),
        review: {},
        notes: "",
      };
      updateProject((p) => ({ ...p, summaries: [summary, ...p.summaries] }));
      setView({ kind: "summary", id: summary.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = project.sources.filter((s) => selected.has(s.id)).length;
  const currentSummary = view.kind === "summary" ? project.summaries.find((s) => s.id === view.id) : undefined;
  const currentSource = view.kind === "source" ? project.sources.find((s) => s.id === view.id) : undefined;
  const currentPack = view.kind === "pack" ? packs.find((p) => p.id === view.id) : undefined;
  const inLibrary = view.kind === "library" || view.kind === "pack" || view.kind === "paper";

  return (
    <div className="app">
      <Sidebar
        projects={ws.projects}
        project={project}
        packs={packs}
        selected={selected}
        view={view}
        ruleSets={ws.ruleSets}
        ruleSet={composerRuleSet}
        onSwitchProject={switchProject}
        onNewProject={() => setModal("new-project")}
        onProjectSettings={() => setModal("project-settings")}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={(on) => setSelected(new Set(on ? project.sources.map((s) => s.id) : []))}
        onOpen={setView}
        onAddSource={() => setModal("add-source")}
        onEditRules={() => openRules(composerRuleSet.id)}
        onExportAll={() => download(`${project.name}.md`, notebookToMarkdown(project.name, project.summaries, project.sources))}
        onLoadDemo={loadDemo}
      />

      <main className="main">
        {!inLibrary && (
          <div className="composer">
            <span className="composer-count">
              {selectedCount === 0 ? "No sources selected" : `${selectedCount} source${selectedCount === 1 ? "" : "s"} selected`}
            </span>
            <select
              value={styleId}
              onChange={(e) => (e.target.value === EDIT_STYLES ? setModal("styles") : setStyleId(e.target.value))}
              aria-label="Drafting style"
            >
              {ws.styles.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value={EDIT_STYLES}>Edit styles…</option>
            </select>
            <select
              value={composerRuleSet.id}
              onChange={(e) => (e.target.value === MANAGE_RULES ? openRules(composerRuleSet.id) : setRuleSetId(e.target.value))}
              aria-label="Rule set"
              title="Writing rules the draft will follow"
            >
              {ws.ruleSets.map((r) => (
                <option key={r.id} value={r.id}>Rules: {r.name}</option>
              ))}
              <option value={MANAGE_RULES}>Manage rule sets…</option>
            </select>
            <input
              className="focus-input"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
              placeholder={project.question ? `Focus (default: ${project.question})` : "Optional focus or research question…"}
            />
            <button className="primary" disabled={busy || selectedCount === 0} onClick={() => generate()}>
              {busy ? "Summarising…" : "Summarise"}
            </button>
          </div>
        )}
        {storageFull && (
          <div className="banner error">
            Your browser's storage is full, so recent changes aren't being saved. Delete old drafts or sources, or export them first.
          </div>
        )}
        {error && (
          <div className="banner error">
            {error}
            <button className="link" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}
        {busy && <div className="progress" />}

        <div className="content">
          {view.kind === "library" ? (
            <LibraryView packs={packs} onOpenPack={(id) => setView({ kind: "pack", id })} onChanged={refreshPacks} />
          ) : view.kind === "pack" && currentPack ? (
            <PackView
              pack={currentPack}
              onOpenPaper={(paperId) => setView({ kind: "paper", packId: currentPack.id, paperId })}
              onChanged={refreshPacks}
              onDeleted={() => {
                refreshPacks();
                setView({ kind: "library" });
              }}
            />
          ) : view.kind === "paper" ? (
            <PaperView packId={view.packId} paperId={view.paperId} onBack={() => setView({ kind: "pack", id: view.packId })} />
          ) : currentSummary ? (
            <CompareView
              summary={currentSummary}
              sources={project.sources}
              ruleSets={ws.ruleSets}
              project={project}
              packs={packs}
              onEditRules={openRules}
              onChange={(updated) => updateProject((p) => ({ ...p, summaries: p.summaries.map((s) => (s.id === updated.id ? updated : s)) }))}
              onDelete={() => {
                updateProject((p) => ({ ...p, summaries: p.summaries.filter((s) => s.id !== currentSummary.id) }));
                setView({ kind: "home" });
              }}
              onRegenerate={(priorities) =>
                generate({
                  sourceIds: currentSummary.sourceIds,
                  priorities,
                  styleName: currentSummary.style,
                  focus: currentSummary.focus ?? "",
                  ruleSetId: ruleSetFor(ws.ruleSets, currentSummary, project).set.id,
                })
              }
              onOpenPaper={(packId, paperId) => setView({ kind: "paper", packId, paperId })}
            />
          ) : currentSource ? (
            <SourcePreview
              source={currentSource}
              usedBy={project.summaries.filter((s) => s.sourceIds.includes(currentSource.id)).length}
              onRename={(title) => updateProject((p) => ({ ...p, sources: p.sources.map((s) => (s.id === currentSource.id ? { ...s, title } : s)) }))}
              onDelete={() => {
                updateProject((p) => ({ ...p, sources: p.sources.filter((s) => s.id !== currentSource.id) }));
                setView({ kind: "home" });
              }}
            />
          ) : (
            <Home project={project} onAdd={() => setModal("add-source")} onDemo={loadDemo} onSettings={() => setModal("project-settings")} />
          )}
        </div>
      </main>

      {modal === "add-source" && <AddSourceModal onAdd={addSources} onClose={() => setModal(null)} />}
      {modal === "rules" && (
        <RuleSetsModal
          ruleSets={ws.ruleSets}
          initialId={rulesModalAt}
          usage={ruleSetUsage(ws)}
          onSave={(ruleSets) => {
            setWs((w) => ({ ...w, ruleSets }));
            if (!ruleSets.some((r) => r.id === ruleSetId)) setRuleSetId(ruleSets.find((r) => r.id === project.defaultRuleSetId)?.id ?? ruleSets[0].id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "styles" && (
        <StylesModal
          styles={ws.styles}
          onSave={(styles) => {
            setWs((w) => ({ ...w, styles }));
            if (!styles.some((s) => s.id === styleId)) setStyleId(styles[0].id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {(modal === "new-project" || modal === "project-settings") && (
        <ProjectModal
          key={modal}
          project={modal === "new-project" ? { ...newProject(""), defaultRuleSetId: composerRuleSet.id } : project}
          packs={packs}
          ruleSets={ws.ruleSets}
          isNew={modal === "new-project"}
          canDelete={ws.projects.length > 1}
          onOpenLibrary={() => {
            setModal(null);
            setView({ kind: "library" });
          }}
          onClose={() => setModal(null)}
          onSave={(patch) => {
            if (modal === "new-project") {
              const created = { ...newProject(patch.name), ...patch };
              setWs((w) => ({ ...w, projects: [...w.projects, created], activeProjectId: created.id }));
              setSelected(new Set());
              setView({ kind: "home" });
            } else {
              updateProject((p) => ({ ...p, ...patch }));
            }
            if (patch.defaultRuleSetId) setRuleSetId(patch.defaultRuleSetId);
            setModal(null);
          }}
          onDelete={() => {
            const remaining = ws.projects.filter((p) => p.id !== project.id);
            setWs((w) => ({ ...w, projects: remaining, activeProjectId: remaining[0].id }));
            setSelected(new Set(remaining[0].sources.map((s) => s.id)));
            setView({ kind: "home" });
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

/** How many drafts, across all projects, use each rule set. */
function ruleSetUsage(ws: Workspace): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const p of ws.projects) for (const s of p.summaries) if (s.ruleSetId) usage[s.ruleSetId] = (usage[s.ruleSetId] ?? 0) + 1;
  return usage;
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

function Home({ project, onAdd, onDemo, onSettings }: { project: Project; onAdd: () => void; onDemo: () => void; onSettings: () => void }) {
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
        <li><strong>Check style</strong> against the draft's rule set and apply the fixes.</li>
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
