import type { DraftStyle } from "./types";

// Drafting styles offered when generating a summary. Researchers can edit these in the app.
export const DEFAULT_STYLES: DraftStyle[] = [
  {
    id: "executive",
    name: "Executive summary",
    instructions: [
      "Write an executive summary for senior decision-makers who will read nothing else.",
      "Open with a one- or two-sentence bottom line: the single most important takeaway.",
      "Then give 3 to 5 key findings as short bullet points (each starting with \"- \"), most important first, each stating the finding and why it matters.",
      "Finish with a short \"Implications\" paragraph covering decisions, risks, or actions the findings point to, as stated in the sources.",
      "Use plain language, no jargon or methodological detail unless essential.",
    ].join(" "),
  },
  {
    id: "brief",
    name: "Brief",
    instructions: "Write a brief summary: one or two short paragraphs capturing only the most important points.",
  },
  {
    id: "detailed",
    name: "Detailed",
    instructions:
      "Write a thorough summary organised into short paragraphs. Cover the main arguments, key evidence, figures, and conclusions.",
  },
  {
    id: "bullets",
    name: "Bullet points",
    instructions: 'Write the summary as a list of concise bullet points, one idea per bullet, each starting with "- ".',
  },
];
