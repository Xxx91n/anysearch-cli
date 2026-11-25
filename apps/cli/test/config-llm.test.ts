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
  resolveConfigHome,
  resolveLlmConfig,
  userConfigPath,
  writeUserLlmConfig,
} from "../src/config-llm.js";

function fixture(files: { userToml?: string; projectToml?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "ans-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-proj-"));
  if (files.userToml !== undefined) {
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(join(home, ".ans", "config.toml"), files.userToml);
  }
  if (files.projectToml !== undefined) {
    mkdirSync(join(cwd, ".ans"), { recursive: true });
    writeFileSync(join(cwd, ".ans", "config.toml"), files.projectToml);
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

test("project provider with a non-provider env_key name keeps env_key verbatim", () => {
  // #301 migrated this expectation. The old rule was "no user.provider means no
  // binding, so accept the key regardless of who picked the provider". That left
  // a documented misroute: the file says "use MY_ANYTHING_KEY" and an env or flag
  // change of provider would send it to a different vendor. The new rule binds by
  // the VARIABLE'S NAME when it is a known provider's canonical variable, and
  // keeps the old verbatim behaviour only for names that belong to no provider —
  // which is what MY_ANYTHING_KEY is. So this case still passes, now for a stated
  // reason rather than by omission.
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "MY_ANYTHING_KEY"\n',
    projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { MY_ANYTHING_KEY: "sk-ok" } }));
  assert.equal(cfg.apiKey, "sk-ok");
  assert.equal(cfg.envKey, "MY_ANYTHING_KEY");
});

test("a provider-named env_key with no user provider is bound by its name (#301)", () => {
  // The same shape, but the variable name belongs to anthropic. Selecting another
  // provider must now block it — this is the boundary #301 was asked to decide.
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
    projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { ANTHROPIC_API_KEY: "sk-ant-real" } }));
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.envKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("bound to provider=anthropic")));
  assert.ok(!f.warnings.join("\n").includes("sk-ant-real"), "the warning repeats no key");
});

test("a provider-named env_key still works when the effective provider matches it", () => {
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-ok" },
  }));
  assert.equal(cfg.apiKey, "sk-ant-ok");
  assert.equal(cfg.envKey, "ANTHROPIC_API_KEY");
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

test("writeUserLlmConfig treats an invalid prior provider as absent (keeps env_key)", () => {
  // parseLlmToml drops empty / non-string providers, so they establish no
  // binding and must not cause a valid env_key to be removed (CodeRabbit #124).
  for (const userToml of [
    '[llm]\nprovider = ""\nenv_key = "KEEP_ME"\n',
    '[llm]\nprovider = 42\nenv_key = "KEEP_ME"\n',
  ]) {
    const f = fixture({ userToml });
    const notices: string[] = [];
    const path = writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, f.home, (m) => notices.push(m));
    assert.ok(readFileSync(path, "utf8").includes("KEEP_ME"));
    const cfg = resolveLlmConfig(f.opts({ env: { KEEP_ME: "k" } }));
    assert.equal(cfg.provider, "openai");
    assert.equal(cfg.apiKey, "k");
    assert.equal(cfg.envKey, "KEEP_ME");
    assert.equal(notices.length, 0);
  }
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

// ---------------------------------------------------------------------------
// #301: the user credential file is the third key source, and the provider
// binding now covers the env and CLI-flag layers too (it used to fire only for
// a project-selected provider). These tests run the real stored file, not a
// stand-in: only the home directory differs.
// ---------------------------------------------------------------------------

import { writeUserCredential, userCredentialsPath as credPath } from "../src/config-llm.js";

test("the stored key authenticates the model when NO env variable exists (GUI case)", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-stored-only" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: {} }));
  assert.equal(cfg.apiKey, "sk-stored-only");
  assert.equal(cfg.sources.apiKey, "credentials");
  assert.equal(cfg.provider, "openai");
});

test("an explicit env key beats the stored key", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-stored" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: { ANS_LLM_API_KEY: "sk-env" } }));
  assert.equal(cfg.apiKey, "sk-env");
  assert.equal(cfg.sources.apiKey, "env");
});

test("a stored key bound to another endpoint is refused, not sent", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "http://127.0.0.1:9/v1"\napi = "chat"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-default-endpoint-only" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: {} }));
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")));
  // The warning names the file, never the key.
  assert.ok(!f.warnings.some((w) => w.includes("sk-default-endpoint-only")));
});

test("a stored key for the current endpoint is used", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "http://127.0.0.1:9/v1"\napi = "chat"\n' });
  writeUserCredential({ provider: "openai", endpoint: "http://127.0.0.1:9/v1", apiKey: "sk-for-this-endpoint" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: {} }));
  assert.equal(cfg.apiKey, "sk-for-this-endpoint");
});

test("an env-selected provider differing from the user file blocks env_key too", () => {
  // #120 only covered a PROJECT-selected provider. Choosing the provider from
  // the env would have sent the same anthropic key to openai (#301 acceptance:
  // the binding must cover the layers that can redirect the secret).
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5", ANTHROPIC_API_KEY: "sk-ant" },
  }));
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.envKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different provider")));
});

test("a CLI-flag-selected provider differing from the user file blocks env_key too", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANTHROPIC_API_KEY: "sk-ant" },
    flags: { provider: "google" },
  }));
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different provider")));
});

test("the same provider selected from env keeps env_key working", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "anthropic"\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant" },
  }));
  assert.equal(cfg.apiKey, "sk-ant");
  assert.equal(cfg.envKey, "ANTHROPIC_API_KEY");
});

test("a user-file base_url bound env_key is refused when another layer moves the endpoint", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://user.example/v1"\napi = "chat"\nenv_key = "MY_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_BASE_URL: "https://other.example/v1", MY_KEY: "sk-bound" },
  }));
  assert.equal(cfg.baseUrl, "https://other.example/v1");
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")));
});

test("endpoint 冲突的告警连 --endpoint 一起给，照着跑不会回到同一句（#573）", () => {
  // A binding is (provider, endpoint). Advice that omits --endpoint stores the key
  // against the provider default, and the next run prints this very warning.
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential(
    { provider: "openai", apiKey: "sk-stored", endpoint: "https://a.example/v1" },
    { home: f.home },
  );
  resolveLlmConfig(f.opts({ env: { ANS_LLM_BASE_URL: "https://b.example/v1" } }));
  const warning = f.warnings.find((w) => w.includes("refusing to send that secret to a different endpoint")) ?? "";
  assert.match(warning, /ans auth set openai --endpoint https:\/\/b\.example\/v1/, warning);
});

test("endpoint 冲突的告警不把 URL 里的凭据打出来（#573 审查）", () => {
  // displayEndpoint strips userinfo and the query everywhere else in this warning;
  // the part the user is told to paste must not put them back.
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential(
    { provider: "openai", apiKey: "sk-stored", endpoint: "https://a.example/v1" },
    { home: f.home },
  );
  resolveLlmConfig(f.opts({ env: { ANS_LLM_BASE_URL: "https://user:pw@gw.example/v1?key=secret" } }));
  const warning = f.warnings.find((w) => w.includes("refusing to send that secret to a different endpoint")) ?? "";
  assert.ok(warning, "the warning is printed");
  assert.doesNotMatch(warning, /pw@/, warning);
  assert.doesNotMatch(warning, /key=secret/, warning);
  // And the redacted URL is not handed over as the value to store: that binding
  // would point where the user never meant it to.
  assert.match(warning, /--endpoint "<the endpoint from your config>"/, warning);
});

test("an unset env_key falls through to the stored key instead of stopping", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "NOT_EXPORTED"\n',
  });
  writeUserCredential({ provider: "openai", apiKey: "sk-from-store" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: {} }));
  assert.equal(cfg.apiKey, "sk-from-store");
  assert.equal(cfg.sources.apiKey, "credentials");
  assert.ok(f.warnings.some((w) => w.includes("NOT_EXPORTED") && w.includes("not set")));
});

test("a broken credential file is reported instead of reading as 'no keys'", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  mkdirSync(join(f.home, ".ans"), { recursive: true });
  writeFileSync(credPath(f.home), "{ not json", "utf8");
  const cfg = resolveLlmConfig(f.opts({ env: {} }));
  assert.equal(cfg.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("not valid JSON")));
});

test("credentials:false ignores the file entirely", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-stored" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: {}, credentials: false }));
  assert.equal(cfg.apiKey, undefined);
});

test("the provider's own env var (OPENAI_API_KEY) still wins over the stored key", () => {
  // Without this layer a stored key would be passed as the session's explicit
  // apiKey, pi-ai would skip its own env fallback, and an exported
  // OPENAI_API_KEY would silently stop working (spec S2: 明确环境凭据优先).
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-stored-loses" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: { OPENAI_API_KEY: "sk-env-wins" } }));
  assert.equal(cfg.apiKey, "sk-env-wins");
  assert.equal(cfg.sources.apiKey, "env");
});

test("a provider env var for a DIFFERENT provider is not used", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' });
  writeUserCredential({ provider: "openai", apiKey: "sk-stored-wins" }, { home: f.home });
  const cfg = resolveLlmConfig(f.opts({ env: { ANTHROPIC_API_KEY: "sk-ant-not-for-openai" } }));
  assert.equal(cfg.apiKey, "sk-stored-wins");
  assert.equal(cfg.sources.apiKey, "credentials");
});

test("an unset env_key does not stop the search for the provider's own env var", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "NOT_EXPORTED"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { OPENAI_API_KEY: "sk-provider-env" } }));
  assert.equal(cfg.apiKey, "sk-provider-env");
  assert.equal(cfg.sources.apiKey, "env");
});

test("google's own env name (GEMINI_API_KEY) is recognized as google's key", () => {
  // pi-ai resolves google's key from GEMINI_API_KEY, not GOOGLE_API_KEY. A key
  // entered under that name is still google's, so the binding must recognize it
  // — otherwise an env-chosen provider would receive it.
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "GEMINI_API_KEY"\n',
  });
  const mismatch = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "openai", GEMINI_API_KEY: "gemini-real-key" },
  }));
  assert.equal(mismatch.apiKey, undefined, "a google key is not sent to openai");
  assert.ok(f.warnings.some((w) => w.includes("bound to provider=google")));

  const matching = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "google", ANS_LLM_MODEL: "gemini-2.5-flash", GEMINI_API_KEY: "gemini-real-key" },
  }));
  assert.equal(matching.apiKey, "gemini-real-key");
  assert.equal(matching.envKey, "GEMINI_API_KEY");
});

test("a provider's own env var is picked up under either of its names", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n' });
  const cfg = resolveLlmConfig(f.opts({ env: { GEMINI_API_KEY: "gemini-env" } }));
  assert.equal(cfg.apiKey, "gemini-env");
  assert.equal(cfg.sources.apiKey, "env");
});

test("an explicit user-file provider wins over the variable-name inference", () => {
  // The file names the provider, so that is the binding — the env_key's name is
  // not consulted to override it.
  const f = fixture({
    userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\nenv_key = "OPENAI_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({ env: { OPENAI_API_KEY: "key-for-google" } }));
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.apiKey, "key-for-google", "the file's explicit provider is the binding");
});

test("a key refused by the endpoint binding is not re-read by the provider fallback", () => {
  // Review P1 on PR #333. The user file binds OPENAI_API_KEY to address A; the
  // env moves the endpoint to B. The endpoint guard refuses the key - and then
  // the provider's-own-env layer used to find the very same variable and hand it
  // to B anyway, making the guard decorative.
  const f = fixture({
    userToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://a.example/v1"\napi = "chat"\nenv_key = "OPENAI_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_BASE_URL: "https://b.example/v1", OPENAI_API_KEY: "sk-bound-to-a" },
  }));
  assert.equal(cfg.baseUrl, "https://b.example/v1");
  assert.equal(cfg.apiKey, undefined, "the refused key must not come back from the provider fallback");
  assert.equal(cfg.sources.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")));
  assert.ok(!f.warnings.join("\n").includes("sk-bound-to-a"));
});

test("a provider-refused key name is not re-read either", () => {
  const f = fixture({
    userToml: '[llm]\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "anthropic", ANS_LLM_MODEL: "x", ANTHROPIC_API_KEY: "sk-ant" },
    flags: { provider: "google" },
  }));
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.apiKey, undefined, "a key refused for the provider mismatch stays refused");
});

test("refusing one of google's env names refuses both", () => {
  // GOOGLE_API_KEY and GEMINI_API_KEY are the same secret under two names. The
  // guard used to block only the name the user file wrote, so the other name
  // let the same google key reach the new endpoint (review, second round).
  const f = fixture({
    userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\nbase_url = "https://a.example/v1"\napi = "chat"\nenv_key = "GOOGLE_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: {
      ANS_LLM_BASE_URL: "https://b.example/v1",
      GOOGLE_API_KEY: "google-secret-1",
      GEMINI_API_KEY: "google-secret-1",
    },
  }));
  assert.equal(cfg.baseUrl, "https://b.example/v1");
  assert.equal(cfg.apiKey, undefined, "neither google env name may carry the key to the new endpoint");
  assert.ok(f.warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")));
  assert.ok(!f.warnings.join("\n").includes("google-secret-1"));
});

test("a provider mismatch refuses the key under either of the provider's names", () => {
  const f = fixture({
    userToml: '[llm]\nprovider = "google"\nmodel = "m"\nenv_key = "GOOGLE_API_KEY"\n',
  });
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5", GEMINI_API_KEY: "google-secret-2" },
  }));
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.apiKey, undefined, "the google secret is not re-read under its other name");
});

test("the caller's env decides the config root under either home variable name", () => {
  // A caller that hands in its own env (a test, an MCP call) must get the config
  // file under THAT root. Merging the process env underneath would let the
  // operator's USERPROFILE beat a test's HOME, so the two would disagree about
  // which config.toml is in force.
  for (const homeVar of ["HOME", "USERPROFILE"] as const) {
    const f = fixture({ userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n' });
    const cfg = resolveLlmConfig({
      env: { [homeVar]: f.home } as NodeJS.ProcessEnv,
      cwd: f.cwd,
      warn: (m: string) => f.warnings.push(m),
    });
    assert.equal(cfg.provider, "google", "root taken from " + homeVar);
    assert.equal(cfg.sources.provider, "user");
  }
});

test("an explicit home wins over every environment variable", () => {
  const f = fixture({ userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n' });
  const cfg = resolveLlmConfig({
    home: f.home,
    // A different root that would win if it were consulted.
    env: { HOME: join(f.home, "elsewhere"), USERPROFILE: join(f.home, "elsewhere") },
    cwd: f.cwd,
    warn: (m: string) => f.warnings.push(m),
  });
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.sources.provider, "user");
});

test("read and write resolve the same config root from the same env", () => {
  // The invariant that matters: whatever env a caller injects, the file this
  // resolver reads is the file `ans auth set` writes. Both go through
  // resolveConfigHome with that env, so the only way they can differ is if one of
  // them stops using it - which is what this asserts, without depending on what
  // the test machine's own home contains.
  const f = fixture({ userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n' });
  for (const env of [
    { HOME: f.home },                                   // names a home
    { USERPROFILE: f.home },                             // the Windows spelling
    {},                                                  // names none: both fall through together
  ] as NodeJS.ProcessEnv[]) {
    const cfg = resolveLlmConfig({ env, cwd: f.cwd, warn: (m: string) => f.warnings.push(m) });
    const expectedHome = resolveConfigHome(undefined, env);
    assert.equal(
      userConfigPath(expectedHome),
      join(expectedHome, ".ans", "config.toml"),
      "the resolver used the shared root for " + JSON.stringify(Object.keys(env)),
    );
    if (expectedHome === f.home) {
      assert.equal(cfg.provider, "google", "and it actually read the file under that root");
    }
  }
});

test("an injected env with a home never reads the machine's own config", () => {
  // A caller that injects an env naming a home means that home. Nothing under the
  // real user directory may be consulted, so a test or a GUI host can never pick
  // up a config file the operator happens to have.
  const f = fixture({ userToml: '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n' });
  const cfg = resolveLlmConfig({
    env: { HOME: f.home },
    cwd: f.cwd,
    warn: (m: string) => f.warnings.push(m),
  });
  assert.equal(cfg.provider, "google");
  assert.equal(cfg.sources.provider, "user");
  assert.equal(resolveConfigHome(undefined, { HOME: f.home }), f.home);
});

test("a supplied credential file is used as-is, and the resolver says nothing about the file", () => {
  // #357: doctor and `ans auth status` read the credential file once and pass
  // the result down. A resolver given that result must not read the disk again
  // and must not warn about the file's fault: the caller says it once, in its
  // own words, instead of the two sides having to agree on wording.
  const f = fixture();
  mkdirSync(join(f.home, ".ans"), { recursive: true });
  writeFileSync(join(f.home, ".ans", "credentials.json"), "{ not json", "utf8");

  const supplied = { bindings: [{ provider: "openai", endpoint: null, apiKey: "sk-from-supplied" }] };
  const cfg = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" },
    credentialsFile: supplied,
  }));
  assert.equal(cfg.apiKey, "sk-from-supplied");
  assert.equal(cfg.sources.apiKey, "credentials");
  assert.deepEqual(f.warnings, [], "文件读坏了只报一条，这一条由调用方报；解析器闭嘴");

  // The same broken file with no supplied result is still reported, so the
  // silence above comes from the input and not from a vanished check.
  const ownRead = resolveLlmConfig(f.opts({
    env: { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" },
  }));
  assert.equal(ownRead.apiKey, undefined);
  assert.ok(f.warnings.some((w) => w.includes("not valid JSON")));
});
