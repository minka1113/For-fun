// Types shared by the server and the browser client.

export interface Source {
  id: string;
  title: string;
  text: string;
  /** Where the text came from, for display only (a URL or a file name). */
  origin?: string;
  addedAt: number;
}

/** A span of a source's text that backs up part of the summary. */
export interface Citation {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
}

/** One run of summary text, plus the source spans it was drawn from (may be empty). */
export interface Segment {
  id: string;
  text: string;
  citations: Citation[];
}

/** A reviewer's verdict on one summary segment after checking it against the source. */
export type Verdict = "ok" | "flag";

export type SummaryStyle = "brief" | "detailed" | "bullets";

export interface Summary {
  id: string;
  title: string;
  sourceIds: string[];
  style: SummaryStyle;
  focus?: string;
  segments: Segment[];
  model: string;
  createdAt: number;
  /** Segment id -> reviewer verdict. */
  review: Record<string, Verdict>;
  /** Free-form notes the researcher keeps alongside the summary. */
  notes: string;
}

export interface SummarizeRequest {
  sources: Pick<Source, "id" | "title" | "text">[];
  style: SummaryStyle;
  focus?: string;
}

export interface SummarizeResponse {
  segments: Segment[];
  model: string;
}

export interface FetchUrlResponse {
  title: string;
  text: string;
  url: string;
}
