import type { DraftStyle, Project, Source, Summary } from "../../shared/types";
import { DEFAULT_SHARED_RULES } from "../../shared/rules";
import { DEFAULT_STYLES } from "../../shared/styles";

const KEY = "source-lens:v1";

export interface Workspace {
  version: 4;
  projects: Project[];
  activeProjectId: string;
  /** Drafting styles, each with its own writing rules. */
  styles: DraftStyle[];
  /** Rules every style follows, on top of its own. */
  sharedRules: string[];
}

/** Earlier versions: v1 had one flat list of sources and summaries, v2 one global rules list, v3 named rule sets. */
interface WorkspaceV1 {
  sources: Source[];
  summaries: Summary[];
}
interface WorkspaceV2or3 {
  version: 2 | 3;
  projects: Project[];
  activeProjectId: string;
  styles?: Partial<DraftStyle>[];
}

/** Copy of a style list (plain object copies; avoids structuredClone, which older Safari lacks). */
export function copyStyles(styles: DraftStyle[]): DraftStyle[] {
  return styles.map((s) => ({ ...s, rules: [...s.rules] }));
}

export function newProject(name: string, sources: Source[] = [], summaries: Summary[] = []): Project {
  return { id: uid("proj"), name, question: "", packIds: [], brief: "", sources, summaries, createdAt: Date.now() };
}

export function emptyWorkspace(): Workspace {
  const project = newProject("My first briefing");
  return { version: 4, projects: [project], activeProjectId: project.id, styles: copyStyles(DEFAULT_STYLES), sharedRules: [...DEFAULT_SHARED_RULES] };
}

/**
 * Bring older styles and drafts up to date: styles gain their default rules (custom styles start
 * with none), and each draft is linked to the style it was written in, matched by name.
 */
function upgrade(projects: Project[], oldStyles: Partial<DraftStyle>[] | undefined, activeProjectId: string): Workspace {
  const styles: DraftStyle[] = (oldStyles?.length ? oldStyles : DEFAULT_STYLES).map((s) => {
    const builtIn = DEFAULT_STYLES.find((d) => d.id === s.id);
    return {
      id: s.id ?? uid("style"),
      name: s.name ?? builtIn?.name ?? "Untitled style",
      instructions: s.instructions ?? builtIn?.instructions ?? "",
      rules: Array.isArray(s.rules) ? s.rules : [...(builtIn?.rules ?? [])],
    };
  });
  const byName = (name: string) => styles.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return {
    version: 4,
    activeProjectId,
    styles,
    sharedRules: [...DEFAULT_SHARED_RULES],
    projects: projects.map((p) => {
      // Fields from the rule-set version are no longer used.
      const { defaultRuleSetId: _unused, ...project } = p as Project & { defaultRuleSetId?: string };
      return {
        ...project,
        summaries: p.summaries.map((s) => {
          const { ruleSetId: _old, ...summary } = s as Summary & { ruleSetId?: string };
          return { ...summary, styleId: s.styleId ?? byName(s.style)?.id };
        }),
      };
    }),
  };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyWorkspace();
    const parsed = JSON.parse(raw) as Workspace | WorkspaceV2or3 | WorkspaceV1;

    if ("version" in parsed && parsed.version === 4 && parsed.projects.length && parsed.styles?.length) return parsed;
    if ("version" in parsed && (parsed.version === 2 || parsed.version === 3) && parsed.projects.length) {
      return upgrade(parsed.projects, parsed.styles, parsed.activeProjectId);
    }

    const v1 = parsed as WorkspaceV1;
    if (!Array.isArray(v1.sources) || !Array.isArray(v1.summaries)) return emptyWorkspace();
    // Move the old flat workspace into a first project.
    const project = newProject("My first briefing", v1.sources, v1.summaries);
    return upgrade([project], undefined, project.id);
  } catch {
    return emptyWorkspace();
  }
}

/** The style a draft was written in; falls back to the first style if it has been deleted. */
export function styleOf(styles: DraftStyle[], summary: Summary): { style: DraftStyle; missing: boolean } {
  const own = styles.find((s) => s.id === summary.styleId) ?? styles.find((s) => s.name === summary.style);
  return own ? { style: own, missing: false } : { style: styles[0], missing: true };
}

/** All the rules a style's drafts follow: the shared rules, then the style's own. */
export function rulesFor(style: DraftStyle, sharedRules: string[]): string[] {
  return [...sharedRules, ...style.rules.filter((r) => !sharedRules.includes(r))];
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
