import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundRef, Citation, DraftStyle, KeyPoint, Pack, Project, Source, SourceRef, Summary, Verdict } from "../../shared/types";
import { countWords, parseWordLimit, withinLimit } from "../../shared/rules";
import { checkStyle } from "../lib/api";
import { coverage, isUnsupported } from "../lib/spans";
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
} from "../lib/style";
import { StylePanel } from "./StylePanel";
import { ExpertPane } from "./ExpertPane";
import { PaperPeek } from "./Library";
import { SegmentView } from "./DraftText";
import { SourceText } from "./SourceText";
import { Inspector } from "./Inspector";

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

  const coverageBySource = useMemo(
    () => new Map(summarySources.map((s) => [s.id, coverage(s.text, s.id, summary.segments)])),
    [summarySources, summary.segments],
  );
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
              const cov = coverageBySource.get(s.id) ?? 0;
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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "summary";
}
