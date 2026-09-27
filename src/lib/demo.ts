// A self-contained example workspace so the comparison view can be explored without an API key.
// Both sources are fictional.

import type { Segment, Source, Summary } from "../../shared/types";

const REPORT = `Riverton Urban Canopy Assessment — Summary Report

Prepared by the Riverton Parks Department, Office of Urban Forestry

Background

Riverton last measured its urban tree canopy in 2014, when trees covered 27 percent of the city's land area. This assessment repeats that study using aerial imagery captured in the summer of the current year, allowing a direct comparison over the intervening decade.

Key findings

Citywide canopy cover has declined to 23 percent, a net loss of roughly 410 acres of tree cover. The losses are not evenly distributed. The three eastern wards, which contain most of the city's industrial land and its oldest housing stock, now average 14 percent canopy, compared with 31 percent in the western wards.

The largest single cause of loss was new construction, which accounted for an estimated 46 percent of removed canopy. Storm damage from the two major windstorms of the past decade accounted for about 22 percent, and the emerald ash borer, which reached the region in 2016, accounted for most of the remainder.

Surface temperature readings taken on the afternoon of the hottest day of the survey period show that blocks with less than 10 percent canopy were on average 7 degrees Fahrenheit hotter than blocks with more than 40 percent canopy.

Recommendations

The Office of Urban Forestry recommends a target of 30 percent citywide canopy by 2040. Reaching this target would require planting approximately 4,000 trees per year, more than double the current rate of about 1,700. Planting should be prioritised in the eastern wards, where heat exposure is greatest.

The report also recommends updating the city's development code so that projects removing mature trees must replace them on site or pay into a dedicated planting fund. Finally, it recommends a dedicated maintenance budget, noting that roughly one in five newly planted street trees currently dies within its first three years, most often from lack of watering.`;

const ARTICLE = `Council Split on Tree Plan as Budget Talks Begin

Riverton Ledger — City Hall desk

A new report showing that Riverton has lost a significant share of its tree cover drew a divided response from city council members on Tuesday, as budget negotiations for the coming fiscal year got under way.

Council member Dana Okafor, who represents the eastern fifth ward, called the findings "a public health issue, not a landscaping issue," and said she would propose redirecting part of the road resurfacing budget to tree planting in the eastern wards.

Others urged caution. Council member Luis Brandt said he supported more planting but questioned the cost of doubling the planting rate. "Before we plant four thousand trees a year, I want to know we can keep the ones we plant alive," Brandt said, pointing to the report's finding on young tree mortality.

The proposed change to the development code drew the sharpest disagreement. Representatives of the Riverton Builders Association told the council that a replacement requirement would add cost to housing at a time when the city is short of it. Supporters of the change countered that the fee would only apply to projects removing mature trees.

The parks department estimated that the full set of recommendations would cost about $2.3 million per year. The council is expected to vote on the budget next month.`;

export const DEMO_SOURCES: Source[] = [
  {
    id: "demo-report",
    title: "Riverton Urban Canopy Assessment",
    text: REPORT,
    origin: "Example source (fictional)",
    addedAt: 0,
  },
  {
    id: "demo-article",
    title: "Council Split on Tree Plan (Riverton Ledger)",
    text: ARTICLE,
    origin: "Example source (fictional)",
    addedAt: 1,
  },
];

type DemoPart = string | [text: string, sourceId: string, ...quotes: string[]];

// Each cited part lists exact quotes; their offsets are looked up in the source text below.
const PARTS: DemoPart[] = [
  [
    "Riverton's tree canopy has fallen from 27 percent of the city's land area in 2014 to 23 percent today, a loss of about 410 acres.",
    "demo-report",
    "Riverton last measured its urban tree canopy in 2014, when trees covered 27 percent of the city's land area.",
    "Citywide canopy cover has declined to 23 percent, a net loss of roughly 410 acres of tree cover.",
  ],
  " ",
  [
    "The loss is concentrated in the eastern wards, which now average 14 percent canopy against 31 percent in the west,",
    "demo-report",
    "The three eastern wards, which contain most of the city's industrial land and its oldest housing stock, now average 14 percent canopy, compared with 31 percent in the western wards.",
  ],
  " ",
  [
    "and the least-shaded blocks measured about 7°F hotter than the most-shaded ones.",
    "demo-report",
    "blocks with less than 10 percent canopy were on average 7 degrees Fahrenheit hotter than blocks with more than 40 percent canopy.",
  ],
  "\n\n",
  [
    "New construction caused nearly half of the loss, with windstorms and the emerald ash borer responsible for most of the rest.",
    "demo-report",
    "The largest single cause of loss was new construction, which accounted for an estimated 46 percent of removed canopy.",
    "Storm damage from the two major windstorms of the past decade accounted for about 22 percent, and the emerald ash borer, which reached the region in 2016, accounted for most of the remainder.",
  ],
  "\n\n",
  [
    "The parks department recommends reaching 30 percent canopy by 2040, which would mean planting about 4,000 trees a year, more than double today's rate,",
    "demo-report",
    "The Office of Urban Forestry recommends a target of 30 percent citywide canopy by 2040. Reaching this target would require planting approximately 4,000 trees per year, more than double the current rate of about 1,700.",
  ],
  " ",
  [
    "at an estimated cost of $2.3 million a year for the full package.",
    "demo-article",
    "The parks department estimated that the full set of recommendations would cost about $2.3 million per year.",
  ],
  " ",
  // Deliberately uncited, to show how unsupported statements are flagged.
  "Most residents are expected to support the plan once they understand the health benefits.",
  "\n\n",
  [
    "On the council, Dana Okafor framed the findings as a public health issue, while Luis Brandt questioned the cost and pointed to the report's finding that about one in five new street trees dies within three years.",
    "demo-article",
    'called the findings "a public health issue, not a landscaping issue,"',
    "questioned the cost of doubling the planting rate.",
  ],
  " ",
  [
    "",
    "demo-report",
    "roughly one in five newly planted street trees currently dies within its first three years, most often from lack of watering.",
  ],
  [
    " The proposed tree-replacement rule for developers was the most contested item, with builders warning it would raise housing costs.",
    "demo-article",
    "The proposed change to the development code drew the sharpest disagreement.",
    "a replacement requirement would add cost to housing at a time when the city is short of it.",
  ],
];

function buildSegments(): Segment[] {
  const byId = new Map(DEMO_SOURCES.map((s) => [s.id, s]));
  const segments: Segment[] = [];
  for (const part of PARTS) {
    const id = `seg-${segments.length}`;
    if (typeof part === "string") {
      segments.push({ id, text: part, citations: [] });
      continue;
    }
    const [text, sourceId, ...quotes] = part;
    const source = byId.get(sourceId)!;
    const citations = quotes.map((quote) => {
      const start = source.text.indexOf(quote);
      if (start === -1) throw new Error(`Demo quote not found: ${quote}`);
      return { sourceId, start, end: start + quote.length, quote };
    });
    // A part with empty text adds its citations to the previous segment (multi-source claims).
    if (!text && segments.length) segments[segments.length - 1].citations.push(...citations);
    else segments.push({ id, text, citations });
  }
  return segments;
}

export function demoSummary(): Summary {
  return {
    id: "demo-summary",
    title: "Tree canopy loss and the council response",
    sourceIds: DEMO_SOURCES.map((s) => s.id),
    style: "detailed",
    focus: "What did the canopy report find, and how is the council reacting?",
    segments: buildSegments(),
    model: "example",
    createdAt: 0,
    review: {},
    notes: "",
  };
}
