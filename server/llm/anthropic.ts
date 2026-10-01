// The Anthropic provider: Claude with native citations, structured outputs, PDF input and
// prompt caching.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaRequestDocumentBlock,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages";
import type {
  GenerateRequest,
  GenerateResult,
  LlmCitation,
  LlmDoc,
  LlmMessage,
  LlmProvider,
  LlmTextBlock,
  StopReason,
  StructuredRequest,
  StructuredResult,
  ToolCall,
  ToolDef,
} from "./types.js";

/** Request fields shared by every call: if the primary model declines, the API retries on a fallback model. */
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as string[],
  fallbacks: "default" as const,
};
const CACHE_1H = { type: "ephemeral", ttl: "1h" } as const;

/** The slice of the SDK the provider uses, so tests can substitute a fake. */
export interface AnthropicLike {
  beta: { messages: { stream(params: any): { finalMessage(): Promise<any> } } };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly capabilities = { nativeCitations: true, pdfInput: true };
  private client: AnthropicLike | null;

  constructor(
    readonly model: string,
    client?: AnthropicLike,
  ) {
    this.client = client ?? null;
  }

  private getClient(): AnthropicLike {
    this.client ??= new Anthropic() as unknown as AnthropicLike;
    return this.client;
  }

  credentialsError(): string | null {
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || this.client) return null;
    return "The server has no ANTHROPIC_API_KEY. Add it to .env and restart.";
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const stream = this.getClient().beta.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      ...(req.tools?.length ? { tools: req.tools.map(toTool) } : {}),
      thinking: { type: "adaptive" },
      ...(req.cache ? { cache_control: CACHE_1H } : {}),
      ...FALLBACK,
      messages: req.messages.map(toMessage),
    });
    const message: BetaMessage = await stream.finalMessage();

    const blocks: LlmTextBlock[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of message.content) {
      if (block.type === "text") blocks.push({ text: block.text, citations: (block.citations ?? []).flatMap(toCitation) });
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
    return {
      blocks,
      toolCalls,
      stopReason: stopReason(message.stop_reason),
      model: message.model,
      assistant: { role: "assistant", text: blocks.map((b) => b.text).join(""), raw: message.content, toolCalls },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const stream = this.getClient().beta.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      thinking: { type: "adaptive" },
      ...FALLBACK,
      output_config: { format: betaZodOutputFormat(req.schema as any) },
      messages: [toMessage({ role: "user", text: req.prompt, docs: req.docs })],
    });
    const message: BetaMessage & { parsed_output?: T | null } = await stream.finalMessage();
    if (message.stop_reason === "refusal") return { refused: true };
    return { refused: false, value: message.parsed_output ?? null };
  }

  async pdfToMarkdown(pdf: Buffer, prompt: string): Promise<string> {
    const stream = this.getClient().beta.messages.stream({
      model: this.model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      ...FALLBACK,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const message: BetaMessage = await stream.finalMessage();

    if (message.stop_reason === "refusal") throw new Error("The model declined to process this PDF.");
    if (message.stop_reason === "max_tokens") throw new Error("This PDF is too long to convert in one pass. Split it into parts.");
    return message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
  }

  describeError(err: unknown): { status: number; error: string } | null {
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 401, error: "The Anthropic API rejected the API key. Check ANTHROPIC_API_KEY." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, error: "Rate limited by the Anthropic API. Wait a moment and try again." };
    }
    if (err instanceof Anthropic.APIError) return { status: 502, error: `Anthropic API error: ${err.message}` };
    return null;
  }
}

function stopReason(r: BetaMessage["stop_reason"]): StopReason {
  if (r === "refusal") return "refusal";
  if (r === "max_tokens") return "max_tokens";
  if (r === "tool_use") return "tool_use";
  return "end";
}

function toCitation(c: NonNullable<Extract<BetaMessage["content"][number], { type: "text" }>["citations"]>[number]): LlmCitation[] {
  if (c.type === "char_location") {
    return [{ docIndex: c.document_index, docTitle: c.document_title ?? "", quote: c.cited_text, start: c.start_char_index, end: c.end_char_index }];
  }
  if (c.type === "page_location") {
    return [{ docIndex: c.document_index, docTitle: c.document_title ?? "", quote: c.cited_text, page: c.start_page_number }];
  }
  return [];
}

function toTool(t: ToolDef): BetaTool {
  return { name: t.name, description: t.description, eager_input_streaming: true, input_schema: t.schema as BetaTool["input_schema"] };
}

function toDocument(d: LlmDoc): BetaRequestDocumentBlock {
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: d.text },
    title: d.title,
    ...(d.context ? { context: d.context } : {}),
    ...(d.citations ? { citations: { enabled: true } } : {}),
    ...(d.cache ? { cache_control: CACHE_1H } : {}),
  };
}

function toMessage(m: LlmMessage): BetaMessageParam {
  switch (m.role) {
    case "user": {
      const text: BetaTextBlockParam = { type: "text", text: m.text };
      return { role: "user", content: [...(m.docs ?? []).map(toDocument), text] };
    }
    case "assistant":
      return { role: "assistant", content: (m.raw as BetaMessage["content"] | undefined) ?? m.text };
    case "tool":
      return {
        role: "user",
        content: m.results.map(
          (r): BetaToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: r.id,
            ...(r.isError ? { is_error: true } : {}),
            content: r.pdf
              ? [
                  {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data: r.pdf.data.toString("base64") },
                    title: r.pdf.title,
                    citations: { enabled: true },
                  },
                ]
              : r.text,
          }),
        ),
      };
  }
}
