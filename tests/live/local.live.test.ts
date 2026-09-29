// Smoke tests against the real home model. They only run with LLM_LIVE=1 (see `npm run test:live`),
// since they need the server to be up and a slow 120B model to answer.
//
//   npm run test:live
//
// Settings come from .env.home, or override LOCAL_LLM_BASE_URL / LOCAL_LLM_MODEL in the shell.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { resolveConfig } from "../../server/llm/config.js";
import { createProvider } from "../../server/llm/index.js";
import type { LlmProvider } from "../../server/llm/types.js";

const live = process.env.LLM_LIVE === "1";
let provider: LlmProvider;

before(() => {
  if (!live) return;
  try {
    process.loadEnvFile(".env.home");
  } catch {
    // Fall back to whatever is in the environment.
  }
  provider = createProvider(resolveConfig({ ...process.env, LLM_PROVIDER: "local" }));
  console.log(`Testing ${provider.id}: ${provider.model}`);
});

const DOC = { title: "Report", text: "Sales rose 12% in 2024. Costs fell by 3%. The board approved a new office in Lisbon.", citations: true };

test("answers a plain prompt", { skip: !live }, async () => {
  const result = await provider.generate({ system: "Answer in one short sentence.", maxTokens: 400, messages: [{ role: "user", text: "What is the capital of France?" }] });
  assert.match(result.blocks.map((b) => b.text).join(""), /Paris/i);
});

test("cites a passage that exists in the document", { skip: !live }, async () => {
  const result = await provider.generate({
    system: "Summarise the documents in two sentences.",
    maxTokens: 2000,
    messages: [{ role: "user", text: "Summarise the report.", docs: [DOC] }],
  });
  const citations = result.blocks.flatMap((b) => b.citations);
  assert.ok(citations.length > 0, `no verifiable citations in: ${JSON.stringify(result.blocks)}`);
  for (const c of citations) assert.equal(DOC.text.slice(c.start, c.end), c.quote);
});

test("returns JSON that matches a schema", { skip: !live }, async () => {
  const result = await provider.structured({
    system: "You extract facts.",
    docs: [{ ...DOC, citations: false }],
    prompt: "Extract the sales growth percentage and the city of the new office.",
    schema: z.object({ sales_growth_percent: z.number(), office_city: z.string() }),
    maxTokens: 2000,
  });
  assert.deepEqual(result, { refused: false, value: { sales_growth_percent: 12, office_city: "Lisbon" } });
});

test("calls a tool", { skip: !live }, async () => {
  const result = await provider.generate({
    system: "Use the tools you are given.",
    maxTokens: 2000,
    tools: [
      {
        name: "record_growth",
        description: "Record the sales growth percentage found in the report.",
        schema: { type: "object", properties: { percent: { type: "number" } }, required: ["percent"], additionalProperties: false },
      },
    ],
    messages: [{ role: "user", text: "Record the sales growth from the report.", docs: [{ ...DOC, citations: false }] }],
  });
  assert.equal(result.stopReason, "tool_use");
  assert.deepEqual(result.toolCalls[0]?.input, { percent: 12 });
});
