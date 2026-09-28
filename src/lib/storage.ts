import type { DraftStyle, Project, Source, Summary } from "../../shared/types";
import { DEFAULT_RULES } from "../../shared/rules";
import { DEFAULT_STYLES } from "../../shared/styles";

const KEY = "source-lens:v1";

export interface Workspace {
  version: 2;
  projects: Project[];
  activeProjectId: string;
  /** Writing rules, one per entry. */
  rules: string[];
  /** Drafting options offered when summarising. */
  styles: DraftStyle[];
}

/** The first version kept one flat list of sources and summaries. */
interface WorkspaceV1 {
  sources: Source[];
  summaries: Summary[];
  rules?: string[];
}

export function newProject(name: string, sources: Source[] = [], summaries: Summary[] = []): Project {
  return { id: uid("proj"), name, question: "", packIds: [], brief: "", sources, summaries, createdAt: Date.now() };
}

export function emptyWorkspace(): Workspace {
  const project = newProject("My first briefing");
  return { version: 2, projects: [project], activeProjectId: project.id, rules: [...DEFAULT_RULES], styles: structuredClone(DEFAULT_STYLES) };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyWorkspace();
    const parsed = JSON.parse(raw) as Workspace | WorkspaceV1;
    if ("version" in parsed && parsed.version === 2 && parsed.projects.length) return parsed;
    const v1 = parsed as WorkspaceV1;
    if (!Array.isArray(v1.sources) || !Array.isArray(v1.summaries)) return emptyWorkspace();
    // Move the old flat workspace into a first project.
    const project = newProject("My first briefing", v1.sources, v1.summaries);
    return {
      version: 2,
      projects: [project],
      activeProjectId: project.id,
      rules: Array.isArray(v1.rules) ? v1.rules : [...DEFAULT_RULES],
      styles: structuredClone(DEFAULT_STYLES),
    };
  } catch {
    return emptyWorkspace();
  }
}

/** Returns false if the browser refused to save (usually because storage is full). */
export function saveWorkspace(ws: Workspace): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
    return true;
  } catch {
    return false;
  }
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
