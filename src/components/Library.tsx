import { useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundRef, Pack, PaperDetail } from "../../shared/types";
import * as api from "../lib/api";

/* ---------- All packs ---------- */

export function LibraryView({ packs, onOpenPack, onChanged }: { packs: Pack[]; onOpenPack: (id: string) => void; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const pack = await api.createPack(name.trim(), "");
      setName("");
      onChanged();
      onOpenPack(pack.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <h1>Knowledge library</h1>
      <p className="muted">
        Knowledge packs are topic libraries of background papers. Attach one or two to a project and its expert reads them in full,
        alongside its own trained knowledge. Papers are stored on this computer, in the app's <code>data</code> folder.
      </p>
      <div className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="New pack name, e.g. Urban forestry" />
        <button className="primary" disabled={!name.trim()} onClick={create}>Create pack</button>
      </div>
      {error && <p className="error">{error}</p>}
      <ul className="card-list">
        {packs.map((p) => {
          const ready = p.papers.filter((x) => x.status === "ready");
          const busy = p.papers.filter((x) => x.status === "processing").length;
          return (
            <li key={p.id} className="card" onClick={() => onOpenPack(p.id)}>
              <strong>{p.name}</strong>
              <span className="muted small">
                {ready.length} paper{ready.length === 1 ? "" : "s"} · ~{approxWords(ready.reduce((n, x) => n + (x.chars ?? 0), 0))} words
                {busy > 0 && ` · converting ${busy}`}
              </span>
              {p.brief && <span className="small">{p.brief}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- One pack ---------- */

export function PackView({ pack, onOpenPaper, onChanged, onDeleted }: { pack: Pack; onOpenPaper: (paperId: string) => void; onChanged: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(pack.name);
  const [brief, setBrief] = useState(pack.brief);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setName(pack.name);
    setBrief(pack.brief);
  }, [pack.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: { name?: string; brief?: string }) => {
    await api.updatePack(pack.id, patch);
    onChanged();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        await api.uploadPaper(pack.id, file);
      } catch (e) {
        failed.push((e as Error).message);
      }
      onChanged();
    }
    setUploading(null);
    setErrors(failed);
  };

  const ready = pack.papers.filter((p) => p.status === "ready");
  const words = ready.reduce((n, p) => n + (p.chars ?? 0), 0) / 6;

  return (
    <div className="page">
      <input className="title-input big" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== pack.name && save({ name })} aria-label="Pack name" />
      <label className="field">
        <span>Default expert brief: what counts as important in this field {saved && <em className="ok">saved</em>}</span>
        <textarea
          className="brief-input"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onBlur={() => brief !== pack.brief && save({ brief })}
          placeholder="e.g. Anything with policy implications, or new information that was not previously known."
        />
      </label>

      <div className="pack-toolbar">
        <label className="primary button-like">
          <input type="file" multiple accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          Upload papers
        </label>
        <span className="muted small">
          {uploading
            ? `Uploading ${uploading}…`
            : `PDFs are converted to study copies (full text, tables transcribed, figures described). This takes a minute or two per paper and costs roughly 20–40¢ each, once.`}
        </span>
      </div>
      {errors.map((e, i) => <p key={i} className="error small">{e}</p>)}

      <p className="muted small">
        {ready.length} ready · about {Math.round(words).toLocaleString()} words. The expert can read roughly 400,000 words at once across a project's packs and sources.
      </p>
      <table className="paper-table">
        <tbody>
          {pack.papers.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="link strong" disabled={p.status !== "ready"} onClick={() => onOpenPaper(p.id)}>{p.title}</button>
                <div className="muted small">{p.fileName}</div>
              </td>
              <td className="status-cell">
                {p.status === "processing" && <span className="status processing">Converting…</span>}
                {p.status === "ready" && <span className="status ready">Ready · ~{approxWords(p.chars ?? 0)} words</span>}
                {p.status === "error" && (
                  <>
                    <span className="status error" title={p.error}>Failed</span>
                    <div className="error small">{p.error}</div>
                  </>
                )}
              </td>
              <td className="actions-cell">
                {p.status === "ready" && <button onClick={() => onOpenPaper(p.id)}>Review</button>}
                {p.status === "error" && p.kind === "pdf" && (
                  <button onClick={async () => { await api.retryPaper(pack.id, p.id).catch((e) => setErrors([(e as Error).message])); onChanged(); }}>Retry</button>
                )}
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm(`Remove "${p.title}" from this pack?`)) return;
                    await api.deletePaper(pack.id, p.id);
                    onChanged();
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pack.papers.length === 0 && <p className="muted">No papers yet. Upload the background papers for this topic.</p>}

      <div className="danger-zone">
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Delete the "${pack.name}" pack and all its papers? Projects using it will lose it.`)) return;
            await api.deletePack(pack.id);
            onDeleted();
          }}
        >
          Delete pack
        </button>
      </div>
    </div>
  );
}

/* ---------- One paper: check the study copy against the original ---------- */

export function PaperView({ packId, paperId, onBack }: { packId: string; paperId: string; onBack: () => void }) {
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [study, setStudy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<number | undefined>(undefined);

  useEffect(() => {
    api.getPaper(packId, paperId).then((p) => {
      setPaper(p);
      setStudy(p.study);
    }, (e) => setError((e as Error).message));
  }, [packId, paperId]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!paper) return <div className="page muted">Loading…</div>;
  const dirty = study !== paper.study;

  return (
    <div className="paper-view">
      <header className="compare-header">
        <div className="compare-title">
          <button className="link" onClick={onBack}>← Back to pack</button>
          <div className="title-static">{paper.title}</div>
          <div className="meta">Check the study copy against the original, especially tables and figure descriptions. Fix anything wrong and save; the expert reads the study copy.</div>
        </div>
        <div className="toolbar">
          {dirty && <button onClick={() => setStudy(paper.study)}>Discard changes</button>}
          <button
            className="primary"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              await api.updatePaper(packId, paperId, { study });
              setPaper({ ...paper, study });
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : dirty ? "Save corrections" : "Saved"}
          </button>
        </div>
      </header>
      <div className="paper-split">
        <section className="pane">
          <div className="pane-label">Study copy (editable)</div>
          <textarea
            className="study-editor"
            value={study}
            onChange={(e) => setStudy(e.target.value)}
            onSelect={(e) => {
              // Follow the cursor: show the matching page of the original.
              const el = e.currentTarget;
              const before = el.value.slice(0, el.selectionStart);
              const m = [...before.matchAll(/\[Page (\d+)\]/g)].pop();
              setPage(m ? Number(m[1]) : undefined);
            }}
            spellCheck={false}
          />
        </section>
        <section className="pane">
          <div className="pane-label">Original {page ? `· page ${page}` : ""}</div>
          <iframe key={page ?? 0} className="pdf-frame" src={api.originalUrl(packId, paperId, page)} title="Original paper" />
        </section>
      </div>
    </div>
  );
}

/* ---------- Quick look at a cited background passage ---------- */

export function PaperPeek({ refInfo, onOpenInLibrary, onClose }: { refInfo: BackgroundRef; onOpenInLibrary: () => void; onClose: () => void }) {
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api.getPaper(refInfo.packId, refInfo.paperId).then(setPaper, (e) => setError((e as Error).message));
  }, [refInfo.packId, refInfo.paperId]);

  const excerpt = useMemo(() => {
    if (!paper) return null;
    const i = paper.study.indexOf(refInfo.quote.trim());
    if (i === -1) return { before: paper.study.slice(0, 2500), quote: "", after: "" };
    const start = Math.max(0, i - 1200);
    return {
      before: paper.study.slice(start, i),
      quote: paper.study.slice(i, i + refInfo.quote.trim().length),
      after: paper.study.slice(i + refInfo.quote.trim().length, i + refInfo.quote.trim().length + 1200),
    };
  }, [paper, refInfo.quote]);

  useEffect(() => markRef.current?.scrollIntoView({ block: "center" }), [excerpt]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Background paper">
        <div className="modal-head">
          <h2>{refInfo.paperTitle}{refInfo.page ? <span className="muted"> · page {refInfo.page}</span> : null}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!refInfo.verified && <p className="warn-text small">The expert's quote couldn't be found word for word in this paper. Check the original before relying on it.</p>}
        {error && <p className="error">{error}</p>}
        {excerpt && (
          <div className="peek-text">
            {excerpt.before}
            {excerpt.quote && <mark ref={markRef}>{excerpt.quote}</mark>}
            {excerpt.after}
          </div>
        )}
        {!excerpt && !error && <p className="muted">Loading…</p>}
        {!excerpt?.quote && refInfo.quote && <blockquote className="peek-quote">{refInfo.quote}</blockquote>}
        <div className="modal-foot">
          <button className="link" onClick={onOpenInLibrary}>Open in library</button>
          <a className="button-like" href={api.originalUrl(refInfo.packId, refInfo.paperId, refInfo.page)} target="_blank" rel="noreferrer">
            Open original{refInfo.page ? ` at page ${refInfo.page}` : ""}
          </a>
        </div>
      </div>
    </div>
  );
}

function approxWords(chars: number): string {
  return Math.round(chars / 6).toLocaleString();
}
