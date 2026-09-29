import { test } from "node:test";
import assert from "node:assert/strict";
import { citationInstructions, parseCitedText, renderDocs } from "../server/llm/cited.js";
import type { LlmDoc } from "../server/llm/types.js";

const docs: LlmDoc[] = [
  { title: "Report", text: "Sales rose 12% in 2024. Costs fell.", citations: true },
  { title: "Notes", text: "Unrelated background.", citations: true },
  { title: "Not citable", text: "Secret text.", citations: false },
];

test("splits text at markers and resolves quotes to offsets", () => {
  const blocks = parseCitedText('Sales grew. [[D1: "Sales rose 12% in 2024."]] Costs dropped. [[D1: "Costs fell."]]', docs);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, "Sales grew. ");
  assert.deepEqual(blocks[0].citations, [{ docIndex: 0, docTitle: "Report", start: 0, end: 23, quote: "Sales rose 12% in 2024." }]);
  assert.equal(blocks[1].citations[0].quote, "Costs fell.");
  assert.equal(docs[0].text.slice(blocks[1].citations[0].start, blocks[1].citations[0].end), "Costs fell.");
});

test("attaches consecutive markers to the same block", () => {
  const [block] = parseCitedText('Both agree. [[D1: "Costs fell."]] [[D2: "Unrelated background."]]', docs);
  assert.deepEqual(
    block.citations.map((c) => c.docIndex),
    [0, 1],
  );
});

test("keeps text after the last marker as an uncited block", () => {
  const blocks = parseCitedText('A. [[D1: "Costs fell."]] Then more.', docs);
  assert.deepEqual(
    blocks.map((b) => [b.text, b.citations.length]),
    [
      ["A. ", 1],
      ["Then more.", 0],
    ],
  );
});

test("tolerates whitespace and curly-quote differences in the quote", () => {
  const withCurly: LlmDoc[] = [{ title: "T", text: "It’s a  test\nof matching.", citations: true }];
  const [block] = parseCitedText(`Fine. [[D1: "It's a test of matching."]]`, withCurly);
  assert.equal(block.citations[0].quote, "It’s a  test\nof matching.");
});

test("drops citations it cannot verify but keeps the text", () => {
  const blocks = parseCitedText('Claim one. [[D1: "made up quote"]] Claim two. [[D9: "x"]] Claim three. [[D3: "Secret text."]]', docs);
  assert.equal(blocks.map((b) => b.text).join(""), "Claim one. Claim two. Claim three. ");
  assert.ok(blocks.every((b) => b.citations.length === 0));
});

test("a marker with no text before it is dropped", () => {
  const blocks = parseCitedText('[[D1: "Costs fell."]] Then text.', docs);
  assert.deepEqual(blocks, [{ text: " Then text.", citations: [] }]);
});

test("text without markers is one block", () => {
  assert.deepEqual(parseCitedText("Nothing cited.", docs), [{ text: "Nothing cited.", citations: [] }]);
});

test("renders documents with stable ids and lists only citable ones in the instructions", () => {
  const out = renderDocs(docs.slice(0, 1), 4);
  assert.match(out, /^<document id="D5" title="Report">\nSales rose/);
  assert.match(citationInstructions(docs), /documents D1, D2 as you write/);
});
