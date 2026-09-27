# Source Lens

A research workspace for generating summaries you can **check against the original sources, side by side**.

Add sources, summarise them with Claude, and read the summary next to the source text. Every sentence of the summary is linked to the exact passages it was drawn from (using Claude's [Citations](https://docs.claude.com/en/docs/build-with-claude/citations) feature), so you can verify claims instead of trusting them.

## Features

- **Sources**: paste text, upload text files (`.txt`, `.md`, `.html`…), or fetch a web page by URL.
- **Summaries**: brief, detailed, or bullet-point, across one or many sources, optionally focused on a research question.
- **Side-by-side comparison**
  - Hover a summary sentence to highlight the source passages behind it; the source pane scrolls to them.
  - Hover a highlighted source passage to see which summary sentences cite it; click it to jump there.
  - Numbered citation chips jump to each specific quote.
  - Uncited statements get a wavy underline so you know to check them.
  - Per-source **coverage bars** show how much of each source the summary actually drew on.
  - Draggable divider between the panes.
- **Review workflow**: pin a claim to see its quotes in the inspector, then mark it ✓ supported or ⚑ flagged. Keyboard: `j`/`k` next/previous claim, `v` verify, `f` flag, `Esc` unpin.
- **Compilation**: summaries collect in a notebook with your research notes. Export one summary or the whole notebook as Markdown, with each citation as a footnote quoting the source.
- Everything is stored in your browser (`localStorage`). Nothing is kept on the server.

## Getting started

Requires Node 20.12+.

```bash
npm install
cp .env.example .env      # then put your Anthropic API key in .env
npm run dev               # web app on http://localhost:5173, API on :8787
```

No key yet? Click **Explore an example** to open a pre-built summary of two sample sources and try the comparison view.

For a production build: `npm run build && npm start` (serves the app and API on port 8787).

## How it works

- `server/index.ts`: Express server. `POST /api/summarize` sends each source as a plain-text `document` block with citations enabled, then turns Claude's response into **segments**, each with the character ranges it cites. `POST /api/fetch-url` pulls readable text from a web page.
- `src/components/CompareView.tsx`: the side-by-side view. The source text is split at every citation boundary (`src/lib/spans.ts`) so overlapping citations highlight correctly.
- `shared/types.ts`: types shared by the server and client.

The model defaults to `claude-opus-5` (set `ANTHROPIC_MODEL` to change it). Requests enable the API's server-side fallback, so if the primary model declines a request it is retried on a fallback model in the same call.

## Limitations

- PDFs aren't parsed yet. Copy the text and paste it in.
- URL import uses a simple HTML-to-text extractor, so some pages need tidying after import.
- Selected sources are limited to 600,000 characters per summary.
