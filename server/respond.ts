// Shared route helpers that depend on the active LLM provider.

import type express from "express";
import { getProvider } from "./llm/index.js";

export function hasCredentials(res: express.Response): boolean {
  const problem = getProvider().credentialsError();
  if (!problem) return true;
  res.status(500).json({ error: problem });
  return false;
}

/** A signal that fires if the browser disconnects before the reply is sent, so model calls stop too. */
export function abortOnClose(res: express.Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

/** Map a failure onto a response the client can show. */
export function sendApiError(res: express.Response, err: unknown, action: string): void {
  if (res.destroyed) return; // the browser left; nobody to tell
  console.error(err);
  const known = getProvider().describeError(err);
  if (known) res.status(known.status).json({ error: known.error });
  else res.status(500).json({ error: `Unexpected server error while ${action}.` });
}
