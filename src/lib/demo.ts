// A self-contained example workspace so the comparison view can be explored without an API key.
// Both sources are fictional.

import type { ExpertState, Project, Segment, Source, SourceRef, StyleCheck, Summary } from "../../shared/types";
import { DEFAULT_SHARED_RULES, parseWordLimit } from "../../shared/rules";
import { DEFAULT_STYLES } from "../../shared/styles";

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

// A style check as Claude might return it for the default rules.
function demoStyleCheck(segments: Segment[]): StyleCheck {
  // The rules Claude judges for a Detailed draft: the shared ones, then the style's own (word limits are counted by the app).
  const detailed = DEFAULT_STYLES.find((s) => s.id === "detailed")!;
  const rules = [...DEFAULT_SHARED_RULES, ...detailed.rules.filter((r) => !parseWordLimit(r))];
  const violations = [
    {
      rule: 0,
      quote: "Riverton's tree canopy has fallen from 27 percent",
      explanation: "Present perfect tense (“has fallen”); the rules require past tense.",
      suggestion: "Riverton's tree canopy had fallen from 27 percent",
    },
    {
      rule: 0,
      quote: "which now average 14 percent canopy",
      explanation: "Present tense (“now average”).",
      suggestion: "which averaged 14 percent canopy",
    },
    {
      rule: 0,
      quote: "The parks department recommends reaching 30 percent canopy by 2040, which would mean planting",
      explanation: "Present tense (“recommends”, “would mean”).",
      suggestion: "The parks department recommended reaching 30 percent canopy by 2040, which would have required planting",
    },
    {
      rule: 1,
      quote: "Most residents are expected to support the plan once they understand the health benefits.",
      explanation: "A prediction about public opinion that neither source makes. This is inference, not a fact from the sources.",
      suggestion: "",
    },
  ];
  return {
    checkedAt: Date.UTC(2026, 0, 1),
    rules,
    checkedText: segments.map((s) => s.text).join(""),
    results: [
      { rule: 0, passed: false, note: "Several sentences use present or present perfect tense." },
      { rule: 1, passed: false, note: "One sentence adds a prediction that isn't in the sources; everything else is sourced." },
      { rule: 2, passed: true, note: "All four paragraphs have three sentences or fewer." },
      { rule: 3, passed: true, note: "Figures are attributed to the report or the parks department estimate." },
      { rule: 4, passed: true, note: "The sources don't contradict each other; the council disagreement is described." },
    ],
    violations: violations.map((v, i) => ({ ...v, id: `demo-v${i}` })),
  };
}

function ref(sourceId: string, quote: string): SourceRef {
  const text = DEMO_SOURCES.find((s) => s.id === sourceId)!.text;
  const start = text.indexOf(quote);
  if (start === -1) throw new Error(`Demo quote not found: ${quote}`);
  return { sourceId, start, end: start + quote.length, quote };
}

// An expert review and short chat as the expert might produce them. No knowledge pack is
// attached to the example, so everything rests on general knowledge and is labelled that way.
function demoExpert(): ExpertState {
  const heat = ref("demo-report", "blocks with less than 10 percent canopy were on average 7 degrees Fahrenheit hotter than blocks with more than 40 percent canopy.");
  const mortality = ref("demo-report", "roughly one in five newly planted street trees currently dies within its first three years, most often from lack of watering.");
  return {
    review: {
      reviewedAt: Date.UTC(2026, 0, 1),
      reviewedText: buildSegments().map((s) => s.text).join(""),
      keyPoints: [
        {
          id: "demo-kp0",
          point: "Low-canopy blocks run about 7°F hotter, and low canopy is concentrated in the eastern wards.",
          why: "Heat exposure is a direct public-health risk. The gap falls on the wards with the oldest housing and most industry, which is where the report says planting should be prioritised.",
          tags: ["policy"],
          importance: "high",
          basis: "general",
          source: heat,
          coverage: "covered",
          draftQuote: "and the least-shaded blocks measured about 7°F hotter than the most-shaded ones.",
          background: [],
        },
        {
          id: "demo-kp1",
          point: "About one in five new street trees dies within three years, mostly from lack of watering.",
          why: "Doubling the planting rate without funding watering and maintenance would lose much of the new stock. The draft mentions it only as a council talking point.",
          tags: ["policy", "confirms"],
          importance: "high",
          basis: "general",
          source: mortality,
          coverage: "partial",
          draftQuote: "pointed to the report's finding that about one in five new street trees dies within three years.",
          background: [],
        },
        {
          id: "demo-kp2",
          point: "Developers removing mature trees would have to replace them or pay into a planting fund.",
          why: "Construction caused almost half the loss, so this rule targets the largest cause the city controls directly. It is also the most contested proposal.",
          tags: ["policy", "new"],
          importance: "high",
          basis: "general",
          source: ref("demo-report", "The report also recommends updating the city's development code so that projects removing mature trees must replace them on site or pay into a dedicated planting fund."),
          coverage: "covered",
          draftQuote: "The proposed tree-replacement rule for developers was the most contested item",
          background: [],
        },
        {
          id: "demo-kp3",
          point: "The full set of recommendations would cost about $2.3 million a year.",
          why: "The figure decision-makers need for the budget vote next month.",
          tags: ["policy"],
          importance: "medium",
          basis: "general",
          source: ref("demo-article", "The parks department estimated that the full set of recommendations would cost about $2.3 million per year."),
          coverage: "covered",
          draftQuote: "at an estimated cost of $2.3 million a year for the full package.",
          background: [],
        },
      ],
      lowValue: [
        {
          id: "demo-lv0",
          quote: "with windstorms and the emerald ash borer responsible for most of the rest",
          reason: "Causes the city can't directly control. Worth cutting if you need the words for the maintenance finding.",
        },
      ],
      suggestions: [
        {
          id: "demo-sg0",
          quote: "and the least-shaded blocks measured about 7°F hotter than the most-shaded ones.",
          replacement:
            "and blocks with under 10 percent canopy measured about 7°F hotter than those with over 40 percent; the report found heat exposure greatest in the eastern wards.",
          reason: "Makes the heat finding concrete and ties it to where the report says the city should act.",
          support: ref("demo-report", "Planting should be prioritised in the eastern wards, where heat exposure is greatest."),
        },
      ],
      notes: [
        {
          id: "demo-note0",
          note: "From general knowledge: emerald ash borer kills nearly all untreated ash trees within a few years of arriving, so further ash losses are likely. The report doesn't say how many ash trees remain.",
          basis: "general",
          anchor: { kind: "source", source: ref("demo-report", "the emerald ash borer, which reached the region in 2016") },
          background: [],
          createdAt: 0,
        },
      ],
    },
    highlights: [],
    notes: [
      {
        id: "demo-note1",
        note: "For scale (general knowledge): many US cities have set canopy goals of 30–40 percent, so a 30 percent target by 2040 sits at the modest end.",
        basis: "general",
        anchor: { kind: "draft", quote: "a loss of about 410 acres" },
        background: [],
        createdAt: 0,
      },
    ],
    chat: [
      { id: "demo-m0", role: "user", text: "Is anything important missing from the draft?", createdAt: 0 },
      {
        id: "demo-m1",
        role: "assistant",
        text: "The draft covers the headline loss and the heat gap well, but it under-plays the maintenance problem: about one in five new street trees dies within three years, mostly from lack of watering. I'd give it its own sentence. (Proposed a context note about funded watering programmes.)",
        parts: [
          { text: "The draft covers the headline loss and the heat gap well, but it under-plays the maintenance problem. The report found that ", refs: [] },
          { text: "about one in five new street trees dies within three years, mostly from lack of watering", refs: [{ kind: "source", ...mortality }] },
          {
            text: ". That matters for the planting target: doubling the planting rate without a maintenance budget would lose much of the new stock. I'd give it its own sentence rather than leaving it as a council talking point. From general knowledge, funded watering for young trees is a common fix elsewhere, but that belongs in a context note, not the draft.",
            refs: [],
          },
        ],
        actions: [
          {
            id: "demo-a0",
            status: "pending",
            type: "note",
            note: {
              id: "demo-note2",
              note: "From general knowledge: many cities fund two to three years of watering for newly planted street trees, often through contracts or volunteer programmes, to cut early deaths.",
              basis: "general",
              anchor: { kind: "source", source: mortality },
              background: [],
              createdAt: 0,
            },
          },
        ],
        createdAt: 0,
      },
    ],
    exportNotes: true,
  };
}

export const DEMO_PROJECT_ID = "demo-project";

export function demoProject(): Project {
  return {
    id: DEMO_PROJECT_ID,
    name: "Example: Riverton tree canopy",
    question: "What did the canopy report find, and how is the council reacting?",
    packIds: [],
    brief: "Anything with policy implications, or new information that was not previously known.",
    sources: DEMO_SOURCES,
    summaries: [demoSummary()],
    createdAt: 0,
  };
}

export function demoSummary(): Summary {
  const segments = buildSegments();
  return {
    id: "demo-summary",
    title: "Tree canopy loss and the council response",
    sourceIds: DEMO_SOURCES.map((s) => s.id),
    style: "Detailed",
    styleId: "detailed",
    focus: "What did the canopy report find, and how is the council reacting?",
    segments,
    model: "example",
    createdAt: 0,
    review: {},
    notes: "",
    styleCheck: demoStyleCheck(segments),
    expert: demoExpert(),
  };
}
