// The iCalendar feed: one all-day event per active task on its next due date, with alerts.
// Calendar apps poll this URL, so reminders reach phones without the app sending anything.

import { addDays, viewTask } from "../shared/dates.js";
import type { Data } from "../shared/types.js";

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join("\r\n ");
}

const compact = (date: string) => date.replace(/-/g, "");

export function buildCalendar(data: Data, today: string, appUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const name = data.settings.homeName || "Home";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//home-maintenance//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(`${name} maintenance`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  if (data.settings.timeZone) lines.push(`X-WR-TIMEZONE:${data.settings.timeZone}`);

  for (const task of data.tasks) {
    if (task.archived) continue;
    const view = viewTask(task, data.log, today);
    // An overdue task shows on today, so it keeps appearing until it's done.
    const day = view.status === "overdue" ? today : view.dueDate;
    const summary = view.status === "overdue" ? `Overdue: ${task.name}` : task.name;
    const description = [
      `${task.area}. Due ${view.dueDate}.`,
      view.lastDone ? `Last done ${view.lastDone}.` : "Not done yet.",
      task.notes,
      `Mark it done: ${appUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      // The UID changes with the date, so a calendar shows a fresh event (and fresh alerts) after each completion.
      `UID:${task.id}-${compact(day)}@home-maintenance`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(day)}`,
      `DTEND;VALUE=DATE:${compact(addDays(day, 1))}`,
      `SUMMARY:${escape(summary)}`,
      `DESCRIPTION:${escape(description)}`,
      `CATEGORIES:${escape(task.area)}`,
      "TRANSP:TRANSPARENT",
      `URL:${appUrl}`,
    );
    if (task.leadDays > 0 && view.status !== "overdue") {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escape(`${task.name} is due in ${task.leadDays} day${task.leadDays === 1 ? "" : "s"}`)}`,
        // 9am, leadDays before the (midnight) start of the all-day event.
        task.leadDays === 1 ? "TRIGGER:-PT15H" : `TRIGGER:-P${task.leadDays - 1}DT15H`,
        "END:VALARM",
      );
    }
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escape(summary)}`,
      "TRIGGER:PT9H", // 9am on the day
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
