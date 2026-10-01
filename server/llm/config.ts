// Chooses the LLM provider from the environment.
//
//   LLM_PROVIDER      anthropic (default) | local
//   ANTHROPIC_*       API key and optional model for the anthropic provider
//   LOCAL_LLM_*       base URL, model and optional key for an OpenAI-compatible server

import type { ProviderId } from "./types.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export type LlmConfig =
  | { provider: "anthropic"; model: string }
  | { provider: "local"; model: string; baseUrl: string; apiKey?: string; timeoutMs: number };

const PROVIDERS: readonly ProviderId[] = ["anthropic", "local"];

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = (env.LLM_PROVIDER?.trim().toLowerCase() || "anthropic") as ProviderId;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`LLM_PROVIDER must be one of ${PROVIDERS.join(", ")} (got "${env.LLM_PROVIDER}").`);
  }
  if (provider === "anthropic") {
    return { provider, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL };
  }

  const baseUrl = env.LOCAL_LLM_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error("LLM_PROVIDER=local needs LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL (see .env.example).");
  }
  const timeoutMs = env.LOCAL_LLM_TIMEOUT_MS ? Number(env.LOCAL_LLM_TIMEOUT_MS) : 15 * 60 * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("LOCAL_LLM_TIMEOUT_MS must be a positive number of milliseconds.");
  return { provider, model, baseUrl, apiKey: env.LOCAL_LLM_API_KEY?.trim() || undefined, timeoutMs };
}
