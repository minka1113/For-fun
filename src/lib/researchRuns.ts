// Research turns in progress, kept outside React so a turn keeps running (and its progress stays
// visible) when you leave the Research view and come back.

import type { ResearchChatRequest, ResearchState, ResearchUpdates } from "../../shared/types";
import { researchChat } from "./api";
import { applyResearchTurn } from "./research";

export interface ResearchRun {
  statusLines: string[];
  liveText: string;
  startedAt: number;
  /** Set when the last turn for this project ended with an error. */
  error: string | null;
  running: boolean;
}

const IDLE: ResearchRun = { statusLines: [], liveText: "", startedAt: 0, error: null, running: false };
const runs = new Map<string, ResearchRun>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function set(projectId: string, patch: Partial<ResearchRun>): void {
  runs.set(projectId, { ...(runs.get(projectId) ?? IDLE), ...patch });
  listeners.forEach((l) => l());
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current run for a project (a stable object between changes, as useSyncExternalStore needs). */
export function getRun(projectId: string): ResearchRun {
  return runs.get(projectId) ?? IDLE;
}

export function clearRunError(projectId: string): void {
  if (runs.get(projectId)?.error) set(projectId, { error: null });
}

export function stopRun(projectId: string): void {
  controllers.get(projectId)?.abort();
}

/**
 * Start a research turn for a project. `update` applies changes to that project's notebook; it is
 * used for the finished turn, and for whatever was gathered if the turn is stopped or fails.
 */
export async function startRun(
  projectId: string,
  req: ResearchChatRequest,
  update: (fn: (r: ResearchState) => ResearchState) => void,
): Promise<ResearchUpdates | null> {
  if (runs.get(projectId)?.running) return null;
  const controller = new AbortController();
  controllers.set(projectId, controller);
  set(projectId, { statusLines: [], liveText: "", startedAt: Date.now(), error: null, running: true });

  let progress: ResearchUpdates | null = null;
  let partialText = "";
  /** False until the server starts streaming; a request refused outright leaves no reply in the chat. */
  let started = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const lines: string[] = [];
  try {
    const result = await researchChat(
      req,
      {
        onStatus: (line) => {
          started = true;
          lines.push(line);
          set(projectId, { statusLines: [...lines] });
        },
        onText: (t) => {
          started = true;
          partialText += t;
          // Text arrives a few characters at a time; update the screen at most ten times a second.
          flushTimer ??= setTimeout(() => {
            flushTimer = null;
            set(projectId, { liveText: partialText });
          }, 100);
        },
        onProgress: (updates) => {
          started = true;
          progress = updates;
        },
      },
      controller.signal,
    );
    update((r) => applyResearchTurn(r, result));
    set(projectId, { running: false, statusLines: [], liveText: "" });
    return result.updates;
  } catch (e) {
    const stopped = controller.signal.aborted;
    const reason =
      e instanceof TypeError ? "Couldn't reach the server. Check your connection, or reload the page if you were signed out." : (e as Error).message;
    if (!started) {
      // Refused before the turn began (e.g. no API key, wrong provider): just show the error.
      set(projectId, { running: false, statusLines: [], liveText: "", error: stopped ? null : reason });
      return null;
    }
    // Keep whatever this turn found before it ended.
    const note = stopped
      ? "(Stopped. Anything found so far is in the notebook.)"
      : "(This turn was interrupted. Anything found so far is in the notebook; ask me to continue.)";
    const reply = [partialText.trim(), note].filter(Boolean).join("\n\n");
    const saved: ResearchUpdates = progress ?? { candidates: [], findings: [], gaps: [] };
    update((r) =>
      applyResearchTurn(r, {
        parts: [{ text: reply, refs: [] }],
        activity: lines.filter((l) => l !== "Thinking…" && l !== "Continuing…"),
        updates: saved,
        text: reply,
      }),
    );
    set(projectId, { running: false, statusLines: [], liveText: "", error: stopped ? null : reason });
    return saved;
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    controllers.delete(projectId);
  }
}
