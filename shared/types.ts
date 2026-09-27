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
  /** True once the researcher (or an applied style fix) has changed the text. */
  edited?: boolean;
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
  /** Result of the most recent style check, if one has been run. */
  styleCheck?: StyleCheck;
}

/** A place where the draft breaks one of the style rules. */
export interface Violation {
  id: string;
  /** Index into StyleCheck.rules. */
  rule: number;
  /** Exact text from the draft that breaks the rule. */
  quote: string;
  explanation: string;
  /** Replacement for `quote`; empty means delete it. */
  suggestion: string;
}

export interface RuleResult {
  rule: number;
  passed: boolean;
  note: string;
}

export interface StyleCheck {
  checkedAt: number;
  /** The rules as they were when the check ran. */
  rules: string[];
  /** The full summary text that was checked, to detect later edits. */
  checkedText: string;
  results: RuleResult[];
  violations: Violation[];
}

export interface StyleCheckRequest {
  text: string;
  /** Rules for Claude to judge (rules the app checks itself are left out). */
  rules: string[];
  sources: Pick<Source, "title" | "text">[];
}

export interface StyleCheckResponse {
  results: { rule: number; passed: boolean; note: string }[];
  violations: { rule: number; quote: string; explanation: string; suggestion: string }[];
}

export interface SummarizeRequest {
  sources: Pick<Source, "id" | "title" | "text">[];
  style: SummaryStyle;
  focus?: string;
  /** Writing rules the draft should follow. */
  rules?: string[];
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
