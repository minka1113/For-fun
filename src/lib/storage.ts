import type { DraftStyle, Project, RuleSet, Source, Summary } from "../../shared/types";
import { DEFAULT_RULES, DEFAULT_RULE_SET } from "../../shared/rules";
import { DEFAULT_STYLES } from "../../shared/styles";

const KEY = "source-lens:v1";

export interface Workspace {
  version: 3;
  projects: Project[];
  activeProjectId: string;
  /** Named sets of writing rules; each draft follows one. */
  ruleSets: RuleSet[];
  /** Drafting options offered when summarising. */
  styles: DraftStyle[];
}

/** The second version had one global list of rules. */
interface WorkspaceV2 extends Omit<Workspace, "version" | "ruleSets"> {
  version: 2;
  rules: string[];
}

/** The first version kept one flat list of sources and summaries. */
interface WorkspaceV1 {
  sources: Source[];
  summaries: Summary[];
  rules?: string[];
}

/** Copy of a style list (plain object copies; avoids structuredClone, which older Safari lacks). */
export function copyStyles(styles: DraftStyle[]): DraftStyle[] {
  return styles.map((s) => ({ ...s }));
}

export function copyRuleSet(set: RuleSet): RuleSet {
  return { ...set, rules: [...set.rules] };
}

export function newProject(name: string, sources: Source[] = [], summaries: Summary[] = []): Project {
  return { id: uid("proj"), name, question: "", packIds: [], brief: "", sources, summaries, createdAt: Date.now() };
}

export function emptyWorkspace(): Workspace {
  const project = newProject("My first briefing");
  project.defaultRuleSetId = DEFAULT_RULE_SET.id;
  return { version: 3, projects: [project], activeProjectId: project.id, ruleSets: [copyRuleSet(DEFAULT_RULE_SET)], styles: copyStyles(DEFAULT_STYLES) };
}

/** Turn the old single list of rules into a "My rules" set that existing drafts and projects use. */
function fromSingleRuleList(rules: string[], projects: Project[]): Pick<Workspace, "ruleSets" | "projects"> {
  const set: RuleSet = { id: "my-rules", name: "My rules", rules };
  return {
    ruleSets: [set],
    projects: projects.map((p) => ({
      ...p,
      defaultRuleSetId: p.defaultRuleSetId ?? set.id,
      summaries: p.summaries.map((s) => ({ ...s, ruleSetId: s.ruleSetId ?? set.id })),
    })),
  };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyWorkspace();
    const parsed = JSON.parse(raw) as Workspace | WorkspaceV2 | WorkspaceV1;

    if ("version" in parsed && parsed.version === 3 && parsed.projects.length && parsed.ruleSets?.length) return parsed;

    if ("version" in parsed && parsed.version === 2 && parsed.projects.length) {
      const { rules, ...rest } = parsed;
      return { ...rest, version: 3, ...fromSingleRuleList(Array.isArray(rules) ? rules : [...DEFAULT_RULES], parsed.projects) };
    }

    const v1 = parsed as WorkspaceV1;
    if (!Array.isArray(v1.sources) || !Array.isArray(v1.summaries)) return emptyWorkspace();
    // Move the old flat workspace into a first project.
    const project = newProject("My first briefing", v1.sources, v1.summaries);
    return {
      version: 3,
      activeProjectId: project.id,
      styles: copyStyles(DEFAULT_STYLES),
      ...fromSingleRuleList(Array.isArray(v1.rules) ? v1.rules : [...DEFAULT_RULES], [project]),
    };
  } catch {
    return emptyWorkspace();
  }
}

/**
 * The rule set a draft follows: its own, else the project's default, else the first set.
 * `missing` is true when the draft's own set has been deleted.
 */
export function ruleSetFor(ruleSets: RuleSet[], summary: Summary | undefined, project: Project): { set: RuleSet; missing: boolean } {
  const own = summary?.ruleSetId ? ruleSets.find((r) => r.id === summary.ruleSetId) : undefined;
  if (own) return { set: own, missing: false };
  const set = ruleSets.find((r) => r.id === project.defaultRuleSetId) ?? ruleSets[0];
  return { set, missing: Boolean(summary?.ruleSetId) };
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
