import { useState } from "react";
import type { Source } from "../../shared/types";
import { fetchUrl } from "../lib/api";
import { uid } from "../lib/storage";

type Mode = "paste" | "file" | "url";

interface Props {
  onAdd: (sources: Source[]) => void;
  onClose: () => void;
}

export function AddSourceModal({ onAdd, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = (t: string, body: string, origin?: string): Source => ({
    id: uid("src"),
    title: t.trim() || firstLine(body),
    text: body,
    origin,
    addedAt: Date.now(),
  });

  const submitPaste = () => {
    if (!text.trim()) return setError("Paste some text first.");
    onAdd([make(title, text.trim())]);
  };

  const submitUrl = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchUrl(url);
      onAdd([make(title || res.title, res.text, res.url)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const added: Source[] = [];
    for (const file of Array.from(files)) {
      if (file.type && !file.type.startsWith("text/") && !/\.(md|markdown|txt|csv|json|html?)$/i.test(file.name)) {
        setError(`${file.name}: only text files are supported (.txt, .md, .html…). For PDFs, copy the text and paste it.`);
        continue;
      }
      const body = (await file.text()).trim();
      if (body) added.push(make(file.name.replace(/\.[^.]+$/, ""), body, file.name));
    }
    if (added.length) onAdd(added);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add source">
        <div className="modal-head">
          <h2>Add source</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="segmented">
          {(["paste", "file", "url"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setError(null); }}>
              {m === "paste" ? "Paste text" : m === "file" ? "Upload file" : "From URL"}
            </button>
          ))}
        </div>

        {mode !== "file" && (
          <label className="field">
            <span>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 2024 annual report" />
          </label>
        )}

        {mode === "paste" && (
          <>
            <label className="field grow">
              <span>Text</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an article, paper, transcript, notes…" autoFocus />
            </label>
            <div className="modal-foot">
              <span className="muted">{text.length.toLocaleString()} characters</span>
              <button className="primary" onClick={submitPaste}>Add source</button>
            </div>
          </>
        )}

        {mode === "file" && (
          <label className="dropzone">
            <input type="file" multiple accept=".txt,.md,.markdown,.html,.htm,.csv,.json,text/*" onChange={(e) => onFiles(e.target.files)} />
            <span>Choose one or more text files</span>
            <span className="muted">.txt, .md, .html and other plain-text formats</span>
          </label>
        )}

        {mode === "url" && (
          <>
            <label className="field">
              <span>URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && submitUrl()}
                placeholder="https://…"
                autoFocus
              />
            </label>
            <p className="muted small">The server downloads the page and keeps its readable text. Check the result: some pages need cleaning up.</p>
            <div className="modal-foot">
              <span />
              <button className="primary" disabled={busy || !url.trim()} onClick={submitUrl}>
                {busy ? "Fetching…" : "Fetch & add"}
              </button>
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 70 ? `${line.slice(0, 67)}…` : line || "Untitled source";
}
