# Source Lens

A research workspace for writing briefings you can **check against the original sources, side by side**, with a subject-matter expert helping you focus on what matters.

Add sources, summarise them with Claude, and read the draft next to the source text. Every sentence of the draft is linked to the exact passages it came from (using Claude's [Citations](https://docs.claude.com/en/docs/build-with-claude/citations) feature), so you can verify claims instead of trusting them.

## Features

- **Projects**: one per briefing. Each holds its sources, drafts, research question, attached knowledge packs and expert brief. Switch projects from the top of the sidebar.
- **Sources**: paste text, upload text files or **PDFs** (converted with tables transcribed and figures described), or fetch a web page by URL.
- **Drafting styles**: Executive summary, Brief, Detailed and Bullet points out of the box. Choose **Edit styles…** in the style menu to change their instructions or add your own.
- **Side-by-side comparison**
  - Hover a draft sentence to highlight the source passages behind it; the source pane scrolls to them.
  - Hover a highlighted source passage to see which sentences cite it; click it to jump there.
  - Numbered citation chips jump to each specific quote.
  - Uncited statements get a wavy underline so you know to check them.
  - Per-source **coverage bars** show how much of each source the draft drew on.
- **Review workflow**: pin a claim to see its quotes, then mark it ✓ supported or ⚑ flagged. Keyboard: `j`/`k` next/previous claim, `v` verify, `f` flag, `Esc` unpin.
- **Rule sets**: named sets of plain-English writing rules (e.g. "Policy briefing": past tense, facts only, max 250 words; "Newsletter": plain language, max 150 words). Pick a set from the **Rules** menu next to Summarise (each project has a default), and the draft follows it. **Check style** reviews a draft rule by rule with suggested fixes, and the Style tab can re-check a draft against a different set. Create, duplicate and edit sets with **Manage rule sets…**. Word limits are counted by the app; Claude judges the rest.
- **Editing**: edit any sentence from the Claim tab. Edits and applied fixes keep the sentence's links to the source and send it back to unreviewed.
- **Subject-matter expert** (✦ Expert button on a draft)
  - Draws on the project's **knowledge packs** (your background papers) and on its own trained knowledge, and always labels which: *Library*, *General knowledge* or both. Library citations open the passage in the paper.
  - **Expert review**: ranks the key points in the sources against your brief, tags them (Policy, New, Contradicts, Confirms), shows whether the draft covers each, and suggests edits, cuts and context notes. Key passages are marked in the source pane.
  - **New draft around these priorities** writes a fresh draft built on the ranked key points.
  - **Chat** about the sources, the draft or the field. The expert can propose edits, context notes and key-passage highlights as cards you accept or dismiss.
  - **Context notes** hold background the expert thinks you should know. They never go into the draft; exports can include them in a separate, clearly labelled section.
- **Knowledge library**: create a pack per topic and upload background papers (PDF or text). Each PDF is converted once into a *study copy*: full text, tables transcribed, figures described in words. Open a paper to check its study copy against the original PDF side by side and correct anything wrong. The expert reads the study copies, and can open an original PDF when a figure's detail matters.
- **Export**: a draft or a whole project as Markdown, with each citation as a footnote quoting the source.

## Getting started

Requires Node 20.12+.

```bash
npm install
cp .env.example .env      # then put your Anthropic API key in .env
npm run dev               # web app on http://localhost:5173, API on :8787
```

No key yet? Click **Load example** in the sidebar. It opens an example project with a draft, a style check and an expert review to explore.

For a production build: `npm run build && npm start` (serves the app and API on port 8787).

## Choosing the model

The model that does the work (summaries, style checks, PDF conversion, the expert) is set by `LLM_PROVIDER`:

| `LLM_PROVIDER` | Runs on | Settings |
| --- | --- | --- |
| `anthropic` (default) | Claude | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` |
| `local` | Any OpenAI-compatible chat server (here, the self-hosted Nemotron) | `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, optional `LOCAL_LLM_API_KEY`, `LOCAL_LLM_TIMEOUT_MS` |

`npm run home` starts the app on the home Nemotron model at `llm.roostercoop.tech`, using the settings in `.env.home`. `npm run dev` uses whatever `.env` says (Anthropic unless you set `LLM_PROVIDER`). Values already set in your shell win over both files.

The local model has no citations feature, PDF input or enforced JSON, so the app supplies those itself:

- **Citations**: the model is asked to cite inline with verbatim quotes. Each quote is looked up in the source and dropped if it isn't really there, so a shown citation always points at real text. Statements whose quote can't be verified show as uncited.
- **Structured replies** (style check, expert review): the schema goes in the prompt and the reply is validated, with one retry.
- **PDFs**: text is extracted and marked by page. Tables come out as running text, figures aren't described, and scanned PDFs are rejected. Use the Anthropic provider for PDFs with important tables or figures. The expert's "view original PDF" tool is unavailable.
- **Limits**: the size limits above are set for Claude's large context window. If your local server has a smaller context, big projects fail with the server's error.

## Tests

```bash
npm test            # unit and route tests; no network or API key needed
npm run test:live   # smoke tests against the real home model (slow; needs it running)
```

## Where things are stored

- **Projects, sources, drafts and settings** live in your browser (`localStorage`). Browsers allow a few megabytes; the app warns you if storage fills up.
- **Knowledge packs** live on your computer in the `data/` folder next to the app (not committed to git): original uploads, study copies, and each pack's settings.

## Costs

These are for the Anthropic provider (`claude-opus-5` by default; set `ANTHROPIC_MODEL` to change it). The local model costs nothing per request. Rough guide:

- A draft or style check: a few cents to around 10¢ for typical articles.
- Converting a PDF to a study copy: roughly 20–40¢ per short paper, once.
- Expert review, or the first chat question in a session: roughly $1–2 with two full knowledge packs, less with smaller libraries. Follow-up questions within the hour cost roughly 10–20¢, because the library is cached for an hour.

Every request enables the API's server-side fallback, so if the model declines a request it is retried on a fallback model in the same call.

## How it works

- `server/llm/`: the model providers behind one interface (`types.ts`): `anthropic.ts` (Claude) and `local.ts` (OpenAI-compatible servers), chosen by `config.ts`. Routes never call a vendor SDK directly.
- `server/app.ts`: routes for summarising (plain-text `document` blocks with citations; output split into cited **segments**), style checks (structured outputs), PDF extraction for sources, and URL import.
- `server/expert.ts`: the expert. Papers are labelled `[B1]…` and sources `[S1]…` in document titles, so citations and tool inputs map back reliably. Review uses structured outputs; chat runs a tool loop (`suggest_edit`, `add_context_note`, `mark_key_passage`, `view_original_pdf`) whose actions come back to the browser as suggestion cards. Background papers and sources use one-hour prompt caching.
- `server/index.ts` starts the server. `server/packs.ts` and `server/study.ts`: knowledge-pack storage and the PDF-to-study-copy conversion queue.
- `src/components/CompareView.tsx` and `ExpertPane.tsx`: the side-by-side view and the expert panel. Source text is split at every citation and key-passage boundary (`src/lib/spans.ts`) so overlapping highlights render correctly.
- `shared/`: types, default rules and drafting styles shared by server and browser.

## Limitations

- The expert reads whole study copies, up to about 400,000 words across a project's packs and sources. Larger libraries would need search, which isn't built yet.
- Study copies are made by the model reading the PDF. Check tables and figure descriptions that matter using the paper's side-by-side review screen.
- URL import uses a simple HTML-to-text extractor, so some pages need tidying after import.
