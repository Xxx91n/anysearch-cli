// #582 acceptance — a model failure that leaves ans_chat names no secret.
//
// A host keeps `content`: it pastes it into a chat, a bug report, a stored
// transcript. So a setup or run failure must say WHAT went wrong (configuration
// / authentication / runtime) and never carry a key value, an absolute path, a
// configured provider value, or a resolver warning as it was written.
//
// The same rule covers the `anysearch.llm.configError` observation, which lives
// in the database long after the process is gone. stderr is the operator's
// copy: paths stay, keys go.
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLlmConfig } from "@anysearch-cli/store";
import type { CompositionResult, LlmSession } from "@anysearch-cli/kernel";
import type { McpServer } from "@modelcontextprotocol/server";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { formatModelFailure, redactForHost } from "../src/tools/llm-failure.js";
import type { DiagnosticSink } from "../src/stderr.js";
import {
  createMcpToolState,
  type AnsChatSessionFactory,
  type McpToolStateOverrides,
} from "../src/tool-state.js";

/** Unique to this suite: no real key, provider or path shares these strings. */
const KEY = "sk-live-REDACT-582-SENTINEL-0001";
const PROVIDER = "fauxprov582";
const SECRET_PATH = join(tmpdir(), "ans-582-sentinel-home", "config.toml");

const ENV_KEYS = [
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API",
  "ANS_LLM_API_KEY", "ANS_LLM_CONTEXT_WINDOW", "ANS_DB_PATH", "ANS_PI_SESSION_DIR",
  "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
];

const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  saved[key] = process.env[key];
  delete process.env[key];
}
const roots: string[] = [];
test.after(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text: string }>;
}

interface Fixture {
  home: string;
  cwd: string;
  warnings: string[];
}

function fixture(userToml: string): Fixture {
  const home = mkdtempSync(join(tmpdir(), "ans-582-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-582-proj-"));
  roots.push(home, cwd);
  mkdirSync(join(home, ".ans"), { recursive: true });
  writeFileSync(join(home, ".ans", "config.toml"), userToml, "utf8");
  process.env.ANS_PI_SESSION_DIR = join(cwd, "pi-sessions");
  process.env.ANS_DB_PATH = join(cwd, "anysearch.db");
  return { home, cwd, warnings: [] };
}

const HEALTHY_TOML = '[llm]\nprovider = "' + PROVIDER + '"\nmodel = "fauxmodel582"\n';

function captureStderr(): { text(): string; restore(): void } {
  const chunks: string[] = [];
  // The seam `writeStderr` already draws: only `write` is replaced. Named once
  // so the writer below and the restore are the same checked shape.
  const sink = process.stderr as unknown as DiagnosticSink;
  const original = process.stderr.write.bind(process.stderr);
  sink.write = (chunk, callback) => {
    chunks.push(String(chunk));
    callback?.(null);
    return true;
  };
  return { text: () => chunks.join(""), restore: () => { sink.write = original; } };
}

const fakeSpan = {
  traceId: "t", spanId: "s", addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: unknown, cb: (span: typeof fakeSpan) => unknown) => cb(fakeSpan), finish: () => {},
};

function harness(
  fix: Fixture,
  overrides: {
    createAnsChatSession?: AnsChatSessionFactory;
    resolveLlmConfig?: McpToolStateOverrides["resolveLlmConfig"];
    engine?: Partial<CompositionResult>;
  } = {},
): { call: () => Promise<ToolResult>; attrs: Record<string, unknown>[] } {
  const attrs: Record<string, unknown>[] = [];
  const state = createMcpToolState({
    createAnsChatSession: overrides.createAnsChatSession ?? (async (sessionOpts) => {
      const core = createFauxCore({ provider: sessionOpts.provider, models: [{ id: sessionOpts.model }] });
      core.setResponses(Array.from({ length: 8 }, () => () => fauxAssistantMessage(fauxText("pong"))));
      return {
        model: core.getModel(), streamFn: core.streamSimple, models: core,
        providerName: sessionOpts.provider, modelName: sessionOpts.model,
        apiKey: sessionOpts.apiKey, contextWindow: sessionOpts.contextWindow,
      } as unknown as LlmSession;
    }),
    resolveLlmConfig: (resolveOpts = {}) => {
      if (overrides.resolveLlmConfig) return overrides.resolveLlmConfig(resolveOpts);
      const upstreamWarn = resolveOpts.warn;
      return resolveLlmConfig({
        ...resolveOpts,
        home: fix.home, cwd: fix.cwd,
        // The key travels in the injected env, never the operator's shell.
        env: { ANS_LLM_API_KEY: KEY },
        warn: (message) => { fix.warnings.push(message); upstreamWarn?.(message); },
      });
    },
  });
  const engine = {
    retriever: { search: async () => ({ results: [], answers: [], metadata: {} }) },
    observation: {
      recordOperation: async (op: { attributes?: Record<string, unknown> }, cb: (span: typeof fakeSpan) => unknown) => {
        if (op.attributes) attrs.push(op.attributes);
        return cb(fakeSpan);
      },
    },
    ...overrides.engine,
  } as unknown as CompositionResult;
  let handler: ((args: unknown) => Promise<ToolResult>) | undefined;
  const server = {
    registerTool: (name: string, _cfg: unknown, fn: (args: unknown) => Promise<ToolResult>) => {
      if (name === "ans_chat") handler = fn;
    },
  } as unknown as McpServer;
  registerAnsChat(server, engine, state);
  assert.ok(handler, "ans_chat was registered");
  return { call: () => handler!({ message: "hi" }), attrs };
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((block) => block.text).join("\n");
}

function assertNoSentinels(result: ToolResult, where: string): void {
  const text = textOf(result);
  assert.equal(text.includes(KEY), false, where + ": no key value in content");
  assert.equal(text.includes(PROVIDER), false, where + ": no provider value in content");
  assert.equal(text.includes(SECRET_PATH), false, where + ": no absolute path in content");
  assert.equal(text.includes("ans-582-sentinel-home"), false, where + ": no home directory in content");
  const structured = JSON.stringify(result.structuredContent ?? {});
  assert.equal(structured.includes(KEY), false, where + ": no key value in structuredContent");
  assert.equal(structured.includes(PROVIDER), false, where + ": no provider value in structuredContent");
  assert.equal(structured.includes("ans-582-sentinel-home"), false, where + ": no path in structuredContent");
}

test("a model setup failure names the kind of problem and leaks nothing", async () => {
  const fix = fixture(HEALTHY_TOML);
  const stderr = captureStderr();
  try {
    const res = await harness(fix, {
      createAnsChatSession: async () => {
        throw new Error(
          'Unknown LLM provider: "' + PROVIDER + '" while reading ' + SECRET_PATH + " (key " + KEY + ")",
        );
      },
    }).call();

    assert.equal(res.isError, true, "a setup failure is an execution error");
    assert.equal(res.structuredContent, undefined, "a bare error stays bare");
    const text = textOf(res);
    assert.ok(text.startsWith("ans_chat error: "), "the reason stays first: " + text);
    assert.ok(text.includes("model setup failed (configuration problem)"),
      "the answer says it is a configuration problem: " + text);
    assert.ok(text.includes("ans llm"), "the answer says where to fix it: " + text);
    assertNoSentinels(res, "setup failure");
  } finally {
    stderr.restore();
  }
  const log = stderr.text();
  assert.ok(log.includes("ans_chat model setup failed"), "the operator still gets a line: " + log);
  assert.equal(log.includes(KEY), false, "stderr keeps paths but never keys");
  assert.ok(log.includes(SECRET_PATH), "stderr still names the file for the operator");
});

test("a failed model request is classified and leaks nothing", async () => {
  const fix = fixture(HEALTHY_TOML);
  const stderr = captureStderr();
  try {
    const res = await harness(fix, {
      createAnsChatSession: async (sessionOpts) => {
        const core = createFauxCore({ provider: sessionOpts.provider, models: [{ id: sessionOpts.model }] });
        // The provider call itself fails: this is the runtime path, not setup.
        core.setResponses([() => {
          throw new Error("HTTP 401 unauthorized for " + PROVIDER + " at " + SECRET_PATH + " key=" + KEY);
        }]);
        return {
          model: core.getModel(), streamFn: core.streamSimple, models: core,
          providerName: sessionOpts.provider, modelName: sessionOpts.model,
          apiKey: sessionOpts.apiKey, contextWindow: sessionOpts.contextWindow,
        } as unknown as LlmSession;
      },
    }).call();

    assert.equal(res.isError, true, "a failed request is an execution error");
    const text = textOf(res);
    assert.ok(text.startsWith("ans_chat error: "), "the reason stays first: " + text);
    assert.ok(text.includes("model request failed (authentication problem)"),
      "the answer names the authentication problem: " + text);
    assert.ok(text.includes("ans auth"), "the answer says where to fix it: " + text);
    assertNoSentinels(res, "run failure");
  } finally {
    stderr.restore();
  }
  const log = stderr.text();
  assert.equal(log.includes(KEY), false, "stderr keeps paths but never keys");
});

test("a resolver warning quoted in a failure does not reach the host", async () => {
  // The user file holds a plaintext key, so the resolver warns with the file's
  // absolute path. A failure that repeats that sentence must not forward it.
  const fix = fixture(HEALTHY_TOML + 'api_key = "' + KEY + '"\n');
  const stderr = captureStderr();
  try {
    const res = await harness(fix, {
      createAnsChatSession: async () => {
        throw new Error("setup failed after: " + fix.warnings[0]);
      },
    }).call();

    assert.ok(fix.warnings.length > 0, "the resolver warned before the failure");
    const text = textOf(res);
    assert.equal(res.isError, true);
    assert.equal(text.includes("secrets never go in config files"), false,
      "the warning's own words are gone: " + text);
    assert.equal(text.includes("ans-582-sentinel-home"), false, "no path from the warning: " + text);
    assertNoSentinels(res, "warning text");
  } finally {
    stderr.restore();
  }
});

test("a configuration-resolution failure sanitizes content and configError", async () => {
  const fix = fixture(HEALTHY_TOML);
  const stderr = captureStderr();
  try {
    const { call, attrs } = harness(fix, {
      resolveLlmConfig: () => {
        throw new Error("cannot read " + SECRET_PATH + " (key " + KEY + ")");
      },
    });
    const res = await call();

    assert.equal(res.isError, true);
    const text = textOf(res);
    assert.ok(text.includes("config resolution failed"), "the failure kind is kept: " + text);
    assert.equal(text.includes(KEY), false, "no key in content");
    assert.equal(text.includes("ans-582-sentinel-home"), false, "no absolute path in content");

    const configError = attrs[0]?.["anysearch.llm.configError"];
    assert.equal(typeof configError, "string", "the observation still records configError");
    assert.equal(String(configError).includes(KEY), false, "no key in the stored configError");
    assert.equal(String(configError).includes("ans-582-sentinel-home"), false,
      "no absolute path in the stored configError");
    assert.equal(attrs.length, 1, "one observation for the call");
  } finally {
    stderr.restore();
  }
  const log = stderr.text();
  assert.equal(log.includes(KEY), false, "stderr never carries the key");
  assert.ok(log.includes(SECRET_PATH), "stderr keeps the path for the operator");
});

test("a domain stop carries no path in its structured detail", async () => {
  // The one failure branch with real structuredContent: #306 puts the stop
  // reason in `content` AND `structuredContent.domain.detail`, and the reason
  // quotes the TOML file plus the parser's message. Both halves are host text.
  const fix = fixture(HEALTHY_TOML);
  const domainsDir = mkdtempSync(join(tmpdir(), "ans-582-domains-"));
  roots.push(domainsDir);
  const tomlPath = join(domainsDir, "sentinel582.toml");
  writeFileSync(tomlPath, 'name = "sentinel582"\n[rag\nadapter = "none"\n', "utf8");
  const stderr = captureStderr();
  try {
    const res = await harness(fix, {
      engine: { domainName: "sentinel582", domainDeclared: true, domainsDirs: [domainsDir] },
    }).call();

    assert.equal(res.isError, true, "a broken Active Domain stops the run");
    assert.equal(res.structuredContent?.errorKind, "domain-not-established",
      "the machine-readable class is kept");
    const domainRecord = res.structuredContent?.domain;
    const detail = typeof domainRecord === "object" && domainRecord !== null && "detail" in domainRecord
      ? String(domainRecord.detail)
      : "";
    assert.ok(detail.length > 0, "the stop still says why: " + JSON.stringify(domainRecord));
    const text = textOf(res);
    for (const where of [text, detail]) {
      assert.equal(where.includes(domainsDir), false, "no absolute path in the host text");
      assert.equal(where.includes("sentinel582.toml"), false, "no file name in the host text");
    }
  } finally {
    stderr.restore();
  }
  assert.ok(stderr.text().includes(tomlPath), "stderr keeps the whole reason for the operator");
});

test("the kernel's own setup errors are classified as configuration", () => {
  // The real words `createLlmSession` throws (packages/kernel/src/llm-init.ts).
  // A host that reads "runtime problem" for a bad provider name is sent to
  // `ans doctor`, which cannot fix it.
  const setupMessages = [
    'Unknown LLM provider: "faux". Available: anthropic, openai',
    "Model not found: openai/gpt-9",
    "baseUrl requires explicit api kind: chat | messages | responses",
    'ANS_LLM_CONTEXT_WINDOW must be a positive integer token count; got "0"',
  ];
  for (const message of setupMessages) {
    const text = formatModelFailure("setup", message);
    assert.ok(text.includes("(configuration problem)"), message + " -> " + text);
    assert.ok(text.includes("ans llm"), "the fix points at the config: " + text);
  }
  // A provider/model pair is not an absolute path: the model name must survive.
  assert.ok(formatModelFailure("setup", "Model not found: openai/gpt-9").includes("openai/gpt-9"),
    "the model the user must change is still named");
  // A long model id is a name, not key-shaped noise. The handler passes the
  // resolved model, which keeps `flash-preview-09-2025` out of `[redacted]`.
  const longModel = "gemini-2.5-flash-preview-09-2025";
  assert.ok(formatModelFailure("setup", "Model not found: google/" + longModel, { model: longModel })
    .includes(longModel), "a long model id survives the 20+ rule");
  // The variable the user must change is a setting, not key-shaped noise.
  assert.ok(formatModelFailure("setup", 'ANS_LLM_CONTEXT_WINDOW must be a positive integer token count; got "0"')
    .includes("ANS_LLM_CONTEXT_WINDOW"), "the setting to fix is still named");

  assert.ok(formatModelFailure("run", "HTTP 401 unauthorized").includes("(authentication problem)"),
    "401 is an auth answer");
  assert.ok(formatModelFailure("run", "read ECONNRESET").includes("(runtime problem)"),
    "a network fault is neither config nor auth");

  // A file the process cannot read is not a rejected key. The path is gone from
  // the host text, so the hint has to send the reader to permissions.
  const fileAccess = formatModelFailure("setup", "EACCES: permission denied, open '/home/a/.ans/config.toml'");
  assert.ok(fileAccess.includes("(file access problem)"), "EACCES is a file problem: " + fileAccess);
  assert.ok(fileAccess.includes("permissions"), "the fix names permissions: " + fileAccess);

  // A port number is not an HTTP status. `:403` used to read as authenticated.
  assert.ok(formatModelFailure("run", "connect ECONNREFUSED 127.0.0.1:403").includes("(runtime problem)"),
    "a port that happens to be 403 is not auth");
  // The shapes upstream SDKs actually print, not just `HTTP 401`.
  for (const message of [
    "Request failed with status code 401",
    "status code 403",
    '401 {"type":"error","error":{"message":"bad key"}}',
    "invalid x-api-key",
  ]) {
    assert.ok(formatModelFailure("run", message).includes("(authentication problem)"),
      message + " is an auth answer");
  }
});

test("a credentialed base URL never reaches the host", () => {
  const baseUrl = "https://alice:s3cret@llm.internal/v1?token=QUERYSECRET";
  const text = formatModelFailure("run", "POST " + baseUrl + " failed with 500", { baseUrl });
  assert.equal(text.includes("s3cret"), false, "no password in the text: " + text);
  assert.equal(text.includes("alice"), false, "no user name in the text: " + text);
  assert.equal(text.includes("QUERYSECRET"), false, "no query credential in the text: " + text);
  assert.ok(text.includes("[endpoint]"), "the endpoint is named without its credential: " + text);

  // Even when the endpoint is not in the context, URL userinfo never survives.
  const other = redactForHost("POST https://bob:hunter2@other.internal/v1 failed");
  assert.equal(other.includes("hunter2"), false, "userinfo is redacted generically: " + other);

  // A URL's query and fragment are stripped too: a short `token=` value is
  // below the key rules' 8- and 20-character floors.
  const bareUrl = redactForHost("POST https://llm.internal/v1?token=QUERYSECRET#frag failed");
  assert.equal(bareUrl.includes("QUERYSECRET"), false, "no query credential: " + bareUrl);
  assert.equal(bareUrl.includes("#frag"), false, "no fragment: " + bareUrl);
  assert.ok(bareUrl.includes("https://llm.internal/v1"), "the endpoint itself stays readable: " + bareUrl);
});
