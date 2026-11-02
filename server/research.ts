// The research agent: an interactive chat that searches the open web, reads pages, and fills the
// project's research notebook (plan, candidate sources, findings, gaps).
//
// It needs Claude's server-side web search and web fetch tools, so it talks to the Anthropic API
// directly and is only available with the Anthropic provider. Progress ("Searching: …", "Reading: …")
// streams to the browser as server-sent events while a turn runs, because a turn can take minutes.

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlock,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages";
import type {
  ResearchChatRequest,
  ResearchChatResult,
  ResearchEvent,
  ResearchPart,
  ResearchRef,
  ResearchUpdates,
} from "../shared/types.js";
import { getProvider } from "./llm/index.js";
import { FALLBACK } from "./llm/anthropic.js";
import { normalizeUrl, replayTurns } from "../shared/chat.js";
import { findQuote } from "./spans.js";

/** The slice of the SDK used here, so tests can substitute a fake. */
export interface ResearchClient {
  beta: {
    messages: {
      stream(params: any, options?: { timeout?: number; maxRetries?: number }): {
        on(event: "contentBlock" | "text" | "streamEvent", listener: (...args: any[]) => void): unknown;
        finalMessage(): Promise<any>;
        abort?(): void;
      };
    };
  };
}

let client: ResearchClient | null = null;
/** Use a fake client (tests), or pass null to go back to the real API. */
export function setResearchClient(fake: ResearchClient | null): void {
  client = fake;
  usingFake = fake !== null;
}
let usingFake = false;
function getClient(): ResearchClient {
  client ??= new Anthropic() as unknown as ResearchClient;
  return client;
}

/** Rounds of the agent loop per turn (tool results and paused server-tool turns each start a new round). */
const MAX_ROUNDS = 8;
/** No new round starts after this long, so one turn can't run on indefinitely. */
let turnBudgetMs = 8 * 60 * 1000;
/** Tests shorten the turn budget. */
export function setTurnBudgetMs(ms: number | null): void {
  turnBudgetMs = ms ?? 8 * 60 * 1000;
}
/**
 * A single model call (searching and reading included) that takes longer than this is abandoned.
 * The SDK's own timeout stops once the response starts, so this also covers a stream that stalls.
 */
let requestTimeoutMs = 6 * 60 * 1000;
/** Tests shorten the per-call time limit. */
export function setRequestTimeoutMs(ms: number | null): void {
  requestTimeoutMs = ms ?? 6 * 60 * 1000;
}

class StepTimeoutError extends Error {
  constructor() {
    super(`One step took longer than ${Math.round(requestTimeoutMs / 60000) || 1} minutes, so I stopped it. Anything found so far is in the notebook; ask me to continue.`);
  }
}
const MAX_NOTEBOOK_ITEMS = 60;

const SYSTEM_PROMPT = `You are a research assistant helping a researcher with the up-front research for a briefing. You search the open web and read pages to find strong sources and key facts, and you keep a shared research notebook up to date.

How to work:
- If there is no research plan yet, propose one with update_plan: a clear research question and 3 to 6 sub-questions. If the scope is genuinely unclear, ask the researcher one short clarifying question instead of guessing.
- Prefer primary, authoritative sources: government and intergovernmental bodies, peer-reviewed research, universities and official statistics. Use reputable news outlets and established organisations for context and recent developments. Be wary of blogs, advocacy material and content farms; if you propose one, explain why in "caution".
- Search, then read the most promising pages with web_fetch before relying on them. Never invent URLs, titles, dates or quotes.
- Record each useful source with propose_source, each key fact with record_finding (the quote copied word for word from a page you read), and each unanswered sub-question or missing piece of data with note_gap. Check the notebook first so you don't propose sources that are already there.
- If a source is paywalled or you could only see its abstract, still propose it and set "paywalled".
- Keep replies short: what you did, what you found, what is still missing, and what you suggest next. The notebook holds the detail.

The notebook is the researcher's working notes. The briefing will be written later, only from the sources they choose to add.`;

/* ---------- Tools ---------- */

const KINDS = ["government", "academic", "intergovernmental", "news", "organisation", "other"] as const;

const PlanInput = z.object({ question: z.string(), sub_questions: z.array(z.string()) });
const SourceInput = z.object({
  url: z.string(),
  title: z.string(),
  publisher: z.string(),
  published: z.string(),
  kind: z.enum(KINDS),
  relevance: z.string(),
  caution: z.string(),
  paywalled: z.boolean(),
  sub_questions: z.array(z.number().int()),
});
const FindingInput = z.object({
  finding: z.string(),
  quote: z.string(),
  url: z.string(),
  source_title: z.string(),
  sub_question: z.number().int(),
});
const GapInput = z.object({ gap: z.string(), sub_question: z.number().int() });

// Client tools stream their input as it is generated; every input is validated with zod before use.
const TOOLS: BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 30000, citations: { enabled: true } },
  {
    name: "update_plan",
    description: "Set the research question and the full, ordered list of sub-questions (replaces the current plan).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { question: { type: "string" }, sub_questions: { type: "array", items: { type: "string" } } },
      required: ["question", "sub_questions"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_source",
    description: "Add a source you found to the researcher's candidate list. They decide whether to add it to the project.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        publisher: { type: "string" },
        published: { type: "string", description: 'Publication date as shown on the page, or "" if unknown.' },
        kind: { type: "string", enum: [...KINDS] },
        relevance: { type: "string", description: "One sentence on what it contributes." },
        caution: { type: "string", description: 'Reasons for caution (old, partisan, weak method…), or "".' },
        paywalled: { type: "boolean" },
        sub_questions: { type: "array", items: { type: "integer" }, description: "Numbers of the sub-questions it helps answer." },
      },
      required: ["url", "title", "publisher", "published", "kind", "relevance", "caution", "paywalled", "sub_questions"],
      additionalProperties: false,
    },
  },
  {
    name: "record_finding",
    description: "Record a key fact in the notebook, with a quote copied word for word from a page you read.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        finding: { type: "string", description: "The fact, in one or two sentences." },
        quote: { type: "string" },
        url: { type: "string" },
        source_title: { type: "string" },
        sub_question: { type: "integer", description: "Sub-question number, or 0 if general." },
      },
      required: ["finding", "quote", "url", "source_title", "sub_question"],
      additionalProperties: false,
    },
  },
  {
    name: "note_gap",
    description: "Record something the research has not yet answered or could not find.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { gap: { type: "string" }, sub_question: { type: "integer", description: "Sub-question number, or 0 if general." } },
      required: ["gap", "sub_question"],
      additionalProperties: false,
    },
  },
];

/* ---------- Notebook context ---------- */

function notebookText(state: ResearchChatRequest["state"]): string {
  const lines: string[] = ["<notebook>"];
  lines.push(`Research question: ${state.question.trim() || "(not set yet)"}`);
  if (state.subQuestions.length) {
    lines.push("Sub-questions:", ...state.subQuestions.map((q, i) => `${i + 1}. ${q.text}`));
  } else {
    lines.push("Sub-questions: (none yet)");
  }
  const numberOf = (id?: string) => {
    const i = state.subQuestions.findIndex((q) => q.id === id);
    return i === -1 ? "general" : `Q${i + 1}`;
  };
  const candidates = state.candidates.slice(-MAX_NOTEBOOK_ITEMS);
  lines.push(`Sources already in the notebook (${state.candidates.length}; do not propose these again):`);
  lines.push(...candidates.map((c) => `- [${c.status}] ${c.title} <${c.url}>`));
  const findings = state.findings.slice(-MAX_NOTEBOOK_ITEMS);
  lines.push(`Findings so far (${state.findings.length}):`);
  lines.push(...findings.map((f) => `- (${numberOf(f.subQuestionId)}) ${f.text} <${f.url}>`));
  if (state.gaps.length) lines.push("Open gaps:", ...state.gaps.map((g) => `- (${numberOf(g.subQuestionId)}) ${g.text}`));
  lines.push("</notebook>");
  return lines.join("\n");
}

/* ---------- One turn ---------- */

interface TurnContext {
  state: ResearchChatRequest["state"];
  updates: ResearchUpdates;
  /** Pages read this turn: url -> title and text (text is empty for PDFs). */
  fetched: Map<string, { title: string; text: string }>;
  knownUrls: Set<string>;
}


function subQuestionCount(ctx: TurnContext): number {
  return ctx.updates.plan?.subQuestions.length ?? ctx.state.subQuestions.length;
}
const clampSub = (ctx: TurnContext, n: number) => (n >= 1 && n <= subQuestionCount(ctx) ? n : 0);

function runTool(ctx: TurnContext, block: BetaToolUseBlock): BetaToolResultBlockParam {
  const ok = (content: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: block.id, content });
  const fail = (content: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: block.id, content, is_error: true });

  switch (block.name) {
    case "update_plan": {
      const input = PlanInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const subQuestions = input.data.sub_questions.map((q) => q.trim()).filter(Boolean);
      ctx.updates.plan = { question: input.data.question.trim(), subQuestions };
      return ok("Plan updated.");
    }
    case "propose_source": {
      const input = SourceInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const v = input.data;
      if (!/^https?:\/\//i.test(v.url)) return fail("url must be a full http(s) URL.");
      const key = normalizeUrl(v.url);
      if (ctx.knownUrls.has(key)) return ok("That source is already in the notebook.");
      ctx.knownUrls.add(key);
      ctx.updates.candidates.push({
        url: v.url,
        title: v.title,
        publisher: v.publisher,
        published: v.published,
        kind: v.kind,
        relevance: v.relevance,
        caution: v.caution,
        paywalled: v.paywalled,
        read: [...ctx.fetched.keys()].some((u) => normalizeUrl(u) === key),
        subQuestions: v.sub_questions.map((n) => clampSub(ctx, n)).filter((n) => n > 0),
      });
      return ok("Added to the researcher's candidate sources.");
    }
    case "record_finding": {
      const input = FindingInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const v = input.data;
      const page = [...ctx.fetched.entries()].find(([u]) => normalizeUrl(u) === normalizeUrl(v.url))?.[1];
      const verified = Boolean(page?.text && findQuote(page.text, v.quote));
      ctx.updates.findings.push({
        text: v.finding,
        quote: v.quote,
        url: v.url,
        sourceTitle: v.source_title,
        verified,
        subQuestion: clampSub(ctx, v.sub_question),
      });
      return ok(
        verified
          ? "Recorded."
          : "Recorded, but the quote could not be matched word for word in a page you read this turn. Quote exactly from pages you have read.",
      );
    }
    case "note_gap": {
      const input = GapInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      ctx.updates.gaps.push({ text: input.data.gap, subQuestion: clampSub(ctx, input.data.sub_question) });
      return ok("Gap noted.");
    }
    default:
      return fail(`Unknown tool ${block.name}.`);
  }
}

/** What the researcher sees while a turn runs. */
function describe(block: BetaContentBlock): string | null {
  if (block.type === "server_tool_use") {
    const input = block.input as { query?: string; url?: string };
    if (block.name === "web_search") return `Searching: ${input.query ?? ""}`;
    if (block.name === "web_fetch") return `Reading: ${input.url ?? ""}`;
  }
  if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_tool_result_error") {
    return `Couldn't open a page (${block.content.error_code.replace(/_/g, " ")})`;
  }
  if (block.type === "web_search_tool_result" && !Array.isArray(block.content)) {
    return `A search failed (${block.content.error_code.replace(/_/g, " ")})`;
  }
  if (block.type === "tool_use") {
    const input = block.input as { title?: string };
    if (block.name === "propose_source") return `Found: ${input.title ?? "a source"}`;
    if (block.name === "record_finding") return "Noted a finding";
    if (block.name === "note_gap") return "Noted a gap";
    if (block.name === "update_plan") return "Updated the research plan";
  }
  return null;
}

function collectFetched(ctx: TurnContext, content: BetaContentBlock[]): void {
  for (const block of content) {
    if (block.type !== "web_fetch_tool_result" || block.content.type !== "web_fetch_result") continue;
    const doc = block.content.content;
    const text = doc.source.type === "text" ? doc.source.data : "";
    ctx.fetched.set(block.content.url, { title: doc.title ?? block.content.url, text });
  }
}

function toPart(ctx: TurnContext, block: BetaTextBlock): ResearchPart {
  const refs: ResearchRef[] = [];
  for (const c of block.citations ?? []) {
    if (c.type === "web_search_result_location") {
      refs.push({ url: c.url, title: c.title ?? c.url, quote: c.cited_text });
    } else if (c.type === "char_location" || c.type === "page_location") {
      // A passage of a page read with web_fetch: find the page by its title.
      const page = [...ctx.fetched.entries()].find(([, p]) => p.title === c.document_title);
      if (page) refs.push({ url: page[0], title: page[1].title, quote: c.cited_text });
    }
  }
  return { text: block.text, refs };
}

function buildMessages(body: ResearchChatRequest): BetaMessageParam[] {
  // Earlier turns are replayed as plain text; the notebook (sent with the newest message) carries the detail.
  const messages: BetaMessageParam[] = replayTurns(body.history).map((m) => ({ role: m.role, content: m.text }));
  messages.push({ role: "user", content: `${notebookText(body.state)}\n\n${body.message.trim()}` });
  return messages;
}

interface TurnControl {
  isClosed: () => boolean;
  /** Called with a function that aborts the model call in flight, so a closed connection stops it. */
  setAbort: (abort: (() => void) | null) => void;
}

async function runTurn(body: ResearchChatRequest, emit: (e: ResearchEvent) => void, control: TurnControl): Promise<ResearchChatResult> {
  const started = Date.now();
  const ctx: TurnContext = {
    state: body.state,
    updates: { candidates: [], findings: [], gaps: [] },
    fetched: new Map(),
    knownUrls: new Set(body.state.candidates.map((c) => normalizeUrl(c.url))),
  };
  const messages = buildMessages(body);
  const parts: ResearchPart[] = [];
  const activity: string[] = [];

  let stoppedEarly = false;
  let lastStop: BetaMessage["stop_reason"] = null;
  for (let round = 0; round < MAX_ROUNDS && !control.isClosed(); round++) {
    if (round > 0 && Date.now() - started >= turnBudgetMs) {
      stoppedEarly = true;
      break;
    }
    emit({ type: "status", text: round === 0 ? "Thinking…" : "Continuing…" });
    const stream = getClient().beta.messages.stream({
      model: getProvider().model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      thinking: { type: "adaptive" },
      // Each round resends the pages read so far; caching makes those resends cheap.
      cache_control: { type: "ephemeral" },
      ...FALLBACK,
      messages,
    }, { timeout: requestTimeoutMs, maxRetries: 1 });
    control.setAbort(() => stream.abort?.());
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stream.abort?.();
    }, requestTimeoutMs);

    // Progress listeners must never throw: an error here would break the stream mid-turn.
    let lastStatus = "";
    const status = (text: string) => {
      if (text === lastStatus) return;
      lastStatus = text;
      emit({ type: "status", text });
    };
    stream.on("streamEvent", (event: { type: string; content_block?: { type: string } }) => {
      try {
        if (event.type === "content_block_start" && event.content_block?.type === "thinking") status("Thinking…");
      } catch (err) {
        console.error("research progress:", err);
      }
    });
    stream.on("text", (delta: string) => {
      if (delta) emit({ type: "text", text: delta });
    });
    stream.on("contentBlock", (block: BetaContentBlock) => {
      try {
        const line = describe(block);
        if (!line) return;
        activity.push(line);
        status(line);
      } catch (err) {
        console.error("research progress:", err);
      }
    });
    let message: BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (timedOut) throw new StepTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
      control.setAbort(null);
    }
    lastStop = message.stop_reason;
    if (message.stop_reason === "refusal") throw new RefusalError();

    // Pages read come before any tool calls that rely on them in the same response.
    collectFetched(ctx, message.content);
    for (const block of message.content) if (block.type === "text" && block.text) parts.push(toPart(ctx, block));
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue; // web tools hit their per-request limit; resume as is
    if (message.stop_reason === "tool_use") {
      const calls = message.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
      messages.push({ role: "user", content: calls.map((c) => runTool(ctx, c)) });
      // Send what has been gathered so far, so a stopped or dropped turn keeps it.
      emit({ type: "progress", updates: ctx.updates });
      continue;
    }
    if (message.stop_reason === "max_tokens") parts.push({ text: "\n\n(The reply was cut off because it ran too long.)", refs: [] });
    break;
  }
  // Out of rounds while the agent was still working: it never wrote a closing reply, so say so.
  if (!stoppedEarly && !control.isClosed() && (lastStop === "tool_use" || lastStop === "pause_turn")) stoppedEarly = true;
  if (stoppedEarly) {
    parts.push({ text: "\n\n(I paused here so this turn doesn't run too long. Everything found so far is in the notebook; ask me to continue.)", refs: [] });
  }

  const u = ctx.updates;
  const did = [
    u.plan ? "updated the plan" : "",
    u.candidates.length ? `proposed ${u.candidates.length} source${u.candidates.length === 1 ? "" : "s"}` : "",
    u.findings.length ? `recorded ${u.findings.length} finding${u.findings.length === 1 ? "" : "s"}` : "",
    u.gaps.length ? `noted ${u.gaps.length} gap${u.gaps.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const reply = parts.map((p) => p.text).join("").trim();
  const text = [reply, did.length ? `(This turn I ${did.join(", ")}.)` : ""].filter(Boolean).join("\n\n");
  return { parts, activity, updates: u, text };
}

class RefusalError extends Error {
  constructor() {
    super("The model declined to continue with that research request.");
  }
}

/* ---------- Route ---------- */

export const researchRouter = express.Router();

researchRouter.post("/chat", async (req, res) => {
  const provider = getProvider();
  if (provider.id !== "anthropic") {
    res.status(501).json({ error: "Research uses Claude's web search, so it needs the Anthropic provider (LLM_PROVIDER=anthropic)." });
    return;
  }
  const problem = usingFake ? null : provider.credentialsError();
  if (problem) {
    res.status(500).json({ error: problem });
    return;
  }
  const body = req.body as ResearchChatRequest;
  if (!body?.message?.trim() || !body.state) {
    res.status(400).json({ error: "Type a message first." });
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (e: ResearchEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  // Keep proxies and load balancers from closing a connection that is quiet during a long model call.
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  let closed = false;
  let abortCurrent: (() => void) | null = null;
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    // The researcher stopped or lost the connection: stop the model call too, rather than paying for it.
    abortCurrent?.();
  });

  try {
    const result = await runTurn(body, emit, { isClosed: () => closed, setAbort: (a) => (abortCurrent = a) });
    emit({ type: "done", result });
  } catch (err) {
    if (closed) return; // stopped by the researcher; nobody is listening
    console.error(err);
    const known = err instanceof RefusalError || err instanceof StepTimeoutError ? { error: err.message } : provider.describeError(err);
    emit({ type: "error", error: known?.error ?? "Unexpected server error while researching." });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
