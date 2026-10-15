// Browser-side logic for drafts: editing segments, highlights, style-check status, source
// fragments and Markdown export. These run in Node; none of them touch the DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Segment, StyleCheck, Summary } from "../shared/types.js";
import { countWords, parseWordLimit, withinLimit } from "../shared/rules.js";
import {
  applyQuoteEdit,
  fullText,
  locateInDraft,
  locateViolations,
  marksBySegment,
  replaceRange,
  ruleRows,
  withSegments,
} from "../src/lib/style.js";
import { coverage, fragmentSource, isUnsupported } from "../src/lib/spans.js";
import { notebookToMarkdown, summaryToMarkdown } from "../src/lib/export.js";
import { demoProject } from "../src/lib/demo.js";

const cite = (start: number, end: number, quote = "q") => ({ sourceId: "s1", start, end, quote });

function draft(segments: Segment[], extra: Partial<Summary> = {}): Summary {
  return {
    id: "sum",
    title: "Title",
    sourceIds: ["s1"],
    style: "Detailed",
    segments,
    model: "m",
    createdAt: 0,
    review: {},
    notes: "",
    ...extra,
  };
}

/* ---------- Editing ---------- */

test("replaceRange edits inside one segment and keeps its citations", () => {
  const segs: Segment[] = [
    { id: "a", text: "Sales rose 12%.", citations: [cite(0, 5)] },
    { id: "b", text: " Costs fell.", citations: [] },
  ];
  const { segments, changed } = replaceRange(segs, 6, 10, "grew");
  assert.deepEqual(changed, ["a"]);
  assert.equal(fullText(segments), "Sales grew 12%. Costs fell.");
  assert.equal(segments[0].edited, true);
  assert.equal(segments[0].citations.length, 1);
  assert.strictEqual(segments[1], segs[1], "untouched segments are reused as is");
});

test("replaceRange across segments merges them and their citations", () => {
  const segs: Segment[] = [
    { id: "a", text: "One. ", citations: [cite(0, 3)] },
    { id: "b", text: "Two. ", citations: [cite(4, 7)] },
    { id: "c", text: "Three.", citations: [] },
  ];
  // "One. Two. Three." with ". Two. " (characters 3-10) replaced.
  const { segments, changed } = replaceRange(segs, 3, 10, ", two, ");
  assert.deepEqual(changed, ["a", "b"]);
  assert.equal(fullText(segments), "One, two, Three.");
  assert.equal(segments.length, 2);
  assert.equal(segments[0].citations.length, 2);
});

test("deleting a sentence tidies the spaces it leaves behind", () => {
  const segs: Segment[] = [
    { id: "a", text: "Kept.", citations: [cite(0, 4)] },
    { id: "b", text: " ", citations: [] },
    { id: "c", text: "Made up claim.", citations: [] },
    { id: "d", text: " ", citations: [] },
    { id: "e", text: "\n\nNext paragraph.", citations: [] },
  ];
  const text = fullText(segs);
  const start = text.indexOf("Made up claim.");
  const { segments } = replaceRange(segs, start, start + "Made up claim.".length, "");
  assert.equal(fullText(segments), "Kept.\n\nNext paragraph.");
});

test("withSegments sends edited segments back to unreviewed", () => {
  const s = draft([{ id: "a", text: "x", citations: [] }], { review: { a: "ok", b: "flag" } });
  assert.deepEqual(withSegments(s, s.segments, ["a"]).review, { b: "flag" });
});

test("applyQuoteEdit replaces the quote, or returns null when it's gone", () => {
  const s = draft([{ id: "a", text: "Trees cool cities.", citations: [cite(0, 5)] }], { review: { a: "ok" } });
  const edited = applyQuoteEdit(s, "cool", "shade");
  assert.equal(fullText(edited!.segments), "Trees shade cities.");
  assert.deepEqual(edited!.review, {});
  assert.equal(applyQuoteEdit(s, "not there", "x"), null);
  assert.equal(applyQuoteEdit(s, "", "x"), null);
});

/* ---------- Highlights ---------- */

test("marksBySegment clips a highlight to each segment it spans", () => {
  const segs: Segment[] = [
    { id: "a", text: "Hello ", citations: [] },
    { id: "b", text: "world.", citations: [] },
  ];
  const marks = marksBySegment(segs, locateInDraft([{ id: "m", quote: "lo wor" }], "edit", fullText(segs)));
  assert.deepEqual(marks.get("a"), [{ id: "m", kind: "edit", start: 3, end: 6 }]);
  assert.deepEqual(marks.get("b"), [{ id: "m", kind: "edit", start: 0, end: 3 }]);
});

test("locateInDraft and locateViolations report quotes that are no longer in the draft", () => {
  assert.equal(locateInDraft([{ id: "x", quote: "missing" }], "low-value", "text")[0].range, null);
  const check: StyleCheck = {
    checkedAt: 0,
    rules: ["Past tense"],
    checkedText: "",
    results: [],
    violations: [{ id: "v", rule: 0, quote: "is", explanation: "", suggestion: "was" }],
  };
  assert.deepEqual(locateViolations(check, "It is.")[0].range, { start: 3, end: 5 });
  assert.equal(locateViolations(check, "It was.")[0].range, null);
});

/* ---------- Style-check status ---------- */

test("ruleRows combines word counts with the last Claude check", () => {
  const text = "The canopy fell sharply.";
  const check: StyleCheck = {
    checkedAt: 0,
    rules: ["Past tense", "Facts only"],
    checkedText: text,
    results: [
      { rule: 0, passed: true, note: "ok" },
      { rule: 1, passed: false, note: "one inference" },
    ],
    violations: [{ id: "v", rule: 1, quote: "sharply", explanation: "", suggestion: "" }],
  };
  const s = draft([{ id: "a", text, citations: [] }], { styleCheck: check });
  const rules = ["Past tense", "Facts only", "No more than 3 words", "Plain language"];
  const rows = ruleRows(rules, s, text, locateViolations(check, text));
  assert.deepEqual(
    rows.map((r) => [r.checkedBy, r.status]),
    [["claude", "pass"], ["claude", "fail"], ["app", "fail"], ["claude", "unchecked"]],
  );
  assert.equal(rows[1].violations.length, 1);
  assert.match(rows[2].note, /4 words: 1 over the limit/);

  // After the flagged text is edited away, the rule needs a re-check rather than staying failed.
  const edited = "The canopy fell.";
  const after = ruleRows(rules, s, edited, locateViolations(check, edited));
  assert.equal(after[1].status, "recheck");
  assert.equal(after[2].status, "pass");
});

test("word limits apply to the whole draft, not to bullets or sentences", () => {
  assert.deepEqual(parseWordLimit("No more than 250 words"), { max: 250, strict: false });
  assert.deepEqual(parseWordLimit("Under 1,000 words"), { max: 1000, strict: true });
  assert.equal(parseWordLimit("Each bullet under 30 words"), null);
  assert.equal(parseWordLimit("Paragraphs of no more than 5 sentences"), null);
  assert.equal(parseWordLimit("Always in past tense"), null);
  assert.equal(countWords("It cost $2.3 million, about 4,000 trees."), 7);
  assert.equal(withinLimit(250, { max: 250, strict: false }), true);
  assert.equal(withinLimit(250, { max: 250, strict: true }), false);
});

/* ---------- Source fragments ---------- */

test("fragmentSource splits at overlapping citations and key passages", () => {
  const segs: Segment[] = [
    { id: "a", text: "x", citations: [cite(0, 6)] },
    { id: "b", text: "y", citations: [cite(3, 9), { sourceId: "other", start: 0, end: 9, quote: "" }] },
  ];
  const frags = fragmentSource("0123456789", "s1", segs, [{ id: "k", start: 5, end: 10 }]);
  assert.deepEqual(
    frags.map((f) => [f.start, f.end, f.segIds.join(""), f.pointIds.join("")]),
    [
      [0, 3, "a", ""],
      [3, 5, "ab", ""],
      [5, 6, "ab", "k"],
      [6, 9, "b", "k"],
      [9, 10, "", "k"],
    ],
  );
  assert.equal(coverage("0123456789", "s1", segs), 0.9);
});

test("isUnsupported flags uncited claims but not connective text", () => {
  assert.equal(isUnsupported({ id: "a", text: "Most residents support the plan.", citations: [] }), true);
  assert.equal(isUnsupported({ id: "b", text: "\n\n- ", citations: [] }), false);
  assert.equal(isUnsupported({ id: "c", text: "Most residents support the plan.", citations: [cite(0, 1)] }), false);
});

/* ---------- Export ---------- */

test("Markdown export quotes each citation as a footnote and labels expert notes", () => {
  const sources = [{ id: "s1", title: "Report", text: "", addedAt: 0 }];
  const s = draft(
    [
      { id: "a", text: "Sales rose.", citations: [cite(0, 5, "Sales\nrose 12%")] },
      { id: "b", text: " More.", citations: [] },
    ],
    {
      expert: {
        highlights: [],
        chat: [],
        exportNotes: true,
        notes: [{ id: "n", note: "Context.", basis: "general", anchor: { kind: "draft", quote: "Sales" }, background: [], createdAt: 0 }],
      },
    },
  );
  const md = summaryToMarkdown(s, sources);
  assert.match(md, /Sales rose\.\[\^1\] More\./);
  assert.match(md, /\[\^1\]:\n {4}> Sales rose 12%\n {4}>\n {4}> — Report/);
  assert.match(md, /### Background context \(not from the sources\)[\s\S]*Context\. \*\(Basis: expert's general knowledge\)\*/);

  const hidden = summaryToMarkdown({ ...s, expert: { ...s.expert!, exportNotes: false } }, sources);
  assert.doesNotMatch(hidden, /Background context/);

  const book = notebookToMarkdown("Project", [s, { ...s, id: "two" }], sources);
  assert.match(book, /\[\^1-1\][\s\S]*\[\^2-1\]/, "footnote labels are unique across the notebook");
});

test("the example project builds, with every demo quote found in its source", () => {
  const project = demoProject();
  const summary = project.summaries[0];
  for (const seg of summary.segments) {
    for (const c of seg.citations) {
      const source = project.sources.find((s) => s.id === c.sourceId)!;
      assert.equal(source.text.slice(c.start, c.end), c.quote);
    }
  }
  const text = fullText(summary.segments);
  for (const v of summary.styleCheck!.violations) assert.ok(text.includes(v.quote), v.quote);
});
