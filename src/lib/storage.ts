import type { Source, Summary } from "../../shared/types";
import { DEFAULT_RULES } from "../../shared/rules";

const KEY = "source-lens:v1";

export interface Workspace {
  sources: Source[];
  summaries: Summary[];
  /** Writing rules, one per entry. */
  rules: string[];
}

export function loadWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Workspace;
    if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.summaries)) return null;
    // Workspaces saved before style rules existed.
    if (!Array.isArray(parsed.rules)) parsed.rules = [...DEFAULT_RULES];
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
  } catch {
    // Storage full or blocked; the session still works, it just won't persist.
  }
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
