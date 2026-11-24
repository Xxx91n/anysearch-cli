import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChat } from "../src/commands/chat.js";

const ENV_KEYS = [
  "HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_PI_SESSION_DIR", "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY",
];

type Binding = { provider: string; endpoint: null; apiKey: string };

async function runChatFixture(opts: { configToml?: string; configDirectory?: boolean; credentials?: string; bindings?: Binding[] }) {
  const home = mkdtempSync(join(tmpdir(), "ans-547-chat-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-547-chat-cwd-"));
  mkdirSync(join(home, ".ans"), { recursive: true });
  if (opts.configDirectory) mkdirSync(join(home, ".ans", "config.toml"));
  else if (opts.configToml !== undefined) writeFileSync(join(home, ".ans", "config.toml"), opts.configToml);
  if (opts.credentials !== undefined) writeFileSync(join(home, ".ans", "credentials.json"), opts.credentials);
  if (opts.bindings !== undefined) {
    writeFileSync(join(home, ".ans", "credentials.json"), JSON.stringify({ bindings: opts.bindings }));
  }

  const savedEnv: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ANS_DB_PATH = ":memory:";
  process.env.ANS_PI_SESSION_DIR = join(cwd, "pi-sessions");

  const previousCwd = process.cwd();
  const realWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  let code = 1;
  process.chdir(cwd);
  (process.stderr as any).write = (chunk: any) => { stderr += String(chunk); return true; };
  try {
    code = await runChat(["-p", "hello"]);
  } finally {
    (process.stderr as any).write = realWrite;
    process.chdir(previousCwd);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return { code, stderr, home };
}

const modelKey = "sk-ant-547-test-000000";
const modelBinding: Binding = { provider: "anthropic", endpoint: null, apiKey: modelKey };

test("broken config names the fault and keeps a stored model key visible", async () => {
  const result = await runChatFixture({ configToml: "[llm\n", bindings: [modelBinding] });
  assert.equal(result.code, 3);
  const faultLine = result.stderr.split("\n").find((line) => line.startsWith("LLM config file is broken"));
  assert.equal(faultLine,
    "LLM config file is broken; provider/model could not be loaded. Fix the config file and try again. " +
    "A model API key is still stored in credentials.json, but it is not in use until the config is fixed.");
  assert.ok(!faultLine?.includes(result.home));
  assert.doesNotMatch(result.stderr, /sk-ant-547-test-000000/);
  assert.doesNotMatch(result.stderr, /anthropic/);
});

test("missing config keeps the existing not-configured message", async () => {
  const result = await runChatFixture({ bindings: [modelBinding] });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /LLM provider not configured/);
  assert.doesNotMatch(result.stderr, /LLM config file is broken/);
  assert.doesNotMatch(result.stderr, /model API key is still stored/);
});

test("broken config with only a search key does not claim a model key remains", async () => {
  const result = await runChatFixture({
    configToml: "[llm\n",
    bindings: [{ provider: "exa", endpoint: null, apiKey: "sk-exa-547-test-000000" }],
  });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /LLM config file is broken/);
  assert.doesNotMatch(result.stderr, /model API key is still stored/);
});

test("broken config with a broken credential file does not guess that a key remains", async () => {
  const result = await runChatFixture({ configToml: "[llm\n", credentials: "{ not json" });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /LLM config file is broken/);
  assert.doesNotMatch(result.stderr, /model API key is still stored/);
});

test("unreadable config names the fault and keeps a stored model key visible", async () => {
  const result = await runChatFixture({ configDirectory: true, bindings: [modelBinding] });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /LLM config file is broken/);
  assert.match(result.stderr, /model API key is still stored/);
  assert.doesNotMatch(result.stderr, /sk-ant-547-test-000000/);
});
