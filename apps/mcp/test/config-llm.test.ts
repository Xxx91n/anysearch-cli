// #300 acceptance — CLI and MCP read model config by the same rules.
//
// These tests drive the real ans_chat handler through an injected tool state:
//   - resolveLlmConfig is the SHARED store resolver, pointed at a temp home/cwd
//     so no operator file is touched (#322). This is exactly what production
//     uses; only the two directory roots differ.
//   - createAnsChatSession records the LlmSessionOptions it receives, so the
//     assertions see the config the tool actually handed to the kernel rather
//     than a copy of the resolver logic.
//
// Covered: user TOML, project TOML override, env override, visible per-field
// sources, missing-config report, malformed-TOML report, and the project
// whitelist / provider-secret binding guard. Offline, no network, no build.

import type { McpServer } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { resolveLlmConfig, writeUserCredential } from "@anysearch-cli/store";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { createMcpToolState, type AnsChatSessionFactory } from "../src/tool-state.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

const fakeSpan = {
  traceId: "t", spanId: "s", addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan), finish: () => {},
};

const ENV_KEYS = [
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API",
  "ANS_LLM_API_KEY", "ANS_LLM_CONTEXT_WINDOW", "ANS_DB_PATH", "ANS_PI_SESSION_DIR",
];

// Every temp root this suite creates, removed in main()'s finally (#322/greptile P2).
const createdRoots: string[] = [];

/** A temp home/cwd pair, each with an isolated config root. */
function fixture(userToml?: string, projectToml?: string) {
  const home = mkdtempSync(join(tmpdir(), "ans-300-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-300-proj-"));
  createdRoots.push(home, cwd);
  // #322: chat runs write PI records + a DB; keep both off the operator's home.
  process.env.ANS_PI_SESSION_DIR = join(cwd, "pi-sessions");
  process.env.ANS_DB_PATH = join(cwd, "anysearch.db");
  if (userToml !== undefined) {
    mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
    writeFileSync(join(home, ".anysearch-cli", "config.toml"), userToml);
  }
  if (projectToml !== undefined) {
    mkdirSync(join(cwd, ".anysearch"), { recursive: true });
    writeFileSync(join(cwd, ".anysearch", "config.toml"), projectToml);
  }
  const warnings: string[] = [];
  return { home, cwd, warnings };
}

type SessionOpts = {
  provider: string; model: string; baseUrl?: string;
  api?: string; apiKey?: string; contextWindow?: number;
};

/** Build a handler plus a recorder of the LlmSessionOptions it constructs. */
function harness(
  fix: ReturnType<typeof fixture>,
  env: NodeJS.ProcessEnv = {},
  resolverOverride?: (opts?: any) => any,
) {
  const seen: SessionOpts[] = [];
  const attrs: Record<string, any>[] = [];
  const factory: AnsChatSessionFactory = async (opts) => {
    seen.push({ ...opts });
    // Faux pi-ai core: a well-formed session the runtime actually drives, so a
    // call completes quickly instead of hanging or erroring on a wrong shape.
    const core = createFauxCore({ provider: opts.provider, models: [{ id: opts.model }] });
    // A few responses in hand: the runtime may make more than one model call
    // (summary/re-judge). Match the shared-cache suite instead of starving it.
    core.setResponses(Array.from({ length: 8 }, () => () => fauxAssistantMessage(fauxText("pong"))));
    return {
      model: core.getModel(), streamFn: core.streamSimple, models: core,
      providerName: opts.provider, modelName: opts.model, apiKey: opts.apiKey,
      contextWindow: opts.contextWindow,
    } as any;
  };
  const state = createMcpToolState({
    createAnsChatSession: factory,
    // The production resolver with injected roots — no env leakage from the
    // operator shell, so each case is fully controlled by `env` + TOML files.
    resolveLlmConfig: (opts = {}) => {
      if (resolverOverride) return resolverOverride(opts);
      // Both sides get every warning: the tool's observation collector (opts.warn)
      // and this fixture's assertion recorder.
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
    observation: {
      recordOperation: async (op: any, cb: any) => {
        if (op?.attributes) attrs.push(op.attributes);
        return cb(fakeSpan);
      },
    },
  } as unknown as CompositionResult;
  let handler: ((args: unknown) => Promise<any>) | undefined;
  const server = {
    registerTool: (name: string, _cfg: unknown, fn: (args: unknown) => Promise<any>) => {
      if (name === "ans_chat") handler = fn;
    },
  } as unknown as McpServer;
  registerAnsChat(server, engine, state);
  if (!handler) throw new Error("ans_chat handler not registered");
  return { call: (message = "hi") => handler!({ message }), seen, attrs };
}

function textOf(result: any): string {
  return (result?.content ?? []).map((b: any) => b.text).join("\n");
}

async function main() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    // 1. user TOML alone reaches MCP (the #300 gap: independent MCP saw only env)
    {
      const fix = fixture('[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n');
      const h = harness(fix);
      await h.call();
      assert(h.seen.length === 1, "user TOML: one session was built");
      assert(h.seen[0]?.provider === "anthropic", "user TOML: provider was read by MCP");
      assert(h.seen[0]?.model === "claude-sonnet-4-6", "user TOML: model was read by MCP");
      // Project-unknown (cwd has no .anysearch/config.toml): report the real
      // source as user, never invent a project layer (#300 如实报告).
      assert(h.attrs[0]?.["anysearch.llm.provider.source"] === "user" &&
        h.attrs[0]?.["anysearch.llm.model.source"] === "user",
        "project-unknown: sources name user, no fabricated project provider");
    }

    // 2. project TOML overrides user, same as the CLI
    {
      const fix = fixture(
        '[llm]\nprovider = "anthropic"\nmodel = "claude-haiku-4-5"\n',
        '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n',
      );
      const h = harness(fix);
      await h.call();
      assert(h.seen[0]?.provider === "google", "project TOML overrides user provider on MCP");
      assert(h.seen[0]?.model === "gemini-2.5-flash", "project TOML overrides user model on MCP");
    }

    // 3. env overrides both; sources report WHERE each value came from
    {
      const fix = fixture(
        '[llm]\nprovider = "anthropic"\nmodel = "claude-haiku-4-5"\n',
        '[llm]\nprovider = "google"\n',
      );
      const cfg = resolveLlmConfig({ home: fix.home, cwd: fix.cwd,
        env: { ANS_LLM_MODEL: "gpt-5-mini" }, warn: (m) => fix.warnings.push(m) });
      assert(cfg.provider === "google" && cfg.sources.provider === "project",
        "sources: provider labeled project");
      assert(cfg.model === "gpt-5-mini" && cfg.sources.model === "env",
        "sources: model labeled env");
      const h = harness(fix, { ANS_LLM_MODEL: "gpt-5-mini" });
      await h.call();
      assert(h.seen[0]?.provider === "google" && h.seen[0]?.model === "gpt-5-mini",
        "env override of project file reaches the MCP session");
      assert(h.attrs[0]?.["anysearch.llm.provider.source"] === "project" &&
        h.attrs[0]?.["anysearch.llm.model.source"] === "env",
        "MCP observation reports each value's source layer");
    }

    // 4. missing model config is an error, not a successful-looking chat
    {
      const fix = fixture();
      const h = harness(fix);
      const res = await h.call();
      assert(res?.isError === true, "missing config: isError true");
      assert(textOf(res).includes("LLM not configured"), "missing config: actionable report kept");
      assert(h.seen.length === 0, "missing config: no LLM session was built");
    }

    // 5. a malformed TOML is reported, never treated as "model connected"
    {
      const fix = fixture("[llm\nprovider = broken");
      const h = harness(fix);
      const res = await h.call();
      assert(res?.isError === true, "bad TOML: isError true, not silently connected");
      assert(fix.warnings.some((w) => w.includes("TOML parse failed")),
        "bad TOML: the parse failure was reported on stderr channel");
      assert(h.seen.length === 0, "bad TOML: no LLM session was built");

      // A bad file must never read as "clean", even when env still supplies a
      // usable model: the call may succeed but the warning count is visible.
      const fix2 = fixture("[llm\nprovider = broken");
      const h2 = harness(fix2, { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" });
      await h2.call();
      assert(h2.seen.length === 1, "bad TOML + env: the env-supplied model still runs");
      assert((h2.attrs[0]?.["anysearch.llm.configWarnings"] ?? 0) >= 1,
        "bad TOML + env: the broken file stays visible as a config warning in observation");
      assert(h2.attrs[0]?.["anysearch.llm.provider.source"] === "env",
        "bad TOML + env: source shows the value came from env, not the broken file");
    }

    // 5b. an unreadable config (config.toml is a directory) is reported, not a
    //     crash before observation (#300/greptile P2).
    {
      const fix = fixture();
      mkdirSync(join(fix.home, ".anysearch-cli"), { recursive: true });
      mkdirSync(join(fix.home, ".anysearch-cli", "config.toml")); // a directory, not a file
      const h = harness(fix, { ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" });
      await h.call();
      assert(h.seen.length === 1, "unreadable config: env model still runs, no crash");
      assert(fix.warnings.some((w) => w.includes("could not read config file")),
        "unreadable config: the read failure was reported as a warning");
      assert((h.attrs[0]?.["anysearch.llm.configWarnings"] ?? 0) >= 1,
        "unreadable config: warning count visible in observation");
    }

    // 6. project whitelist: a repo cannot redirect endpoint/protocol/secret
    {
      const fix = fixture(undefined,
        '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' +
        'base_url = "https://evil.example/v1"\napi = "chat"\n' +
        'api_key = "sk-plaintext"\nenv_key = "MY_KEY"\n');
      const h = harness(fix, { MY_KEY: "sk-secret" });
      await h.call();
      assert(h.seen[0]?.baseUrl === undefined, "whitelist: project base_url dropped");
      assert(h.seen[0]?.api === undefined, "whitelist: project api dropped");
      assert(h.seen[0]?.apiKey === undefined, "whitelist: project secret source dropped");
    }

    // 7. provider binding: a project picking another provider cannot reuse the
    //    user file's secret that was bound to a different provider.
    {
      const fix = fixture(
        '[llm]\nprovider = "anthropic"\nmodel = "m"\nenv_key = "ANTHROPIC_API_KEY"\n',
        '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n',
      );
      const h = harness(fix, { ANTHROPIC_API_KEY: "sk-ant" });
      await h.call();
      assert(h.seen[0]?.provider === "openai", "binding: project provider wins");
      // The API key is now passed unconditionally (#300/greptile P1). The guard
      // must keep it undefined here, so no secret reaches the new provider.
      assert(h.seen[0]?.apiKey === undefined, "binding: blocked secret never reaches the model session");
      const cfg = resolveLlmConfig({ home: fix.home, cwd: fix.cwd,
        env: { ANTHROPIC_API_KEY: "sk-ant" }, warn: (m) => fix.warnings.push(m) });
      assert(cfg.apiKey === undefined, "binding: cross-provider secret blocked by shared resolver");
      assert(fix.warnings.some((w) => w.includes("refusing to send that secret")),
        "binding: refusal was reported");
    }

    // 8. a legitimate user-file env_key reaches a CATALOG model on MCP too —
    //    the exact CLI/MCP gap greptile P1 flagged (was dropped without baseUrl).
    {
      const fix = fixture('[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MY_OPENAI_KEY"\n');
      const h = harness(fix, { MY_OPENAI_KEY: "sk-user-envkey" });
      await h.call();
      assert(h.seen[0]?.provider === "openai", "env_key catalog: provider from user file");
      assert(h.seen[0]?.apiKey === "sk-user-envkey",
        "env_key catalog: the user-file key reaches a catalog model session (no baseUrl needed)");
      assert(h.attrs[0]?.["anysearch.llm.provider.source"] === "user",
        "env_key catalog: source reported as user");
    }

    // 9b. #301: a key stored in the user credential file reaches the MCP session
    //     with NO environment variable at all — the GUI-host shape.
    {
      const fix = fixture('[llm]\nprovider = "openai"\nmodel = "gpt-5"\n');
      writeUserCredential({ provider: "openai", apiKey: "sk-stored-mcp-0123456789" }, { home: fix.home });
      const h = harness(fix, {});
      await h.call();
      assert(h.seen.length === 1, "stored key: one session was built");
      assert(h.seen[0]?.apiKey === "sk-stored-mcp-0123456789",
        "stored key: the credential file's key reaches the model session on MCP");
    }

    // 9c. #301: an explicit env key still beats the stored one on the MCP path.
    {
      const fix = fixture('[llm]\nprovider = "openai"\nmodel = "gpt-5"\n');
      writeUserCredential({ provider: "openai", apiKey: "sk-stored-loses" }, { home: fix.home });
      const h = harness(fix, { ANS_LLM_API_KEY: "sk-env-wins" });
      await h.call();
      assert(h.seen[0]?.apiKey === "sk-env-wins", "explicit env key beats the stored key on MCP");
    }

    // 9d. #301: a stored key bound to another endpoint is refused, so no secret
    //     is sent to an endpoint it was not entered for.
    {
      const fix = fixture('[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://gw.example/v1"\napi = "chat"\n');
      writeUserCredential({ provider: "openai", apiKey: "sk-default-endpoint" }, { home: fix.home });
      const h = harness(fix, {});
      await h.call();
      assert(h.seen[0]?.baseUrl === "https://gw.example/v1", "endpoint binding: the custom endpoint is in effect");
      assert(h.seen[0]?.apiKey === undefined, "endpoint binding: the mismatched stored key never reaches the session");
      assert(fix.warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")),
        "endpoint binding: the refusal was reported");
      assert(!fix.warnings.some((w) => w.includes("sk-default-endpoint")), "endpoint binding: the warning repeats no key");
    }

    // 10. a resolver fault returns a structured isError result AND leaves an
    //    observation — never a raw handler rejection that skips both (#300 review A).
    {
      const fix = fixture();
      const h = harness(fix, {}, () => { throw new Error("resolver exploded"); });
      const res = await h.call();
      assert(res?.isError === true, "resolver fault: returned isError result, not a thrown rejection");
      assert(textOf(res).includes("config resolution failed: resolver exploded"),
        "resolver fault: actionable structured error text");
      assert(h.attrs[0]?.["anysearch.llm.configError"] === "resolver exploded",
        "resolver fault: observation recorded the config error");
      assert(h.seen.length === 0, "resolver fault: no LLM session was built");
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
  }

  console.log("--- mcp config-resolution tests (#300): " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
