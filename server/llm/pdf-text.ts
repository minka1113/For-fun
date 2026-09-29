// Text-only PDF conversion for providers that can't read PDFs. Tables come out as running text
// and figures are not described, so the result is weaker than a model's reading of the PDF.

import { extractText, getDocumentProxy, getMeta } from "unpdf";

export async function pdfToText(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text: pages } = await extractText(doc, { mergePages: false });
  const meta = await getMeta(doc).catch(() => null);

  if (!pages.some((p) => p.trim())) {
    throw new Error("No text could be extracted from this PDF. It may be scanned; the Anthropic provider can read scanned PDFs.");
  }
  const infoTitle = (meta?.info as { Title?: unknown } | undefined)?.Title;
  const firstLine = pages.join("\n").split("\n").find((l) => l.trim()) ?? "Untitled";
  const title = (typeof infoTitle === "string" && infoTitle.trim() ? infoTitle.trim() : firstLine.trim()).slice(0, 150);

  return [`# ${title}`, ...pages.map((p, i) => `[Page ${i + 1}]\n${p.trim()}`)].join("\n\n");
}
