import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addInterval, describeInterval } from "../shared/dates";
import type { LogEntry, StateResponse, TaskView } from "../shared/types";
import { api } from "./api";
import { DoneModal } from "./components/DoneModal";
import { LibraryModal } from "./components/LibraryModal";
import { TaskModal } from "./components/TaskModal";

type Tab = "upcoming" | "tasks" | "history" | "settings";
type Dialog =
  | { kind: "task"; task: TaskView | null }
  | { kind: "done"; task: TaskView }
  | { kind: "entry"; entry: LogEntry }
  | { kind: "library" }
  | null;

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dueText(t: TaskView): string {
  const n = t.daysUntilDue;
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n < 45) return `Due in ${n} days`;
  return `Due ${formatDate(t.dueDate)}`;
}

export function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [dialog, setDialog] = useState<Dialog>(null);

  const reload = useCallback(() => {
    api.state().then(
      (s) => {
        setState(s);
        setError("");
        // First visit: use this browser's time zone to decide what "today" is.
        if (!s.settings.timeZone) {
          api.saveSettings({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(reload, () => {});
        }
      },
      (e) => setError(e.message),
    );
  }, []);

  useEffect(reload, [reload]);

  const close = useCallback(() => setDialog(null), []);
  const saved = useCallback(() => {
    setDialog(null);
    reload();
  }, [reload]);

  if (!state) return <div className="loading">{error || "Loading…"}</div>;

  const active = state.tasks.filter((t) => !t.archived);
  const overdue = active.filter((t) => t.status === "overdue").length;

  return (
    <div className="app">
      <header className="top">
        <h1>
          <span className="logo" aria-hidden>
            ⌂
          </span>
          {state.settings.homeName}
        </h1>
        <nav>
          {(
            [
              ["upcoming", "Upcoming"],
              ["tasks", "All tasks"],
              ["history", "History"],
              ["settings", "Reminders & settings"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
              {id === "upcoming" && overdue > 0 && <span className="badge">{overdue}</span>}
            </button>
          ))}
        </nav>
      </header>
      {error && <p className="error banner">{error}</p>}

      <main>
        {tab === "upcoming" && <Upcoming tasks={active} today={state.today} setDialog={setDialog} reload={reload} />}
        {tab === "tasks" && <AllTasks tasks={state.tasks} setDialog={setDialog} />}
        {tab === "history" && <History log={state.log} tasks={state.tasks} setDialog={setDialog} />}
        {tab === "settings" && <SettingsView state={state} reload={reload} />}
      </main>

      {dialog?.kind === "task" && <TaskModal task={dialog.task} today={state.today} onClose={close} onSaved={saved} />}
      {dialog?.kind === "done" && <DoneModal task={dialog.task} today={state.today} onClose={close} onSaved={saved} />}
      {dialog?.kind === "entry" && <DoneModal entry={dialog.entry} today={state.today} onClose={close} onSaved={saved} />}
      {dialog?.kind === "library" && <LibraryModal existing={state.tasks} today={state.today} onClose={close} onSaved={saved} />}
    </div>
  );
}

function Upcoming({ tasks, today, setDialog, reload }: { tasks: TaskView[]; today: string; setDialog: (d: Dialog) => void; reload: () => void }) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <h2>Nothing to track yet</h2>
        <p>Start with a list of common jobs (filters, alarms, gutters, water heater…) or add your own.</p>
        <div className="actions">
          <button className="primary" onClick={() => setDialog({ kind: "library" })}>
            Add common tasks
          </button>
          <button onClick={() => setDialog({ kind: "task", task: null })}>New task</button>
        </div>
      </div>
    );
  }

  const groups: [string, TaskView[]][] = [
    ["Overdue", tasks.filter((t) => t.status === "overdue")],
    ["Due soon", tasks.filter((t) => t.status === "due-soon")],
    ["Next 3 months", tasks.filter((t) => t.status === "upcoming" && t.daysUntilDue <= 90)],
    ["Later", tasks.filter((t) => t.status === "upcoming" && t.daysUntilDue > 90)],
  ];

  async function snooze(t: TaskView, days: number) {
    await api.snooze(t.id, addDays(t.dueDate < today ? today : t.dueDate, days));
    reload();
  }

  return (
    <>
      <div className="toolbar">
        <span className="spacer" />
        <button onClick={() => setDialog({ kind: "library" })}>Add common tasks</button>
        <button className="primary" onClick={() => setDialog({ kind: "task", task: null })}>
          New task
        </button>
      </div>
      {groups.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title} className="group">
            <h2>
              {title} <span className="count">{list.length}</span>
            </h2>
            <ul className="tasks">
              {list.map((t) => (
                <li key={t.id} className={`task ${t.status}`}>
                  <div className="main" onClick={() => setDialog({ kind: "task", task: t })}>
                    <strong>{t.name}</strong>
                    <small>
                      <span className="area">{t.area}</span> {describeInterval(t.every, t.unit)}
                      {t.lastDone ? ` · last done ${formatDate(t.lastDone)}` : " · not done yet"}
                      {t.snoozedUntil && t.snoozedUntil === t.dueDate ? " · snoozed" : ""}
                    </small>
                  </div>
                  <span className="due">{dueText(t)}</span>
                  <div className="buttons">
                    {t.status !== "upcoming" && (
                      <select aria-label="Snooze" value="" onChange={(e) => e.target.value && snooze(t, Number(e.target.value))}>
                        <option value="">Snooze…</option>
                        <option value="3">3 days</option>
                        <option value="7">1 week</option>
                        <option value="14">2 weeks</option>
                        <option value="30">1 month</option>
                      </select>
                    )}
                    <button className="primary" onClick={() => setDialog({ kind: "done", task: t })}>
                      ✓ Done
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </>
  );
}

function AllTasks({ tasks, setDialog }: { tasks: TaskView[]; setDialog: (d: Dialog) => void }) {
  const areas = [...new Set(tasks.map((t) => t.area))].sort();
  return (
    <>
      <div className="toolbar">
        <span className="hint">{tasks.length} tasks. Click one to edit, pause or delete it.</span>
        <span className="spacer" />
        <button onClick={() => setDialog({ kind: "library" })}>Add common tasks</button>
        <button className="primary" onClick={() => setDialog({ kind: "task", task: null })}>
          New task
        </button>
      </div>
      {areas.map((area) => (
        <section key={area} className="group">
          <h2>{area}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Repeats</th>
                <th>Last done</th>
                <th>Next due</th>
              </tr>
            </thead>
            <tbody>
              {tasks
                .filter((t) => t.area === area)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <tr key={t.id} className={`clickable${t.archived ? " archived" : ""}`} onClick={() => setDialog({ kind: "task", task: t })}>
                    <td>
                      {t.name}
                      {t.archived && <span className="tag">paused</span>}
                    </td>
                    <td>{describeInterval(t.every, t.unit)}</td>
                    <td>{t.lastDone ? formatDate(t.lastDone) : "—"}</td>
                    <td className={t.archived ? "" : t.status}>{t.archived ? "—" : formatDate(t.dueDate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function History({ log, tasks, setDialog }: { log: LogEntry[]; tasks: TaskView[]; setDialog: (d: Dialog) => void }) {
  const years = useMemo(() => [...new Set(log.map((e) => e.date.slice(0, 4)))].sort().reverse(), [log]);
  const [year, setYear] = useState<string>("all");
  const [taskId, setTaskId] = useState<string>("all");
  const shown = log.filter((e) => (year === "all" || e.date.startsWith(year)) && (taskId === "all" || e.taskId === taskId));
  const total = shown.reduce((sum, e) => sum + (e.cost ?? 0), 0);
  const taskOptions = [...new Map(log.map((e) => [e.taskId, tasks.find((t) => t.id === e.taskId)?.name ?? e.taskName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  if (log.length === 0) {
    return (
      <div className="empty">
        <h2>No history yet</h2>
        <p>Each time you mark a task done it's logged here, with the date, cost, vendor and notes.</p>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Task">
          <option value="all">All tasks</option>
          {taskOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span className="hint">
          {shown.length} entr{shown.length === 1 ? "y" : "ies"} · {money.format(total)} spent
        </span>
        <span className="spacer" />
        <a className="button" href="/api/export.csv">
          Export CSV
        </a>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Task</th>
            <th className="num">Cost</th>
            <th>Vendor</th>
            <th>Notes</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => setDialog({ kind: "entry", entry: e })}>
              <td className="nowrap">{formatDate(e.date)}</td>
              <td>{e.taskName}</td>
              <td className="num">{e.cost == null ? "" : money.format(e.cost)}</td>
              <td>{e.vendor}</td>
              <td className="notes">{e.notes}</td>
              <td>{e.doneBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SettingsView({ state, reload }: { state: StateResponse; reload: () => void }) {
  const [homeName, setHomeName] = useState(state.settings.homeName);
  const [timeZone, setTimeZone] = useState(state.settings.timeZone);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const url = state.settings.calendarUrl;
  const webcal = url.replace(/^https?:/, "webcal:");
  const zones = useMemo(() => (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [], []);

  async function save() {
    try {
      await api.saveSettings({ homeName, timeZone });
      setError("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function regenerate() {
    if (!confirm("Make a new calendar link? Calendars subscribed to the old link stop updating and must be re-subscribed.")) return;
    await api.newCalendarToken();
    reload();
  }

  const nextYear = addInterval(state.today, 1, "year");
  const dueThisYear = state.tasks.filter((t) => !t.archived && t.dueDate < nextYear).length;

  return (
    <div className="settings">
      <section className="card">
        <h2>Calendar reminders</h2>
        <p>
          Subscribe to this calendar on your phone or computer. Each task shows on its due date with an alert at 9am, plus an early alert at 9am the number of days
          before that you set on the task. Overdue tasks move to today until they're done. {dueThisYear} task{dueThisYear === 1 ? " is" : "s are"} due in the
          next 12 months.
        </p>
        <div className="copy">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <div className="howto">
          <div>
            <h3>iPhone, iPad, Mac</h3>
            <p>
              <a href={webcal}>Open in Calendar</a>, or Settings › Calendar › Accounts › Add Account › Other › Add Subscribed Calendar and paste the link. Alerts
              work as long as “Remove alerts” is off.
            </p>
          </div>
          <div>
            <h3>Google Calendar</h3>
            <p>
              On a computer: <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}>add by URL</a>. Google ignores the feed's own
              alerts, so set notifications for this calendar under its settings (e.g. “All-day events: 1 week before at 9am”). Google refreshes subscribed calendars
              every few hours up to a day, so a task you just marked done may linger.
            </p>
          </div>
          <div>
            <h3>Outlook</h3>
            <p>Add calendar › Subscribe from web, and paste the link.</p>
          </div>
        </div>
        <p className="hint">
          Anyone with this link can see your task list, so share it only with your household. <button onClick={regenerate}>Make a new link</button>
        </p>
      </section>

      <section className="card">
        <h2>Home</h2>
        <div className="form">
          <label>
            Name
            <input value={homeName} onChange={(e) => setHomeName(e.target.value)} />
          </label>
          <label>
            Time zone (decides when a task becomes due or overdue)
            {zones.length > 0 ? (
              <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {[...new Set([timeZone, ...zones])].filter(Boolean).map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            ) : (
              <input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
            )}
          </label>
          {error && <p className="error">{error}</p>}
          <footer>
            <span className="spacer" />
            <button className="primary" onClick={save} disabled={homeName === state.settings.homeName && timeZone === state.settings.timeZone}>
              Save
            </button>
          </footer>
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p>
          <a className="button" href="/api/export.csv">
            History as CSV
          </a>{" "}
          <a className="button" href="/api/export.json">
            Everything as JSON
          </a>
        </p>
        <p className="hint">Signed in as {state.me}.</p>
      </section>
    </div>
  );
}
