// Knowledge packs: topic libraries of background papers, stored on disk under data/packs.
//
//   data/packs/<packId>/pack.json          name, brief, paper list
//   data/packs/<packId>/<paperId>.pdf|.txt original upload
//   data/packs/<packId>/<paperId>.md       study copy

import express from "express";
import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Pack, Paper, PaperDetail } from "../shared/types.js";
import { hasCredentials } from "./respond.js";
import { MAX_PDF_BYTES, studyCopyFromPdf } from "./study.js";

const ROOT = path.resolve(import.meta.dirname, "../data/packs");
const packs = new Map<string, Pack>();

const dir = (packId: string) => path.join(ROOT, packId);
const originalPath = (packId: string, paper: Paper) => path.join(dir(packId), `${paper.id}.${paper.kind === "pdf" ? "pdf" : "txt"}`);
const studyPath = (packId: string, paperId: string) => path.join(dir(packId), `${paperId}.md`);

// Saves to one pack run one at a time, each through its own temporary file, so overlapping
// requests (several uploads, or a conversion finishing during an upload) can't collide.
const saving = new Map<string, Promise<void>>();

function save(pack: Pack): Promise<void> {
  const next = (saving.get(pack.id) ?? Promise.resolve()).catch(() => {}).then(() => write(pack));
  saving.set(pack.id, next);
  return next;
}

async function write(pack: Pack): Promise<void> {
  await mkdir(dir(pack.id), { recursive: true });
  const file = path.join(dir(pack.id), "pack.json");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(pack, null, 2));
  await rename(tmp, file);
}

export async function loadPacks(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pack = JSON.parse(await readFile(path.join(ROOT, entry.name, "pack.json"), "utf8")) as Pack;
      // Conversions still running when the server stopped won't finish now.
      let changed = false;
      for (const paper of pack.papers) {
        if (paper.status === "processing") {
          paper.status = "error";
          paper.error = "Processing was interrupted. Click Retry.";
          changed = true;
        }
      }
      packs.set(pack.id, pack);
      if (changed) await save(pack);
    } catch (err) {
      console.error(`Skipping unreadable pack ${entry.name}:`, err);
    }
  }
}

/* ---------- Conversion queue: a few PDFs at a time ---------- */

const CONCURRENCY = 2;
const queue: { packId: string; paperId: string }[] = [];
let running = 0;

function enqueue(packId: string, paperId: string): void {
  queue.push({ packId, paperId });
  pump();
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    running++;
    convert(job.packId, job.paperId)
      .catch((err) => console.error("Paper conversion failed:", err))
      .finally(() => {
      running--;
      pump();
    });
  }
}

async function convert(packId: string, paperId: string): Promise<void> {
  const pack = packs.get(packId);
  const paper = pack?.papers.find((p) => p.id === paperId);
  if (!pack || !paper) return;
  try {
    const { title, text } = await studyCopyFromPdf(await readFile(originalPath(packId, paper)));
    if (!packs.has(packId) || !pack.papers.includes(paper)) return; // deleted while converting
    await writeFile(studyPath(packId, paperId), text);
    if (title && paper.title === paper.fileName.replace(/\.[^.]+$/, "")) paper.title = title;
    paper.status = "ready";
    paper.chars = text.length;
    delete paper.error;
  } catch (err) {
    console.error(`Converting ${paper.fileName} failed:`, err);
    paper.status = "error";
    paper.error = err instanceof Error ? err.message : "Conversion failed.";
  }
  if (packs.has(packId)) await save(pack);
}

/* ---------- Access for the expert ---------- */

export interface LoadedPaper {
  pack: Pack;
  paper: Paper;
  study: string;
}

/** Ready papers from the given packs, with their study copies. */
export async function loadPapers(packIds: string[]): Promise<LoadedPaper[]> {
  const out: LoadedPaper[] = [];
  for (const id of packIds) {
    const pack = packs.get(id);
    if (!pack) continue;
    for (const paper of pack.papers) {
      if (paper.status !== "ready") continue;
      out.push({ pack, paper, study: await readFile(studyPath(pack.id, paper.id), "utf8") });
    }
  }
  return out;
}

export async function loadOriginalPdf(packId: string, paperId: string): Promise<Buffer | null> {
  const paper = packs.get(packId)?.papers.find((p) => p.id === paperId);
  if (!paper || paper.kind !== "pdf") return null;
  return readFile(originalPath(packId, paper));
}

/* ---------- Routes ---------- */

export const packsRouter = express.Router();

function findPack(req: express.Request, res: express.Response): Pack | null {
  const pack = packs.get(String(req.params.packId));
  if (!pack) res.status(404).json({ error: "Knowledge pack not found." });
  return pack ?? null;
}

function findPaper(pack: Pack, req: express.Request, res: express.Response): Paper | null {
  const paper = pack.papers.find((p) => p.id === req.params.paperId);
  if (!paper) res.status(404).json({ error: "Paper not found." });
  return paper ?? null;
}

packsRouter.get("/", (_req, res) => {
  res.json([...packs.values()].sort((a, b) => a.createdAt - b.createdAt));
});

packsRouter.post("/", async (req, res) => {
  const { name, brief } = req.body as { name?: string; brief?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Give the pack a name." });
    return;
  }
  const pack: Pack = { id: randomUUID(), name: name.trim(), brief: brief?.trim() ?? "", papers: [], createdAt: Date.now() };
  packs.set(pack.id, pack);
  await save(pack);
  res.json(pack);
});

packsRouter.patch("/:packId", async (req, res) => {
  const pack = findPack(req, res);
  if (!pack) return;
  const { name, brief } = req.body as { name?: string; brief?: string };
  if (typeof name === "string" && name.trim()) pack.name = name.trim();
  if (typeof brief === "string") pack.brief = brief;
  await save(pack);
  res.json(pack);
});

packsRouter.delete("/:packId", async (req, res) => {
  const pack = findPack(req, res);
  if (!pack) return;
  packs.delete(pack.id);
  await rm(dir(pack.id), { recursive: true, force: true });
  res.json({ ok: true });
});

// Uploads are sent as the raw file body, with the file name in a header.
packsRouter.post("/:packId/papers", express.raw({ type: () => true, limit: MAX_PDF_BYTES }), async (req, res) => {
  const pack = findPack(req, res);
  if (!pack) return;
  const fileName = decodeURIComponent(String(req.headers["x-file-name"] ?? "paper"));
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: `${fileName} is empty.` });
    return;
  }
  const isPdf = /\.pdf$/i.test(fileName) || body.subarray(0, 5).toString() === "%PDF-";
  const isText = /\.(txt|md|markdown)$/i.test(fileName);
  if (!isPdf && !isText) {
    res.status(415).json({ error: `${fileName}: upload PDFs or plain-text files (.txt, .md).` });
    return;
  }
  if (isPdf && !hasCredentials(res)) return;

  const paper: Paper = {
    id: randomUUID(),
    title: fileName.replace(/\.[^.]+$/, ""),
    fileName,
    kind: isPdf ? "pdf" : "text",
    status: isPdf ? "processing" : "ready",
    addedAt: Date.now(),
  };
  await mkdir(dir(pack.id), { recursive: true });
  await writeFile(originalPath(pack.id, paper), body);
  if (!isPdf) {
    const text = body.toString("utf8");
    await writeFile(studyPath(pack.id, paper.id), text);
    paper.chars = text.length;
  }
  pack.papers.push(paper);
  await save(pack);
  if (isPdf) enqueue(pack.id, paper.id);
  res.json(paper);
});

packsRouter.get("/:packId/papers/:paperId", async (req, res) => {
  const pack = findPack(req, res);
  const paper = pack && findPaper(pack, req, res);
  if (!pack || !paper) return;
  const study = paper.status === "ready" ? await readFile(studyPath(pack.id, paper.id), "utf8") : "";
  const detail: PaperDetail = { ...paper, study };
  res.json(detail);
});

// Save corrections to the study copy, or rename the paper.
packsRouter.put("/:packId/papers/:paperId", async (req, res) => {
  const pack = findPack(req, res);
  const paper = pack && findPaper(pack, req, res);
  if (!pack || !paper) return;
  const { study, title } = req.body as { study?: string; title?: string };
  if (typeof study === "string" && paper.status === "ready") {
    await writeFile(studyPath(pack.id, paper.id), study);
    paper.chars = study.length;
  }
  if (typeof title === "string" && title.trim()) paper.title = title.trim();
  await save(pack);
  res.json(paper);
});

packsRouter.post("/:packId/papers/:paperId/retry", async (req, res) => {
  const pack = findPack(req, res);
  const paper = pack && findPaper(pack, req, res);
  if (!pack || !paper) return;
  if (paper.kind !== "pdf" || paper.status === "processing") {
    res.json(paper);
    return;
  }
  if (!hasCredentials(res)) return;
  paper.status = "processing";
  delete paper.error;
  await save(pack);
  enqueue(pack.id, paper.id);
  res.json(paper);
});

packsRouter.delete("/:packId/papers/:paperId", async (req, res) => {
  const pack = findPack(req, res);
  const paper = pack && findPaper(pack, req, res);
  if (!pack || !paper) return;
  pack.papers = pack.papers.filter((p) => p.id !== paper.id);
  await rm(originalPath(pack.id, paper), { force: true });
  await rm(studyPath(pack.id, paper.id), { force: true });
  await save(pack);
  res.json({ ok: true });
});

packsRouter.get("/:packId/papers/:paperId/original", (req, res) => {
  const pack = findPack(req, res);
  const paper = pack && findPaper(pack, req, res);
  if (!pack || !paper) return;
  res.type(paper.kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(paper.fileName)}"`);
  res.sendFile(originalPath(pack.id, paper));
});
