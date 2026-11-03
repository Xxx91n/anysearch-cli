// Layered TOML LLM config tests (issue #38 / #108).
// Covers each layer of cli > env > project > user, the project whitelist,
// env_key indirection, the no-plaintext-secret contract, and the
// cross-provider secret guard on `ans llm set` provider switches (#120).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseLlmFlags,
  parseLlmToml,
  resolveLlmConfig,
  userConfigPath,
  writeUserLlmConfig,
} from "../src/config-llm.js";

function fixture(files: { userToml?: string; projectToml?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "ans-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-proj-"));
  if (files.userToml !== undefined) {
    mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
    writeFileSync(join(home, ".anysearch-cli", "config.toml"), files.userToml);
  }
  if (files.projectToml !== undefined) {
    mkdirSync(join(cwd, ".anysearch"), { recursive: true });
    writeFileSync(join(cwd, ".anysearch", "config.toml"), files.projectToml);
  }
  const warnings: string[] = [];
  const opts = (extra: object = {}) => ({
    home, cwd, env: {} as NodeJS.ProcessEnv, warn: (m: string) => warnings.push(m), ...extra,
  });
  return { home, cwd, warnings, opts };
}

test("user-level file supplies provider/model (layer: user)", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n' });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.model, "claude-sonnet-4-6");
  assert.equal(cfg.sources.provider, "user");
  assert.equal(cfg.sources.model, "user");
});

test("env overrides user file (layer: env)", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n' });
  const cfg = resolveLlmConfig(f.opts({ env: { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" } }));
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "gpt-5");
  assert.equal(cfg.sources.provider, "env");
});

test("project file overrides user file (layer: project)", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-haiku-4-5"\n',
    projectToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n',
  });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.model, "gemini-2.5-flash");
  assert.equal(cfg.sources.provider, "project");
});

test("exported-but-empty env var does not shadow lower layers", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n' });
  const cfg = resolveLlmConfig(f.opts({ env: { ANS_LLM_PROVIDER: "", ANS_LLM_MODEL: "" } }));
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.model, "claude-sonnet-4-6");
  assert.equal(cfg.sources.provider, "user");
});

test("empty --llm flag value does not shadow lower layers", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n' });
  const cfg = resolveLlmConfig(f.opts({ flags: { provider: "" } }));
  assert.equal(cfg.provider, "anthropic");
});

test("writeUserLlmConfig refuses to overwrite a malformed file", () => {
  const f = fixture({ userToml: "[llm\nprovider = broken" });
  assert.throws(() => writeUserLlmConfig({ provider: "openai" }, f.home), /TOML parse failed/);
  // original bytes preserved — env_key etc. not silently dropped
  assert.equal(readFileSync(userConfigPath(f.home), "utf8"), "[llm\nprovider = broken");
});

test("CLI flag beats env which beats project which beats user", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "claude-haiku-4-5"\n',
    projectToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_MODEL: "gpt-5-mini" },
    flags: { provider: "openai" },
  }));
  assert.equal(cfg.provider, "openai"); // flag > everything
  assert.equal(cfg.model, "gpt-5-mini"); // env > project > user
  assert.equal(cfg.sources.provider, "cli");
  assert.equal(cfg.sources.model, "env");
});

test("project whitelist drops security keys with warning", () => {
  const f = fixture({
    projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://evil.example"\napi = "chat"\nenv_key = "AWS_SECRET_ACCESS_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.provider, "openai"); // whitelisted, honored
  assert.equal(cfg.baseUrl, undefined); // NOT whitelisted, ignored
  assert.equal(cfg.api, undefined);
  assert.equal(cfg.envKey, undefined);
  assert.equal(cfg.apiKey, undefined); // env_key dropped -> no secret lookup
  assert.equal(f.warnings.filter(w => w.includes("ignoring")).length, 3);
  assert.ok(f.warnings.some(w => w.includes("project config may only set")));
});

test("env_key indirection: file holds the var NAME, secret comes from env", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MY_CUSTOM_LLM_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { MY_CUSTOM_LLM_KEY: "sk-secret-123" } }));
  assert.equal(cfg.envKey, "MY_CUSTOM_LLM_KEY");
  assert.equal(cfg.apiKey, "sk-secret-123");
  assert.equal(cfg.sources.apiKey, "user");
});

test("env_key naming an unset var warns and yields no apiKey", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MISSING_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some(w => w.includes("MISSING_KEY")));
});

test("ANS_LLM_API_KEY env wins over file env_key", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MY_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { ANS_LLM_API_KEY: "env-wins", MY_KEY: "file-loses" } }));
  assert.equal(cfg.apiKey, "env-wins");
  assert.equal(cfg.sources.apiKey, "env");
});

test("plaintext secret keys in config files are rejected, never stored", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi_key = "sk-plaintext"\n',
  });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some(w => w.includes("secrets never go in config files")));
  // and the secret value never surfaces anywhere in the resolved config
  assert.ok(!JSON.stringify(cfg).includes("sk-plaintext"));
});

test("invalid api value is ignored with warning", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://x.example/v1"\napi = "grpc"\n',
  });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.baseUrl, "https://x.example/v1");
  assert.equal(cfg.api, undefined);
  assert.ok(f.warnings.some(w => w.includes("chat|messages|responses")));
});

test("invalid api at a higher layer falls through to a valid lower layer", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://x.example/v1"\napi = "chat"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { ANS_LLM_API: "grpc" } }));
  assert.equal(cfg.api, "chat"); // env's invalid value warned + skipped, user wins
  assert.equal(cfg.sources.api, "user");
  assert.ok(f.warnings.some(w => w.includes("ignoring api=grpc")));
});

test("malformed TOML warns and yields empty config", () => {
  const f = fixture({ userToml: "[llm\nprovider = broken" });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.provider, undefined);
  assert.ok(f.warnings.some(w => w.includes("TOML parse failed")));
});

test("non-string values in [llm] are dropped with warning", () => {
  const f = fixture({ userToml: '[llm]\nprovider = 42\nmodel = "gpt-5"\n' });
  const cfg = resolveLlmConfig(f.opts());
  assert.equal(cfg.provider, undefined);
  assert.equal(cfg.model, "gpt-5");
  assert.ok(f.warnings.some(w => w.includes("non-empty string")));
});

test("project-selected provider differing from user provider blocks the env_key secret", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
    projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { ANTHROPIC_API_KEY: "sk-ant" } }));
  assert.equal(cfg.apiKey, undefined); // blocked, not just warned
  assert.equal(cfg.envKey, undefined);
  assert.ok(f.warnings.some(w => w.includes("refusing to send that secret")));
});

test("project provider with absent user provider keeps env_key verbatim", () => {
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "MY_ANYTHING_KEY"\n',
    projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { MY_ANYTHING_KEY: "sk-ok" } }));
  assert.equal(cfg.apiKey, "sk-ok"); // no user.provider → no binding to violate
  assert.equal(cfg.envKey, "MY_ANYTHING_KEY");
});

test("writeUserLlmConfig drops env_key when the provider changes (cross-provider secret)", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "old"\nenv_key = "ANTHROPIC_API_KEY"\n[other]\nx = 1\n',
  });
  const notices: string[] = [];
  const path = writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, f.home, (m) => notices.push(m));
  assert.equal(path, userConfigPath(f.home));
  const raw = readFileSync(path, "utf8");
  assert.ok(!raw.includes("env_key")); // the stale binding is gone from disk
  assert.ok(raw.includes("[other]")); // unrelated sections survive
  assert.ok(raw.includes('provider = "openai"'));
  assert.ok(raw.includes('model = "gpt-5"'));
  // The old provider's key must not reach the new provider via resolution.
  const cfg = resolveLlmConfig(f.opts({ env: { ANTHROPIC_API_KEY: "sk-ant-secret" } }));
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "gpt-5");
  assert.equal(cfg.envKey, undefined);
  assert.equal(cfg.apiKey, undefined);
  assert.ok(notices.some(n => n.includes("provider changed from anthropic to openai")));
});

test("writeUserLlmConfig keeps env_key on a same-provider update", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "old"\nenv_key = "KEEP_ME"\n',
  });
  const notices: string[] = [];
  const path = writeUserLlmConfig({ provider: "anthropic", model: "new" }, f.home, (m) => notices.push(m));
  assert.equal(resolveLlmConfig(f.opts({ env: { KEEP_ME: "k" } })).apiKey, "k");
  assert.equal(resolveLlmConfig(f.opts({ env: { KEEP_ME: "k" } })).envKey, "KEEP_ME");
  assert.ok(readFileSync(path, "utf8").includes("KEEP_ME"));
  assert.equal(notices.length, 0);
});

test("writeUserLlmConfig keeps env_key on a model-only update", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "old"\nenv_key = "KEEP_ME"\n',
  });
  const notices: string[] = [];
  writeUserLlmConfig({ model: "new" }, f.home, (m) => notices.push(m));
  const cfg = resolveLlmConfig(f.opts({ env: { KEEP_ME: "k" } }));
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.model, "new");
  assert.equal(cfg.apiKey, "k");
  assert.equal(notices.length, 0);
});

test("writeUserLlmConfig keeps env_key when the file has no prior provider", () => {
  const f = fixture({ userToml: '[llm]\nenv_key = "MY_ANYTHING_KEY"\n' });
  const notices: string[] = [];
  writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, f.home, (m) => notices.push(m));
  const cfg = resolveLlmConfig(f.opts({ env: { MY_ANYTHING_KEY: "sk-ok" } }));
  assert.equal(cfg.apiKey, "sk-ok"); // no prior binding to violate
  assert.equal(cfg.envKey, "MY_ANYTHING_KEY");
  assert.equal(notices.length, 0);
});

test("writeUserLlmConfig creates the file fresh", () => {
  const f = fixture();
  const path = writeUserLlmConfig({ provider: "google", model: "gemini-2.5-flash" }, f.home);
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.includes('provider = "google"'));
  assert.ok(raw.includes('model = "gemini-2.5-flash"'));
});

test("parseLlmFlags strips --llm.* in both space and = forms", () => {
  const { flags, argv } = parseLlmFlags([
    "what is rrf", "--llm.provider", "openai", "--llm.model=gpt-5", "--llm.base-url", "https://x/v1", "--llm.api=chat",
  ]);
  assert.deepEqual(flags, { provider: "openai", model: "gpt-5", baseUrl: "https://x/v1", api: "chat" });
  assert.deepEqual(argv, ["what is rrf"]);
});

test("parseLlmToml ignores missing [llm] section silently", () => {
  const warnings: string[] = [];
  const out = parseLlmToml('[other]\nx = "y"\n', "user", "/fake/config.toml", (m) => warnings.push(m));
  assert.deepEqual(out, {});
  assert.equal(warnings.length, 0);
});

test("kernel llm-init keeps zero env reads (LlmSession deep-module contract)", () => {
  // AC: kernel 无任何新增 env/env 读取 — the session seam must stay env-free;
  // the loader layer above is the only place env is consulted.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "kernel", "src", "llm-init.ts"),
    "utf8",
  );
  assert.ok(!src.includes("process.env"), "llm-init.ts must not read process.env");
});
