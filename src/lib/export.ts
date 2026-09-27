import type { Source, Summary } from "../../shared/types";

/** Render a summary as Markdown, with each citation as a footnote quoting the source. */
export function summaryToMarkdown(summary: Summary, sources: Source[]): string {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const footnotes: string[] = [];
  let body = "";
  for (const seg of summary.segments) {
    body += seg.text;
    for (const c of seg.citations) {
      footnotes.push(`> ${c.quote.trim().replace(/\n+/g, " ")}\n>\n> — ${byId.get(c.sourceId)?.title ?? "Unknown source"}`);
      body += `[^${footnotes.length}]`;
    }
  }
  const sourceList = summary.sourceIds
    .map((id) => byId.get(id))
    .filter((s): s is Source => Boolean(s))
    .map((s) => `- ${s.title}${s.origin ? ` (${s.origin})` : ""}`)
    .join("\n");

  return [
    `## ${summary.title}`,
    summary.focus ? `*Focus: ${summary.focus}*` : "",
    body.trim(),
    summary.notes.trim() ? `### Notes\n\n${summary.notes.trim()}` : "",
    `### Sources\n\n${sourceList}`,
    footnotes.map((f, i) => `[^${i + 1}]:\n${f.replace(/^/gm, "    ")}`).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function notebookToMarkdown(summaries: Summary[], sources: Source[]): string {
  // Footnote labels must be unique across the whole document.
  return [
    "# Research notebook",
    ...summaries.map((s, i) => summaryToMarkdown(s, sources).replace(/\[\^(\d+)\]/g, `[^${i + 1}-$1]`)),
  ].join("\n\n---\n\n");
}

export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
