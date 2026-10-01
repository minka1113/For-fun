// Calendar-day arithmetic on "YYYY-MM-DD" strings. Everything runs in UTC so no day is lost to DST.

import type { DueStatus, LogEntry, Task, TaskView, Unit } from "./types.js";

const DAY_MS = 86_400_000;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateString(parse(s)) === s;
}

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today in the given IANA time zone (falls back to UTC for an unknown zone). */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return toDateString(now);
  }
}

export function addDays(date: string, days: number): string {
  return toDateString(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Adds an interval. Months and years clamp to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(date: string, every: number, unit: Unit): string {
  if (unit === "day") return addDays(date, every);
  if (unit === "week") return addDays(date, every * 7);
  const d = parse(date);
  const months = unit === "year" ? every * 12 : every;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return toDateString(target);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

/** The 1st of the next occurrence of `month` (1–12) on or after `today`'s month. */
export function nextMonthStart(today: string, month: number): string {
  const t = parse(today);
  let year = t.getUTCFullYear();
  if (month - 1 < t.getUTCMonth()) year += 1;
  return toDateString(new Date(Date.UTC(year, month - 1, 1)));
}

export function lastDoneDate(taskId: string, log: LogEntry[]): string | null {
  let last: string | null = null;
  for (const e of log) if (e.taskId === taskId && (last === null || e.date > last)) last = e.date;
  return last;
}

export function dueDate(task: Task, lastDone: string | null): string {
  const base = lastDone ? addInterval(lastDone, task.every, task.unit) : task.startDate;
  return task.snoozedUntil && task.snoozedUntil > base ? task.snoozedUntil : base;
}

export function dueStatus(daysUntilDue: number, leadDays: number): DueStatus {
  if (daysUntilDue < 0) return "overdue";
  return daysUntilDue <= leadDays ? "due-soon" : "upcoming";
}

export function viewTask(task: Task, log: LogEntry[], today: string): TaskView {
  const lastDone = lastDoneDate(task.id, log);
  const due = dueDate(task, lastDone);
  const daysUntilDue = daysBetween(today, due);
  return { ...task, lastDone, dueDate: due, daysUntilDue, status: dueStatus(daysUntilDue, task.leadDays) };
}

export function describeInterval(every: number, unit: Unit): string {
  if (every === 1) return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  if (unit === "month" && every === 3) return "Quarterly";
  if (unit === "month" && every === 6) return "Twice a year";
  return `Every ${every} ${unit}s`;
}
