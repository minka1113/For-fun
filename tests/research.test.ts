// The research agent end to end over HTTP, with a fake Anthropic client playing back a scripted turn.

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../server/app.js";
import { setProvider } from "../server/llm/index.js";
import { AnthropicProvider, type AnthropicLike } from "../server/llm/anthropic.js";
import { LocalProvider } from "../server/llm/local.js";
import { type ResearchClient, setResearchClient } from "../server/research.js";
import { makePdf } from "./helpers/pdf.js";
import type { ResearchChatRequest, ResearchEvent } from "../shared/types.js";

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
afterEach(() => {
  setProvider(null);
  setResearchClient(null);
});

/** A fake client that returns one scripted message per request and records what was sent. */
function scripted(messages: object[]) {
  const calls: any[] = [];
  const client: ResearchClient = {
    beta: {
      messages: {
        stream(params) {
          calls.push(structuredClone(params));
          const message = { model: "claude-test", ...messages[calls.length - 1] } as any;
          const listeners: ((b: any) => void)[] = [];
          return {
            on(_event: "contentBlock", listener: (b: any) => void) {
              listeners.push(listener);
              return this;
            },
            async finalMessage() {
              for (const block of message.content) listeners.forEach((l) => l(block));
              return message;
            },
          };
        },
      },
    },
  };
  setResearchClient(client);
  setProvider(new AnthropicProvider("claude-test", {} as AnthropicLike));
  return calls;
}

async function research(body: ResearchChatRequest): Promise<ResearchEvent[]> {
  const res = await fetch(`${base}/api/research/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ResearchEvent);
}

const PAGE_URL = "https://www.epa.gov/heatislands";
const PAGE_TEXT = "Heat islands are urbanized areas that experience higher temperatures than outlying areas. Trees can reduce peak summer temperatures by 2-9°F.";

const EMPTY_STATE: ResearchChatRequest["state"] = {
  question: "",
  subQuestions: [],
  gaps: [],
  candidates: [{ url: "https://example.org/already-known/", title: "Already known", status: "new" }],
  findings: [],
};

test("a research turn streams progress, runs tools and returns notebook updates", async () => {
  const calls = scripted([
    {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me look into urban heat.", citations: null },
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "urban heat island trees" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        { type: "server_tool_use", id: "srv_2", name: "web_fetch", input: { url: PAGE_URL } },
        {
          type: "web_fetch_tool_result",
          tool_use_id: "srv_2",
          content: { type: "web_fetch_result", url: PAGE_URL, retrieved_at: null, content: { type: "document", title: "Heat Islands | EPA", citations: null, source: { type: "text", media_type: "text/plain", data: PAGE_TEXT } } },
        },
        { type: "tool_use", id: "t_plan", name: "update_plan", input: { question: "How do trees reduce urban heat?", sub_questions: ["What is the cooling effect?", "Who is most exposed?"] } },
        {
          type: "tool_use",
          id: "t_src",
          name: "propose_source",
          input: { url: PAGE_URL, title: "Heat Islands", publisher: "US EPA", published: "", kind: "government", relevance: "Defines heat islands.", caution: "", paywalled: false, sub_questions: [1, 7] },
        },
        { type: "tool_use", id: "t_dup", name: "propose_source", input: { url: "https://EXAMPLE.org/already-known", title: "Dup", publisher: "x", published: "", kind: "other", relevance: "", caution: "", paywalled: false, sub_questions: [] } },
        { type: "tool_use", id: "t_f1", name: "record_finding", input: { finding: "Trees cut peak temperatures by 2-9°F.", quote: "Trees can reduce peak summer temperatures by 2-9°F.", url: PAGE_URL, source_title: "Heat Islands", sub_question: 1 } },
        { type: "tool_use", id: "t_f2", name: "record_finding", input: { finding: "Made up.", quote: "Trees cool cities by 40 degrees.", url: PAGE_URL, source_title: "Heat Islands", sub_question: 0 } },
        { type: "tool_use", id: "t_gap", name: "note_gap", input: { gap: "No local exposure data yet.", sub_question: 2 } },
        { type: "tool_use", id: "t_bad", name: "record_finding", input: { finding: "Missing fields" } },
      ],
    },
    // The web tools hit their per-request limit: the API pauses and the turn is resumed as is.
    { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srv_3", name: "web_search", input: { query: "heat exposure by neighbourhood" } }] },
    {
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Trees can lower peak temperatures noticeably.",
          citations: [
            { type: "web_search_result_location", url: "https://www.nature.com/x", title: "Nature study", cited_text: "lower peaks", encrypted_index: "e" },
            { type: "char_location", document_title: "Heat Islands | EPA", document_index: 0, cited_text: "Trees can reduce", start_char_index: 0, end_char_index: 5 },
          ],
        },
      ],
    },
  ]);

  const events = await research({ state: EMPTY_STATE, history: [], message: "Research how trees reduce urban heat." });

  const statuses = events.filter((e) => e.type === "status").map((e) => (e as { text: string }).text);
  assert.ok(statuses.includes("Searching: urban heat island trees"));
  assert.ok(statuses.includes(`Reading: ${PAGE_URL}`));
  assert.ok(statuses.includes("Found: Heat Islands"));
  assert.ok(statuses.includes("Continuing…"));

  const done = events.at(-1);
  assert.equal(done?.type, "done");
  const { result } = done as Extract<ResearchEvent, { type: "done" }>;
  assert.deepEqual(result.updates.plan, { question: "How do trees reduce urban heat?", subQuestions: ["What is the cooling effect?", "Who is most exposed?"] });
  assert.equal(result.updates.candidates.length, 1, "the duplicate URL is not proposed again");
  assert.equal(result.updates.candidates[0].read, true);
  assert.deepEqual(result.updates.candidates[0].subQuestions, [1], "out-of-range sub-question numbers are dropped");
  assert.deepEqual(
    result.updates.findings.map((f) => [f.verified, f.subQuestion]),
    [[true, 1], [false, 0]],
    "a quote is verified only if it appears in a page that was read",
  );
  assert.deepEqual(result.updates.gaps, [{ text: "No local exposure data yet.", subQuestion: 2 }]);
  const refs = result.parts.flatMap((p) => p.refs);
  assert.deepEqual(refs.map((r) => r.url), ["https://www.nature.com/x", PAGE_URL]);
  assert.match(result.text, /proposed 1 source, recorded 2 findings, noted 1 gap/);

  // Request shapes: web tools present, tool results answer every call, pause resumes without a new user turn.
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].tools.slice(0, 2).map((t: any) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
  assert.match(calls[0].messages[0].content, /Already known <https:\/\/example.org\/already-known\/>/);
  const results = calls[1].messages.at(-1).content;
  assert.deepEqual(results.map((r: any) => r.tool_use_id), ["t_plan", "t_src", "t_dup", "t_f1", "t_f2", "t_gap", "t_bad"]);
  assert.equal(results.find((r: any) => r.tool_use_id === "t_bad").is_error, true);
  assert.equal(calls[2].messages.at(-1).role, "assistant", "a paused turn is resumed by resending, not with a new user message");
});

test("history is replayed as alternating plain-text turns, with the notebook on the newest message", async () => {
  const calls = scripted([{ stop_reason: "end_turn", content: [{ type: "text", text: "Sure.", citations: null }] }]);
  const state = { ...EMPTY_STATE, question: "Q?", subQuestions: [{ id: "a", text: "First" }], findings: [{ subQuestionId: "a", text: "A fact", url: "https://x.gov" }] };
  await research({
    state,
    history: [
      { role: "user", text: "Hi" },
      { role: "user", text: "Are you there?" },
      { role: "assistant", text: "Yes." },
    ],
    message: "Go on",
  });
  const roles = calls[0].messages.map((m: any) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user"]);
  assert.match(calls[0].messages[0].content, /Hi\n\nAre you there\?/);
  assert.match(calls[0].messages[2].content, /<notebook>[\s\S]*1\. First[\s\S]*\(Q1\) A fact[\s\S]*<\/notebook>\n\nGo on$/);
});

test("research is refused with the local provider", async () => {
  setProvider(new LocalProvider({ baseUrl: "http://127.0.0.1:1", model: "x", timeoutMs: 1000 }));
  const res = await fetch(`${base}/api/research/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: EMPTY_STATE, history: [], message: "Hi" }),
  });
  assert.equal(res.status, 501);
  assert.match(((await res.json()) as any).error, /Anthropic provider/);
});

test("a refusal ends the turn with an error event", async () => {
  scripted([{ stop_reason: "refusal", content: [] }]);
  const events = await research({ state: EMPTY_STATE, history: [], message: "Hi" });
  assert.equal(events.at(-1)?.type, "error");
});

test("POST /api/fetch-url imports a PDF report through the study-copy conversion", async () => {
  // A local web server stands in for a site hosting a PDF; the local provider extracts its text.
  const site = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(makePdf(["Canopy report 2024"]));
  });
  site.listen(0, "127.0.0.1");
  await new Promise((resolve) => site.once("listening", resolve));
  setProvider(new LocalProvider({ baseUrl: "http://127.0.0.1:1", model: "x", timeoutMs: 1000 }));
  try {
    const res = await fetch(`${base}/api/fetch-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${(site.address() as AddressInfo).port}/report.pdf` }),
    });
    const json = (await res.json()) as any;
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.equal(json.title, "Canopy report 2024");
    assert.match(json.text, /Canopy report 2024/);
  } finally {
    site.close();
  }
});
