// Knowledge-pack storage under concurrent writes.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../server/app.js";
import { loadPacks, loadPapers } from "../server/packs.js";

let server: Server;
let base: string;

before(async () => {
  await loadPacks();
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("many uploads to one pack at once are all saved", async () => {
  const created = await fetch(`${base}/api/packs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Concurrency test pack" }),
  });
  const pack = (await created.json()) as { id: string };
  try {
    const uploads = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetch(`${base}/api/packs/${pack.id}/papers`, {
          method: "POST",
          headers: { "x-file-name": `paper-${i}.txt`, "content-type": "application/octet-stream" },
          body: `Background paper number ${i}.`,
        }),
      ),
    );
    assert.deepEqual(uploads.map((r) => r.status), Array(10).fill(200));

    // What's on disk matches: reload from the files and count the papers.
    await loadPacks();
    const packs = (await (await fetch(`${base}/api/packs`)).json()) as { id: string; papers: unknown[] }[];
    assert.equal(packs.find((p) => p.id === pack.id)?.papers.length, 10);
  } finally {
    await fetch(`${base}/api/packs/${pack.id}`, { method: "DELETE" });
  }
});

test("corrections to a study copy reach the expert, and deleted papers drop out", async () => {
  const pack = (await (
    await fetch(`${base}/api/packs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cache test pack" }) })
  ).json()) as { id: string };
  try {
    const paper = (await (
      await fetch(`${base}/api/packs/${pack.id}/papers`, { method: "POST", headers: { "x-file-name": "notes.txt" }, body: "First version." })
    ).json()) as { id: string };
    assert.equal((await loadPapers([pack.id]))[0].study, "First version.");

    await fetch(`${base}/api/packs/${pack.id}/papers/${paper.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ study: "Corrected version." }),
    });
    assert.equal((await loadPapers([pack.id]))[0].study, "Corrected version.");
    const detail = (await (await fetch(`${base}/api/packs/${pack.id}/papers/${paper.id}`)).json()) as { study: string };
    assert.equal(detail.study, "Corrected version.");

    await fetch(`${base}/api/packs/${pack.id}/papers/${paper.id}`, { method: "DELETE" });
    assert.deepEqual(await loadPapers([pack.id]), []);
  } finally {
    await fetch(`${base}/api/packs/${pack.id}`, { method: "DELETE" });
  }
});
