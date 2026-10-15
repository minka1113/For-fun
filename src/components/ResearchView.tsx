import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Candidate, Project, ResearchMessage, ResearchState, Source, SourceKind } from "../../shared/types";
import { fetchUrl } from "../lib/api";
import { emptyResearch, notebookForRequest } from "../lib/research";
import { clearRunError, getRun, startRun, stopRun, subscribeRuns } from "../lib/researchRuns";
import { uid } from "../lib/storage";
import { ChatInput } from "./ChatInput";

interface Props {
  project: Project;
  /** Update this project's research notebook (applied to the project it started on, even if you switch away). */
  onUpdate: (fn: (r: ResearchState) => ResearchState) => void;
  onAddSource: (source: Source) => void;
  onStartBriefing: () => void;
}

type Tab = "plan" | "sources" | "findings";

const STARTERS = [
  "Help me scope research on this topic: ",
  "Find the most authoritative government and academic sources on our sub-questions.",
  "What are the key facts and figures so far, and what's still missing?",
  "Look for recent developments from the past year.",
];

const KIND_LABEL: Record<SourceKind, string> = {
  government: "Government",
  academic: "Academic",
  intergovernmental: "Intergovernmental",
  news: "News",
  organisation: "Organisation",
  other: "Other",
};

export function ResearchView({ project, onUpdate, onAddSource, onStartBriefing }: Props) {
  const research = project.research ?? emptyResearch();
  const [tab, setTab] = useState<Tab>("plan");
  const [input, setInput] = useState("");
  const run = useSyncExternalStore(subscribeRuns, () => getRun(project.id));
  const { running, statusLines, liveText, startedAt, error } = run;
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whether the chat is scrolled to the bottom; if you scroll up to read, new text doesn't pull you back down. */
  const following = useRef(true);

  useEffect(() => {
    const log = logRef.current;
    if (log && following.current) log.scrollTop = log.scrollHeight;
  }, [research.chat.length, statusLines.length, liveText]);
  // Tick the elapsed-time display while a turn runs.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const send = async (text: string) => {
    if (!text.trim() || running) return;
    const userMsg: ResearchMessage = { id: uid("rmsg"), role: "user", text: text.trim(), createdAt: Date.now() };
    const history = research.chat.map((m) => ({ role: m.role, text: m.text }));
    const state = notebookForRequest(research);
    onUpdate((r) => ({ ...r, chat: [...r.chat, userMsg] }));
    setInput("");
    setNow(Date.now());
    // The turn runs outside this view, so it carries on (and still saves) if you look elsewhere meanwhile.
    const updates = await startRun(project.id, { state, history, message: userMsg.text }, onUpdate);
    if (updates?.plan) setTab("plan");
    else if (updates?.candidates.length) setTab("sources");
  };

  const added = research.candidates.filter((c) => c.status === "added" && project.sources.some((s) => s.id === c.sourceId));
  const newCount = research.candidates.filter((c) => c.status === "new").length;

  return (
    <div className="research">
      <header className="compare-header">
        <div className="compare-title">
          <div className="title-static">Research</div>
          <div className="meta">
            Chat with the research agent to plan, search the web and gather sources. The notebook is your working notes; the briefing
            is written only from sources you add.
          </div>
        </div>
        <div className="toolbar">
          <span className="muted small">
            {added.length} source{added.length === 1 ? "" : "s"} added
          </span>
          <button className="primary" disabled={added.length === 0} onClick={onStartBriefing} title="Select the added sources and go to drafting">
            Start briefing →
          </button>
        </div>
      </header>

      <div className="research-body">
        <section className="research-chat">
          <div
            className="chat-log"
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {research.chat.length === 0 && (
              <div className="starters">
                <p className="muted small">
                  Describe what the briefing is about. The agent proposes a research plan, searches the open web (preferring government
                  and academic sources), reads the most promising pages, and fills in the notebook.
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      if (s.endsWith(": ")) {
                        setInput(s);
                        inputRef.current?.focus();
                      } else send(s);
                    }}
                    disabled={running}
                  >
                    {s.endsWith(": ") ? `${s}…` : s}
                  </button>
                ))}
              </div>
            )}
            <ChatHistory messages={research.chat} />
            {running && (
              <div className="bubble assistant live">
                <div className="live-head">
                  <span className="spinner" /> Researching… {formatElapsed(now - startedAt)}
                  <button className="stop-btn" onClick={() => stopRun(project.id)}>Stop</button>
                </div>
                {liveText && <div className="assistant-text">{liveText}</div>}
                <ul className="live-lines">
                  {statusLines.slice(-6).map((l, i) => <li key={i}>{l}</li>)}
                </ul>
                <div className="muted small">A turn can take a few minutes while the agent searches and reads. Stopping keeps what it has found so far.</div>
              </div>
            )}
          </div>
          {error && (
            <p className="error small pad">
              {error} <button className="link" onClick={() => clearRunError(project.id)}>dismiss</button>
            </p>
          )}
          <ChatInput value={input} onChange={setInput} onSend={send} disabled={running} placeholder="Ask the research agent…" inputRef={inputRef} />
        </section>

        <aside className="notebook">
          <div className="drawer-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "plan"} className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Plan</button>
            <button role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>
              Sources {newCount > 0 && <span className="tab-badge pass">{newCount} new</span>}
            </button>
            <button role="tab" aria-selected={tab === "findings"} className={tab === "findings" ? "on" : ""} onClick={() => setTab("findings")}>
              Findings{research.findings.length ? ` (${research.findings.length})` : ""}
            </button>
          </div>
          <div className="notebook-body">
            {tab === "plan" && <PlanTab research={research} onUpdate={onUpdate} />}
            {tab === "sources" && <SourcesTab research={research} project={project} onUpdate={onUpdate} onAddSource={onAddSource} />}
            {tab === "findings" && <FindingsTab research={research} onUpdate={onUpdate} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Past messages. Kept separate so streaming a new reply doesn't redraw the whole history. */
const ChatHistory = memo(function ChatHistory({ messages }: { messages: ResearchMessage[] }) {
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          {m.role === "user" ? (
            m.text
          ) : (
            <>
              <div className="assistant-text">
                {(m.parts ?? [{ text: m.text, refs: [] }]).map((p, i) => (
                  <span key={i}>
                    {p.text}
                    {p.refs.map((r, j) => (
                      <a key={j} className="ref-chip web" href={r.url} target="_blank" rel="noreferrer" title={`${r.title}: ${r.quote}`}>
                        ↗
                      </a>
                    ))}
                  </span>
                ))}
              </div>
              {m.activity && m.activity.length > 0 && (
                <details className="activity">
                  <summary>{activitySummary(m.activity)}</summary>
                  <ul>{m.activity.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
});

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function activitySummary(lines: string[]): string {
  const searches = lines.filter((l) => l.startsWith("Searching")).length;
  const reads = lines.filter((l) => l.startsWith("Reading")).length;
  const bits = [searches && `${searches} search${searches === 1 ? "" : "es"}`, reads && `${reads} page${reads === 1 ? "" : "s"} read`].filter(Boolean);
  return bits.length ? `What I did: ${bits.join(", ")}` : "What I did";
}

/* ---------- Plan ---------- */

const PlanTab = memo(function PlanTab({ research, onUpdate }: { research: ResearchState; onUpdate: Props["onUpdate"] }) {
  const counts = (id?: string) => ({
    sources: research.candidates.filter((c) => c.status !== "dismissed" && (id ? c.subQuestionIds.includes(id) : c.subQuestionIds.length === 0)).length,
    findings: research.findings.filter((f) => f.subQuestionId === id).length,
  });
  const gapsFor = (id?: string) => research.gaps.filter((g) => (id ? g.subQuestionId === id : !research.subQuestions.some((q) => q.id === g.subQuestionId)));
  const removeGap = (id: string) => onUpdate((r) => ({ ...r, gaps: r.gaps.filter((g) => g.id !== id) }));

  return (
    <div>
      <label className="field">
        <span>Research question</span>
        <input value={research.question} onChange={(e) => { const v = e.target.value; onUpdate((r) => ({ ...r, question: v })); }} placeholder="What should the research answer?" />
      </label>
      <h3>Sub-questions</h3>
      {research.subQuestions.length === 0 && <p className="muted small">None yet. Ask the agent to help scope the research, or add your own.</p>}
      <ol className="subq-list">
        {research.subQuestions.map((q, i) => {
          const c = counts(q.id);
          return (
            <li key={q.id}>
              <div className="subq-row">
                <span className="subq-num">Q{i + 1}</span>
                <input
                  value={q.text}
                  onChange={(e) => { const v = e.target.value; onUpdate((r) => ({ ...r, subQuestions: r.subQuestions.map((x) => (x.id === q.id ? { ...x, text: v } : x)) })); }}
                  aria-label={`Sub-question ${i + 1}`}
                />
                <button className="icon" aria-label="Remove sub-question" onClick={() => onUpdate((r) => ({ ...r, subQuestions: r.subQuestions.filter((x) => x.id !== q.id) }))}>✕</button>
              </div>
              <div className="muted small subq-meta">
                {c.sources} source{c.sources === 1 ? "" : "s"} · {c.findings} finding{c.findings === 1 ? "" : "s"}
              </div>
              {gapsFor(q.id).map((g) => <GapRow key={g.id} text={g.text} onRemove={() => removeGap(g.id)} />)}
            </li>
          );
        })}
      </ol>
      <button className="add-btn" onClick={() => onUpdate((r) => ({ ...r, subQuestions: [...r.subQuestions, { id: uid("sq"), text: "" }] }))}>+ Add sub-question</button>
      {gapsFor(undefined).length > 0 && (
        <>
          <h3>Other gaps</h3>
          {gapsFor(undefined).map((g) => <GapRow key={g.id} text={g.text} onRemove={() => removeGap(g.id)} />)}
        </>
      )}
    </div>
  );
});

function GapRow({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <div className="gap-row">
      <span className="gap-tag">Gap</span>
      <span>{text}</span>
      <button className="icon" aria-label="Remove gap" onClick={onRemove}>✕</button>
    </div>
  );
}

/* ---------- Sources ---------- */

const SourcesTab = memo(function SourcesTab({ research, project, onUpdate, onAddSource }: { research: ResearchState; project: Project; onUpdate: Props["onUpdate"]; onAddSource: Props["onAddSource"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDismissed, setShowDismissed] = useState(false);

  const setStatus = (id: string, patch: Partial<Candidate>) =>
    onUpdate((r) => ({ ...r, candidates: r.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const add = async (c: Candidate) => {
    setBusy(c.id);
    setErrors((e) => ({ ...e, [c.id]: "" }));
    try {
      const page = await fetchUrl(c.url);
      const source: Source = { id: uid("src"), title: c.title || page.title, text: page.text, origin: c.url, addedAt: Date.now() };
      onAddSource(source);
      setStatus(c.id, { status: "added", sourceId: source.id });
    } catch (e) {
      setErrors((x) => ({
        ...x,
        [c.id]: `${(e as Error).message} Open the link yourself, then download or copy it and use “Add source”.`,
      }));
    } finally {
      setBusy(null);
    }
  };

  const qNum = (id: string) => research.subQuestions.findIndex((q) => q.id === id) + 1;
  const order = { new: 0, added: 1, dismissed: 2 } as const;
  const visible = [...research.candidates]
    .filter((c) => showDismissed || c.status !== "dismissed")
    .sort((a, b) => order[a.status] - order[b.status] || b.foundAt - a.foundAt);
  const dismissed = research.candidates.filter((c) => c.status === "dismissed").length;

  return (
    <div>
      {research.candidates.length === 0 && <p className="muted small">No sources yet. Ask the agent to search.</p>}
      {visible.map((c) => {
        const inProject = c.status === "added" && project.sources.some((s) => s.id === c.sourceId);
        return (
          <div key={c.id} className={`expert-card cand ${c.status}`}>
            <div className="chip-row">
              <span className={`kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
              {c.paywalled && <span className="tag tag-contradicts">Paywalled</span>}
              <span className="muted small">{c.read ? "Read by the agent" : "Seen in search results"}</span>
              {c.subQuestionIds.map((id) => qNum(id) > 0 && <span key={id} className="tag">Q{qNum(id)}</span>)}
            </div>
            <a className="cand-title" href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>
            <div className="muted small">{[c.publisher, c.published].filter(Boolean).join(" · ")}</div>
            <div className="kp-why">{c.relevance}</div>
            {c.caution && <div className="warn-text small">⚠ {c.caution}</div>}
            {errors[c.id] && <div className="error small">{errors[c.id]}</div>}
            <div className="violation-actions">
              {c.status === "new" && (
                <>
                  <button className="primary" disabled={busy !== null} onClick={() => add(c)}>{busy === c.id ? "Importing…" : "Add as source"}</button>
                  <button onClick={() => setStatus(c.id, { status: "dismissed" })}>Dismiss</button>
                </>
              )}
              {c.status === "added" && (inProject ? <span className="ok small">✓ Added to the project's sources</span> : <span className="muted small">Added, then removed from sources</span>)}
              {c.status === "dismissed" && <button onClick={() => setStatus(c.id, { status: "new" })}>Restore</button>}
            </div>
          </div>
        );
      })}
      {dismissed > 0 && (
        <button className="link small" onClick={() => setShowDismissed(!showDismissed)}>
          {showDismissed ? "Hide" : "Show"} {dismissed} dismissed
        </button>
      )}
    </div>
  );
});

/* ---------- Findings ---------- */

const FindingsTab = memo(function FindingsTab({ research, onUpdate }: { research: ResearchState; onUpdate: Props["onUpdate"] }) {
  if (research.findings.length === 0) return <p className="muted small">No findings yet. They appear as the agent reads sources.</p>;
  const groups = [
    ...research.subQuestions.map((q, i) => ({ label: `Q${i + 1}. ${q.text}`, items: research.findings.filter((f) => f.subQuestionId === q.id) })),
    { label: "General", items: research.findings.filter((f) => !research.subQuestions.some((q) => q.id === f.subQuestionId)) },
  ].filter((g) => g.items.length);

  return (
    <div>
      <p className="muted small">Working notes only: these don't go into the briefing, which is written from the sources you add.</p>
      {groups.map((g) => (
        <section key={g.label}>
          <h3>{g.label}</h3>
          {g.items.map((f) => (
            <div key={f.id} className="expert-card finding">
              <div className="note-text">{f.text}</div>
              <blockquote>{f.quote}</blockquote>
              <div className="chip-row">
                <a className="paper-chip" href={f.url} target="_blank" rel="noreferrer">{f.sourceTitle} ↗</a>
                <span className={`basis ${f.verified ? "basis-library" : "basis-general"}`} title={f.verified ? "The quote was found word for word in the page the agent read" : "The quote couldn't be matched to a page the agent read; check it before relying on it"}>
                  {f.verified ? "✓ Quote checked" : "Quote not checked"}
                </span>
                <button className="icon" aria-label="Remove finding" onClick={() => onUpdate((r) => ({ ...r, findings: r.findings.filter((x) => x.id !== f.id) }))}>✕</button>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
});
