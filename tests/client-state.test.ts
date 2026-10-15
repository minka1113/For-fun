// Browser-side state: loading and migrating saved workspaces, merging research turns into the
// notebook, and the store that runs research turns (including stopping and dropped connections).

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { ResearchChatResult, ResearchEvent, ResearchState, Summary } from "../shared/types.js";
import { DEFAULT_SHARED_RULES } from "../shared/rules.js";
import { DEFAULT_STYLES } from "../shared/styles.js";
import { emptyWorkspace, loadWorkspace, rulesFor, saveWorkspace, styleOf } from "../src/lib/storage.js";
import { applyResearchTurn, emptyResearch, notebookForRequest } from "../src/lib/research.js";
import { getRun, startRun, stopRun } from "../src/lib/researchRuns.js";

/* ---------- A minimal localStorage for Node ---------- */

const store = new Map<string, string>();
const KEY = "source-lens:v1";
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const summary = (extra: Partial<Summary> = {}): Summary => ({
  id: "sum",
  title: "T",
  sourceIds: [],
  style: "Detailed",
  segments: [],
  model: "m",
  createdAt: 0,
  review: {},
  notes: "",
  ...extra,
});

/* ---------- Workspace loading and migration ---------- */

test("an empty or unreadable browser store starts a fresh workspace", () => {
  assert.equal(loadWorkspace().version, 4);
  store.set(KEY, "{not json");
  const ws = loadWorkspace();
  assert.equal(ws.projects.length, 1);
  assert.deepEqual(ws.sharedRules, DEFAULT_SHARED_RULES);
  assert.equal(ws.styles.length, DEFAULT_STYLES.length);
});

test("a first-version workspace moves into a project, with drafts linked to their style", () => {
  store.set(KEY, JSON.stringify({ sources: [{ id: "s", title: "S", text: "t", addedAt: 0 }], summaries: [summary({ style: "detailed" })], rules: ["Old rule"] }));
  const ws = loadWorkspace();
  assert.equal(ws.version, 4);
  assert.equal(ws.projects[0].sources.length, 1);
  assert.equal(ws.projects[0].summaries[0].styleId, "detailed", "style names match regardless of case");
  assert.equal(ws.activeProjectId, ws.projects[0].id);
});

test("rule sets from version 3 are replaced by per-style rules, and old fields are dropped", () => {
  store.set(
    KEY,
    JSON.stringify({
      version: 3,
      activeProjectId: "p",
      ruleSets: [{ id: "my-rules", name: "My rules", rules: ["x"] }],
      styles: [
        { id: "executive", name: "Executive summary", instructions: "Custom wording" },
        { id: "mine", name: "My memo", instructions: "Memo." },
      ],
      projects: [
        { id: "p", name: "P", question: "", packIds: [], brief: "", defaultRuleSetId: "my-rules", sources: [], summaries: [summary({ style: "My memo", ruleSetId: "my-rules" } as any)], createdAt: 0 },
      ],
    }),
  );
  const ws = loadWorkspace();
  const exec = ws.styles.find((s) => s.id === "executive")!;
  assert.equal(exec.instructions, "Custom wording", "edited instructions are kept");
  assert.deepEqual(exec.rules, DEFAULT_STYLES.find((s) => s.id === "executive")!.rules, "built-in styles gain their default rules");
  assert.deepEqual(ws.styles.find((s) => s.id === "mine")!.rules, [], "custom styles start with none");
  const project = ws.projects[0] as any;
  assert.equal("defaultRuleSetId" in project, false);
  assert.equal("ruleSetId" in project.summaries[0], false);
  assert.equal(project.summaries[0].styleId, "mine");
});

test("a current workspace loads unchanged, and saving reports a full store", () => {
  const ws = emptyWorkspace();
  assert.equal(saveWorkspace(ws), true);
  assert.deepEqual(loadWorkspace(), ws);
  (globalThis as any).localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(saveWorkspace(ws), false);
});

test("a draft follows its style's rules after the shared ones, and falls back if the style is deleted", () => {
  const styles = DEFAULT_STYLES.map((s) => ({ ...s }));
  const exec = styles.find((s) => s.id === "executive")!;
  const rules = rulesFor(exec, ["Past tense", exec.rules[0]]);
  assert.deepEqual(rules.slice(0, 2), ["Past tense", exec.rules[0]]);
  assert.equal(rules.filter((r) => r === exec.rules[0]).length, 1, "a rule in both lists appears once");

  assert.equal(styleOf(styles, summary({ styleId: "executive" })).style.id, "executive");
  assert.equal(styleOf(styles, summary({ style: "Brief" })).style.id, "brief", "older drafts match by name");
  const gone = styleOf(styles, summary({ styleId: "deleted", style: "Deleted" }));
  assert.equal(gone.missing, true);
  assert.equal(gone.style.id, styles[0].id);
});

/* ---------- Research notebook ---------- */

const result = (updates: Partial<ResearchChatResult["updates"]>, text = "Reply"): ResearchChatResult => ({
  parts: [{ text, refs: [] }],
  activity: ["Searching: x"],
  updates: { candidates: [], findings: [], gaps: [], ...updates },
  text,
});

const candidate = (url: string, subQuestions: number[] = []) => ({
  url,
  title: url,
  publisher: "",
  published: "",
  kind: "government" as const,
  relevance: "",
  caution: "",
  paywalled: false,
  read: true,
  subQuestions,
});

test("a research turn updates the plan, keeping sub-question ids whose text is unchanged", () => {
  let r: ResearchState = { ...emptyResearch(), subQuestions: [{ id: "keep", text: "Cooling?" }], findings: [{ id: "f", subQuestionId: "keep", text: "", quote: "", url: "", sourceTitle: "", verified: true, createdAt: 0 }] };
  r = applyResearchTurn(
    r,
    result({
      plan: { question: "Q", subQuestions: ["Exposure?", "Cooling?"] },
      candidates: [candidate("https://a.gov/x", [2, 1, 9])],
      findings: [{ text: "F", quote: "q", url: "https://a.gov/x", sourceTitle: "A", verified: false, subQuestion: 2 }],
      gaps: [{ text: "G", subQuestion: 0 }],
    }),
  );
  assert.equal(r.question, "Q");
  assert.equal(r.subQuestions[1].id, "keep");
  assert.equal(r.findings[0].subQuestionId, "keep", "existing findings stay attached");
  assert.equal(r.findings[1].subQuestionId, "keep", "numbers refer to the new plan");
  assert.deepEqual(r.candidates[0].subQuestionIds, [r.subQuestions[1].id, r.subQuestions[0].id]);
  assert.equal(r.gaps[0].subQuestionId, undefined);
  assert.equal(r.chat.at(-1)?.role, "assistant");
  assert.deepEqual(r.chat.at(-1)?.activity, ["Searching: x"]);
});

test("the same source is never added twice, whatever its URL formatting", () => {
  let r = applyResearchTurn(emptyResearch(), result({ candidates: [candidate("https://Example.org/Report/")] }));
  r = applyResearchTurn(r, result({ candidates: [candidate("https://example.org/report#section"), candidate("https://example.org/other")] }));
  assert.deepEqual(r.candidates.map((c) => c.url), ["https://Example.org/Report/", "https://example.org/other"]);
  assert.deepEqual(notebookForRequest(r).candidates.map((c) => c.status), ["new", "new"]);
});

/* ---------- Running research turns ---------- */

/** Stand in for the server: stream the given events, optionally never finishing. */
function serve(events: ResearchEvent[], opts: { hang?: boolean } = {}) {
  (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        if (!opts.hang) controller.close();
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function notebook() {
  let r = emptyResearch();
  return { update: (fn: (x: ResearchState) => ResearchState) => (r = fn(r)), get: () => r };
}

const REQ = { state: notebookForRequest(emptyResearch()), history: [], message: "Go" };

test("a finished turn is applied to the notebook and the run goes idle", async () => {
  serve([
    { type: "status", text: "Searching: x" },
    { type: "text", text: "Hello" },
    { type: "done", result: result({ candidates: [candidate("https://a.gov")] }) },
  ]);
  const nb = notebook();
  await startRun("p1", REQ, nb.update);
  assert.equal(nb.get().candidates.length, 1);
  assert.equal(getRun("p1").running, false);
  assert.equal(getRun("p1").error, null);
});

test("a turn that fails part-way keeps what it gathered and reports the error", async () => {
  serve([
    { type: "text", text: "Partial reply" },
    { type: "progress", updates: { candidates: [candidate("https://a.gov")], findings: [], gaps: [] } },
    { type: "error", error: "Rate limited" },
  ]);
  const nb = notebook();
  await startRun("p2", REQ, nb.update);
  assert.equal(nb.get().candidates.length, 1);
  assert.match(nb.get().chat.at(-1)!.text, /Partial reply[\s\S]*interrupted/);
  assert.equal(getRun("p2").error, "Rate limited");
});

test("stopping a turn keeps its progress without reporting an error", async () => {
  serve([{ type: "progress", updates: { candidates: [candidate("https://b.gov")], findings: [], gaps: [] } }], { hang: true });
  const nb = notebook();
  const running = startRun("p3", REQ, nb.update);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(getRun("p3").running, true);
  stopRun("p3");
  await running;
  assert.equal(nb.get().candidates.length, 1);
  assert.match(nb.get().chat.at(-1)!.text, /Stopped/);
  assert.equal(getRun("p3").error, null);
});

test("a reply that isn't an event stream (e.g. a login page) is reported clearly", async () => {
  (globalThis as any).fetch = async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
  const nb = notebook();
  await startRun("p4", REQ, nb.update);
  assert.match(getRun("p4").error ?? "", /unexpected reply/);
});
