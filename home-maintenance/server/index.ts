import path from "node:path";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT ?? 8788);
const DATA_FILE = path.resolve(import.meta.dirname, "../data/home.json");

const store = await Store.open(DATA_FILE);
createApp(store).listen(PORT, () => {
  console.log(`Home maintenance server on http://localhost:${PORT} (data: ${DATA_FILE})`);
});
