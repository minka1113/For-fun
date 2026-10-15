// Turns a PDF into a "study copy": its full text with tables transcribed and figures described
// in words, so the expert (and the summariser) can work from compact text while the original
// PDF is kept for checking.

import { getProvider } from "./llm/index.js";

export const MAX_PDF_BYTES = 30 * 1024 * 1024;

const STUDY_PROMPT = `Produce a faithful study copy of this PDF as Markdown, so that someone who cannot see the PDF loses nothing of substance.

- Begin with the document's title as a level-1 heading ("# Title").
- Start every page with a line containing only "[Page N]", using the PDF's physical page order starting at 1.
- Transcribe all body text in reading order, word for word. Do not summarise, shorten, or paraphrase. Skip only running headers, footers, and page numbers.
- Transcribe every table in full as a Markdown table, keeping every row, column, number, unit, and footnote marker. Put the table's caption above it.
- For every figure, chart, map, or diagram write a block:
  "[Figure: <caption or short title>]" followed by a description of what it shows: chart type, axes and units, every labelled value you can read, the main trends and comparisons, and anything highlighted. Report values exactly as printed; if a value must be estimated from the graphic, prefix it with "≈". Never invent data that is not visible.
- Keep equations, footnotes, and reference lists.
- Output only the study copy, with no commentary before or after it.`;

export async function studyCopyFromPdf(pdf: Buffer, signal?: AbortSignal): Promise<{ title: string; text: string }> {
  const text = await getProvider().pdfToMarkdown(pdf, STUDY_PROMPT, signal);
  if (!text) throw new Error("No text came back for this PDF.");
  const title = text.match(/^#\s+(.+)$/m)?.[1].trim() ?? "";
  return { title, text };
}
