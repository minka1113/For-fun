// Small parsers on the server: document labels in expert citations, and HTML entities in imported pages.

import { test } from "node:test";
import assert from "node:assert/strict";
import { labelNumber } from "../server/expert.js";
import { htmlToText } from "../server/extract.js";

test("document labels are read only from the start of a title", () => {
  assert.equal(labelNumber("[S2] Report", "S"), 1);
  assert.equal(labelNumber("S3", "S"), 2);
  assert.equal(labelNumber("[B1] Supplementary Table S2 analysis", "S"), null, "a paper mentioning S2 isn't a source");
  assert.equal(labelNumber("[B1] Supplementary Table S2 analysis", "B"), 0);
});

test("out-of-range character codes in a page don't stop it being imported", () => {
  assert.equal(htmlToText("<p>A &#99999999; B &#x41; &amp; &#x110000;</p>").text, "A &#99999999; B A & &#x110000;");
});
