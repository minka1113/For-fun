// The subject-matter expert: reviews a draft for focus and chats about it, drawing on the
// project's knowledge packs (background papers) and its own trained knowledge.
//
// Background knowledge never goes into the draft. It informs what matters, and it can be
// recorded as context notes, which are kept separate from the draft.

import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
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
import { type LlmDoc, type LlmMessage, type LlmTextBlock, type ToolCall, type ToolDef, type ToolResult, getProvider } from "./llm/index.js";
import { type LoadedPaper, loadOriginalPdf, loadPapers } from "./packs.js";
import { abortOnClose, hasCredentials, sendApiError } from "./respond.js";
import { replayTurns } from "../shared/chat.js";
import { findQuote, pageAt, resolveSpan } from "./spans.js";

/** Roughly 600k tokens: leaves room in the 1M context for the conversation and thinking. */
const MAX_CONTEXT_CHARS = 2_400_000;

interface Ctx {
  req: ExpertContext;
  papers: LoadedPaper[];
}

/* ---------- Documents and labels ---------- */

// Papers are labelled [B1], [B2]… and sources [S1], [S2]… in their document titles. Citations
// and tool inputs refer to these labels, which map back reliably whatever the document order.

function documents(ctx: Ctx, citations: boolean): LlmDoc[] {
  const papers: LlmDoc[] = ctx.papers.map((p, i) => ({
    title: `[B${i + 1}] ${p.paper.title}`,
    text: p.study,
    context: `Background paper from the "${p.pack.name}" knowledge pack.`,
    citations,
  }));
  const sources: LlmDoc[] = ctx.req.sources.map((s, i) => ({
    title: `[S${i + 1}] ${s.title}`,
    text: s.text,
    context: "Source document for the briefing. The draft may only contain facts from the sources.",
    citations,
  }));
  // Cache the background library and the sources, so follow-up questions re-read them cheaply.
  if (papers.length) papers[papers.length - 1].cache = true;
  if (sources.length) sources[sources.length - 1].cache = true;
  return [...papers, ...sources];
}

/**
 * The number in a leading "[S2]" / "B3" label. Only the start counts, so a paper whose title
 * mentions something like "Table S2" isn't mistaken for a source.
 */
export function labelNumber(label: string, prefix: "B" | "S"): number | null {
  const m = label.trim().match(new RegExp(`^\\[?${prefix}(\\d+)\\b`));
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
    const result = await getProvider().structured({
      system: systemPrompt(ctx),
      signal: abortOnClose(res),
      docs: documents(ctx, false),
      prompt: `${draftBlock(ctx.req.draft)}\n\n${REVIEW_TASK}`,
      schema: ReviewSchema,
      maxTokens: 32000,
    });
    if (result.refused) {
      res.status(422).json({ error: "The model declined to review this draft." });
      return;
    }
    const out = result.value;
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

function chatGuide(canViewPdf: boolean): string {
  return `

## In this conversation
Answer the researcher's questions about the sources, the draft and the field. Be concise and direct, as an expert colleague would be. Cite the documents you draw on.

You can act on the page with tools. Every action is shown to the researcher as a suggestion they accept or dismiss, so propose freely but only when it genuinely helps:
- suggest_edit: change wording in the draft (source facts only, supported by a source quote).
- add_context_note: record background the researcher should know that must not go in the draft.
- mark_key_passage: highlight an important passage in a source.${canViewPdf ? "\n- view_original_pdf: open a background paper's original PDF when its figures or tables matter and the study copy's description is not enough. Use it sparingly; it is slow and costly." : ""}
Prefer these tools over writing out suggested wording or notes in your reply.`;
}

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

// Each tool input is validated with zod before it is used.
const TOOLS: ToolDef[] = [
  {
    name: "suggest_edit",
    description:
      "Propose replacing a piece of the draft with new wording. The replacement must contain only facts from the sources and be supported by source_quote.",
    schema: {
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
    schema: {
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
    schema: {
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
    schema: {
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
  const current = `${draftBlock(ctx.req.draft)}\n\n${body.message.trim()}`;
  const [first, ...rest] = [...replayTurns(body.history), { role: "user" as const, text: current }];
  const messages: LlmMessage[] = [{ role: "user", text: first.text, docs: documents(ctx, true) }, ...rest];

  const parts: ChatPart[] = [];
  const actions: ChatAction[] = [];
  const summaries: string[] = [];
  const provider = getProvider();
  const tools = TOOLS.filter((t) => t.name !== "view_original_pdf" || provider.capabilities.pdfInput);
  const system = systemPrompt(ctx) + chatGuide(provider.capabilities.pdfInput);
  const signal = abortOnClose(res);

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await provider.generate({ system, messages, tools, maxTokens: 16000, cache: true, signal });
      if (result.stopReason === "refusal") {
        res.status(422).json({ error: "The model declined to answer that." });
        return;
      }

      for (const block of result.blocks) {
        if (block.text) parts.push(chatPart(ctx, block));
      }
      if (result.stopReason === "max_tokens") {
        parts.push({ text: "\n\n(The reply was cut off because it ran too long.)", refs: [] });
        break;
      }
      if (result.stopReason !== "tool_use") break;

      const results: ToolResult[] = [];
      for (const call of result.toolCalls) {
        results.push(await runTool(ctx, call, actions, summaries));
      }
      messages.push(result.assistant, { role: "tool", results });
    }

    const text = [parts.map((p) => p.text).join(""), ...summaries].filter(Boolean).join("\n\n");
    const payload: ExpertChatResponse = { parts, actions, text };
    res.json(payload);
  } catch (err) {
    sendApiError(res, err, "answering");
  }
});

function chatPart(ctx: Ctx, block: LlmTextBlock): ChatPart {
  const refs: ChatRef[] = [];
  for (const c of block.citations) {
    const hasSpan = c.start !== undefined && c.end !== undefined;
    if (hasSpan && labelNumber(c.docTitle, "S") !== null) {
      const source = sourceFor(ctx, c.docTitle);
      if (!source) continue;
      const span = resolveSpan(source.text, c.start!, c.end!, c.quote);
      refs.push({ kind: "source", sourceId: source.id, ...span, quote: c.quote });
    } else {
      const p = paperFor(ctx, c.docTitle);
      if (!p) continue;
      const page = c.page ?? (hasSpan ? pageAt(p.study, resolveSpan(p.study, c.start!, c.end!, c.quote).start) : undefined);
      refs.push({ kind: "paper", packId: p.pack.id, paperId: p.paper.id, paperTitle: p.paper.title, quote: c.quote, page, verified: true });
    }
  }
  return { text: block.text, refs };
}

async function runTool(ctx: Ctx, block: ToolCall, actions: ChatAction[], summaries: string[]): Promise<ToolResult> {
  const fail = (message: string): ToolResult => ({ id: block.id, text: message, isError: true });
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
      return { id: block.id, text: shown };
    }
    case "add_context_note": {
      const input = NoteInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const note = contextNote(ctx, input.data);
      if (!note) return fail("Unknown source label. Use a label like S1.");
      actions.push({ id, status: "pending", type: "note", note });
      summaries.push(`(Proposed a context note: ${input.data.note})`);
      return { id: block.id, text: shown };
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
      return { id: block.id, text: shown };
    }
    case "view_original_pdf": {
      const input = PdfInput.safeParse(block.input);
      if (!input.success) return fail(`Invalid input: ${input.error.message}`);
      const p = paperFor(ctx, input.data.paper);
      if (!p) return fail("Unknown paper label. Use a label like B3.");
      const pdf = await loadOriginalPdf(p.pack.id, p.paper.id);
      if (!pdf) return fail("That paper was uploaded as text; there is no PDF. Use its study copy.");
      return {
        id: block.id,
        text: "The original PDF is attached.",
        pdf: { title: `[B${ctx.papers.indexOf(p) + 1}] ${p.paper.title} (original PDF)`, data: pdf },
      };
    }
    default:
      return fail(`Unknown tool ${block.name}.`);
  }
}
