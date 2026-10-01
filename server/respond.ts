// Shared route helpers that depend on the active LLM provider.

import type express from "express";
import { getProvider } from "./llm/index.js";

export function hasCredentials(res: express.Response): boolean {
  const problem = getProvider().credentialsError();
  if (!problem) return true;
  res.status(500).json({ error: problem });
  return false;
}

/** Map a failure onto a response the client can show. */
export function sendApiError(res: express.Response, err: unknown, action: string): void {
  console.error(err);
  const known = getProvider().describeError(err);
  if (known) res.status(known.status).json({ error: known.error });
  else res.status(500).json({ error: `Unexpected server error while ${action}.` });
}
