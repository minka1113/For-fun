import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../server/llm/config.js";
import { createProvider } from "../server/llm/index.js";

const LOCAL = { LLM_PROVIDER: "local", LOCAL_LLM_BASE_URL: "https://llm.example/v1/", LOCAL_LLM_MODEL: "nemotron" };

test("defaults to Anthropic with the default model", () => {
  assert.deepEqual(resolveConfig({}), { provider: "anthropic", model: "claude-opus-5" });
});

test("ANTHROPIC_MODEL overrides the Anthropic model", () => {
  assert.deepEqual(resolveConfig({ ANTHROPIC_MODEL: "claude-sonnet-5-5" }), { provider: "anthropic", model: "claude-sonnet-5-5" });
});

test("the provider name is case-insensitive", () => {
  assert.equal(resolveConfig({ ...LOCAL, LLM_PROVIDER: " Local " }).provider, "local");
});

test("local config reads the URL, model and key, and trims trailing slashes", () => {
  const config = resolveConfig({ ...LOCAL, LOCAL_LLM_API_KEY: "k" });
  assert.deepEqual(config, { provider: "local", model: "nemotron", baseUrl: "https://llm.example/v1", apiKey: "k", timeoutMs: 900_000 });
});

test("local config needs a base URL and a model", () => {
  assert.throws(() => resolveConfig({ LLM_PROVIDER: "local", LOCAL_LLM_MODEL: "m" }), /LOCAL_LLM_BASE_URL/);
  assert.throws(() => resolveConfig({ LLM_PROVIDER: "local", LOCAL_LLM_BASE_URL: "http://x" }), /LOCAL_LLM_MODEL/);
});

test("rejects an unknown provider and a bad timeout", () => {
  assert.throws(() => resolveConfig({ LLM_PROVIDER: "gpt" }), /LLM_PROVIDER must be one of/);
  assert.throws(() => resolveConfig({ ...LOCAL, LOCAL_LLM_TIMEOUT_MS: "soon" }), /LOCAL_LLM_TIMEOUT_MS/);
});

test("builds the provider the config names", () => {
  const anthropic = createProvider(resolveConfig({}));
  assert.equal(anthropic.id, "anthropic");
  assert.equal(anthropic.capabilities.pdfInput, true);

  const local = createProvider(resolveConfig(LOCAL));
  assert.equal(local.id, "local");
  assert.equal(local.model, "nemotron");
  assert.equal(local.capabilities.pdfInput, false);
  assert.equal(local.credentialsError(), null);
});
