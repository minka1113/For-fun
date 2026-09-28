import type { ContextNote, Source, Summary } from "../../shared/types";

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

  const expert = summary.expert;
  const contextNotes = expert?.exportNotes && expert.notes.length ? contextSection(expert.notes, byId) : "";

  return [
    `## ${summary.title}`,
    summary.focus ? `*Focus: ${summary.focus}*` : "",
    body.trim(),
    summary.notes.trim() ? `### Notes\n\n${summary.notes.trim()}` : "",
    contextNotes,
    `### Sources\n\n${sourceList}`,
    footnotes.map((f, i) => `[^${i + 1}]:\n${f.replace(/^/gm, "    ")}`).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Expert context notes, clearly separated from the sourced summary. */
function contextSection(notes: ContextNote[], byId: Map<string, Source>): string {
  const basis = { library: "background library", general: "expert's general knowledge", both: "background library and general knowledge" };
  const items = notes.map((n) => {
    const anchor =
      n.anchor.kind === "draft" ? `On “${n.anchor.quote.trim()}”` : `On ${byId.get(n.anchor.source.sourceId)?.title ?? "a source"}: “${n.anchor.source.quote.trim()}”`;
    const refs = n.background.map((r) => `${r.paperTitle}${r.page ? `, p. ${r.page}` : ""}`);
    return `- ${anchor}: ${n.note.trim()} *(Basis: ${basis[n.basis]}${refs.length ? `; ${refs.join("; ")}` : ""})*`;
  });
  return `### Background context (not from the sources)\n\n*Added by the subject-matter expert. These notes draw on background papers or general knowledge, not on the sources summarised above.*\n\n${items.join("\n")}`;
}

export function notebookToMarkdown(projectName: string, summaries: Summary[], sources: Source[]): string {
  // Footnote labels must be unique across the whole document.
  return [
    `# ${projectName}`,
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
