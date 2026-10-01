// Models without a citations feature are asked to cite inline as [[D2: "verbatim quote"]].
// These helpers describe that convention to the model and turn the markers back into the same
// text blocks with citations that a native-citations provider returns.

import { findQuote } from "../spans.js";
import type { LlmCitation, LlmDoc, LlmTextBlock } from "./types.js";

const MARKER = /\[\[D(\d+):\s*"([\s\S]*?)"\s*\]\]/g;

export function renderDocs(docs: LlmDoc[], firstIndex: number): string {
  return docs
    .map((d, i) => {
      const header = `<document id="D${firstIndex + i + 1}" title=${JSON.stringify(d.title)}>`;
      return [header, d.context, d.text, "</document>"].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function citationInstructions(docs: LlmDoc[]): string {
  const ids = docs.flatMap((d, i) => (d.citations ? [`D${i + 1}`] : []));
  return `

## Citing documents
The documents are given as <document id="D1" title="…"> blocks. Cite the documents ${ids.join(", ")} as you write: put a citation marker straight after each statement that rests on a passage, in the form [[D1: "quote"]]. The quote must be copied character for character from that document, at most one sentence, and must support the statement. Use several markers when a statement rests on several passages. Never cite from memory or invent a quote, and do not mention the markers or explain them.`;
}

/** Split text at its citation markers into blocks, each carrying the passages it cites. */
export function parseCitedText(text: string, docs: LlmDoc[]): LlmTextBlock[] {
  const blocks: LlmTextBlock[] = [];
  let cursor = 0;
  // Text that follows a marker loses its leading spaces when the block before already ends in one.
  const chunkAfter = (chunk: string) => (/\s$/.test(blocks[blocks.length - 1]?.text ?? "") ? chunk.replace(/^[ \t]+/, "") : chunk);
  for (const m of text.matchAll(MARKER)) {
    const chunk = chunkAfter(text.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    if (chunk.trim()) blocks.push({ text: chunk, citations: [] });
    const citation = resolve(docs, Number(m[1]) - 1, m[2]);
    // A marker before any text, or one whose quote isn't in the document, is dropped.
    if (citation && blocks.length) blocks[blocks.length - 1].citations.push(citation);
  }
  const rest = chunkAfter(text.slice(cursor));
  if (rest.trim()) blocks.push({ text: rest, citations: [] });
  return blocks;
}

function resolve(docs: LlmDoc[], docIndex: number, quote: string): LlmCitation | null {
  const doc = docs[docIndex];
  if (!doc?.citations) return null;
  const found = findQuote(doc.text, quote);
  if (!found) return null;
  return { docIndex, docTitle: doc.title, start: found.start, end: found.end, quote: doc.text.slice(found.start, found.end) };
}
