// Data shared by the server and the browser. Dates are plain calendar days ("YYYY-MM-DD") with no time zone.

export const UNITS = ["day", "week", "month", "year"] as const;
export type Unit = (typeof UNITS)[number];

export const AREAS = [
  "HVAC",
  "Plumbing",
  "Electrical",
  "Safety",
  "Appliances",
  "Exterior",
  "Roof & gutters",
  "Yard & garden",
  "Interior",
  "Seasonal",
  "Other",
] as const;

export interface Task {
  id: string;
  name: string;
  area: string;
  notes: string;
  /** Repeat every `every` `unit`s after the last time it was done. */
  every: number;
  unit: Unit;
  /** First due date, used until the task has been done once. */
  startDate: string;
  /** Days before the due date to start reminding. */
  leadDays: number;
  /** Pushed back to this date; cleared when the task is next done. */
  snoozedUntil: string | null;
  archived: boolean;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  taskId: string;
  /** Task name when it was done, so the history still reads well if the task is renamed or deleted. */
  taskName: string;
  date: string;
  notes: string;
  cost: number | null;
  vendor: string;
  doneBy: string;
  createdAt: string;
}

export interface Settings {
  homeName: string;
  /** IANA zone used to decide what "today" is for the calendar feed. */
  timeZone: string;
  calendarToken: string;
}

export interface Data {
  tasks: Task[];
  log: LogEntry[];
  settings: Settings;
}

export type DueStatus = "overdue" | "due-soon" | "upcoming";

export interface TaskView extends Task {
  dueDate: string;
  lastDone: string | null;
  status: DueStatus;
  /** Negative when overdue. */
  daysUntilDue: number;
}

export interface StateResponse {
  tasks: TaskView[];
  log: LogEntry[];
  settings: { homeName: string; timeZone: string; calendarUrl: string };
  today: string;
  me: string;
}

export interface TaskInput {
  name: string;
  area: string;
  notes: string;
  every: number;
  unit: Unit;
  startDate: string;
  leadDays: number;
  archived?: boolean;
}

export interface CompleteInput {
  date: string;
  notes?: string;
  cost?: number | null;
  vendor?: string;
}
