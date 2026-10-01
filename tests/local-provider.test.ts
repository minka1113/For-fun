import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { LocalProvider, extractInlineToolCalls } from "../server/llm/local.js";
import type { LlmDoc, LlmMessage } from "../server/llm/types.js";
import { type MockLlm, startMockLlm } from "./helpers/mock-llm.js";
import { makePdf } from "./helpers/pdf.js";

const open: MockLlm[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((m) => m.close()));
});

async function setup(script: Parameters<typeof startMockLlm>[0], extra: { apiKey?: string; timeoutMs?: number } = {}) {
  const mock = await startMockLlm(script);
  open.push(mock);
  const provider = new LocalProvider({ baseUrl: mock.baseUrl, model: "nemotron", timeoutMs: 5000, ...extra });
  return { mock, provider };
}

const docs: LlmDoc[] = [{ title: "Report", text: "Sales rose 12% in 2024. Costs fell.", citations: true }];

test("sends an OpenAI chat request and reassembles the streamed reply", async () => {
  const { mock, provider } = await setup({ text: "Hello there, friend." }, { apiKey: "secret" });
  const result = await provider.generate({ system: "Be brief.", maxTokens: 123, messages: [{ role: "user", text: "Hi" }] });

  assert.deepEqual(result.blocks, [{ text: "Hello there, friend.", citations: [] }]);
  assert.equal(result.stopReason, "end");
  assert.equal(result.model, "nemotron");

  const [req] = mock.requests;
  assert.equal(req.path, "/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer secret");
  assert.equal(req.body.model, "nemotron");
  assert.equal(req.body.max_tokens, 123);
  assert.equal(req.body.stream, true);
  assert.deepEqual(req.body.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Hi" },
  ]);
  assert.equal(req.body.tools, undefined);
});

test("sends no authorization header without an API key", async () => {
  const { mock, provider } = await setup({ text: "ok" });
  await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] });
  assert.equal(mock.requests[0].headers.authorization, undefined);
});

test("strips inline reasoning from the reply", async () => {
  const { provider } = await setup({ text: "<think>let me think</think>The answer." });
  const result = await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] });
  assert.equal(result.blocks[0].text, "The answer.");
});

test("accepts a non-streaming JSON response", async () => {
  const { provider } = await setup({ text: "plain reply", plain: true });
  const result = await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] });
  assert.equal(result.blocks[0].text, "plain reply");
});

test("reports a length cut-off as max_tokens", async () => {
  const { provider } = await setup({ text: "cut of", finish: "length" });
  const result = await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] });
  assert.equal(result.stopReason, "max_tokens");
});

test("turns inline citation markers into cited blocks and explains the convention to the model", async () => {
  const reply = 'Sales grew strongly. [[D1: "Sales rose 12% in 2024."]] Costs dropped. [[D1: "Costs fell."]]';
  const { mock, provider } = await setup({ text: reply });
  const result = await provider.generate({ system: "Summarise.", maxTokens: 10, messages: [{ role: "user", text: "Go", docs }] });

  assert.deepEqual(
    result.blocks.map((b) => [b.text, b.citations.map((c) => c.quote)]),
    [
      ["Sales grew strongly. ", ["Sales rose 12% in 2024."]],
      ["Costs dropped. ", ["Costs fell."]],
    ],
  );
  const [system, user] = mock.requests[0].body.messages;
  assert.match(system.content, /^Summarise\.[\s\S]*\[\[D1: "quote"\]\]/);
  assert.match(user.content, /^<document id="D1" title="Report">\nSales rose 12% in 2024\. Costs fell\.\n<\/document>\n\nGo$/);
  assert.equal(result.assistant.role === "assistant" && result.assistant.text, "Sales grew strongly. Costs dropped. ");
});

test("does not mention citations when no document asks for them", async () => {
  const { mock, provider } = await setup({ text: "fine" });
  await provider.generate({ system: "Plain.", maxTokens: 10, messages: [{ role: "user", text: "q", docs: [{ title: "T", text: "body" }] }] });
  assert.equal(mock.requests[0].body.messages[0].content, "Plain.");
});

test("numbers documents across the whole conversation", async () => {
  const { mock, provider } = await setup({ text: "ok" });
  await provider.generate({
    system: "s",
    maxTokens: 10,
    messages: [
      { role: "user", text: "first", docs: [{ title: "A", text: "a" }] },
      { role: "assistant", text: "reply" },
      { role: "user", text: "second", docs: [{ title: "B", text: "b" }] },
    ],
  });
  const [, first, , second] = mock.requests[0].body.messages;
  assert.match(first.content, /id="D1" title="A"/);
  assert.match(second.content, /id="D2" title="B"/);
});

const TOOLS = [
  {
    name: "suggest_edit",
    description: "Propose an edit",
    schema: { type: "object", properties: { draft_quote: { type: "string" } }, required: ["draft_quote"] },
  },
];

test("runs a tool loop with native tool calls", async () => {
  const { mock, provider } = await setup((_body, n) =>
    n === 0 ? { text: "Let me suggest an edit.", toolCalls: [{ id: "call_a", name: "suggest_edit", args: { draft_quote: "old text" } }] } : { text: "Done." },
  );
  const messages: LlmMessage[] = [{ role: "user", text: "Improve it" }];
  const first = await provider.generate({ system: "s", maxTokens: 10, messages, tools: TOOLS });

  assert.equal(first.stopReason, "tool_use");
  assert.deepEqual(first.toolCalls, [{ id: "call_a", name: "suggest_edit", input: { draft_quote: "old text" } }]);
  assert.deepEqual(mock.requests[0].body.tools, [
    { type: "function", function: { name: "suggest_edit", description: "Propose an edit", parameters: TOOLS[0].schema } },
  ]);

  messages.push(first.assistant, { role: "tool", results: [{ id: "call_a", text: "Shown to the researcher." }] });
  const second = await provider.generate({ system: "s", maxTokens: 10, messages, tools: TOOLS });
  assert.equal(second.stopReason, "end");
  assert.equal(second.blocks[0].text, "Done.");

  const wire = mock.requests[1].body.messages;
  assert.deepEqual(wire[2], {
    role: "assistant",
    content: "Let me suggest an edit.",
    tool_calls: [{ id: "call_a", type: "function", function: { name: "suggest_edit", arguments: '{"draft_quote":"old text"}' } }],
  });
  assert.deepEqual(wire[3], { role: "tool", tool_call_id: "call_a", content: "Shown to the researcher." });
});

test("recovers tool calls the server left in the text", async () => {
  const text = 'I will edit it.\n<tool_call>\n{"name": "suggest_edit", "arguments": {"draft_quote": "x"}}\n</tool_call>';
  const { provider } = await setup({ text });
  const result = await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }], tools: TOOLS });
  assert.equal(result.stopReason, "tool_use");
  assert.deepEqual(result.toolCalls, [{ id: "call_inline_0", name: "suggest_edit", input: { draft_quote: "x" } }]);
  assert.equal(result.blocks[0].text, "I will edit it.");
});

test("parses the XML style of inline tool call", () => {
  const { calls, text } = extractInlineToolCalls(
    'Sure.<tool_call>\n<function=add_context_note>\n<parameter=anchor>\ndraft\n</parameter>\n<parameter=background>\n[{"paper":"B1","quote":"q"}]\n</parameter>\n</function>\n</tool_call>',
  );
  assert.equal(text, "Sure.");
  assert.deepEqual(calls, [{ id: "call_inline_0", name: "add_context_note", input: { anchor: "draft", background: [{ paper: "B1", quote: "q" }] } }]);
});

test("ignores malformed inline tool calls", () => {
  assert.deepEqual(extractInlineToolCalls("<tool_call>{not json}</tool_call>").calls, []);
  assert.deepEqual(extractInlineToolCalls("<tool_call>whatever</tool_call>").calls, []);
});

test("does not look for inline tool calls when no tools were offered", async () => {
  const { provider } = await setup({ text: '<tool_call>{"name": "x", "arguments": {}}</tool_call>' });
  const result = await provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] });
  assert.equal(result.toolCalls.length, 0);
});

const Person = z.object({ name: z.string(), age: z.number().int() });

test("structured output: parses JSON out of a fenced reply and puts the schema in the prompt", async () => {
  const { mock, provider } = await setup({ text: 'Sure:\n```json\n{"name": "Bob", "age": 30}\n```' });
  const result = await provider.structured({ system: "s", docs: docs.map((d) => ({ ...d, citations: false })), prompt: "Who?", schema: Person, maxTokens: 100 });
  assert.deepEqual(result, { refused: false, value: { name: "Bob", age: 30 } });

  const user = mock.requests[0].body.messages[1].content as string;
  assert.match(user, /<document id="D1"/);
  assert.match(user, /Who\?/);
  assert.match(user, /"required":\["name","age"\]/);
  assert.doesNotMatch(user, /\$schema/);
});

test("structured output: asks again, quoting the problem, when the first reply is unusable", async () => {
  const { mock, provider } = await setup((_b, n) => (n === 0 ? { text: '{"name": "Bob", "age": "thirty"}' } : { text: '{"name": "Bob", "age": 30}' }));
  const result = await provider.structured({ system: "s", docs: [], prompt: "Who?", schema: Person, maxTokens: 100 });
  assert.deepEqual(result, { refused: false, value: { name: "Bob", age: 30 } });
  assert.equal(mock.requests.length, 2);
  const retry = mock.requests[1].body.messages;
  assert.equal(retry.at(-2).role, "assistant");
  assert.match(retry.at(-1).content, /not usable/);
});

test("structured output: gives up with null after a second bad reply", async () => {
  const { mock, provider } = await setup({ text: "I cannot do that." });
  const result = await provider.structured({ system: "s", docs: [], prompt: "Who?", schema: Person, maxTokens: 100 });
  assert.deepEqual(result, { refused: false, value: null });
  assert.equal(mock.requests.length, 2);
});

test("structured output: does not retry a reply that was cut off", async () => {
  const { mock, provider } = await setup({ text: '{"name": "Bo', finish: "length" });
  const result = await provider.structured({ system: "s", docs: [], prompt: "Who?", schema: Person, maxTokens: 5 });
  assert.deepEqual(result, { refused: false, value: null });
  assert.equal(mock.requests.length, 1);
});

test("structured output: reports a content-filter stop as a refusal", async () => {
  const { provider } = await setup({ text: "", finish: "content_filter" });
  assert.deepEqual(await provider.structured({ system: "s", docs: [], prompt: "p", schema: Person, maxTokens: 5 }), { refused: true });
});

test("describes HTTP failures for the user", async () => {
  const cases: [number, number, RegExp][] = [
    [401, 401, /LOCAL_LLM_API_KEY/],
    [429, 429, /busy/],
    [502, 502, /HTTP 502\): Bad Gateway/],
  ];
  for (const [upstream, status, message] of cases) {
    const { provider } = await setup({ status: upstream, error: "Bad Gateway" });
    await assert.rejects(provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] }), (err) => {
      const described = provider.describeError(err);
      assert.equal(described?.status, status);
      assert.match(described!.error, message);
      return true;
    });
  }
});

test("describes an unreachable server", async () => {
  const provider = new LocalProvider({ baseUrl: "http://127.0.0.1:1/v1", model: "m", timeoutMs: 2000 });
  await assert.rejects(provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] }), (err) => {
    const described = provider.describeError(err);
    assert.equal(described?.status, 502);
    assert.match(described!.error, /Couldn't reach the local model at http:\/\/127\.0\.0\.1:1\/v1/);
    return true;
  });
});

test("times out a server that never answers", async () => {
  const { provider } = await setup({ hang: true }, { timeoutMs: 100 });
  await assert.rejects(provider.generate({ system: "s", maxTokens: 10, messages: [{ role: "user", text: "q" }] }), (err) => {
    assert.equal(provider.describeError(err)?.status, 504);
    return true;
  });
});

test("describeError leaves foreign errors alone", async () => {
  const { provider } = await setup({});
  assert.equal(provider.describeError(new Error("boom")), null);
});

test("converts a PDF to page-marked Markdown by extracting its text", async () => {
  const { provider } = await setup({});
  const md = await provider.pdfToMarkdown(makePdf(["Quarterly findings", "Second page text"]));
  assert.match(md, /^# Quarterly findings/);
  assert.match(md, /\[Page 1\]\nQuarterly findings/);
  assert.match(md, /\[Page 2\]\nSecond page text/);
});

test("refuses a PDF with no extractable text", async () => {
  const { provider } = await setup({});
  await assert.rejects(provider.pdfToMarkdown(makePdf([""])), /No text could be extracted/);
});
