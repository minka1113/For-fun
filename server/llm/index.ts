import { AnthropicProvider } from "./anthropic.js";
import { type LlmConfig, resolveConfig } from "./config.js";
import { LocalProvider } from "./local.js";
import type { LlmProvider } from "./types.js";

export * from "./types.js";
export { resolveConfig } from "./config.js";

export function createProvider(config: LlmConfig): LlmProvider {
  return config.provider === "local" ? new LocalProvider(config) : new AnthropicProvider(config.model);
}

let current: LlmProvider | null = null;

/** The provider chosen by the environment, created on first use. */
export function getProvider(): LlmProvider {
  current ??= createProvider(resolveConfig());
  return current;
}

/** Replace the provider (tests), or pass null to go back to the environment's choice. */
export function setProvider(provider: LlmProvider | null): void {
  current = provider;
}
