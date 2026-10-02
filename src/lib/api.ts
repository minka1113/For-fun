import type {
  ExpertChatRequest,
  ExpertChatResponse,
  ExpertContext,
  ExpertReviewResponse,
  ExtractPdfResponse,
  FetchUrlResponse,
  Pack,
  Paper,
  PaperDetail,
  ResearchChatRequest,
  ResearchChatResult,
  ResearchEvent,
  ResearchUpdates,
  StyleCheckRequest,
  StyleCheckResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "../../shared/types";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const post = <T>(url: string, body: unknown) => request<T>("POST", url, body);

export const summarize = (req: SummarizeRequest) => post<SummarizeResponse>("/api/summarize", req);
export const fetchUrl = (url: string) => post<FetchUrlResponse>("/api/fetch-url", { url });
export const checkStyle = (req: StyleCheckRequest) => post<StyleCheckResponse>("/api/check-style", req);
export const extractPdf = (file: File) => post<ExtractPdfResponse>("/api/extract-pdf", file);

export const expertReview = (req: ExpertContext) => post<ExpertReviewResponse>("/api/expert/review", req);
export const expertChat = (req: ExpertChatRequest) => post<ExpertChatResponse>("/api/expert/chat", req);

export const listPacks = () => request<Pack[]>("GET", "/api/packs");
export const createPack = (name: string, brief: string) => post<Pack>("/api/packs", { name, brief });
export const updatePack = (id: string, patch: { name?: string; brief?: string }) => request<Pack>("PATCH", `/api/packs/${id}`, patch);
export const deletePack = (id: string) => request<{ ok: true }>("DELETE", `/api/packs/${id}`);
export const getPaper = (packId: string, paperId: string) => request<PaperDetail>("GET", `/api/packs/${packId}/papers/${paperId}`);
export const updatePaper = (packId: string, paperId: string, patch: { study?: string; title?: string }) =>
  request<Paper>("PUT", `/api/packs/${packId}/papers/${paperId}`, patch);
export const retryPaper = (packId: string, paperId: string) => post<Paper>(`/api/packs/${packId}/papers/${paperId}/retry`, {});
export const deletePaper = (packId: string, paperId: string) => request<{ ok: true }>("DELETE", `/api/packs/${packId}/papers/${paperId}`);
export const originalUrl = (packId: string, paperId: string, page?: number) =>
  `/api/packs/${packId}/papers/${paperId}/original${page ? `#page=${page}` : ""}`;

export async function uploadPaper(packId: string, file: File): Promise<Paper> {
  const res = await fetch(`/api/packs/${packId}/papers`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent(file.name), "content-type": "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
  return data as Paper;
}

export interface ResearchHandlers {
  onStatus: (text: string) => void;
  /** A piece of the reply as it is written. */
  onText: (text: string) => void;
  /** Everything gathered so far this turn (sent after each round of tool calls). */
  onProgress: (updates: ResearchUpdates) => void;
}

/** The server sends a keep-alive every 15 seconds, so this much silence means the connection is gone. */
const RESEARCH_STALL_MS = 60_000;

/**
 * Run one research-chat turn, reporting progress as the agent searches and reads. Resolves with
 * the reply and notebook updates when the turn finishes. Rejects if the turn fails, is stopped with
 * `signal`, or the connection goes silent.
 */
export async function researchChat(req: ResearchChatRequest, handlers: ResearchHandlers, signal?: AbortSignal): Promise<ResearchChatResult> {
  const res = await fetch("/api/research/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    throw new Error("The server sent an unexpected reply. If you're signed in through a login page, reload the page and try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastByte = Date.now();
  let stalled = false;
  const watchdog = setInterval(() => {
    if (Date.now() - lastByte > RESEARCH_STALL_MS) {
      stalled = true;
      reader.cancel().catch(() => {});
    }
  }, 5_000);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByte = Date.now();
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!chunk.startsWith("data: ")) continue; // keep-alive comments
        const event = JSON.parse(chunk.slice(6)) as ResearchEvent;
        if (event.type === "status") handlers.onStatus(event.text);
        else if (event.type === "text") handlers.onText(event.text);
        else if (event.type === "progress") handlers.onProgress(event.updates);
        else if (event.type === "done") return event.result;
        else if (event.type === "error") throw new Error(event.error);
      }
    }
  } finally {
    clearInterval(watchdog);
  }
  if (stalled) throw new Error("Lost contact with the server during this turn (no response for a minute).");
  throw new Error("The connection closed before the turn finished.");
}
