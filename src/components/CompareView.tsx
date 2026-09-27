import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Citation, Segment, Source, Summary, Verdict } from "../../shared/types";
import { coverage, fragmentSource, isUnsupported } from "../lib/spans";
import { download, summaryToMarkdown } from "../lib/export";

interface Props {
  summary: Summary;
  sources: Source[];
  onChange: (summary: Summary) => void;
  onDelete: () => void;
}

export function CompareView({ summary, sources, onChange, onDelete }: Props) {
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

  const sourcePaneRef = useRef<HTMLDivElement>(null);
  const summaryPaneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset view state when switching summaries.
  useEffect(() => {
    setPinned(null);
    setHovered(null);
    setTab(summarySources[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id]);

  const segById = useMemo(() => new Map(summary.segments.map((s) => [s.id, s])), [summary.segments]);
  const claims = useMemo(
    () => summary.segments.filter((s) => s.citations.length > 0 || isUnsupported(s)),
    [summary.segments],
  );
  const activeId = hovered ?? pinned;
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
        </div>
        <div className="toolbar">
          <button onClick={() => step(-1)} title="Previous claim (k)">↑ Prev</button>
          <button onClick={() => step(1)} title="Next claim (j)">↓ Next</button>
          <label className="toggle">
            <input type="checkbox" checked={showUnsupported} onChange={(e) => setShowUnsupported(e.target.checked)} />
            Mark unsupported
          </label>
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

      <div className="compare-body" ref={bodyRef} style={{ gridTemplateColumns: `${split}fr 6px ${100 - split}fr` }}>
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
                  onHover={() => setHovered(seg.citations.length || isUnsupported(seg) ? seg.id : null)}
                  onClick={() => setPinned(pinned === seg.id ? null : seg.id)}
                  onCite={(c) => {
                    setPinned(seg.id);
                    focusCitation(c);
                  }}
                />
              ))}
            </div>
          </div>
          <Inspector
            seg={pinned ? segById.get(pinned) : undefined}
            sources={summarySources}
            verdict={pinned ? summary.review[pinned] : undefined}
            citeNumbers={citeNumbers}
            onVerdict={(v) => pinned && setVerdict(pinned, v)}
            onCite={focusCitation}
            onClose={() => setPinned(null)}
          />
          <details className="notes">
            <summary>Research notes{summary.notes.trim() ? " •" : ""}</summary>
            <textarea
              value={summary.notes}
              placeholder="Your own notes, questions, and follow-ups. Included in exports."
              onChange={(e) => onChange({ ...summary, notes: e.target.value })}
            />
          </details>
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
      </div>
    </div>
  );
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
  onHover: () => void;
  onClick: () => void;
  onCite: (c: Citation) => void;
}

function SegmentView({ seg, active, pinned, linked, verdict, unsupported, citeNumbers, onHover, onClick, onCite }: SegmentViewProps) {
  const interactive = seg.citations.length > 0 || unsupported;
  if (!interactive) return <span>{seg.text}</span>;
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
        {seg.text}
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

interface SourceTextProps {
  source: Source;
  segments: Segment[];
  activeId: string | null;
  flagged: Record<string, Verdict>;
  onHover: (segIds: string[]) => void;
  onPick: (segId: string) => void;
}

function SourceText({ source, segments, activeId, flagged, onHover, onPick }: SourceTextProps) {
  const fragments = useMemo(() => fragmentSource(source.text, source.id, segments), [source, segments]);
  return (
    <div className="source-text" onMouseLeave={() => onHover([])}>
      {source.origin && <div className="origin">{source.origin}</div>}
      {fragments.map((f) => {
        const text = source.text.slice(f.start, f.end);
        if (f.segIds.length === 0) return <span key={f.start}>{text}</span>;
        const isActive = activeId !== null && f.segIds.includes(activeId);
        const isFlagged = f.segIds.some((id) => flagged[id] === "flag");
        return (
          <mark
            key={f.start}
            data-start={f.start}
            className={`${isActive ? "active" : ""} ${isFlagged ? "flagged" : ""} ${f.segIds.length > 1 ? "multi" : ""}`}
            onMouseEnter={() => onHover(f.segIds)}
            onClick={() => onPick(f.segIds[0])}
            title={`Cited by ${f.segIds.length} part${f.segIds.length === 1 ? "" : "s"} of the summary`}
          >
            {text}
          </mark>
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
  onClose: () => void;
}

function Inspector({ seg, sources, verdict, citeNumbers, onVerdict, onCite, onClose }: InspectorProps) {
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
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <p className="inspector-claim">{seg.text.trim()}</p>
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
