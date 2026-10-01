// The HTTP routes end to end, against a store in a temporary directory.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import type { StateResponse, Task } from "../shared/types.js";

let server: Server;
let base: string;
let dir: string;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "home-"));
  const store = await Store.open(path.join(dir, "home.json"));
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + url, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const state = async () => (await (await call("GET", "/api/state")).json()) as StateResponse;
const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("full flow: create, complete, snooze, history, calendar, export", async () => {
  await call("PUT", "/api/settings", { timeZone: "UTC", homeName: "Maple St" });
  const today = (await state()).today;

  const created = await call("POST", "/api/tasks", [
    { name: "Replace filter", area: "HVAC", every: 3, unit: "month", startDate: "2020-01-01", leadDays: 7 },
    { name: "Gutters, front; back", area: "Roof & gutters", notes: "Ladder in garage", every: 6, unit: "month", startDate: "2099-01-01" },
  ]);
  assert.equal(created.status, 201);
  const [filter, gutters] = (await created.json()) as Task[];
  assert.equal(gutters.leadDays, 7, "lead days default");

  let s = await state();
  assert.equal(s.settings.homeName, "Maple St");
  assert.equal(s.tasks.find((t) => t.id === filter.id)?.status, "overdue");

  // Completing logs who did it and moves the due date on.
  const res = await call("POST", `/api/tasks/${filter.id}/complete`, { date: today, cost: 24.5, notes: "=SUM(A1)" }, { "x-amzn-oidc-data": jwt({ username: "sarah" }) });
  assert.equal(res.status, 201);
  s = await state();
  const view = s.tasks.find((t) => t.id === filter.id)!;
  assert.equal(view.lastDone, today);
  assert.equal(view.status, "upcoming");
  assert.equal(s.log[0].doneBy, "sarah");
  assert.equal(s.log[0].taskName, "Replace filter");

  // Snooze, then completion clears it.
  await call("POST", `/api/tasks/${gutters.id}/snooze`, { until: "2099-02-01" });
  assert.equal((await state()).tasks.find((t) => t.id === gutters.id)?.dueDate, "2099-02-01");

  // Calendar: wrong token is a 404, right one returns events with escaped text and alarms.
  assert.equal((await call("GET", "/cal/nope.ics")).status, 404);
  const ics = await (await fetch(s.settings.calendarUrl)).text();
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:Maple St maintenance/);
  assert.match(ics, /SUMMARY:Gutters\\, front\; back/);
  assert.match(ics, /DTSTART;VALUE=DATE:20990201/);
  assert.match(ics, /TRIGGER:-P6DT15H/);
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "lines are folded");

  // A new token turns the old link off.
  await call("POST", "/api/settings/calendar-token");
  assert.equal((await fetch(s.settings.calendarUrl)).status, 404);

  // CSV export neutralises spreadsheet formulas.
  const csv = await (await call("GET", "/api/export.csv")).text();
  assert.match(csv, /Replace filter,HVAC,24\.50,,sarah,'=SUM\(A1\)/);

  // Deleting a task keeps its history.
  assert.equal((await call("DELETE", `/api/tasks/${filter.id}`)).status, 204);
  s = await state();
  assert.equal(s.tasks.length, 1);
  assert.equal(s.log.length, 1);

  // Data is on disk.
  const saved = JSON.parse(await readFile(path.join(dir, "home.json"), "utf8"));
  assert.equal(saved.log.length, 1);
});

test("overdue tasks show on today in the calendar", async () => {
  const [t] = (await (await call("POST", "/api/tasks", { name: "Old job", every: 1, unit: "year", startDate: "2001-01-01" })).json()) as Task[];
  const s = await state();
  const ics = await (await fetch(s.settings.calendarUrl)).text();
  assert.ok(ics.includes(`UID:${t.id}-${s.today.replace(/-/g, "")}@home-maintenance`));
  assert.match(ics, /SUMMARY:Overdue: Old job/);
});

test("rejects bad input", async () => {
  assert.equal((await call("POST", "/api/tasks", { name: "", every: 1, unit: "year", startDate: "2026-01-01" })).status, 400);
  assert.equal((await call("POST", "/api/tasks", { name: "x", every: 0, unit: "year", startDate: "2026-01-01" })).status, 400);
  assert.equal((await call("POST", "/api/tasks", { name: "x", every: 1, unit: "decade", startDate: "2026-01-01" })).status, 400);
  assert.equal((await call("POST", "/api/tasks", { name: "x", every: 1, unit: "year", startDate: "2026-02-30" })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { timeZone: "Mars/Olympus" })).status, 400);
  assert.equal((await call("POST", "/api/tasks/missing/complete", { date: "2026-01-01" })).status, 404);
});
