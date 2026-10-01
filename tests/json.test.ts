import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, stripThinking } from "../server/llm/json.js";

test("stripThinking removes reasoning blocks", () => {
  assert.equal(stripThinking("<think>hmm</think>\nAnswer"), "Answer");
  assert.equal(stripThinking("reasoning only closes here</think> Answer"), "Answer");
  assert.equal(stripThinking("<think>never finished"), "");
  assert.equal(stripThinking("plain"), "plain");
});

test("extractJson reads bare, fenced and embedded objects", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": [1, 2]}\n```\nDone.'), { a: [1, 2] });
  assert.deepEqual(extractJson('Sure! {"a": "x } y", "b": {"c": 2}} hope that helps'), { a: "x } y", b: { c: 2 } });
});

test("extractJson ignores reasoning before the answer", () => {
  assert.deepEqual(extractJson('<think>maybe {"wrong": true}</think>{"right": true}'), { right: true });
});

test("extractJson throws when there is no JSON", () => {
  assert.throws(() => extractJson("no json here"), /valid JSON/);
  assert.throws(() => extractJson('{"unterminated": '), /valid JSON/);
});
