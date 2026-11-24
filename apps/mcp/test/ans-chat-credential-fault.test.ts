// #538 acceptance — ans_chat's CredentialFileNotice reaches the tool return.
//
// The case that motivated the ticket: a broken `~/.ans/credentials.json` left
// the model key unresolved, and the only report was one stderr line plus a
// warning COUNT on the observation. A host that reads `content` or
// `structuredContent` saw a normal chat. Here the failure is driven through the
// registered handler with the real shared resolver pointed at a temp home.
//
// Decisions pinned here:
//   - broken file + another source supplied the key → still reported (both
//     halves). The env key is not evidence that the file is healthy.
//   - broken file + no provider/model at all → the error text carries the
//     sentence, and `structuredContent` stays ABSENT (#204 keeps bare errors
//     bare; the existing failure-semantics suite pins that shape).
//   - a runtime error keeps its `ans_chat error: ` prefix first (#264).
//   - no fault → every key and byte of the previous shape stays put.
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CompositionResult, LlmSession } from "@anysearch-cli/kernel";
import { credentialFileNotice } from "@anysearch-cli/kernel";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { resolveLlmConfig } from "@anysearch-cli/store";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { createMcpToolState, type AnsChatSessionFactory } from "../src/tool-state.js";
import { writeStderr } from "../src/stderr.js";
import { buildAnsChatCancelledResult, withCredentialFileFault, type AnsChatToolResult } from "../src/ans-chat-session.js";

const ENV_KEYS = [
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API",
  "ANS_LLM_API_KEY", "ANS_LLM_CONTEXT_WINDOW", "ANS_DB_PATH", "ANS_PI_SESSION_DIR",
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

const fakeSpan = {
  traceId: "t", spanId: "s", addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: unknown, cb: (span: typeof fakeSpan) => unknown) => cb(fakeSpan), finish: () => {},
};

const USER_TOML = '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n';

interface Fixture {
  home: string;
  cwd: string;
  warnings: string[];
}

function fixture(opts: { userToml?: string; credentials?: string } = {}): Fixture {
  const home = mkdtempSync(join(tmpdir(), "ans-538-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-538-proj-"));
  roots.push(home, cwd);
  mkdirSync(join(home, ".ans"), { recursive: true });
  if (opts.userToml !== undefined) writeFileSync(join(home, ".ans", "config.toml"), opts.userToml, "utf8");
  if (opts.credentials !== undefined) {
    writeFileSync(join(home, ".ans", "credentials.json"), opts.credentials, "utf8");
  }
  process.env.ANS_PI_SESSION_DIR = join(cwd, "pi-sessions");
  process.env.ANS_DB_PATH = join(cwd, "anysearch.db");
  return { home, cwd, warnings: [] };
}

function harness(
  fix: Fixture,
  env: NodeJS.ProcessEnv = {},
  extraEngine: Partial<CompositionResult> = {},
): {
  call: (args?: unknown) => Promise<AnsChatToolResult>;
} {
  const factory: AnsChatSessionFactory = async (opts) => {
    const core = createFauxCore({ provider: opts.provider, models: [{ id: opts.model }] });
    core.setResponses(Array.from({ length: 8 }, () => () => fauxAssistantMessage(fauxText("pong"))));
    // The faux core exposes runtime objects the kernel's LlmSession type does
    // not declare (pi-ai builds them); the handler only drives streamFn/models.
    return {
      model: core.getModel(), streamFn: core.streamSimple, models: core,
      providerName: opts.provider, modelName: opts.model, apiKey: opts.apiKey,
      contextWindow: opts.contextWindow,
    } as unknown as LlmSession;
  };
  const state = createMcpToolState({
    createAnsChatSession: factory,
    // The production resolver with injected roots and env, so no operator file
    // or shell variable can change which case this is.
    resolveLlmConfig: (opts = {}) => {
      const upstreamWarn = opts.warn;
      return resolveLlmConfig({
        ...opts,
        home: fix.home, cwd: fix.cwd, env,
        warn: (m) => { fix.warnings.push(m); upstreamWarn?.(m); },
      });
    },
  });
  const engine = {
    retriever: { search: async () => ({ results: [], answers: [], metadata: {} }) },
    observation: { recordOperation: async (_op: unknown, cb: (span: typeof fakeSpan) => unknown) => cb(fakeSpan) },
    ...extraEngine,
  } as unknown as CompositionResult;
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, fn: (args: unknown) => Promise<unknown>) => {
      handlers[name] = fn;
    },
  } as unknown as McpServer;
  registerAnsChat(server, engine, state);
  const handler = handlers["ans_chat"];
  if (!handler) throw new Error("ans_chat handler not registered");
  return { call: (args: unknown = { message: "hi" }) => handler(args) as Promise<AnsChatToolResult> };
}

function textOf(result: AnsChatToolResult | undefined): string {
  return (result?.content ?? []).map((b) => b.text).join("\n");
}

const NOT_JSON = credentialFileNotice({ kind: "not-json" });

test("a broken credential file is in the answer text and the structured record", async () => {
  const fix = fixture({ userToml: USER_TOML, credentials: "{ not json" });
  const res = await harness(fix).call();

  assert.equal(res?.isError, undefined, "the chat itself still succeeds");
  const text = textOf(res);
  assert.ok(text.startsWith(NOT_JSON.notice + "\n"), "the shared sentence opens the answer: " + text.slice(0, 200));

  const record = res?.structuredContent?.["credentialFileFault"] as typeof NOT_JSON | undefined;
  assert.equal(record?.kind, "not-json", "the classification is the search tools' own");
  assert.equal(record?.notice, NOT_JSON.notice, "one table words every surface");
  assert.deepEqual(record, NOT_JSON, "the record is exactly the kernel's notice, no extra fields");

  // #533's ruling: classification and one generated sentence only. The raw
  // sentence carries the path and can quote the file, so neither half may take
  // it — the whole result is checked, not just the one field.
  assert.ok(!JSON.stringify(res).includes(fix.home), "no path anywhere in the result");
  assert.ok(!JSON.stringify(res).includes("credentials.json"), "the file name is not a field either");

  // The description of the call is unchanged.
  assert.ok(res?.structuredContent?.["usage"], "usage still rides the result");
  assert.ok(res?.structuredContent?.["toolCalls"] !== undefined, "toolCalls still rides the result");
  assert.ok(res?.structuredContent?.["context"] !== undefined, "context still rides the result");
});

test("a healthy (or absent) file changes nothing", async () => {
  const fix = fixture({ userToml: USER_TOML });
  const res = await harness(fix).call();
  const record = res?.structuredContent?.["credentialFileFault"];
  assert.equal(record, undefined, "no fault means no key at all");
  assert.ok(!textOf(res).includes("credential file"), "the answer does not mention a file");
  assert.deepEqual(Object.keys(res?.structuredContent ?? {}).sort(), ["context", "toolCalls", "usage"].sort(),
    "the success shape is the pre-#538 shape");
});

test("an env key does not hide a broken file", async () => {
  // The old silence: because a key was already found, the resolver never read
  // the file, so neither stderr nor the return said anything. Reporting is the
  // decision here — a successful call is exactly when nobody would look.
  const fix = fixture({ userToml: USER_TOML, credentials: "{ not json" });
  const res = await harness(fix, { ANS_LLM_API_KEY: "sk-env-supplied" }).call();

  assert.equal(res?.isError, undefined, "the env key still drives the model");
  const text = textOf(res);
  assert.ok(text.includes(NOT_JSON.notice), "the sentence is in the answer text");
  const record = res?.structuredContent?.["credentialFileFault"] as typeof NOT_JSON | undefined;
  assert.equal(record?.kind, "not-json", "the record is in structuredContent");
  assert.deepEqual(fix.warnings, [], "stderr stays quiet; the return is the report");
});

test("no model configured still names the broken file, and stays a bare error", async () => {
  // The second silence: the failure text sent the user to provider/model and
  // buried the file fix in the log. The sentence joins the error text. The
  // structured half stays absent on purpose — #204's bare-error rule, pinned by
  // failure-semantics.test.ts.
  const fix = fixture({ credentials: "{ not json" });
  const res = await harness(fix).call();

  assert.equal(res?.isError, true, "missing model config is still an error");
  const text = textOf(res);
  assert.ok(text.startsWith("ans_chat: "), "the reason stays first (#264): " + text);
  assert.ok(text.includes("LLM not configured"), "the configuration report is kept: " + text);
  assert.ok(text.includes(NOT_JSON.notice), "the file fault is part of the same answer: " + text);
  assert.equal(res?.structuredContent, undefined, "a bare error stays bare (#204)");
});

test("a runtime error keeps its prefix and still names the file", async () => {
  // The `ans_chat error: ` results are the ones #264's rule governs. A fault
  // must not push the reason off the first line.
  const fix = fixture({ userToml: USER_TOML, credentials: "{ not json" });
  const res = await harness(fix, { ANS_LLM_BASE_URL: "http://127.0.0.1:1/v1" }).call();

  assert.equal(res?.isError, true, "a custom endpoint without its api fails the call");
  const text = textOf(res);
  assert.ok(text.startsWith("ans_chat error: "), "the reason stays first (#264): " + text);
  assert.ok(text.includes("ANS_LLM_API"), "the actionable reason is kept: " + text);
  assert.ok(text.includes(NOT_JSON.notice), "the file fault follows the reason: " + text);
  assert.equal(res?.structuredContent, undefined, "a bare error stays bare (#204)");
});

test("a cancelled result still leads with the cancellation", () => {
  // `buildAnsChatCancelledResult` exists so a content-only host sees "no answer
  // was produced" first. The fault sentence must not displace it.
  const res = withCredentialFileFault(buildAnsChatCancelledResult(), NOT_JSON);
  const text = textOf(res);
  assert.ok(text.startsWith("ans_chat: cancelled"), "the cancellation stays first: " + text);
  assert.ok(text.includes(NOT_JSON.notice), "the file fault still travels: " + text);
  const record = res.structuredContent?.["credentialFileFault"];
  assert.equal((record as { kind?: string } | undefined)?.kind, "not-json");
});

test("a result with no text block degrades to the sentence, never a TypeError", () => {
  // The tool casts the SDK's open result type in; a missing content array must
  // not turn a successful call into a thrown exception.
  const res = withCredentialFileFault({ content: [] } as unknown as AnsChatToolResult, NOT_JSON);
  assert.equal(textOf(res), NOT_JSON.notice);
});

test("an invalid entry is classified without quoting what it held", async () => {
  // The raw structural error names the provider it read from the file; that
  // value can be key-shaped, so only the classification may travel.
  const fix = fixture({
    userToml: USER_TOML,
    credentials: JSON.stringify({ bindings: [{ provider: "sk-live-SECRET", apiKey: "" }] }),
  });
  const res = await harness(fix).call();
  const record = res?.structuredContent?.["credentialFileFault"];
  // A record that cannot be read is its own kind: it is the one fault `ans auth
  // repair` can keep the other keys out of (#537).
  assert.equal((record as { kind?: string } | undefined)?.kind, "invalid-record");
  assert.deepEqual(record, credentialFileNotice({ kind: "invalid-record" }));
  assert.ok(!JSON.stringify(res).includes("SECRET"), "the file's provider value never reaches the result");
});

test("the TOML parse warning keeps its line out of stderr too", async () => {
  // smol-toml quotes the offending line in its message. The handler redacts its
  // stderr writes; this asserts the end-to-end shape a host could capture.
  const fix = fixture({
    userToml: '[llm\napi_key = "sk-live-SECRET-DO-NOT-PRINT"\n',
  });
  const env = { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5", ANS_LLM_API_KEY: "sk-env-key" };
  const realErr = process.stderr.write.bind(process.stderr);
  let err = "";
  const captured = process.stderr as unknown as {
    write: (chunk: unknown, callback?: (error?: Error | null) => void) => boolean;
  };
  captured.write = (chunk, callback) => { err += String(chunk); callback?.(); return true; };
  try {
    const res = await harness(fix, env).call();
    assert.equal(res?.isError, undefined, "env still supplies a usable model");
    assert.ok(fix.warnings.some((w) => w.includes("TOML parse failed")), "the parse fault is still reported");
    assert.ok(!fix.warnings.join("\n").includes("SECRET"), "the resolver's warning does not quote the line");
    assert.ok(!err.includes("SECRET"), "nor does the tool's stderr copy: " + err);
    assert.ok(!JSON.stringify(res).includes("SECRET"), "nor does the tool result");
  } finally {
    captured.write = realErr;
  }
});

test("a dead stderr pipe is swallowed, not fatal", async () => {
  // A parent that closes the pipe sends an asynchronous 'error' event; a
  // try/catch cannot see it. A real Writable reproduces both the success path
  // (listener removed) and the EPIPE path (event swallowed).
  const tick = () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    return promise;
  };

  const healthy = new Writable({ write(_chunk, _enc, callback) { callback(); } });
  writeStderr("ok", healthy);
  await tick();
  assert.equal(healthy.listenerCount("error"), 0, "a successful write removes its listener");

  const broken = new Writable({ write(_chunk, _enc, callback) { callback(new Error("EPIPE")); } });
  assert.doesNotThrow(() => writeStderr("boom", broken));
  await tick();
  assert.equal(broken.listenerCount("error"), 0, "the async error is swallowed and the listener is gone");

  const syncThrow = { once: () => {}, off: () => {}, write: () => { throw new Error("sync EPIPE"); } };
  assert.doesNotThrow(() => writeStderr("sync", syncThrow));
});

test("the fault notice also reaches the consolidate result", async () => {
  // `operation: "consolidate"` returns through the same single exit, so it gets
  // the same two halves without a second wiring site.
  const fix = fixture({ userToml: USER_TOML, credentials: "{ not json" });
  const store = {
    consolidateMemory: async () => ({
      dryRun: false, add: 0, update: 0, noop: 0, gateRejected: 0, llmUnavailable: 0,
      clustersScanned: 0, clustersTriggered: 0, verifyRejected: 0, correctionsIncomplete: 0,
      summariesSuspended: 0, conflicts: 0, budgetRejected: 0,
      scope: { kind: "session", sessionId: "s-538" },
    }),
  } as unknown as CompositionResult["store"];
  const res = await harness(fix, {}, { store }).call({ operation: "consolidate", sessionId: "s-538" });
  assert.ok(textOf(res).includes(NOT_JSON.notice), "the text half carries the sentence");
  const record = res?.structuredContent?.["credentialFileFault"];
  assert.equal((record as { kind?: string } | undefined)?.kind, "not-json",
    "the structured half carries the record");
});
