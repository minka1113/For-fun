import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isDate, todayIn, viewTask } from "../shared/dates.js";
import { LIBRARY } from "../shared/library.js";
import { UNITS, type Data, type LogEntry, type StateResponse, type Task } from "../shared/types.js";
import { buildCalendar } from "./ics.js";
import { type Store, newId, newToken } from "./store.js";

const date = z.string().refine(isDate, "Use a real date (YYYY-MM-DD).");
const text = (max: number) => z.string().trim().max(max);

const taskInput = z.object({
  name: text(120).min(1, "Give the task a name."),
  area: text(60).default("Other"),
  notes: text(4000).default(""),
  every: z.number().int().min(1).max(1000),
  unit: z.enum(UNITS),
  startDate: date,
  leadDays: z.number().int().min(0).max(365).default(7),
  archived: z.boolean().optional(),
});

const completeInput = z.object({
  date,
  notes: text(4000).default(""),
  cost: z.number().min(0).max(10_000_000).nullable().default(null),
  vendor: text(120).default(""),
});

const logInput = completeInput.partial();

const settingsInput = z.object({
  homeName: text(80).min(1).optional(),
  timeZone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone.")
    .optional(),
});

/** The signed-in user, from the claims the ALB adds after Cognito login. The instance only accepts traffic from the ALB. */
function whoIs(req: Request): string {
  const jwt = req.header("x-amzn-oidc-data");
  if (!jwt) return "me";
  try {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return String(claims.username ?? claims.email ?? "me");
  } catch {
    return "me";
  }
}

function today(data: Data): string {
  return todayIn(data.settings.timeZone || "UTC");
}

function origin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function badRequest(res: Response, err: z.ZodError) {
  res.status(400).json({ error: err.issues.map((i) => i.message).join(" ") });
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Leading =+-@ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createApp(store: Store) {
  const app = express();
  app.set("trust proxy", 1); // the ALB
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/state", (req, res) => {
    const data = store.get();
    const now = today(data);
    const body: StateResponse = {
      tasks: data.tasks.map((t) => viewTask(t, data.log, now)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      log: [...data.log].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      settings: {
        homeName: data.settings.homeName,
        timeZone: data.settings.timeZone,
        calendarUrl: `${origin(req)}/cal/${data.settings.calendarToken}.ics`,
      },
      today: now,
      me: whoIs(req),
    };
    res.json(body);
  });

  app.get("/api/library", (_req, res) => {
    res.json(LIBRARY);
  });

  app.post("/api/tasks", async (req, res) => {
    const parsed = z.union([taskInput, z.array(taskInput).max(200)]).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const inputs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const created = await store.update((data) => {
      const tasks: Task[] = inputs.map((input) => ({
        ...input,
        id: newId(),
        snoozedUntil: null,
        archived: input.archived ?? false,
        createdAt: new Date().toISOString(),
      }));
      data.tasks.push(...tasks);
      return tasks;
    });
    res.status(201).json(created);
  });

  app.put("/api/tasks/:id", async (req, res) => {
    const parsed = taskInput.partial().safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const task = await store.update((data) => {
      const t = data.tasks.find((x) => x.id === req.params.id);
      if (t) Object.assign(t, parsed.data);
      return t;
    });
    if (!task) return void res.status(404).json({ error: "No such task." });
    res.json(task);
  });

  // History is kept when a task is deleted; entries keep the task's name.
  app.delete("/api/tasks/:id", async (req, res) => {
    const found = await store.update((data) => {
      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => t.id !== req.params.id);
      return data.tasks.length < before;
    });
    if (!found) return void res.status(404).json({ error: "No such task." });
    res.status(204).end();
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const parsed = completeInput.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const entry = await store.update((data) => {
      const task = data.tasks.find((t) => t.id === req.params.id);
      if (!task) return null;
      task.snoozedUntil = null;
      const e: LogEntry = {
        id: newId(),
        taskId: task.id,
        taskName: task.name,
        ...parsed.data,
        doneBy: whoIs(req),
        createdAt: new Date().toISOString(),
      };
      data.log.push(e);
      return e;
    });
    if (!entry) return void res.status(404).json({ error: "No such task." });
    res.status(201).json(entry);
  });

  app.post("/api/tasks/:id/snooze", async (req, res) => {
    const parsed = z.object({ until: date.nullable() }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const task = await store.update((data) => {
      const t = data.tasks.find((x) => x.id === req.params.id);
      if (t) t.snoozedUntil = parsed.data.until;
      return t;
    });
    if (!task) return void res.status(404).json({ error: "No such task." });
    res.json(task);
  });

  app.put("/api/log/:id", async (req, res) => {
    const parsed = logInput.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const entry = await store.update((data) => {
      const e = data.log.find((x) => x.id === req.params.id);
      if (e) Object.assign(e, parsed.data);
      return e;
    });
    if (!entry) return void res.status(404).json({ error: "No such entry." });
    res.json(entry);
  });

  app.delete("/api/log/:id", async (req, res) => {
    const found = await store.update((data) => {
      const before = data.log.length;
      data.log = data.log.filter((e) => e.id !== req.params.id);
      return data.log.length < before;
    });
    if (!found) return void res.status(404).json({ error: "No such entry." });
    res.status(204).end();
  });

  app.put("/api/settings", async (req, res) => {
    const parsed = settingsInput.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    await store.update((data) => Object.assign(data.settings, parsed.data));
    res.status(204).end();
  });

  // Anyone with the old link loses access to the feed.
  app.post("/api/settings/calendar-token", async (_req, res) => {
    await store.update((data) => {
      data.settings.calendarToken = newToken();
    });
    res.status(204).end();
  });

  app.get("/api/export.csv", (_req, res) => {
    const data = store.get();
    const rows = [["Date", "Task", "Area", "Cost", "Vendor", "Done by", "Notes"]];
    const areas = new Map(data.tasks.map((t) => [t.id, t.area]));
    for (const e of [...data.log].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([e.date, e.taskName, areas.get(e.taskId) ?? "", e.cost == null ? "" : e.cost.toFixed(2), e.vendor, e.doneBy, e.notes]);
    }
    res.type("text/csv").attachment("maintenance-history.csv");
    res.send(rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n");
  });

  app.get("/api/export.json", (_req, res) => {
    const { tasks, log, settings } = store.get();
    res.attachment("home-maintenance.json").json({ tasks, log, settings: { homeName: settings.homeName, timeZone: settings.timeZone } });
  });

  // The calendar feed. Calendar apps can't log in, so the ALB lets /cal/* through and the secret token is the only check.
  app.get("/cal/:file", (req, res) => {
    const data = store.get();
    const expected = Buffer.from(`${data.settings.calendarToken}.ics`);
    const given = Buffer.from(req.params.file);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return void res.status(404).type("text/plain").send("Not found");
    }
    res.set("Cache-Control", "no-store");
    res.type("text/calendar; charset=utf-8").send(buildCalendar(data, today(data), origin(req)));
  });

  const dist = path.resolve(import.meta.dirname, "../dist");
  if (process.env.NODE_ENV === "production" && existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/(api|cal)\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  return app;
}
