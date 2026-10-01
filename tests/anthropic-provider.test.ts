import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AnthropicProvider, type AnthropicLike } from "../server/llm/anthropic.js";

/** A fake SDK client that records the request and returns a canned final message. */
function fake(message: object) {
  const calls: any[] = [];
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          return { finalMessage: async () => ({ model: "claude-test", stop_reason: "end_turn", content: [], ...message }) };
        },
      },
    },
  };
  return { calls, provider: new AnthropicProvider("claude-test", client) };
}

test("maps text blocks, citations and stop reasons", async () => {
  const { provider, calls } = fake({
    content: [
      { type: "text", text: "Sales grew.", citations: [{ type: "char_location", cited_text: "Sales rose", document_index: 0, document_title: "Report", start_char_index: 0, end_char_index: 10 }] },
      { type: "text", text: " See page 3.", citations: [{ type: "page_location", cited_text: "p3", document_index: 1, document_title: "[B1] Paper", start_page_number: 3, end_page_number: 4 }] },
      { type: "text", text: " Plain." },
    ],
  });
  const result = await provider.generate({
    system: "sys",
    maxTokens: 500,
    messages: [{ role: "user", text: "Go", docs: [{ title: "Report", text: "Sales rose 12%", citations: true, context: "ctx", cache: true }] }],
  });

  assert.equal(result.model, "claude-test");
  assert.equal(result.stopReason, "end");
  assert.deepEqual(result.blocks, [
    { text: "Sales grew.", citations: [{ docIndex: 0, docTitle: "Report", quote: "Sales rose", start: 0, end: 10 }] },
    { text: " See page 3.", citations: [{ docIndex: 1, docTitle: "[B1] Paper", quote: "p3", page: 3 }] },
    { text: " Plain.", citations: [] },
  ]);

  const params = calls[0];
  assert.equal(params.model, "claude-test");
  assert.equal(params.max_tokens, 500);
  assert.deepEqual(params.thinking, { type: "adaptive" });
  assert.equal(params.fallbacks, "default");
  assert.equal(params.cache_control, undefined);
  assert.deepEqual(params.messages, [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "text", media_type: "text/plain", data: "Sales rose 12%" },
          title: "Report",
          context: "ctx",
          citations: { enabled: true },
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        { type: "text", text: "Go" },
      ],
    },
  ]);
});

test("passes tools and caching, and replays the raw assistant content in a tool loop", async () => {
  const toolUse = { type: "tool_use", id: "tu_1", name: "suggest_edit", input: { draft_quote: "x" } };
  const raw = [{ type: "thinking", thinking: "hm", signature: "sig" }, { type: "text", text: "Editing." }, toolUse];
  const { provider, calls } = fake({ stop_reason: "tool_use", content: raw });
  const tools = [{ name: "suggest_edit", description: "d", schema: { type: "object", properties: {} } }];

  const result = await provider.generate({ system: "s", maxTokens: 10, tools, cache: true, messages: [{ role: "user", text: "q" }] });
  assert.equal(result.stopReason, "tool_use");
  assert.deepEqual(result.toolCalls, [{ id: "tu_1", name: "suggest_edit", input: { draft_quote: "x" } }]);
  assert.deepEqual(calls[0].tools, [{ name: "suggest_edit", description: "d", eager_input_streaming: true, input_schema: tools[0].schema }]);
  assert.deepEqual(calls[0].cache_control, { type: "ephemeral", ttl: "1h" });

  await provider.generate({
    system: "s",
    maxTokens: 10,
    tools,
    messages: [{ role: "user", text: "q" }, result.assistant, { role: "tool", results: [{ id: "tu_1", text: "ok" }, { id: "tu_2", text: "bad", isError: true }] }],
  });
  const sent = calls[1].messages;
  assert.equal(sent[1].content, raw);
  assert.deepEqual(sent[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "tu_1", content: "ok" },
      { type: "tool_result", tool_use_id: "tu_2", content: "bad", is_error: true },
    ],
  });
});

test("sends a PDF tool result as a document with citations", async () => {
  const { provider, calls } = fake({});
  await provider.generate({
    system: "s",
    maxTokens: 10,
    messages: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }, { role: "tool", results: [{ id: "t", text: "attached", pdf: { title: "Paper (original PDF)", data: Buffer.from("%PDF-x") } }] }],
  });
  assert.deepEqual(calls[0].messages[2].content[0].content, [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-x").toString("base64") }, title: "Paper (original PDF)", citations: { enabled: true } },
  ]);
});

test("reports refusals and truncation", async () => {
  assert.equal((await fake({ stop_reason: "refusal" }).provider.generate({ system: "s", maxTokens: 1, messages: [{ role: "user", text: "q" }] })).stopReason, "refusal");
  assert.equal((await fake({ stop_reason: "max_tokens" }).provider.generate({ system: "s", maxTokens: 1, messages: [{ role: "user", text: "q" }] })).stopReason, "max_tokens");
});

test("structured output returns the parsed value, null, or a refusal", async () => {
  const schema = z.object({ ok: z.boolean() });
  const req = { system: "s", docs: [{ title: "T", text: "body" }], prompt: "p", schema, maxTokens: 5 };

  const good = fake({ parsed_output: { ok: true } });
  assert.deepEqual(await good.provider.structured(req), { refused: false, value: { ok: true } });
  assert.ok(good.calls[0].output_config.format);
  assert.equal(good.calls[0].messages[0].content[0].citations, undefined);

  assert.deepEqual(await fake({}).provider.structured(req), { refused: false, value: null });
  assert.deepEqual(await fake({ stop_reason: "refusal" }).provider.structured(req), { refused: true });
});

test("pdfToMarkdown sends the PDF and reports failures", async () => {
  const ok = fake({ content: [{ type: "text", text: "# Title\n" }, { type: "text", text: "[Page 1]\nBody\n" }] });
  assert.equal(await ok.provider.pdfToMarkdown(Buffer.from("%PDF-1"), "convert"), "# Title\n[Page 1]\nBody");
  assert.equal(ok.calls[0].messages[0].content[0].source.media_type, "application/pdf");
  assert.equal(ok.calls[0].messages[0].content[1].text, "convert");

  await assert.rejects(fake({ stop_reason: "refusal" }).provider.pdfToMarkdown(Buffer.from("x"), "p"), /declined/);
  await assert.rejects(fake({ stop_reason: "max_tokens" }).provider.pdfToMarkdown(Buffer.from("x"), "p"), /too long/);
});

test("describes SDK errors", () => {
  const { provider } = fake({});
  const make = (status: number) => Anthropic.APIError.generate(status, { error: { message: "nope" } }, "nope", new Headers());
  assert.equal(provider.describeError(make(401))?.status, 401);
  assert.equal(provider.describeError(make(429))?.status, 429);
  assert.match(provider.describeError(make(500))!.error, /Anthropic API error/);
  assert.equal(provider.describeError(new Error("x")), null);
});

test("asks for an API key when none is set", () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    assert.match(new AnthropicProvider("m").credentialsError()!, /ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = "k";
    assert.equal(new AnthropicProvider("m").credentialsError(), null);
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});
