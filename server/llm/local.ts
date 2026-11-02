// The local provider: any OpenAI-compatible chat server (mlx_lm, vLLM, llama.cpp, Ollama…),
// such as a self-hosted Nemotron.
//
// Local servers vary in what they enforce, so this relies on the least common denominator:
// plain chat completions, streamed so a slow model doesn't hit a proxy's idle timeout.
// Citations come from inline markers, structured output from a schema in the prompt plus
// validation, and PDFs from text extraction.

import { z } from "zod";
import { citationInstructions, parseCitedText, renderDocs } from "./cited.js";
import { extractJson, stripThinking } from "./json.js";
import { pdfToText } from "./pdf-text.js";
import type {
  GenerateRequest,
  GenerateResult,
  LlmDoc,
  LlmMessage,
  LlmProvider,
  StopReason,
  StructuredRequest,
  StructuredResult,
  ToolCall,
} from "./types.js";

export interface LocalOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** A failure talking to the server, already worded for the user. */
export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LocalApiError";
  }
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface Completion {
  content: string;
  toolCalls: { id: string; name: string; args: string }[];
  finish: string | null;
}

export class LocalProvider implements LlmProvider {
  readonly id = "local" as const;
  readonly capabilities = { nativeCitations: false, pdfInput: false };
  readonly model: string;
  private readonly opts: LocalOptions;

  constructor(opts: LocalOptions) {
    this.opts = opts;
    this.model = opts.model;
  }

  credentialsError(): string | null {
    return null;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const docs = allDocs(req.messages);
    const citable = docs.some((d) => d.citations);
    const messages = toWire(req.system + (citable ? citationInstructions(docs) : ""), req.messages);
    const done = await this.complete(messages, req.maxTokens, req.tools, req.signal);

    let text = stripThinking(done.content);
    let calls: ToolCall[] = done.toolCalls.map((c) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }));
    if (calls.length === 0 && req.tools?.length) {
      const inline = extractInlineToolCalls(text);
      calls = inline.calls;
      text = inline.text;
    }

    const blocks = !text ? [] : citable ? parseCitedText(text, docs) : [{ text, citations: [] }];
    const cleaned = blocks.map((b) => b.text).join("");
    return {
      blocks,
      toolCalls: calls,
      stopReason: stopReason(done.finish, calls.length > 0),
      model: this.model,
      assistant: { role: "assistant", text: cleaned, toolCalls: calls },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const schema = z.toJSONSchema(req.schema) as Record<string, unknown>;
    delete schema.$schema;
    const ask =
      `${req.prompt}\n\nReply with a single JSON object that conforms to this JSON Schema, and nothing else: ` +
      `no Markdown fences, no commentary.\n${JSON.stringify(schema)}`;
    const messages = toWire(req.system, [{ role: "user", text: ask, docs: req.docs }]);

    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const done = await this.complete(messages, req.maxTokens, undefined, req.signal);
      if (done.finish === "content_filter") return { refused: true };
      last = done.content;
      let problem: string;
      try {
        const parsed = req.schema.safeParse(extractJson(last));
        if (parsed.success) return { refused: false, value: parsed.data };
        problem = parsed.error.message;
      } catch (err) {
        problem = (err as Error).message;
      }
      // A reply cut off by the token limit won't improve by asking again.
      if (done.finish === "length") break;
      messages.push(
        { role: "assistant", content: stripThinking(last) },
        { role: "user", content: `That reply was not usable: ${problem}\nReply again with only the JSON object.` },
      );
    }
    return { refused: false, value: null };
  }

  async pdfToMarkdown(pdf: Buffer): Promise<string> {
    return pdfToText(pdf);
  }

  describeError(err: unknown): { status: number; error: string } | null {
    return err instanceof LocalApiError ? { status: err.status, error: err.message } : null;
  }

  /** One streamed chat completion. */
  private async complete(messages: WireMessage[], maxTokens: number, tools?: GenerateRequest["tools"], signal?: AbortSignal): Promise<Completion> {
    const { baseUrl, apiKey, timeoutMs } = this.opts;
    const doFetch = this.opts.fetch ?? fetch;
    const body = {
      model: this.model,
      messages,
      max_tokens: maxTokens,
      stream: true,
      ...(tools?.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) }
        : {}),
    };

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw networkError(err, baseUrl, timeoutMs);
    }
    if (!response.ok) throw httpError(response.status, await response.text().catch(() => ""));

    try {
      return (response.headers.get("content-type") ?? "").includes("json") ? readJson(await response.json()) : await readStream(response);
    } catch (err) {
      if (err instanceof LocalApiError) throw err;
      throw networkError(err, baseUrl, timeoutMs);
    }
  }
}

/* ---------- Wire format ---------- */

/** Documents are numbered D1, D2… in the order they appear across the conversation. */
function allDocs(messages: LlmMessage[]): LlmDoc[] {
  return messages.flatMap((m) => (m.role === "user" ? (m.docs ?? []) : []));
}

function toWire(system: string, messages: LlmMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];
  let docCount = 0;
  for (const m of messages) {
    if (m.role === "user") {
      const docs = m.docs ?? [];
      const rendered = docs.length ? `${renderDocs(docs, docCount)}\n\n` : "";
      docCount += docs.length;
      out.push({ role: "user", content: rendered + m.text });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {}),
      });
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.text });
    }
  }
  return out;
}

function stopReason(finish: string | null, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return "tool_use";
  if (finish === "length") return "max_tokens";
  if (finish === "content_filter") return "refusal";
  return "end";
}

function parseArgs(args: string): unknown {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return undefined;
  }
}

/* ---------- Tool calls the server left in the text ---------- */

// Some servers don't parse the model's tool-call syntax and return it as content:
//   <tool_call>{"name": "x", "arguments": {...}}</tool_call>
//   <tool_call><function=x><parameter=k>v</parameter></function></tool_call>
export function extractInlineToolCalls(text: string): { text: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const rest = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_all, body: string) => {
    const call = parseInlineCall(body.trim(), calls.length);
    if (call) calls.push(call);
    return "";
  });
  return { text: rest.trim(), calls };
}

function parseInlineCall(body: string, n: number): ToolCall | null {
  const id = `call_inline_${n}`;
  if (body.startsWith("{")) {
    try {
      const j = JSON.parse(body) as { name?: unknown; arguments?: unknown };
      if (typeof j.name !== "string") return null;
      return { id, name: j.name, input: typeof j.arguments === "string" ? parseArgs(j.arguments) : (j.arguments ?? {}) };
    } catch {
      return null;
    }
  }
  const fn = body.match(/<function=([^>\s]+)>([\s\S]*?)<\/function>/);
  if (!fn) return null;
  const input: Record<string, unknown> = {};
  for (const p of fn[2].matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g)) {
    const raw = p[2].replace(/^\n|\n$/g, "");
    try {
      input[p[1]] = JSON.parse(raw);
    } catch {
      input[p[1]] = raw;
    }
  }
  return { id, name: fn[1], input };
}

/* ---------- Reading responses ---------- */

function readJson(j: any): Completion {
  const choice = j?.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    toolCalls: (choice?.message?.tool_calls ?? []).map((c: any, i: number) => ({
      id: c.id ?? `call_${i}`,
      name: c.function?.name ?? "",
      args: c.function?.arguments ?? "",
    })),
    finish: choice?.finish_reason ?? null,
  };
}

async function readStream(response: Response): Promise<Completion> {
  const out: Completion = { content: "", toolCalls: [], finish: null };
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new LocalApiError(502, `Local model error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") out.content += delta.content;
    for (const tc of delta.tool_calls ?? []) {
      const call = (out.toolCalls[tc.index ?? 0] ??= { id: "", name: "", args: "" });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.args += tc.function.arguments;
    }
    if (choice.finish_reason) out.finish = choice.finish_reason;
  };

  for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  buffer += decoder.decode();
  buffer.split(/\r?\n/).forEach(handle);

  out.toolCalls = out.toolCalls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return out;
}

/* ---------- Errors ---------- */

function httpError(status: number, body: string): LocalApiError {
  const detail = body.trim().slice(0, 300);
  if (status === 401 || status === 403) return new LocalApiError(401, "The local model server rejected the credentials. Check LOCAL_LLM_API_KEY.");
  if (status === 429) return new LocalApiError(429, "The local model server is busy. Wait a moment and try again.");
  return new LocalApiError(502, `Local model error (HTTP ${status})${detail ? `: ${detail}` : ""}`);
}

function networkError(err: unknown, baseUrl: string, timeoutMs: number): LocalApiError {
  if (err instanceof Error && err.name === "TimeoutError") {
    return new LocalApiError(504, `The local model didn't finish within ${Math.round(timeoutMs / 1000)}s. Raise LOCAL_LLM_TIMEOUT_MS or use a smaller request.`);
  }
  return new LocalApiError(502, `Couldn't reach the local model at ${baseUrl}. Check that the server is running.`);
}
