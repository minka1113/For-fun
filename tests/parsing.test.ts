// Small parsers and helpers: document labels in expert citations, HTML entities in imported pages,
// and the chat history replayed to the model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { labelNumber } from "../server/expert.js";
import { htmlToText } from "../server/extract.js";
import { normalizeUrl, replayTurns } from "../shared/chat.js";

test("document labels are read only from the start of a title", () => {
  assert.equal(labelNumber("[S2] Report", "S"), 1);
  assert.equal(labelNumber("S3", "S"), 2);
  assert.equal(labelNumber("[B1] Supplementary Table S2 analysis", "S"), null, "a paper mentioning S2 isn't a source");
  assert.equal(labelNumber("[B1] Supplementary Table S2 analysis", "B"), 0);
});

test("out-of-range character codes in a page don't stop it being imported", () => {
  assert.equal(htmlToText("<p>A &#99999999; B &#x41; &amp; &#x110000;</p>").text, "A &#99999999; B A & &#x110000;");
});

test("chat history is replayed opening with the user, with roles alternating", () => {
  assert.deepEqual(replayTurns([]), []);
  assert.deepEqual(
    replayTurns([
      { role: "assistant", text: "Welcome" },
      { role: "user", text: "One" },
      { role: "user", text: "Two" },
      { role: "assistant", text: "  " },
    ]),
    [
      { role: "user", text: "One\n\nTwo" },
      { role: "assistant", text: "(No reply.)" },
    ],
  );
  assert.equal(normalizeUrl(" https://A.gov/Report/#top "), "https://a.gov/report");
});
