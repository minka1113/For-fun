import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundRef, Citation, DraftStyle, KeyPoint, Pack, Project, Segment, Source, SourceRef, Summary, Verdict } from "../../shared/types";
import { countWords, parseWordLimit, withinLimit } from "../../shared/rules";
import { checkStyle } from "../lib/api";
import { coverage, fragmentSource, isUnsupported, type KeyRange } from "../lib/spans";
import { download, summaryToMarkdown } from "../lib/export";
import { rulesFor, styleOf, uid } from "../lib/storage";
import {
  fullText,
  locateInDraft,
  locateViolations,
  marksBySegment,
  replaceRange,
  ruleRows,
  withSegments,
  type DraftAnnotation,
  type MarkKind,
  type SegmentMark,
} from "../lib/style";
import { StylePanel } from "./StylePanel";
import { ExpertPane } from "./ExpertPane";
import { PaperPeek } from "./Library";

interface Props {
  summary: Summary;
  sources: Source[];
  styles: DraftStyle[];
  sharedRules: string[];
  project: Project;
  packs: Pack[];
  onChange: (summary: Summary) => void;
  onDelete: () => void;
  /** Open the rule-set manager, optionally at a given set. */
  onEditRules: (styleId?: string) => void;
  /** Create a new draft of this summary built around the expert's priorities. */
  onRegenerate: (priorities: string[]) => void;
  onOpenPaper: (packId: string, paperId: string) => void;
}

const TAG_SHORT: Record<string, string> = { policy: "Policy", new: "New", contradicts: "Contradicts", confirms: "Confirms" };

type DrawerTab = "claim" | "style" | "notes";

export function CompareView({ summary, sources, styles, sharedRules, project, packs, onChange, onDelete, onEditRules, onRegenerate, onOpenPaper }: Props) {
  const summarySources = useMemo(
    () => summary.sourceIds.map((id) => sources.find((s) => s.id === id)).filter((s): s is Source => Boolean(s)),
    [summary.sourceIds, sources],
  );

  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [linkedFromSource, setLinkedFromSource] = useState<string[]>([]);
  const [tab, setTab] = useState<string | null>(summarySources[0]?.id ?? null);
  const [showUnsupported, setShowUnsupported] = useState(true);
  const [split, setSplit] = useState(50);
  const [copied, setCopied] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTab>("claim");
  const [activeViolation, setActiveViolation] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [expertOpen, setExpertOpen] = useState(Boolean(summary.expert));
  const [expertSelected, setExpertSelected] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(true);
  const [peek, setPeek] = useState<BackgroundRef | null>(null);

  // Async work (the style check) must apply its result to the latest summary, not the one it started with.
  const latest = useRef(summary);
  latest.current = summary;

  const sourcePaneRef = useRef<HTMLDivElement>(null);
  const summaryPaneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset view state when switching summaries.
  useEffect(() => {
    setPinned(null);
    setHovered(null);
    setActiveViolation(null);
    setCheckError(null);
    setExpertSelected(null);
    setExpertOpen(Boolean(summary.expert));
    setTab(summarySources[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id]);

  const segById = useMemo(() => new Map(summary.segments.map((s) => [s.id, s])), [summary.segments]);
  const claims = useMemo(
    () => summary.segments.filter((s) => s.citations.length > 0 || isUnsupported(s)),
    [summary.segments],
  );
  const activeId = hovered ?? pinned;

  const text = useMemo(() => fullText(summary.segments), [summary.segments]);
  // The draft follows its own style's rules; the Style tab can check it against another style's instead.
  const { style: ownStyle, missing: ownStyleMissing } = styleOf(styles, summary);
  const checkAgainst = styles.find((s) => s.id === summary.checkStyleId) ?? ownStyle;
  const rules = useMemo(() => rulesFor(checkAgainst, sharedRules), [checkAgainst, sharedRules]);
  const ownRules = useMemo(() => rulesFor(ownStyle, sharedRules), [ownStyle, sharedRules]);
  // Only highlight problems with rules being checked now (the style may have been switched since the check).
  const located = useMemo(
    () => locateViolations(summary.styleCheck, text).filter((l) => rules.includes(summary.styleCheck!.rules[l.violation.rule])),
    [summary.styleCheck, text, rules],
  );
  const annotations = useMemo<DraftAnnotation[]>(() => {
    const review = summary.expert?.review;
    return [
      ...located.map((l) => ({ id: l.violation.id, kind: "style" as const, range: l.range })),
      ...(review ? locateInDraft(review.suggestions, "edit", text) : []),
      ...(review ? locateInDraft(review.lowValue, "low-value", text) : []),
    ];
  }, [located, summary.expert?.review, text]);
  const marks = useMemo(() => marksBySegment(summary.segments, annotations), [summary.segments, annotations]);
  const keyPoints = useMemo<KeyPoint[]>(
    () => (showKey ? [...(summary.expert?.review?.keyPoints ?? []), ...(summary.expert?.highlights ?? [])] : []),
    [showKey, summary.expert?.review, summary.expert?.highlights],
  );
  const rows = useMemo(() => ruleRows(rules, summary, text, located), [rules, summary, text, located]);
  const wordLimit = rules.map(parseWordLimit).find((l) => l !== null) ?? null;
  const words = countWords(text);
  const active = activeId ? segById.get(activeId) : undefined;
  const activeSource = summarySources.find((s) => s.id === tab) ?? summarySources[0];

  // Global citation numbering, in reading order.
  const citeNumbers = useMemo(() => {
    const numbers = new Map<Citation, number>();
    let n = 0;
    for (const seg of summary.segments) for (const c of seg.citations) numbers.set(c, ++n);
    return numbers;
  }, [summary.segments]);

  const scrollSourceTo = useCallback((start: number) => {
    // Wait a frame so a tab switch has rendered.
    requestAnimationFrame(() => {
      const pane = sourcePaneRef.current;
      const el = pane?.querySelector<HTMLElement>(`[data-start="${start}"]`);
      if (!pane || !el) return;
      const p = pane.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < p.top + 40 || r.bottom > p.bottom - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  const focusCitation = useCallback(
    (c: Citation) => {
      setTab(c.sourceId);
      scrollSourceTo(c.start);
    },
    [scrollSourceTo],
  );

  const focusSourceRef = useCallback(
    (ref: SourceRef) => {
      setTab(ref.sourceId);
      if (ref.start >= 0) scrollSourceTo(ref.start);
    },
    [scrollSourceTo],
  );

  const pickMark = (id: string, kind: MarkKind) => {
    if (kind === "style") {
      selectViolation(id);
    } else {
      setExpertOpen(true);
      setExpertSelected(id);
    }
  };

  // When the active segment changes, bring its first citation into view.
  useEffect(() => {
    if (!active || active.citations.length === 0) return;
    const inTab = active.citations.find((c) => c.sourceId === tab);
    focusCitation(inTab ?? active.citations[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const setVerdict = useCallback(
    (segId: string, verdict: Verdict | null) => {
      const review = { ...summary.review };
      if (verdict) review[segId] = verdict;
      else delete review[segId];
      onChange({ ...summary, review });
    },
    [summary, onChange],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (claims.length === 0) return;
      const idx = claims.findIndex((c) => c.id === pinned);
      const next = idx === -1 ? (dir === 1 ? 0 : claims.length - 1) : (idx + dir + claims.length) % claims.length;
      const id = claims[next].id;
      setHovered(null);
      setPinned(id);
      setDrawer("claim");
      summaryPaneRef.current
        ?.querySelector<HTMLElement>(`[data-seg="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [claims, pinned],
  );

  // Keyboard review: j/k to move between claims, v to verify, f to flag, Esc to clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "j" || e.key === "ArrowDown") step(1);
      else if (e.key === "k" || e.key === "ArrowUp") step(-1);
      else if (e.key === "Escape") setPinned(null);
      else if (pinned && e.key === "v") setVerdict(pinned, summary.review[pinned] === "ok" ? null : "ok");
      else if (pinned && e.key === "f") setVerdict(pinned, summary.review[pinned] === "flag" ? null : "flag");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, pinned, setVerdict, summary.review]);

  const runStyleCheck = async () => {
    const claudeRules = rules.filter((r) => !parseWordLimit(r));
    setChecking(true);
    setCheckError(null);
    try {
      const res = await checkStyle({
        text,
        rules: claudeRules,
        sources: summarySources.map(({ title, text }) => ({ title, text })),
      });
      onChange({
        ...latest.current,
        styleCheck: {
          checkedAt: Date.now(),
          rules: claudeRules,
          checkedText: text,
          results: res.results,
          violations: res.violations.map((v) => ({ ...v, id: uid("v") })),
        },
      });
    } catch (e) {
      setCheckError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const dropViolation = (s: Summary, id: string): Summary =>
    s.styleCheck ? { ...s, styleCheck: { ...s.styleCheck, violations: s.styleCheck.violations.filter((v) => v.id !== id) } } : s;

  const applyViolation = (id: string) => {
    const found = located.find((l) => l.violation.id === id);
    if (!found?.range) return;
    const { segments, changed } = replaceRange(summary.segments, found.range.start, found.range.end, found.violation.suggestion);
    onChange(dropViolation(withSegments(summary, segments, changed), id));
    setActiveViolation(null);
  };

  const editSegment = (segId: string, newText: string) => {
    const segments = summary.segments.map((s) => (s.id === segId ? { ...s, text: newText, edited: true } : s));
    onChange(withSegments(summary, segments, [segId]));
  };

  const selectViolation = (id: string) => {
    setActiveViolation(id);
    setDrawer("style");
    requestAnimationFrame(() => {
      document.querySelector(`[data-violation="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      summaryPaneRef.current?.querySelector(`[data-mark="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const stats = useMemo(() => {
    const cited = summary.segments.filter((s) => s.citations.length > 0).length;
    const unsupported = summary.segments.filter(isUnsupported).length;
    const values = Object.values(summary.review);
    return {
      cited,
      unsupported,
      verified: values.filter((v) => v === "ok").length,
      flagged: values.filter((v) => v === "flag").length,
    };
  }, [summary.segments, summary.review]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const markdown = () => summaryToMarkdown(summary, sources);

  return (
    <div className="compare">
      <header className="compare-header">
        <div className="compare-title">
          <input
            className="title-input"
            value={summary.title}
            onChange={(e) => onChange({ ...summary, title: e.target.value })}
            aria-label="Summary title"
          />
          <div className="meta">
            {summary.style} · {summarySources.length} source{summarySources.length === 1 ? "" : "s"} · {summary.model}
            {summary.focus && <> · focus: “{summary.focus}”</>}
          </div>
        </div>
        <div className="stats">
          <Stat label="cited" value={stats.cited} />
          <Stat label="verified" value={stats.verified} tone="ok" />
          <Stat label="flagged" value={stats.flagged} tone="flag" />
          <Stat label="unsupported" value={stats.unsupported} tone="warn" />
          <Stat
            label={wordLimit ? `of ${wordLimit.max} words` : "words"}
            value={words}
            tone={wordLimit && !withinLimit(words, wordLimit) ? "flag" : undefined}
          />
        </div>
        <div className="toolbar">
          <button onClick={() => step(-1)} title="Previous claim (k)">↑ Prev</button>
          <button onClick={() => step(1)} title="Next claim (j)">↓ Next</button>
          <label className="toggle">
            <input type="checkbox" checked={showUnsupported} onChange={(e) => setShowUnsupported(e.target.checked)} />
            Mark unsupported
          </label>
          {(summary.expert?.review || summary.expert?.highlights.length) && (
            <label className="toggle">
              <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
              Key passages
            </label>
          )}
          <button className={expertOpen ? "on-accent" : ""} onClick={() => setExpertOpen(!expertOpen)}>
            ✦ Expert
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(markdown());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy Markdown"}
          </button>
          <button onClick={() => download(`${slug(summary.title)}.md`, markdown())}>Download .md</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm("Delete this summary?")) onDelete();
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <div
        className={`compare-body ${expertOpen ? "with-expert" : ""}`}
        ref={bodyRef}
        style={{ gridTemplateColumns: `${split}fr 6px ${100 - split}fr${expertOpen ? " minmax(340px, 30%)" : ""}` }}
      >
        <section className="pane summary-pane" aria-label="Summary">
          <div className="pane-label">Summary</div>
          <div className="pane-scroll" ref={summaryPaneRef} onMouseLeave={() => setHovered(null)}>
            <div className="summary-text">
              {summary.segments.map((seg) => (
                <SegmentView
                  key={seg.id}
                  seg={seg}
                  active={seg.id === activeId}
                  pinned={seg.id === pinned}
                  linked={linkedFromSource.includes(seg.id)}
                  verdict={summary.review[seg.id]}
                  unsupported={showUnsupported && isUnsupported(seg)}
                  citeNumbers={citeNumbers}
                  marks={marks.get(seg.id)}
                  activeMark={activeViolation ?? expertSelected}
                  onMark={pickMark}
                  onHover={() => setHovered(seg.citations.length || isUnsupported(seg) ? seg.id : null)}
                  onClick={() => {
                    setPinned(pinned === seg.id ? null : seg.id);
                    setDrawer("claim");
                  }}
                  onCite={(c) => {
                    setPinned(seg.id);
                    setDrawer("claim");
                    focusCitation(c);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="drawer">
            <div className="drawer-tabs" role="tablist">
              <button role="tab" aria-selected={drawer === "claim"} className={drawer === "claim" ? "on" : ""} onClick={() => setDrawer("claim")}>
                Claim
              </button>
              <button role="tab" aria-selected={drawer === "style"} className={drawer === "style" ? "on" : ""} onClick={() => setDrawer("style")}>
                Style
                <StyleBadge rows={rows} />
              </button>
              <button role="tab" aria-selected={drawer === "notes"} className={drawer === "notes" ? "on" : ""} onClick={() => setDrawer("notes")}>
                Notes{summary.notes.trim() ? " •" : ""}
              </button>
            </div>
            <div className="drawer-body">
              {drawer === "claim" && (
                <Inspector
                  seg={pinned ? segById.get(pinned) : undefined}
                  sources={summarySources}
                  verdict={pinned ? summary.review[pinned] : undefined}
                  citeNumbers={citeNumbers}
                  onVerdict={(v) => pinned && setVerdict(pinned, v)}
                  onCite={focusCitation}
                  onEdit={(t) => pinned && editSegment(pinned, t)}
                  onClose={() => setPinned(null)}
                />
              )}
              {drawer === "style" && (
                <StylePanel
                  rows={rows}
                  styles={styles}
                  checkStyleId={checkAgainst.id}
                  ownStyleId={ownStyleMissing ? "" : ownStyle.id}
                  ownStyleMissing={ownStyleMissing}
                  onChangeCheckStyle={(id) => onChange({ ...summary, checkStyleId: !ownStyleMissing && id === ownStyle.id ? undefined : id })}
                  checking={checking}
                  error={checkError}
                  checkedAt={summary.styleCheck?.checkedAt}
                  stale={Boolean(summary.styleCheck && summary.styleCheck.checkedText !== text)}
                  activeViolation={activeViolation}
                  onCheck={runStyleCheck}
                  onEditRules={() => onEditRules(checkAgainst.id)}
                  onSelect={selectViolation}
                  onApply={applyViolation}
                  onDismiss={(id) => onChange(dropViolation(summary, id))}
                />
              )}
              {drawer === "notes" && (
                <textarea
                  className="notes-input"
                  value={summary.notes}
                  placeholder="Your own notes, questions, and follow-ups. Included in exports."
                  onChange={(e) => onChange({ ...summary, notes: e.target.value })}
                />
              )}
            </div>
          </div>
        </section>

        <div className="divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />

        <section className="pane source-pane" aria-label="Source">
          <div className="tabs" role="tablist">
            {summarySources.map((s) => {
              const cov = coverage(s.text, s.id, summary.segments);
              const hasActive = active?.citations.some((c) => c.sourceId === s.id);
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === activeSource?.id}
                  className={`tab ${s.id === activeSource?.id ? "selected" : ""} ${hasActive ? "has-active" : ""}`}
                  onClick={() => setTab(s.id)}
                  title={s.origin}
                >
                  <span className="tab-title">{s.title}</span>
                  <span className="coverage" title="Share of this source cited by the summary">
                    <span className="coverage-bar" style={{ width: `${Math.round(cov * 100)}%` }} />
                  </span>
                  <span className="coverage-pct">{Math.round(cov * 100)}%</span>
                </button>
              );
            })}
          </div>
          <div className="pane-scroll" ref={sourcePaneRef}>
            {activeSource ? (
              <SourceText
                source={activeSource}
                segments={summary.segments}
                activeId={activeId}
                flagged={summary.review}
                keyPoints={keyPoints}
                selectedPoint={expertSelected}
                onPickPoint={(id) => {
                  setExpertOpen(true);
                  setExpertSelected(id);
                }}
                onHover={setLinkedFromSource}
                onPick={(id) => {
                  setPinned(id);
                  summaryPaneRef.current
                    ?.querySelector<HTMLElement>(`[data-seg="${id}"]`)
                    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }}
              />
            ) : (
              <p className="muted">The sources for this summary were removed from the workspace.</p>
            )}
          </div>
        </section>

        {expertOpen && (
          <ExpertPane
            summary={summary}
            latest={() => latest.current}
            sources={summarySources}
            project={project}
            packs={packs}
            rules={ownRules}
            selectedId={expertSelected}
            onSelect={setExpertSelected}
            onChange={onChange}
            onFocusSource={focusSourceRef}
            onPeekPaper={setPeek}
            onRegenerate={onRegenerate}
            onClose={() => setExpertOpen(false)}
          />
        )}
      </div>
      {peek && (
        <PaperPeek
          refInfo={peek}
          onClose={() => setPeek(null)}
          onOpenInLibrary={() => {
            setPeek(null);
            onOpenPaper(peek.packId, peek.paperId);
          }}
        />
      )}
    </div>
  );
}

function StyleBadge({ rows }: { rows: { status: string }[] }) {
  const failing = rows.filter((r) => r.status === "fail").length;
  if (rows.length === 0) return null;
  if (failing) return <span className="tab-badge fail">{failing}</span>;
  if (rows.every((r) => r.status === "pass")) return <span className="tab-badge pass">✓</span>;
  return null;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

interface SegmentViewProps {
  seg: Segment;
  active: boolean;
  pinned: boolean;
  linked: boolean;
  verdict?: Verdict;
  unsupported: boolean;
  citeNumbers: Map<Citation, number>;
  marks?: SegmentMark[];
  activeMark: string | null;
  onMark: (id: string, kind: MarkKind) => void;
  onHover: () => void;
  onClick: () => void;
  onCite: (c: Citation) => void;
}

function SegmentView(props: SegmentViewProps) {
  const { seg, active, pinned, linked, verdict, unsupported, citeNumbers, onHover, onClick, onCite } = props;
  const interactive = seg.citations.length > 0 || unsupported;
  const body = <MarkedText text={seg.text} marks={props.marks} active={props.activeMark} onPick={props.onMark} />;
  if (!interactive) return <span>{body}</span>;
  const cls = [
    "seg",
    seg.citations.length ? "cited" : "",
    unsupported ? "unsupported" : "",
    active ? "active" : "",
    pinned ? "pinned" : "",
    linked ? "linked" : "",
    verdict ? `verdict-${verdict}` : "",
  ].join(" ");
  return (
    <>
      <span className={cls} data-seg={seg.id} onMouseEnter={onHover} onClick={onClick}>
        {body}
        {verdict === "ok" && <span className="verdict-mark ok" aria-label="verified">✓</span>}
        {verdict === "flag" && <span className="verdict-mark flag" aria-label="flagged">⚑</span>}
      </span>
      {seg.citations.map((c) => (
        <button
          key={`${c.sourceId}:${c.start}:${c.end}`}
          className="cite-chip"
          title={c.quote}
          onMouseEnter={onHover}
          onClick={(e) => {
            e.stopPropagation();
            onCite(c);
          }}
        >
          {citeNumbers.get(c)}
        </button>
      ))}
    </>
  );
}

const MARK_TITLE: Record<MarkKind, string> = {
  style: "Breaks a style rule; click for details",
  edit: "The expert suggests an edit here; click for details",
  "low-value": "The expert rates this as lower-value; click for details",
};

/** Segment text with style-violation and expert highlights. */
function MarkedText({
  text,
  marks,
  active,
  onPick,
}: {
  text: string;
  marks?: SegmentMark[];
  active: string | null;
  onPick: (id: string, kind: MarkKind) => void;
}) {
  if (!marks?.length) return <>{text}</>;
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos) continue; // overlapping violation; the first one wins
    if (m.start > pos) parts.push(text.slice(pos, m.start));
    parts.push(
      <span
        key={m.id}
        data-mark={m.id}
        className={`${m.kind}-mark ${active === m.id ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onPick(m.id, m.kind);
        }}
        title={MARK_TITLE[m.kind]}
      >
        {text.slice(m.start, m.end)}
      </span>,
    );
    pos = m.end;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

interface SourceTextProps {
  source: Source;
  segments: Segment[];
  activeId: string | null;
  flagged: Record<string, Verdict>;
  keyPoints: KeyPoint[];
  selectedPoint: string | null;
  onPickPoint: (id: string) => void;
  onHover: (segIds: string[]) => void;
  onPick: (segId: string) => void;
}

function SourceText({ source, segments, activeId, flagged, keyPoints, selectedPoint, onPickPoint, onHover, onPick }: SourceTextProps) {
  const mine = useMemo(() => keyPoints.filter((k) => k.source.sourceId === source.id && k.source.start >= 0), [keyPoints, source.id]);
  const keyRanges = useMemo<KeyRange[]>(() => mine.map((k) => ({ id: k.id, start: k.source.start, end: k.source.end })), [mine]);
  const fragments = useMemo(() => fragmentSource(source.text, source.id, segments, keyRanges), [source, segments, keyRanges]);
  const startsAt = useMemo(() => new Map(mine.map((k) => [k.source.start, k])), [mine]);
  return (
    <div className="source-text" onMouseLeave={() => onHover([])}>
      {source.origin && <div className="origin">{source.origin}</div>}
      {fragments.map((f) => {
        const text = source.text.slice(f.start, f.end);
        const point = startsAt.get(f.start);
        const tag = point && (
          <button key={`tag-${point.id}`} className={`key-tag ${point.id === selectedPoint ? "selected" : ""}`} onClick={() => onPickPoint(point.id)} title={point.point}>
            ✦ {point.tags.map((t) => TAG_SHORT[t]).join(" · ") || "Key"}
          </button>
        );
        if (f.segIds.length === 0 && f.pointIds.length === 0) return <span key={f.start}>{text}</span>;
        const isActive = activeId !== null && f.segIds.includes(activeId);
        const isFlagged = f.segIds.some((id) => flagged[id] === "flag");
        const cls = [
          f.segIds.length ? "cited" : "",
          isActive ? "active" : "",
          isFlagged ? "flagged" : "",
          f.segIds.length > 1 ? "multi" : "",
          f.pointIds.length ? "key" : "",
          selectedPoint && f.pointIds.includes(selectedPoint) ? "key-selected" : "",
        ].join(" ");
        return (
          <span key={f.start}>
            {tag}
            <mark
              data-start={f.start}
              className={cls}
              onMouseEnter={() => onHover(f.segIds)}
              onClick={() => (f.segIds.length ? onPick(f.segIds[0]) : onPickPoint(f.pointIds[0]))}
              title={
                f.segIds.length
                  ? `Cited by ${f.segIds.length} part${f.segIds.length === 1 ? "" : "s"} of the summary`
                  : "A key passage marked by the expert"
              }
            >
              {text}
            </mark>
          </span>
        );
      })}
    </div>
  );
}

interface InspectorProps {
  seg?: Segment;
  sources: Source[];
  verdict?: Verdict;
  citeNumbers: Map<Citation, number>;
  onVerdict: (v: Verdict | null) => void;
  onCite: (c: Citation) => void;
  onEdit: (text: string) => void;
  onClose: () => void;
}

function Inspector({ seg, sources, verdict, citeNumbers, onVerdict, onCite, onEdit, onClose }: InspectorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [seg?.id]);

  if (!seg) {
    return (
      <div className="inspector empty">
        Hover a sentence to see where it came from. Click to pin it and review. <kbd>j</kbd>/<kbd>k</kbd> step through
        claims, <kbd>v</kbd> verify, <kbd>f</kbd> flag.
      </div>
    );
  }
  const titleOf = (id: string) => sources.find((s) => s.id === id)?.title ?? "Unknown source";
  return (
    <div className="inspector">
      <div className="inspector-head">
        <strong>Claim</strong>
        <div className="verdict-buttons">
          <button className={verdict === "ok" ? "on ok" : ""} onClick={() => onVerdict(verdict === "ok" ? null : "ok")}>
            ✓ Supported
          </button>
          <button className={verdict === "flag" ? "on flag" : ""} onClick={() => onVerdict(verdict === "flag" ? null : "flag")}>
            ⚑ Flag
          </button>
          {draft === null && <button onClick={() => setDraft(seg.text)}>Edit</button>}
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      {draft === null ? (
        <p className="inspector-claim">
          {seg.text.trim()}
          {seg.edited && <span className="edited-tag">edited</span>}
        </p>
      ) : (
        <div className="edit-box">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="edit-actions">
            <span className="muted small">Links to the source stay attached. The sentence goes back to unreviewed.</span>
            <button onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                onEdit(draft);
                setDraft(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      {seg.citations.length === 0 ? (
        <p className="warn-text">No citation. This statement isn't tied to any passage in the sources, so check it or remove it.</p>
      ) : (
        <ul className="quotes">
          {seg.citations.map((c) => (
            <li key={`${c.sourceId}:${c.start}`} onClick={() => onCite(c)}>
              <span className="cite-chip static">{citeNumbers.get(c)}</span>
              <blockquote>{c.quote.trim()}</blockquote>
              <span className="quote-source">{titleOf(c.sourceId)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "summary";
}
