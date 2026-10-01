import type { Template } from "../shared/library";
import type { CompleteInput, LogEntry, StateResponse, Task, TaskInput } from "../shared/types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // An expired ALB login session redirects to Cognito; reload to sign in again.
  if (res.redirected || res.type === "opaqueredirect") {
    location.reload();
    throw new Error("Signing in again…");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  state: () => call<StateResponse>("GET", "/api/state"),
  library: () => call<Template[]>("GET", "/api/library"),
  createTasks: (tasks: TaskInput[]) => call<Task[]>("POST", "/api/tasks", tasks),
  updateTask: (id: string, patch: Partial<TaskInput>) => call<Task>("PUT", `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => call<void>("DELETE", `/api/tasks/${id}`),
  complete: (id: string, input: CompleteInput) => call<LogEntry>("POST", `/api/tasks/${id}/complete`, input),
  snooze: (id: string, until: string | null) => call<Task>("POST", `/api/tasks/${id}/snooze`, { until }),
  updateLog: (id: string, patch: Partial<CompleteInput>) => call<LogEntry>("PUT", `/api/log/${id}`, patch),
  deleteLog: (id: string) => call<void>("DELETE", `/api/log/${id}`),
  saveSettings: (patch: { homeName?: string; timeZone?: string }) => call<void>("PUT", "/api/settings", patch),
  newCalendarToken: () => call<void>("POST", "/api/settings/calendar-token"),
};
