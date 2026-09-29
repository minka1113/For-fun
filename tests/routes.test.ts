// The HTTP routes end to end, with the app talking to a mock OpenAI-compatible server.

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../server/app.js";
import { setProvider } from "../server/llm/index.js";
import { LocalProvider } from "../server/llm/local.js";
import { AnthropicProvider, type AnthropicLike } from "../server/llm/anthropic.js";
import { type MockLlm, startMockLlm } from "./helpers/mock-llm.js";
import { makePdf } from "./helpers/pdf.js";

let server: Server;
let base: string;
const mocks: MockLlm[] = [];

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  setProvider(null);
  server.close();
});
afterEach(async () => {
  setProvider(null);
  await Promise.all(mocks.splice(0).map((m) => m.close()));
});

async function useLocal(script: Parameters<typeof startMockLlm>[0]) {
  const mock = await startMockLlm(script);
  mocks.push(mock);
  setProvider(new LocalProvider({ baseUrl: mock.baseUrl, model: "nemotron", timeoutMs: 5000 }));
  return mock;
}

async function post(path: string, body: unknown, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
  return { status: res.status, json: (await res.json()) as any };
}

const SOURCE = { id: "src-1", title: "Report", text: "Sales rose 12% in 2024. Costs fell by 3%." };

test("GET /api/health reports the active provider and model", async () => {
  await useLocal({});
  const res = await fetch(`${base}/api/health`);
  assert.deepEqual(await res.json(), { ok: true, provider: "local", model: "nemotron", ready: true, hasKey: true });
});

test("POST /api/summarize returns cited segments from the local model", async () => {
  const mock = await useLocal({ text: 'Sales grew 12%. [[D1: "Sales rose 12% in 2024."]] Costs dipped. [[D1: "Costs fell by 3%."]] Outlook unclear.' });
  const { status, json } = await post("/api/summarize", { sources: [SOURCE], focus: "results", rules: ["Past tense"] });

  assert.equal(status, 200);
  assert.equal(json.model, "nemotron");
  assert.deepEqual(
    json.segments.map((s: any) => [s.text, s.citations.map((c: any) => [c.sourceId, c.start, c.end, c.quote])]),
    [
      ["Sales grew 12%. ", [["src-1", 0, 23, "Sales rose 12% in 2024."]]],
      ["Costs dipped. ", [["src-1", 24, 41, "Costs fell by 3%."]]],
      ["Outlook unclear.", []],
    ],
  );
  const user = mock.requests[0].body.messages[1].content as string;
  assert.match(user, /<document id="D1" title="Report">/);
  assert.match(user, /Focus the summary on this question or topic: results/);
  assert.match(user, /1\. Past tense/);
});

test("POST /api/summarize rejects an empty request before calling the model", async () => {
  const mock = await useLocal({});
  const { status } = await post("/api/summarize", { sources: [{ id: "a", title: "t", text: "  " }] });
  assert.equal(status, 400);
  assert.equal(mock.requests.length, 0);
});

test("POST /api/summarize surfaces a failing local server", async () => {
  await useLocal({ status: 502, error: "Bad Gateway" });
  const { status, json } = await post("/api/summarize", { sources: [SOURCE] });
  assert.equal(status, 502);
  assert.match(json.error, /Local model error \(HTTP 502\)/);
});

test("POST /api/summarize errors when the model returns no text", async () => {
  await useLocal({ text: "<think>only thinking</think>" });
  const { status } = await post("/api/summarize", { sources: [SOURCE] });
  assert.equal(status, 502);
});

test("POST /api/check-style converts rule numbers to 0-based and drops out-of-range ones", async () => {
  await useLocal({
    text: JSON.stringify({
      results: [
        { rule: 1, passed: false, note: "Broken" },
        { rule: 2, passed: true, note: "Fine" },
        { rule: 9, passed: true, note: "Bogus" },
      ],
      violations: [
        { rule: 1, quote: "will rise", explanation: "Future tense", suggestion: "rose" },
        { rule: 7, quote: "x", explanation: "Bogus", suggestion: "" },
        { rule: 1, quote: "  ", explanation: "Empty quote", suggestion: "" },
      ],
    }),
  });
  const { status, json } = await post("/api/check-style", { text: "Sales will rise.", rules: ["Past tense", "Short"], sources: [SOURCE] });
  assert.equal(status, 200);
  assert.deepEqual(json.results.map((r: any) => r.rule), [0, 1]);
  assert.deepEqual(json.violations, [{ rule: 0, quote: "will rise", explanation: "Future tense", suggestion: "rose" }]);
});

test("POST /api/check-style reports a reply it cannot parse", async () => {
  await useLocal({ text: "Looks good to me!" });
  const { status, json } = await post("/api/check-style", { text: "Draft.", rules: ["Short"] });
  assert.equal(status, 502);
  assert.match(json.error, /unexpected format/);
});

test("POST /api/extract-pdf reads the text of a PDF with the local provider", async () => {
  await useLocal({});
  const res = await fetch(`${base}/api/extract-pdf`, { method: "POST", body: new Uint8Array(makePdf(["Annual findings"])) });
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(json.title, "Annual findings");
  assert.match(json.text, /\[Page 1\]\nAnnual findings/);
});

const REVIEW_BODY = {
  sources: [SOURCE],
  draft: "Sales grew. Costs dipped.",
  brief: "Financial results",
  packIds: [],
};

test("POST /api/expert/review builds key points from the local model's JSON", async () => {
  await useLocal({
    text: JSON.stringify({
      key_points: [
        {
          source: "S1",
          source_quote: "Sales rose 12% in 2024.",
          point: "Sales up",
          why_it_matters: "Headline number",
          tags: ["new"],
          importance: "high",
          basis: "general",
          background: [],
          coverage: "covered",
          draft_quote: "Sales grew.",
        },
        { source: "S9", source_quote: "?", point: "x", why_it_matters: "y", tags: [], importance: "medium", basis: "general", background: [], coverage: "missing", draft_quote: "" },
      ],
      low_value: [{ draft_quote: "Costs dipped.", reason: "Minor" }],
      suggestions: [],
      context_notes: [],
    }),
  });
  const { status, json } = await post("/api/expert/review", REVIEW_BODY);
  assert.equal(status, 200);
  assert.equal(json.keyPoints.length, 1);
  assert.deepEqual(json.keyPoints[0].source, { sourceId: "src-1", start: 0, end: 23, quote: "Sales rose 12% in 2024." });
  assert.equal(json.lowValue[0].quote, "Costs dipped.");
});

test("POST /api/expert/chat runs the tool loop and hides the PDF tool from the local model", async () => {
  const mock = await useLocal((_body, n) =>
    n === 0
      ? {
          text: "Tighten it.",
          toolCalls: [
            {
              name: "suggest_edit",
              args: { draft_quote: "Sales grew.", replacement: "Sales rose 12%.", reason: "Precise", source: "S1", source_quote: "Sales rose 12% in 2024." },
            },
            { name: "suggest_edit", args: { draft_quote: "not in the draft", replacement: "x", reason: "r", source: "S1", source_quote: "q" } },
          ],
        }
      : { text: 'The report says sales rose. [[D1: "Sales rose 12% in 2024."]]' },
  );
  const { status, json } = await post("/api/expert/chat", { ...REVIEW_BODY, message: "How can I improve this?", history: [] });

  assert.equal(status, 200);
  assert.equal(json.actions.length, 1);
  assert.equal(json.actions[0].type, "edit");
  assert.equal(json.actions[0].edit.replacement, "Sales rose 12%.");
  assert.deepEqual(json.actions[0].edit.support, { sourceId: "src-1", start: 0, end: 23, quote: "Sales rose 12% in 2024." });

  const lastPart = json.parts.at(-1);
  assert.equal(lastPart.text, "The report says sales rose. ");
  assert.deepEqual(lastPart.refs, [{ kind: "source", sourceId: "src-1", start: 0, end: 23, quote: "Sales rose 12% in 2024." }]);

  assert.equal(mock.requests.length, 2);
  const toolNames = mock.requests[0].body.tools.map((t: any) => t.function.name);
  assert.deepEqual(toolNames, ["suggest_edit", "add_context_note", "mark_key_passage"]);
  assert.doesNotMatch(mock.requests[0].body.messages[0].content, /view_original_pdf/);
  // The failed call's error goes back to the model.
  const toolMessages = mock.requests[1].body.messages.filter((m: any) => m.role === "tool");
  assert.equal(toolMessages.length, 2);
  assert.match(toolMessages[1].content, /not found verbatim/);
});

test("POST /api/expert/chat replays history and merges same-role turns", async () => {
  const mock = await useLocal({ text: "Sure." });
  await post("/api/expert/chat", {
    ...REVIEW_BODY,
    message: "And now?",
    history: [
      { role: "assistant", text: "stale opener" },
      { role: "user", text: "first question" },
      { role: "user", text: "retry of first question" },
      { role: "assistant", text: "an answer" },
    ],
  });
  const roles = mock.requests[0].body.messages.map((m: any) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
  assert.match(mock.requests[0].body.messages[1].content, /first question\n\nretry of first question$/);
  assert.match(mock.requests[0].body.messages[3].content, /And now\?$/);
});

test("the same routes run on the Anthropic provider", async () => {
  const calls: any[] = [];
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          return {
            finalMessage: async () => ({
              model: "claude-test",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: "Sales grew.",
                  citations: [{ type: "char_location", cited_text: "Sales rose 12% in 2024.", document_index: 0, document_title: "Report", start_char_index: 0, end_char_index: 23 }],
                },
              ],
            }),
          };
        },
      },
    },
  };
  setProvider(new AnthropicProvider("claude-test", client));
  const { status, json } = await post("/api/summarize", { sources: [SOURCE] });
  assert.equal(status, 200);
  assert.equal(json.model, "claude-test");
  assert.deepEqual(json.segments[0].citations, [{ sourceId: "src-1", start: 0, end: 23, quote: "Sales rose 12% in 2024." }]);
  assert.equal(calls[0].messages[0].content[0].citations.enabled, true);
});

test("Anthropic without an API key fails clearly", async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    setProvider(new AnthropicProvider("claude-test"));
    const { status, json } = await post("/api/summarize", { sources: [SOURCE] });
    assert.equal(status, 500);
    assert.match(json.error, /ANTHROPIC_API_KEY/);
    assert.equal(((await (await fetch(`${base}/api/health`)).json()) as any).ready, false);
  } finally {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});
