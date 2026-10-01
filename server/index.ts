// llm/config.js loads .env, so it must be imported before anything reads the environment.
import { getProvider } from "./llm/index.js";
import { app } from "./app.js";
import { loadPacks } from "./packs.js";

const PORT = Number(process.env.PORT ?? 8787);

// Fail at startup, not on the first request, if the provider is misconfigured.
const provider = getProvider();
await loadPacks();
const server = app.listen(PORT, () => {
  console.log(`Source Lens server on http://localhost:${PORT} (${provider.id}: ${provider.model})`);
});
// Converting a long PDF or answering with a large library can take several minutes.
server.requestTimeout = 15 * 60 * 1000;
