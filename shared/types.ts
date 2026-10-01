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

/** A drafting option offered when generating a summary, with its own writing rules; editable by the researcher. */
export interface DraftStyle {
  id: string;
  name: string;
  /** How to shape the draft: structure, audience, emphasis. */
  instructions: string;
  /** Plain-English rules this style's drafts must follow, on top of the shared rules. */
  rules: string[];
}

export interface Summary {
  id: string;
  title: string;
  sourceIds: string[];
  /** Name of the drafting style used (kept for display if the style is later deleted). */
  style: string;
  /** Id of the drafting style used; its rules are what the draft follows. */
  styleId?: string;
  /** Style whose rules the Style tab checks against, when switched away from the draft's own. */
  checkStyleId?: string;
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
  /** Subject-matter expert review, chat and context notes. */
  expert?: ExpertState;
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
  /** Instructions for the chosen drafting style. */
  styleInstructions: string;
  focus?: string;
  /** Writing rules the draft should follow. */
  rules?: string[];
  /** Points the draft should prioritise, most important first (from an expert review). */
  priorities?: string[];
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

/* ---------- Projects ---------- */

/** One piece of work, usually several sources feeding one briefing. */
export interface Project {
  id: string;
  name: string;
  /** The research question; pre-fills the summary focus. */
  question: string;
  /** Knowledge packs the expert draws on (usually one or two). */
  packIds: string[];
  /** Overrides the packs' default expert briefs when non-empty. */
  brief: string;
  sources: Source[];
  summaries: Summary[];
  createdAt: number;
  /** Up-front research: plan, candidate sources, findings and the research chat. */
  research?: ResearchState;
}

/* ---------- Knowledge packs ---------- */

export type PaperStatus = "processing" | "ready" | "error";

export interface Paper {
  id: string;
  title: string;
  fileName: string;
  kind: "pdf" | "text";
  status: PaperStatus;
  error?: string;
  /** Length of the study copy, in characters. */
  chars?: number;
  addedAt: number;
}

/** A topic library of background papers the expert knows. */
export interface Pack {
  id: string;
  name: string;
  /** Default statement of what the expert should treat as important. */
  brief: string;
  papers: Paper[];
  createdAt: number;
}

export interface PaperDetail extends Paper {
  /** Text of the paper with tables transcribed and figures described, with [Page N] markers. */
  study: string;
}

/* ---------- Expert ---------- */

/** Where a piece of expert judgement comes from. */
export type Basis = "library" | "general" | "both";
export type ExpertTag = "policy" | "new" | "contradicts" | "confirms";

/** A passage in a background paper. */
export interface BackgroundRef {
  packId: string;
  paperId: string;
  paperTitle: string;
  quote: string;
  page?: number;
  /** False if the quote couldn't be found in the paper's study copy. */
  verified: boolean;
}

/** A passage in one of the project's sources; start is -1 if the quote couldn't be located. */
export interface SourceRef {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
}

export interface KeyPoint {
  id: string;
  point: string;
  why: string;
  tags: ExpertTag[];
  importance: "high" | "medium";
  basis: Basis;
  source: SourceRef;
  /** Whether the draft covers it; absent for highlights added from chat. */
  coverage?: "covered" | "partial" | "missing";
  draftQuote?: string;
  background: BackgroundRef[];
}

export interface LowValue {
  id: string;
  quote: string;
  reason: string;
}

export interface ExpertSuggestion {
  id: string;
  /** Exact draft text to replace. */
  quote: string;
  replacement: string;
  reason: string;
  /** The source passage supporting the new wording. */
  support?: SourceRef;
}

/** Background context kept apart from the draft; never inserted into it. */
export interface ContextNote {
  id: string;
  note: string;
  basis: Basis;
  anchor: { kind: "draft"; quote: string } | { kind: "source"; source: SourceRef };
  background: BackgroundRef[];
  createdAt: number;
}

export interface ExpertReview {
  reviewedAt: number;
  reviewedText: string;
  keyPoints: KeyPoint[];
  lowValue: LowValue[];
  suggestions: ExpertSuggestion[];
  /** Context notes the expert proposes; kept only if the researcher accepts them. */
  notes: ContextNote[];
}

export type ChatRef = ({ kind: "source" } & SourceRef) | ({ kind: "paper" } & BackgroundRef);

export interface ChatPart {
  text: string;
  refs: ChatRef[];
}

export type ChatAction = { id: string; status: "pending" | "accepted" | "dismissed" } & (
  | { type: "note"; note: ContextNote }
  | { type: "edit"; edit: ExpertSuggestion }
  | { type: "highlight"; point: KeyPoint }
);

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Plain text, used when replaying the conversation to the model. */
  text: string;
  /** Assistant text split into cited parts. */
  parts?: ChatPart[];
  actions?: ChatAction[];
  createdAt: number;
}

export interface ExpertState {
  review?: ExpertReview;
  /** Key passages accepted from chat. */
  highlights: KeyPoint[];
  notes: ContextNote[];
  chat: ChatMessage[];
  /** Include context notes (clearly labelled) in Markdown exports. */
  exportNotes: boolean;
}

export interface ExpertContext {
  sources: Pick<Source, "id" | "title" | "text">[];
  packIds: string[];
  brief: string;
  question?: string;
  /** The current draft text. */
  draft: string;
  /** Writing rules the draft follows, so suggested wording respects them. */
  rules?: string[];
}

export interface ExpertReviewResponse {
  keyPoints: KeyPoint[];
  lowValue: LowValue[];
  suggestions: ExpertSuggestion[];
  notes: ContextNote[];
}

export interface ExpertChatRequest extends ExpertContext {
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
}

export interface ExpertChatResponse {
  parts: ChatPart[];
  actions: ChatAction[];
  /** Plain-text version of the reply (including what it proposed), for replaying history. */
  text: string;
}

export interface ExtractPdfResponse {
  title: string;
  text: string;
}

/* ---------- Research ---------- */

export interface SubQuestion {
  id: string;
  text: string;
}

export type SourceKind = "government" | "academic" | "intergovernmental" | "news" | "organisation" | "other";

/** A source the research agent found, waiting to be added to the project or dismissed. */
export interface Candidate {
  id: string;
  url: string;
  title: string;
  publisher: string;
  /** Publication date as found, or "" if unknown. */
  published: string;
  kind: SourceKind;
  relevance: string;
  /** Reasons for caution (old, partisan, weak method…), or "". */
  caution: string;
  paywalled: boolean;
  /** True if the agent read the page itself rather than only seeing it in search results. */
  read: boolean;
  subQuestionIds: string[];
  status: "new" | "added" | "dismissed";
  /** The project source created from it, once added. */
  sourceId?: string;
  foundAt: number;
}

/** A working note: something learned, with the passage and page it came from. */
export interface Finding {
  id: string;
  subQuestionId?: string;
  text: string;
  quote: string;
  url: string;
  sourceTitle: string;
  /** True if the quote was found word for word in a page the agent read. */
  verified: boolean;
  createdAt: number;
}

export interface Gap {
  id: string;
  subQuestionId?: string;
  text: string;
}

export interface ResearchRef {
  url: string;
  title: string;
  quote: string;
}

export interface ResearchPart {
  text: string;
  refs: ResearchRef[];
}

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  /** Plain text, used when replaying the conversation to the model. */
  text: string;
  parts?: ResearchPart[];
  /** Short log of what the agent did this turn ("Searched: …", "Read: …"). */
  activity?: string[];
  createdAt: number;
}

export interface ResearchState {
  question: string;
  subQuestions: SubQuestion[];
  candidates: Candidate[];
  findings: Finding[];
  gaps: Gap[];
  chat: ResearchMessage[];
}

export interface ResearchChatRequest {
  state: Pick<ResearchState, "question" | "subQuestions" | "gaps"> & {
    candidates: Pick<Candidate, "url" | "title" | "status">[];
    findings: Pick<Finding, "subQuestionId" | "text" | "url">[];
  };
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
}

/** Changes the agent made to the notebook this turn. Sub-questions are referred to by 1-based number. */
export interface ResearchUpdates {
  plan?: { question: string; subQuestions: string[] };
  candidates: (Omit<Candidate, "id" | "subQuestionIds" | "status" | "foundAt"> & { subQuestions: number[] })[];
  findings: (Omit<Finding, "id" | "subQuestionId" | "createdAt"> & { subQuestion: number })[];
  gaps: { text: string; subQuestion: number }[];
}

export interface ResearchChatResult {
  parts: ResearchPart[];
  activity: string[];
  updates: ResearchUpdates;
  /** Plain-text version of the reply, for replaying history. */
  text: string;
}

/** Server-sent events from POST /api/research/chat. */
export type ResearchEvent =
  | { type: "status"; text: string }
  | { type: "done"; result: ResearchChatResult }
  | { type: "error"; error: string };
