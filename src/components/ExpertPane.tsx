import { useEffect, useRef, useState } from "react";
import type {
  BackgroundRef,
  Basis,
  ChatAction,
  ChatMessage,
  ChatRef,
  ContextNote,
  ExpertState,
  ExpertSuggestion,
  KeyPoint,
  Pack,
  Project,
  Source,
  SourceRef,
  Summary,
} from "../../shared/types";
import { expertChat, expertReview } from "../lib/api";
import { uid } from "../lib/storage";
import { applyQuoteEdit, fullText } from "../lib/style";
import { ChatInput } from "./ChatInput";

export function emptyExpert(): ExpertState {
  return { highlights: [], notes: [], chat: [], exportNotes: true };
}

interface Props {
  summary: Summary;
  /** Returns the newest version of the summary, for async results. */
  latest: () => Summary;
  sources: Source[];
  project: Project;
  packs: Pack[];
  rules: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (summary: Summary) => void;
  onFocusSource: (ref: SourceRef) => void;
  onPeekPaper: (ref: BackgroundRef) => void;
  onRegenerate: (priorities: string[]) => void;
  onClose: () => void;
}

type Tab = "review" | "chat" | "notes";

const STARTERS = [
  "What are the most important findings here for policymakers?",
  "What is genuinely new compared with the background library?",
  "Is anything important missing from the draft?",
  "Where do the sources disagree with established research?",
];

export function ExpertPane(props: Props) {
  const { summary, project, packs } = props;
  const expert = summary.expert ?? emptyExpert();
  const text = fullText(summary.segments);
  const [tab, setTab] = useState<Tab>("review");
  const [busy, setBusy] = useState<"review" | "chat" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const attached = packs.filter((p) => project.packIds.includes(p.id));
  const brief = project.brief.trim() || attached.map((p) => p.brief.trim()).filter(Boolean).join("\n");

  useEffect(() => setError(null), [summary.id]);
  useEffect(() => chatEnd.current?.scrollIntoView({ block: "end" }), [expert.chat.length, tab]);

  // A selected point or suggestion elsewhere on the page brings its card into view.
  useEffect(() => {
    const id = props.selectedId;
    if (!id) return;
    const r = expert.review;
    const onReviewTab =
      r?.keyPoints.some((k) => k.id === id) ||
      r?.suggestions.some((s) => s.id === id) ||
      r?.lowValue.some((l) => l.id === id) ||
      expert.highlights.some((k) => k.id === id);
    if (!onReviewTab) return;
    setTab("review");
    // Wait for the tab to render before scrolling to the card.
    requestAnimationFrame(() =>
      document.querySelector(`[data-expert-card="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [props.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setExpert = (s: Summary, patch: Partial<ExpertState>): Summary => ({ ...s, expert: { ...(s.expert ?? emptyExpert()), ...patch } });
  const update = (patch: Partial<ExpertState>) => props.onChange(setExpert(summary, patch));

  const context = () => ({
    sources: props.sources.map(({ id, title, text }) => ({ id, title, text })),
    packIds: project.packIds,
    brief,
    question: project.question || summary.focus,
    draft: fullText(props.latest().segments),
    rules: props.rules,
  });

  const runReview = async () => {
    setBusy("review");
    setError(null);
    try {
      const reviewedText = fullText(props.latest().segments);
      const res = await expertReview(context());
      const s = props.latest();
      props.onChange(setExpert(s, { review: { reviewedAt: Date.now(), reviewedText, ...res } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    const userMsg: ChatMessage = { id: uid("msg"), role: "user", text: message.trim(), createdAt: Date.now() };
    const history = expert.chat.map((m) => ({ role: m.role, text: m.text }));
    props.onChange(setExpert(summary, { chat: [...expert.chat, userMsg] }));
    setInput("");
    setBusy("chat");
    setError(null);
    try {
      const res = await expertChat({ ...context(), history, message: userMsg.text });
      const s = props.latest();
      const reply: ChatMessage = { id: uid("msg"), role: "assistant", text: res.text, parts: res.parts, actions: res.actions, createdAt: Date.now() };
      props.onChange(setExpert(s, { chat: [...(s.expert?.chat ?? []), reply] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* ----- Acting on suggestions ----- */

  const applyEdit = (edit: ExpertSuggestion, after: (s: Summary) => Summary) => {
    const edited = applyQuoteEdit(summary, edit.quote, edit.replacement);
    if (!edited) return;
    props.onChange(after(edited));
  };

  const dropFromReview = (s: Summary, id: string): Summary => {
    const review = s.expert?.review;
    if (!review) return s;
    return setExpert(s, {
      review: {
        ...review,
        suggestions: review.suggestions.filter((x) => x.id !== id),
        lowValue: review.lowValue.filter((x) => x.id !== id),
        notes: review.notes.filter((x) => x.id !== id),
      },
    });
  };

  const resolveAction = (s: Summary, actionId: string, status: "accepted" | "dismissed"): Summary =>
    setExpert(s, {
      chat: (s.expert?.chat ?? []).map((m) =>
        m.actions?.some((a) => a.id === actionId) ? { ...m, actions: m.actions.map((a) => (a.id === actionId ? { ...a, status } : a)) } : m,
      ),
    });

  const acceptAction = (action: ChatAction) => {
    if (action.type === "edit") {
      applyEdit(action.edit, (s) => resolveAction(s, action.id, "accepted"));
    } else if (action.type === "note") {
      const s = resolveAction(summary, action.id, "accepted");
      props.onChange(setExpert(s, { notes: [...(s.expert?.notes ?? []), action.note] }));
    } else {
      const s = resolveAction(summary, action.id, "accepted");
      props.onChange(setExpert(s, { highlights: [...(s.expert?.highlights ?? []), action.point] }));
    }
  };

  const review = expert.review;
  const stale = review && review.reviewedText !== text;
  const knowledge = attached.length ? `${attached.map((p) => p.name).join(" + ")} + general knowledge` : "general knowledge only (no packs attached)";

  return (
    <aside className="expert-pane" aria-label="Subject-matter expert">
      <div className="expert-head">
        <div>
          <strong>Expert</strong>
          <div className="muted small">Knows: {knowledge}</div>
        </div>
        <button onClick={props.onClose} aria-label="Close expert">✕</button>
      </div>
      <div className="drawer-tabs" role="tablist">
        {(["review", "chat", "notes"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "review" ? "Review" : t === "chat" ? "Chat" : `Notes${expert.notes.length ? ` (${expert.notes.length})` : ""}`}
          </button>
        ))}
      </div>
      {error && <p className="error small pad">{error}</p>}

      {tab === "review" && (
        <div className="expert-body">
          <div className="style-head">
            <div className="muted small">
              {review ? `Reviewed ${new Date(review.reviewedAt).toLocaleString()}` : "Not reviewed yet"}
              {stale && <span className="warn-text"> · the draft changed since</span>}
            </div>
            <button className="primary" disabled={busy !== null} onClick={runReview}>
              {busy === "review" ? "Reviewing…" : review ? "Re-run review" : "Run expert review"}
            </button>
          </div>
          {!review && busy !== "review" && (
            <p className="muted small">
              The expert ranks the key points in the sources by what matters{brief ? " under your brief" : ""}, checks whether the draft covers
              them, and suggests cuts, edits and background context. With a full library this takes a minute or two.
            </p>
          )}
          {brief && <p className="brief-line small"><strong>Brief:</strong> {brief}</p>}

          {review && (
            <>
              <h3>Key points, most important first</h3>
              <ol className="key-points">
                {review.keyPoints.map((k) => (
                  <KeyPointCard key={k.id} point={k} selected={props.selectedId === k.id} sources={props.sources} onSelect={() => { props.onSelect(k.id); props.onFocusSource(k.source); }} onPeek={props.onPeekPaper} />
                ))}
              </ol>
              {review.keyPoints.length > 0 && (
                <button onClick={() => props.onRegenerate(review.keyPoints.map((k) => k.point))} title="Creates a new summary; this one is kept">
                  ↻ New draft around these priorities
                </button>
              )}

              {review.suggestions.length > 0 && <h3>Suggested edits</h3>}
              {review.suggestions.map((sug) => (
                <EditCard
                  key={sug.id}
                  edit={sug}
                  selected={props.selectedId === sug.id}
                  available={text.includes(sug.quote)}
                  onSelect={() => props.onSelect(sug.id)}
                  onFocusSource={props.onFocusSource}
                  onApply={() => applyEdit(sug, (s) => dropFromReview(s, sug.id))}
                  onDismiss={() => props.onChange(dropFromReview(summary, sug.id))}
                />
              ))}

              {review.lowValue.length > 0 && <h3>Lower-value text</h3>}
              {review.lowValue.map((l) => {
                const available = text.includes(l.quote);
                return (
                  <div key={l.id} data-expert-card={l.id} className={`expert-card ${props.selectedId === l.id ? "selected" : ""}`} onClick={() => props.onSelect(l.id)}>
                    <div className="diff"><del>{l.quote}</del></div>
                    <div className="violation-why">{l.reason}</div>
                    <div className="violation-actions">
                      {available ? (
                        <button onClick={(e) => { e.stopPropagation(); applyEdit({ id: l.id, quote: l.quote, replacement: "", reason: l.reason }, (s) => dropFromReview(s, l.id)); }}>Cut it</button>
                      ) : (
                        <span className="muted small">No longer in the draft.</span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); props.onChange(dropFromReview(summary, l.id)); }}>Keep</button>
                    </div>
                  </div>
                );
              })}

              {review.notes.length > 0 && <h3>Suggested context notes</h3>}
              {review.notes.map((n) => (
                <NoteCard key={n.id} note={n} sources={props.sources} onFocusSource={props.onFocusSource} onPeek={props.onPeekPaper}>
                  <button onClick={() => { const s = dropFromReview(summary, n.id); props.onChange(setExpert(s, { notes: [...(s.expert?.notes ?? []), n] })); }}>Keep note</button>
                  <button onClick={() => props.onChange(dropFromReview(summary, n.id))}>Dismiss</button>
                </NoteCard>
              ))}
            </>
          )}

          {expert.highlights.length > 0 && (
            <>
              <h3>Highlights added from chat</h3>
              <ul className="key-points plain">
                {expert.highlights.map((k) => (
                  <KeyPointCard key={k.id} point={k} selected={props.selectedId === k.id} sources={props.sources} onSelect={() => { props.onSelect(k.id); props.onFocusSource(k.source); }} onPeek={props.onPeekPaper}>
                    <button onClick={(e) => { e.stopPropagation(); update({ highlights: expert.highlights.filter((x) => x.id !== k.id) }); }}>Remove</button>
                  </KeyPointCard>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="chat">
          <div className="chat-log">
            {expert.chat.length === 0 && (
              <div className="starters">
                <p className="muted small">Ask about the sources, the draft or the field. The expert can propose edits, context notes and highlights for you to accept.</p>
                {STARTERS.map((q) => <button key={q} onClick={() => send(q)} disabled={busy !== null}>{q}</button>)}
              </div>
            )}
            {expert.chat.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.role === "user" ? m.text : <AssistantText message={m} sources={props.sources} onFocusSource={props.onFocusSource} onPeek={props.onPeekPaper} />}
                {m.actions?.map((a) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    text={text}
                    sources={props.sources}
                    onFocusSource={props.onFocusSource}
                    onPeek={props.onPeekPaper}
                    onAccept={() => acceptAction(a)}
                    onDismiss={() => props.onChange(resolveAction(summary, a.id, "dismissed"))}
                  />
                ))}
              </div>
            ))}
            {busy === "chat" && <div className="bubble assistant muted">Thinking…</div>}
            <div ref={chatEnd} />
          </div>
          <ChatInput value={input} onChange={setInput} onSend={send} disabled={busy !== null} placeholder="Ask the expert…" />
          {expert.chat.length > 0 && (
            <button className="link small pad" onClick={() => confirm("Clear this conversation?") && update({ chat: [] })}>Clear conversation</button>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="expert-body">
          <p className="muted small">
            Background context from the expert. It is kept apart from the draft and never inserted into it.
          </p>
          <label className="toggle">
            <input type="checkbox" checked={expert.exportNotes} onChange={(e) => update({ exportNotes: e.target.checked })} />
            Include in Markdown exports, in a separate labelled section
          </label>
          {expert.notes.length === 0 && <p className="muted small">No notes yet. Keep notes from a review, or accept ones the expert proposes in chat.</p>}
          {expert.notes.map((n) => (
            <NoteCard key={n.id} note={n} sources={props.sources} onFocusSource={props.onFocusSource} onPeek={props.onPeekPaper}>
              <button onClick={() => update({ notes: expert.notes.filter((x) => x.id !== n.id) })}>Remove</button>
            </NoteCard>
          ))}
        </div>
      )}
    </aside>
  );
}

/* ---------- Pieces ---------- */

const BASIS_LABEL: Record<Basis, string> = { library: "Library", general: "General knowledge", both: "Library + general" };

export function BasisBadge({ basis }: { basis: Basis }) {
  return (
    <span className={`basis basis-${basis}`} title={basis === "library" ? "Based on the background library" : basis === "general" ? "Based on the model's general knowledge, which may be out of date" : "Based on the library and general knowledge"}>
      {BASIS_LABEL[basis]}
    </span>
  );
}

function PaperChips({ refs, onPeek }: { refs: BackgroundRef[]; onPeek: (r: BackgroundRef) => void }) {
  if (!refs.length) return null;
  return (
    <div className="chip-row">
      {refs.map((r, i) => (
        <button key={i} className={`paper-chip ${r.verified ? "" : "unverified"}`} title={r.quote} onClick={(e) => { e.stopPropagation(); onPeek(r); }}>
          📄 {r.paperTitle}{r.page ? `, p.${r.page}` : ""}{r.verified ? "" : " (unverified)"}
        </button>
      ))}
    </div>
  );
}

function SourceChip({ refInfo, sources, onFocus }: { refInfo: SourceRef; sources: Source[]; onFocus: (r: SourceRef) => void }) {
  const title = sources.find((s) => s.id === refInfo.sourceId)?.title ?? "Source";
  return (
    <button className="source-chip" title={refInfo.quote} onClick={(e) => { e.stopPropagation(); onFocus(refInfo); }}>
      ◧ {title}{refInfo.start === -1 ? " (quote not found)" : ""}
    </button>
  );
}

function KeyPointCard({ point, selected, sources, onSelect, onPeek, children }: { point: KeyPoint; selected: boolean; sources: Source[]; onSelect: () => void; onPeek: (r: BackgroundRef) => void; children?: React.ReactNode }) {
  return (
    <li data-expert-card={point.id} className={`expert-card key-point ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="chip-row">
        {point.importance === "high" && <span className="tag tag-high">High</span>}
        {point.tags.map((t) => <span key={t} className={`tag tag-${t}`}>{t}</span>)}
        {point.coverage && <span className={`coverage-badge ${point.coverage}`}>{point.coverage === "covered" ? "✓ in draft" : point.coverage === "partial" ? "◐ partly in draft" : "✕ missing from draft"}</span>}
      </div>
      <div className="kp-point">{point.point}</div>
      <div className="kp-why">{point.why}</div>
      <div className="chip-row">
        <BasisBadge basis={point.basis} />
        <SourceChip refInfo={point.source} sources={sources} onFocus={onSelect} />
      </div>
      <PaperChips refs={point.background} onPeek={onPeek} />
      {children && <div className="violation-actions">{children}</div>}
    </li>
  );
}

function EditCard({ edit, selected, available, onSelect, onFocusSource, onApply, onDismiss, sources = [] }: { edit: ExpertSuggestion; selected?: boolean; available: boolean; onSelect?: () => void; onFocusSource: (r: SourceRef) => void; onApply: () => void; onDismiss: () => void; sources?: Source[] }) {
  return (
    <div data-expert-card={edit.id} className={`expert-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="diff">
        <del>{edit.quote}</del>
        {edit.replacement ? <ins>{edit.replacement}</ins> : <em className="muted"> (delete)</em>}
      </div>
      <div className="violation-why">{edit.reason}</div>
      {edit.support && (
        <div className="chip-row">
          <span className="muted small">Supported by</span>
          <SourceChip refInfo={edit.support} sources={sources} onFocus={onFocusSource} />
        </div>
      )}
      <div className="violation-actions">
        {available ? <button onClick={(e) => { e.stopPropagation(); onApply(); }}>Apply</button> : <span className="muted small">That text is no longer in the draft.</span>}
        <button onClick={(e) => { e.stopPropagation(); onDismiss(); }}>Dismiss</button>
      </div>
    </div>
  );
}

function NoteCard({ note, sources, onFocusSource, onPeek, children }: { note: ContextNote; sources: Source[]; onFocusSource: (r: SourceRef) => void; onPeek: (r: BackgroundRef) => void; children?: React.ReactNode }) {
  return (
    <div className="expert-card note-card">
      <div className="note-anchor">
        {note.anchor.kind === "draft" ? <>On the draft: “{note.anchor.quote}”</> : <SourceChip refInfo={note.anchor.source} sources={sources} onFocus={onFocusSource} />}
      </div>
      <div className="note-text">{note.note}</div>
      <div className="chip-row"><BasisBadge basis={note.basis} /></div>
      <PaperChips refs={note.background} onPeek={onPeek} />
      {children && <div className="violation-actions">{children}</div>}
    </div>
  );
}

function AssistantText({ message, sources, onFocusSource, onPeek }: { message: ChatMessage; sources: Source[]; onFocusSource: (r: SourceRef) => void; onPeek: (r: BackgroundRef) => void }) {
  const parts = message.parts ?? [{ text: message.text, refs: [] }];
  return (
    <div className="assistant-text">
      {parts.map((p, i) => (
        <span key={i}>
          {p.text}
          {p.refs.map((r, j) => <RefChip key={j} refInfo={r} sources={sources} onFocusSource={onFocusSource} onPeek={onPeek} />)}
        </span>
      ))}
    </div>
  );
}

function RefChip({ refInfo, sources, onFocusSource, onPeek }: { refInfo: ChatRef; sources: Source[]; onFocusSource: (r: SourceRef) => void; onPeek: (r: BackgroundRef) => void }) {
  if (refInfo.kind === "source") {
    const title = sources.find((s) => s.id === refInfo.sourceId)?.title ?? "Source";
    return <button className="ref-chip source" title={`${title}: ${refInfo.quote}`} onClick={() => onFocusSource(refInfo)}>◧</button>;
  }
  return (
    <button className="ref-chip paper" title={`${refInfo.paperTitle}${refInfo.page ? `, p.${refInfo.page}` : ""}: ${refInfo.quote}`} onClick={() => onPeek(refInfo)}>
      📄{refInfo.page ? refInfo.page : ""}
    </button>
  );
}

function ActionCard({ action, text, sources, onFocusSource, onPeek, onAccept, onDismiss }: { action: ChatAction; text: string; sources: Source[]; onFocusSource: (r: SourceRef) => void; onPeek: (r: BackgroundRef) => void; onAccept: () => void; onDismiss: () => void }) {
  const done = action.status !== "pending";
  const status = done && <div className={`action-status ${action.status}`}>{action.status === "accepted" ? "✓ Accepted" : "Dismissed"}</div>;
  if (action.type === "edit") {
    return (
      <div className={`action-card ${done ? "done" : ""}`}>
        <div className="action-kind">Suggested edit</div>
        {done ? (
          <><div className="diff"><del>{action.edit.quote}</del><ins>{action.edit.replacement}</ins></div>{status}</>
        ) : (
          <EditCard edit={action.edit} available={text.includes(action.edit.quote)} onFocusSource={onFocusSource} onApply={onAccept} onDismiss={onDismiss} sources={sources} />
        )}
      </div>
    );
  }
  if (action.type === "note") {
    return (
      <div className={`action-card ${done ? "done" : ""}`}>
        <div className="action-kind">Context note</div>
        <NoteCard note={action.note} sources={sources} onFocusSource={onFocusSource} onPeek={onPeek}>
          {!done && <><button onClick={onAccept}>Add to notes</button><button onClick={onDismiss}>Dismiss</button></>}
        </NoteCard>
        {status}
      </div>
    );
  }
  return (
    <div className={`action-card ${done ? "done" : ""}`}>
      <div className="action-kind">Key passage</div>
      <ul className="key-points plain">
        <KeyPointCard point={action.point} selected={false} sources={sources} onSelect={() => onFocusSource(action.point.source)} onPeek={onPeek}>
          {!done && <><button onClick={(e) => { e.stopPropagation(); onAccept(); }}>Highlight in source</button><button onClick={(e) => { e.stopPropagation(); onDismiss(); }}>Dismiss</button></>}
        </KeyPointCard>
      </ul>
      {status}
    </div>
  );
}
