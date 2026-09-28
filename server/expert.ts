// The subject-matter expert: reviews a draft for focus and chats about it, drawing on the
// project's knowledge packs (background papers) and its own trained knowledge.
//
// Background knowledge never goes into the draft. It informs what matters, and it can be
// recorded as context notes, which are kept separate from the draft.

import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessageParam,
  BetaRequestDocumentBlock,
  BetaTextBlock,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages";
import type {
  BackgroundRef,
  ChatAction,
  ChatPart,
  ChatRef,
  ContextNote,
  ExpertChatRequest,
  ExpertChatResponse,
  ExpertContext,
  ExpertReviewResponse,
  KeyPoint,
  SourceRef,
} from "../shared/types.js";
import { FALLBACK, MODEL, findQuote, getClient, hasCredentials, pageAt, resolveSpan, sendApiError } from "./claude.js";
import { type LoadedPaper, loadOriginalPdf, loadPapers } from "./packs.js";

/** Roughly 600k tokens: leaves room in the 1M context for the conversation and thinking. */
const MAX_CONTEXT_CHARS = 2_400_000;
const CACHE_1H = { type: "ephemeral", ttl: "1h" } as const;

interface Ctx {
  req: ExpertContext;
  papers: LoadedPaper[];
}

/* ---------- Documents and labels ---------- */

// Papers are labelled [B1], [B2]… and sources [S1], [S2]… in their document titles. Citations
// and tool inputs refer to these labels, which map back reliably whatever the document order.

function documents(ctx: Ctx, citations: boolean): BetaRequestDocumentBlock[] {
  const papers: BetaRequestDocumentBlock[] = ctx.papers.map((p, i) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: p.study },
    title: `[B${i + 1}] ${p.paper.title}`,
    context: `Background paper from the "${p.pack.name}" knowledge pack.`,
    citations: { enabled: citations },
  }));
  const sources: BetaRequestDocumentBlock[] = ctx.req.sources.map((s, i) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: s.text },
    title: `[S${i + 1}] ${s.title}`,
    context: "Source document for the briefing. The draft may only contain facts from the sources.",
    citations: { enabled: citations },
  }));
  // Cache the background library and the sources for an hour, so follow-up questions re-read them cheaply.
  if (papers.length) papers[papers.length - 1].cache_control = CACHE_1H;
  if (sources.length) sources[sources.length - 1].cache_control = CACHE_1H;
  return [...papers, ...sources];
}

function labelNumber(label: string, prefix: "B" | "S"): number | null {
  const m = label.match(new RegExp(`\\b${prefix}(\\d+)\\b`));
  return m ? Number(m[1]) - 1 : null;
}

function paperFor(ctx: Ctx, label: string): LoadedPaper | undefined {
  const n = labelNumber(label, "B");
  return n === null ? undefined : ctx.papers[n];
}

function sourceFor(ctx: Ctx, label: string): ExpertContext["sources"][number] | undefined {
  const n = labelNumber(label, "S");
  if (n !== null) return ctx.req.sources[n];
  return ctx.req.sources.find((s) => label.includes(s.title));
}

function sourceRef(ctx: Ctx, label: string, quote: string): SourceRef | null {
  const source = sourceFor(ctx, label);
  if (!source) return null;
  const found = findQuote(source.text, quote);
  return found
    ? { sourceId: source.id, ...found, quote: source.text.slice(found.start, found.end) }
    : { sourceId: source.id, start: -1, end: -1, quote };
}

function backgroundRef(ctx: Ctx, label: string, quote: string): BackgroundRef | null {
  const p = paperFor(ctx, label);
  if (!p) return null;
  const found = findQuote(p.study, quote);
  return {
    packId: p.pack.id,
    paperId: p.paper.id,
    paperTitle: p.paper.title,
    quote,
    page: found ? pageAt(p.study, found.start) : undefined,
    verified: Boolean(found),
  };
}

function backgroundRefs(ctx: Ctx, refs: { paper: string; quote: string }[]): BackgroundRef[] {
  return refs.map((r) => backgroundRef(ctx, r.paper, r.quote)).filter((r): r is BackgroundRef => r !== null);
}

/* ---------- Prompt ---------- */

function systemPrompt(ctx: Ctx): string {
  const packNames = [...new Set(ctx.papers.map((p) => p.pack.name))];
  const rules = (ctx.req.rules ?? []).filter((r) => r.trim());
  return `You are a senior subject-matter expert advising a researcher who is writing a briefing from a set of source documents. Your job is to make sure the briefing focuses on the most important and valuable information in the sources.

## What you know
1. The background library: papers labelled [B1], [B2]…${packNames.length ? ` from the knowledge pack(s): ${packNames.join(", ")}` : " (none attached to this project)"}. These are study copies of the originals, with tables transcribed and figures described in words.
2. Your own expertise from training. It has a cutoff date and may be out of date.

Always make clear which one you are relying on. Cite library papers when you use them. When you rely on general knowledge, say so explicitly (for example "From general knowledge: …"). Where the library and your general knowledge disagree, the library takes precedence, but point out the disagreement.

## The sources and the draft
Documents labelled [S1], [S2]… are the sources the briefing summarises. The draft must contain only facts from the sources. Never put background or general knowledge into the draft: any wording you propose for the draft must be supported by a source passage. Background and general knowledge belong in context notes, which are kept separate from the draft.

## What counts as important
${ctx.req.brief.trim() || "Findings that matter most to decision-makers in this field."}

"New" means not already established in the background library or, as far as you know, in the field. The library may be incomplete, so say "not in the library" when you are unsure whether something is new to the field.
${ctx.req.question?.trim() ? `\n## The research question\n${ctx.req.question.trim()}\n` : ""}${rules.length ? `\n## Writing rules the draft follows\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\nKeep any wording you propose consistent with these rules.\n` : ""}
When you quote a document, copy the text character for character.`;
}

function draftBlock(draft: string): string {
  return `<current_draft>\n${draft}\n</current_draft>`;
}

async function loadContext(req: express.Request, res: express.Response): Promise<Ctx | null> {
  const body = req.body as ExpertContext;
  const sources = (body.sources ?? []).filter((s) => s.text?.trim());
  if (sources.length === 0) {
    res.status(400).json({ error: "This summary has no sources left to review against." });
    return null;
  }
  if (!hasCredentials(res)) return null;
  const papers = await loadPapers(body.packIds ?? []);
  const total = papers.reduce((n, p) => n + p.study.length, 0) + sources.reduce((n, s) => n + s.text.length, 0);
  if (total > MAX_CONTEXT_CHARS) {
    res.status(413).json({
      error: `The background library and sources total ${total.toLocaleString()} characters, more than the expert can read at once (${MAX_CONTEXT_CHARS.toLocaleString()}). Detach a knowledge pack or remove some papers.`,
    });
    return null;
  }
  return { req: { ...body, sources, draft: body.draft ?? "" }, papers };
}

/* ---------- Review ---------- */

const BackgroundSchema = z.object({ paper: z.string(), quote: z.string() });
const BasisSchema = z.enum(["library", "general", "both"]);
const TagSchema = z.enum(["policy", "new", "contradicts", "confirms"]);

const ReviewSchema = z.object({
  key_points: z.array(
    z.object({
      source: z.string(),
      source_quote: z.string(),
      point: z.string(),
      why_it_matters: z.string(),
      tags: z.array(TagSchema),
      importance: z.enum(["high", "medium"]),
      basis: BasisSchema,
      background: z.array(BackgroundSchema),
      coverage: z.enum(["covered", "partial", "missing"]),
      draft_quote: z.string(),
    }),
  ),
  low_value: z.array(z.object({ draft_quote: z.string(), reason: z.string() })),
  suggestions: z.array(
    z.object({ draft_quote: z.string(), replacement: z.string(), reason: z.string(), source: z.string(), source_quote: z.string() }),
  ),
  context_notes: z.array(
    z.object({
      anchor: z.enum(["draft", "source"]),
      source: z.string(),
      quote: z.string(),
      note: z.string(),
      basis: BasisSchema,
      background: z.array(BackgroundSchema),
    }),
  ),
});

const REVIEW_TASK = `Review the current draft for focus.

1. key_points: the most important points in the sources, ranked most important first (usually 4 to 10). For each, give the source label (e.g. "S1"), a verbatim quote of the key passage (one to three sentences), the point in your own words, and why it matters in terms of what counts as important. Support "why it matters" with library papers where you can: add each to "background" with its label (e.g. "B2") and a verbatim quote. Set "basis" to "library", "general" or "both" depending on what your judgement rests on. Tag it: "policy" if it has policy implications; "new" if it is not already established; "contradicts" if it conflicts with a library paper or established knowledge; "confirms" if it restates established findings. Say whether the draft covers it ("covered", "partial" or "missing") and give the verbatim draft text that covers it, or "" if missing.
2. low_value: draft sentences that spend words on less important material, quoted verbatim, with the reason.
3. suggestions: concrete edits that improve the draft's focus. Each replaces a verbatim piece of the draft (usually a whole sentence) with new wording that contains only facts from the sources, supported by the given source quote. To add a missing key point, choose the least valuable sentence to replace, or include the sentence you are extending in the replacement.
4. context_notes: up to five pieces of background the researcher should know but that must not go in the draft (how this compares with earlier studies, caveats, contradictions, history). Anchor each to a verbatim quote from the draft or from a source (with its label; use "" for the source when anchoring to the draft).

Every quote must be copied character for character.`;

export const expertRouter = express.Router();

expertRouter.post("/review", async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: systemPrompt(ctx),
      thinking: { type: "adaptive" },
      ...FALLBACK,
      output_config: { format: betaZodOutputFormat(ReviewSchema) },
      messages: [
        {
          role: "user",
          content: [...documents(ctx, false), { type: "text", text: `${draftBlock(ctx.req.draft)}\n\n${REVIEW_TASK}` }],
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to review this draft." });
      return;
    }
    const out = message.parsed_output;
    if (!out) {
      res.status(502).json({ error: "The expert review came back in an unexpected format. Try again." });
      return;
    }

    const keyPoints: KeyPoint[] = out.key_points.flatMap((k) => {
      const source = sourceRef(ctx, k.source, k.source_quote);
      if (!source) return [];
      return [
        {
          id: randomUUID(),
          point: k.point,
          why: k.why_it_matters,
          tags: k.tags,
          importance: k.importance,
          basis: k.basis,
          source,
          coverage: k.coverage,
          draftQuote: k.draft_quote,
          background: backgroundRefs(ctx, k.background),
        },
      ];
    });
    const payload: ExpertReviewResponse = {
      keyPoints,
      lowValue: out.low_value.filter((l) => l.draft_quote.trim()).map((l) => ({ id: randomUUID(), quote: l.draft_quote, reason: l.reason })),
      suggestions: out.suggestions
        .filter((s) => s.draft_quote.trim())
        .map((s) => ({
          id: randomUUID(),
          quote: s.draft_quote,
          replacement: s.replacement,
          reason: s.reason,
          support: sourceRef(ctx, s.source, s.source_quote) ?? undefined,
        })),
      notes: out.context_notes.flatMap((n) => {
        const note = contextNote(ctx, n);
        return note ? [note] : [];
      }),
    };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "reviewing the draft");
  }
});

function contextNote(
  ctx: Ctx,
  n: { anchor: "draft" | "source"; source: string; quote: string; note: string; basis: "library" | "general" | "both"; background: { paper: string; quote: string }[] },
): ContextNote | null {
  let anchor: ContextNote["anchor"];
  if (n.anchor === "source") {
    const source = sourceRef(ctx, n.source, n.quote);
    if (!source) return null;
    anchor = { kind: "source", source };
  } else {
    anchor = { kind: "draft", quote: n.quote };
  }
  return { id: randomUUID(), note: n.note, basis: n.basis, anchor, background: backgroundRefs(ctx, n.background), createdAt: Date.now() };
}

/* ---------- Chat ---------- */

const CHAT_GUIDE = `

## In this conversation
Answer the researcher's questions about the sources, the draft and the field. Be concise and direct, as an expert colleague would be. Cite the documents you draw on.

You can act on the page with tools. Every action is shown to the researcher as a suggestion they accept or dismiss, so propose freely but only when it genuinely helps:
- suggest_edit: change wording in the draft (source facts only, supported by a source quote).
- add_context_note: record background the researcher should know that must not go in the draft.
- mark_key_passage: highlight an important passage in a source.
- view_original_pdf: open a background paper's original PDF when its figures or tables matter and the study copy's description is not enough. Use it sparingly; it is slow and costly.
Prefer these tools over writing out suggested wording or notes in your reply.`;

const EditInput = z.object({
  draft_quote: z.string(),
  replacement: z.string(),
  reason: z.string(),
  source: z.string(),
  source_quote: z.string(),
});
const NoteInput = z.object({
  anchor: z.enum(["draft", "source"]),
  source: z.string(),
  quote: z.string(),
  note: z.string(),
  basis: BasisSchema,
  background: z.array(BackgroundSchema),
});
const PassageInput = z.object({
  source: z.string(),
  quote: z.string(),
  point: z.string(),
  why_it_matters: z.string(),
  tags: z.array(TagSchema),
  importance: z.enum(["high", "medium"]),
  basis: BasisSchema,
  background: z.array(BackgroundSchema),
});
const PdfInput = z.object({ paper: z.string() });

const bgSchema = {
  type: "array",
  description: 'Library passages that support this, as {paper: label like "B2", quote: verbatim text}.',
  items: {
    type: "object",
    properties: { paper: { type: "string" }, quote: { type: "string" } },
    required: ["paper", "quote"],
    additionalProperties: false,
  },
};
const basisSchema = { type: "string", enum: ["library", "general", "both"], description: "What this rests on: the background library, your general knowledge, or both." };

// Tool inputs stream as they are generated; each input is validated with zod before it is used.
const TOOLS: BetaTool[] = [
  {
    name: "suggest_edit",
    description:
      "Propose replacing a piece of the draft with new wording. The replacement must contain only facts from the sources and be supported by source_quote.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        draft_quote: { type: "string", description: "Exact text from the current draft to replace." },
        replacement: { type: "string", description: "New wording. Empty string deletes the text." },
        reason: { type: "string" },
        source: { type: "string", description: 'Label of the supporting source, e.g. "S1".' },
        source_quote: { type: "string", description: "Verbatim source passage that supports the new wording." },
      },
      required: ["draft_quote", "replacement", "reason", "source", "source_quote"],
      additionalProperties: false,
    },
  },
  {
    name: "add_context_note",
    description: "Record background context the researcher should know. It is kept separate from the draft and never inserted into it.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        anchor: { type: "string", enum: ["draft", "source"], description: "Attach the note to draft text or to a source passage." },
        source: { type: "string", description: 'Source label (e.g. "S1") when anchored to a source; otherwise "".' },
        quote: { type: "string", description: "Verbatim text the note is attached to." },
        note: { type: "string" },
        basis: basisSchema,
        background: bgSchema,
      },
      required: ["anchor", "source", "quote", "note", "basis", "background"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_key_passage",
    description: "Highlight an important passage in a source, with why it matters.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: 'Source label, e.g. "S1".' },
        quote: { type: "string", description: "Verbatim passage to highlight." },
        point: { type: "string" },
        why_it_matters: { type: "string" },
        tags: { type: "array", items: { type: "string", enum: ["policy", "new", "contradicts", "confirms"] } },
        importance: { type: "string", enum: ["high", "medium"] },
        basis: basisSchema,
        background: bgSchema,
      },
      required: ["source", "quote", "point", "why_it_matters", "tags", "importance", "basis", "background"],
      additionalProperties: false,
    },
  },
  {
    name: "view_original_pdf",
    description: "Load the original PDF of a background paper to inspect its figures, tables or layout directly.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { paper: { type: "string", description: 'Paper label, e.g. "B3".' } },
      required: ["paper"],
      additionalProperties: false,
    },
  },
];

const MAX_TOOL_ROUNDS = 6;

expertRouter.post("/chat", async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  const body = req.body as ExpertChatRequest;
  if (!body.message?.trim()) {
    res.status(400).json({ error: "Type a question first." });
    return;
  }

  // Earlier turns are replayed as plain text. The documents lead the first message so they
  // form a stable prefix that stays cached; the current draft goes with the newest question.
  const history = (body.history ?? []).filter((m) => m.text.trim());
  if (history[0]?.role === "assistant") history.shift();
  const current = `${draftBlock(ctx.req.draft)}\n\n${body.message.trim()}`;
  const messages: BetaMessageParam[] = [];
  const docs = documents(ctx, true);
  if (history.length === 0) {
    messages.push({ role: "user", content: [...docs, { type: "text", text: current }] });
  } else {
    messages.push({ role: "user", content: [...docs, { type: "text", text: history[0].text }] });
    for (const m of history.slice(1)) {
      const last = messages[messages.length - 1];
      if (last.role === m.role) {
        // Merge consecutive same-role turns (e.g. after a failed reply) so roles alternate.
        last.content = [...(typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content), { type: "text", text: m.text }];
      } else {
        messages.push({ role: m.role, content: m.text });
      }
    }
    if (messages[messages.length - 1].role === "user") messages.push({ role: "assistant", content: "(No reply.)" });
    messages.push({ role: "user", content: current });
  }

  const parts: ChatPart[] = [];
  const actions: ChatAction[] = [];
  const summaries: string[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: systemPrompt(ctx) + CHAT_GUIDE,
        tools: TOOLS,
        thinking: { type: "adaptive" },
        cache_control: CACHE_1H,
        ...FALLBACK,
        messages,
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        res.status(422).json({ error: "The model declined to answer that." });
        return;
      }

      for (const block of message.content) {
        if (block.type === "text" && block.text) parts.push(chatPart(ctx, block));
      }
      if (message.stop_reason === "max_tokens") {
        parts.push({ text: "\n\n(The reply was cut off because it ran too long.)", refs: [] });
        break;
      }
      if (message.stop_reason !== "tool_use") break;

      const results: BetaToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        results.push(await runTool(ctx, block, actions, summaries));
      }
      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: results });
    }

    const text = [parts.map((p) => p.text).join(""), ...summaries].filter(Boolean).join("\n\n");
    const payload: ExpertChatResponse = { parts, actions, text };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "answering");
  }
});

function chatPart(ctx: Ctx, block: BetaTextBlock): ChatPart {
  const refs: ChatRef[] = [];
  for (const c of block.citations ?? []) {
    const title = c.type === "char_location" || c.type === "page_location" ? (c.document_title ?? "") : "";
    if (c.type === "char_location" && labelNumber(title, "S") !== null) {
      const source = sourceFor(ctx, title);
      if (!source) continue;
      const span = resolveSpan(source.text, c.start_char_index, c.end_char_index, c.cited_text);
      refs.push({ kind: "source", sourceId: source.id, ...span, quote: c.cited_text });
    } else if (c.type === "char_location" || c.type === "page_location") {
      const p = paperFor(ctx, title);
      if (!p) continue;
      const page =
        c.type === "page_location"
          ? c.start_page_number
          : pageAt(p.study, resolveSpan(p.study, c.start_char_index, c.end_char_index, c.cited_text).start);
      refs.push({ kind: "paper", packId: p.pack.id, paperId: p.paper.id, paperTitle: p.paper.title, quote: c.cited_text, page, verified: true });
    }
  }
  return { text: block.text, refs };
}

async function runTool(ctx: Ctx, block: BetaToolUseBlock, actions: ChatAction[], summaries: string[]): Promise<BetaToolResultBlockParam> {
  const fail = (message: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
  const shown = "Shown to the researcher as a suggestion card. They will accept or dismiss it.";
  const id = randomUUID();

  switch (block.name) {
    case "suggest_edit": {
      const input = EditInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const v = input.data;
      if (!ctx.req.draft.includes(v.draft_quote)) return fail("draft_quote was not found verbatim in the current draft. Copy it exactly.");
      actions.push({
        id,
        status: "pending",
        type: "edit",
        edit: { id, quote: v.draft_quote, replacement: v.replacement, reason: v.reason, support: sourceRef(ctx, v.source, v.source_quote) ?? undefined },
      });
      summaries.push(`(Suggested an edit: replace "${v.draft_quote}" with "${v.replacement}".)`);
      return { type: "tool_result", tool_use_id: block.id, content: shown };
    }
    case "add_context_note": {
      const input = NoteInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const note = contextNote(ctx, input.data);
      if (!note) return fail("Unknown source label. Use a label like S1.");
      actions.push({ id, status: "pending", type: "note", note });
      summaries.push(`(Proposed a context note: ${input.data.note})`);
      return { type: "tool_result", tool_use_id: block.id, content: shown };
    }
    case "mark_key_passage": {
      const input = PassageInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const v = input.data;
      const source = sourceRef(ctx, v.source, v.quote);
      if (!source) return fail("Unknown source label. Use a label like S1.");
      if (source.start === -1) return fail("The quote was not found verbatim in that source. Copy it exactly.");
      actions.push({
        id,
        status: "pending",
        type: "highlight",
        point: {
          id,
          point: v.point,
          why: v.why_it_matters,
          tags: v.tags,
          importance: v.importance,
          basis: v.basis,
          source,
          background: backgroundRefs(ctx, v.background),
        },
      });
      summaries.push(`(Proposed highlighting: "${v.quote}")`);
      return { type: "tool_result", tool_use_id: block.id, content: shown };
    }
    case "view_original_pdf": {
      const input = PdfInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const p = paperFor(ctx, input.data.paper);
      if (!p) return fail("Unknown paper label. Use a label like B3.");
      const pdf = await loadOriginalPdf(p.pack.id, p.paper.id);
      if (!pdf) return fail("That paper was uploaded as text; there is no PDF. Use its study copy.");
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
            title: `[B${ctx.papers.indexOf(p) + 1}] ${p.paper.title} (original PDF)`,
            citations: { enabled: true },
          },
        ],
      };
    }
    default:
      return fail(`Unknown tool ${block.name}.`);
  }
}
