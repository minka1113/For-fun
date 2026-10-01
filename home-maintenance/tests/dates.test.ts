import { test } from "node:test";
import assert from "node:assert/strict";
import { addInterval, dueDate, dueStatus, isDate, nextMonthStart, todayIn, viewTask } from "../shared/dates.js";
import type { LogEntry, Task } from "../shared/types.js";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  name: "Flush water heater",
  area: "Plumbing",
  notes: "",
  every: 1,
  unit: "year",
  startDate: "2026-03-01",
  leadDays: 7,
  snoozedUntil: null,
  archived: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});
const done = (date: string, taskId = "t1"): LogEntry => ({ id: date, taskId, taskName: "x", date, notes: "", cost: null, vendor: "", doneBy: "me", createdAt: date });

test("adds intervals, clamping to shorter months", () => {
  assert.equal(addInterval("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(addInterval("2028-01-31", 1, "month"), "2028-02-29");
  assert.equal(addInterval("2028-02-29", 1, "year"), "2029-02-28");
  assert.equal(addInterval("2026-11-15", 3, "month"), "2027-02-15");
  assert.equal(addInterval("2026-03-07", 2, "week"), "2026-03-21");
  assert.equal(addInterval("2026-03-07", 30, "day"), "2026-04-06");
});

test("validates dates", () => {
  assert.ok(isDate("2026-02-28"));
  assert.ok(!isDate("2026-02-30"));
  assert.ok(!isDate("2026-2-3"));
  assert.ok(!isDate(20260101));
});

test("due date comes from the start date, then the latest completion", () => {
  assert.equal(dueDate(task(), null), "2026-03-01");
  const log = [done("2026-03-04"), done("2025-01-01"), done("2026-05-01", "other")];
  assert.equal(viewTask(task(), log, "2026-06-01").dueDate, "2027-03-04");
  assert.equal(viewTask(task(), log, "2026-06-01").lastDone, "2026-03-04");
});

test("snoozing only ever pushes the date later", () => {
  assert.equal(dueDate(task({ snoozedUntil: "2026-04-01" }), null), "2026-04-01");
  assert.equal(dueDate(task({ snoozedUntil: "2026-02-01" }), null), "2026-03-01");
});

test("status by days until due and lead time", () => {
  assert.equal(dueStatus(-1, 7), "overdue");
  assert.equal(dueStatus(0, 7), "due-soon");
  assert.equal(dueStatus(7, 7), "due-soon");
  assert.equal(dueStatus(8, 7), "upcoming");
  const v = viewTask(task(), [], "2026-03-05");
  assert.equal(v.daysUntilDue, -4);
  assert.equal(v.status, "overdue");
});

test("next start of a month", () => {
  assert.equal(nextMonthStart("2026-10-01", 10), "2026-10-01");
  assert.equal(nextMonthStart("2026-10-15", 10), "2026-10-01");
  assert.equal(nextMonthStart("2026-10-15", 4), "2027-04-01");
  assert.equal(nextMonthStart("2026-10-15", 11), "2026-11-01");
});

test("today depends on the time zone", () => {
  const now = new Date("2026-10-01T03:00:00Z");
  assert.equal(todayIn("UTC", now), "2026-10-01");
  assert.equal(todayIn("America/Los_Angeles", now), "2026-09-30");
  assert.equal(todayIn("Not/AZone", now), "2026-10-01");
});
