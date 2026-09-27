import type { FetchUrlResponse, SummarizeRequest, SummarizeResponse } from "../../shared/types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const summarize = (req: SummarizeRequest) => post<SummarizeResponse>("/api/summarize", req);
export const fetchUrl = (url: string) => post<FetchUrlResponse>("/api/fetch-url", { url });
