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
