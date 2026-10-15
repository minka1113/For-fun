// Provider-neutral types. The routes talk to an LlmProvider and never to a vendor SDK, so the
// agentic work can run on Anthropic or on a locally hosted OpenAI-compatible model.

import type { ZodType } from "zod";

export type ProviderId = "anthropic" | "local";

export interface LlmDoc {
  title: string;
  text: string;
  /** A short note on what the document is. */
  context?: string;
  /** Ask for citations that point at passages of this document. */
  citations?: boolean;
  /** Hint that this document is worth caching between requests. */
  cache?: boolean;
}

/** A passage of a document a piece of output rests on. */
export interface LlmCitation {
  docIndex: number;
  docTitle: string;
  quote: string;
  /** Character offsets into the document text, when known. */
  start?: number;
  end?: number;
  page?: number;
}

/** A run of output text and the passages it cites. */
export interface LlmTextBlock {
  text: string;
  citations: LlmCitation[];
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  text: string;
  isError?: boolean;
  /** A PDF to show the model along with the text. Only providers with pdfInput can use it. */
  pdf?: { title: string; data: Buffer };
}

export type LlmMessage =
  | { role: "user"; text: string; docs?: LlmDoc[] }
  | { role: "assistant"; text: string; /** Provider-specific content to replay verbatim in a tool loop. */ raw?: unknown; toolCalls?: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface GenerateRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  /** Cache the conversation prefix between calls, where the provider supports it. */
  cache?: boolean;
  /** Abort the call, e.g. when the browser that asked for it has gone away. */
  signal?: AbortSignal;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal";

export interface GenerateResult {
  blocks: LlmTextBlock[];
  toolCalls: ToolCall[];
  stopReason: StopReason;
  model: string;
  /** Append this to the conversation before sending tool results. */
  assistant: LlmMessage;
}

export interface StructuredRequest<T> {
  system: string;
  docs: LlmDoc[];
  prompt: string;
  schema: ZodType<T>;
  maxTokens: number;
  signal?: AbortSignal;
}

export type StructuredResult<T> = { refused: true } | { refused: false; value: T | null };

export interface Capabilities {
  /** The provider returns citations natively (otherwise they are recovered from quotes). */
  nativeCitations: boolean;
  /** The provider can read a PDF directly, tables and figures included. */
  pdfInput: boolean;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly capabilities: Capabilities;
  /** A message for the user when the provider isn't set up, else null. */
  credentialsError(): string | null;
  /** One model turn, streamed internally. Also used for each round of a tool loop. */
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** One model turn whose reply must match `schema`. */
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  /** Turn a PDF into Markdown following `prompt`. Throws with a user-facing message on failure. */
  pdfToMarkdown(pdf: Buffer, prompt: string, signal?: AbortSignal): Promise<string>;
  /** Map a failure onto an HTTP status and message, or null if it isn't one of the provider's errors. */
  describeError(err: unknown): { status: number; error: string } | null;
}
