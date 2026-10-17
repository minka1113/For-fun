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
    rules: [
      "Opens with a one- or two-sentence bottom line",
      "3 to 5 bullet points, most important first",
      "Each bullet is a single sentence of 30 words or fewer",
      "Plain language; spell out acronyms on first use",
      "No more than 200 words",
    ],
  },
  {
    id: "brief",
    name: "Brief",
    instructions: "Write a brief summary: one or two short paragraphs capturing only the most important points.",
    rules: ["One or two paragraphs, no bullet points", "Leads with the single most important finding", "No more than 120 words"],
  },
  {
    id: "detailed",
    name: "Detailed",
    instructions:
      "Write a thorough summary organised into short paragraphs. Cover the main arguments, key evidence, figures, and conclusions.",
    rules: [
      "Paragraphs of no more than 5 sentences",
      'Every figure attributed to its source (e.g. "according to the report")',
      "Where sources disagree, say so explicitly",
      "No more than 600 words",
    ],
  },
  {
    id: "bullets",
    name: "Bullet points",
    instructions: 'Write the summary as a list of concise bullet points, one idea per bullet, each starting with "- ".',
    rules: [
      "5 to 10 bullet points, one idea each",
      "Each bullet is a single sentence of 30 words or fewer",
      "Most important point first",
      "No more than 250 words",
    ],
  },
  {
    id: "outline",
    name: "Summary Outline",
    instructions: [
      "You are summarizing a technical document (such as a proposal, research paper, specification, or report) for a mixed audience of technical and non-technical readers. Your summary should let a busy reader understand what the document said and how it was organized, without reading it.",
      "Produce exactly two parts, in this order, with no title, preamble, or closing remarks.",
      "PART 1: TOP-LINE SUMMARY\nWrite one paragraph of no more than five sentences, and no more than 100 words. Cover all four of the following, combining them into the same sentence where that reads naturally:\n- The purpose of the document or the problem it addressed\n- The methods or approach it described\n- Its key findings or results\n- Its recommendations or asks",
      "Write in plain language that a non-technical reader can follow, while staying precise enough for a technical reader. If a technical term is essential, keep it and add a brief plain-language gloss. Include specific figures or results only when they are central to the document's conclusions. If the document did not contain one of the four elements (for example, no recommendations), do not invent one; state its absence in a few words or leave it out.",
      "PART 2: OUTLINE\nGive an indented outline of the document's structure, using its headers (top level) and subheaders (second level) only. Ignore any deeper levels. The paragraph should open with \u201cThe document outlined the following sections:\u201d followed by the outline. Reproduce headings exactly as they appear in the document, in their original order. List headings only, with no descriptions. Do not include a table of contents as an entry.",
      'If the document has no clear headings, infer its main sections from the content, write each inferred heading as a short noun phrase (for example, "Background on Current System"), and add "[inferred]" after it. Begin the outline with the line "Note: This document had no explicit headings; the sections below were inferred."',
      'TENSE\nWrite the summary entirely in the past tense, describing the document as something that has already been written (for example, "The proposal argued..." or "The authors found..."). This applies even to findings that remain true and to future plans the document described (for example, "The team planned to launch in Q3"). Headings copied from the document should stay exactly as written; inferred headings should be noun phrases, which avoids any tense.',
      "Before responding, check that Part 1 has five sentences or fewer, that every sentence is in the past tense, and that the outline goes no deeper than two levels.",
    ].join("\n\n"),
    rules: [
      "Exactly two parts, a top-line paragraph then an outline, with no title, preamble, or closing remarks",
      "Top-line paragraph of no more than 5 sentences and no more than 100 words",
      "Top-line paragraph covers purpose, methods, key findings, and recommendations, without inventing any the document lacked",
      "Outline opens with \u201cThe document outlined the following sections:\u201d",
      "Outline lists headings only, no more than two levels deep, with no table of contents entry",
      'Inferred headings are short noun phrases marked "[inferred]"',
    ],
  },
];
