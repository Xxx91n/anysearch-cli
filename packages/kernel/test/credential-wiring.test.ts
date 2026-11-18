// #301 acceptance — the stored key actually reaches the REAL clients.
//
// Spec S2 says the shared credential resolution must take effect where the real
// model and search clients are assembled, not just configure an internal mock
// provider. So this test does two things with real transports and no mock of the
// code under test:
//
//   1. Model: a stored key with NO environment at all is resolved by the shared
//      resolver and handed to the real pi-ai session, which issues a real HTTP
//      request to a local fake endpoint. The endpoint records the
//      Authorization header, so "the key arrived" is observed on the wire.
//   2. Search: the composition root builds the real anysearch arm from the
//      stored file (again with no environment) and the test drives a real search
//      through the engine against a local MCP endpoint, asserting the
//      Authorization header on every request. The anysearch arm is the one whose
//      endpoint is configurable (ANYSEARCH_ENDPOINT), so it is the arm that can
//      prove the key reaches the wire rather than only the constructor.
//
// A fifth case proves a key bound to another endpoint is NOT sent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLlmSession } from "../src/llm-init";
import { createEngine } from "../src/composition";
import { readUserCredentials, resolveLlmConfig, resolveSearchCredentials, writeUserCredential } from "@anysearch-cli/store";

const STORED_MODEL_KEY = "sk-stored-model-key-0123456789";
const STORED_ANYS_KEY = "as-stored-key-0123456789";

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ans-301-home-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/** Save and blank every env var the resolver consults, to stand in for a GUI host. */
const SCRUB = [
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY",
  "TAVILY_API_KEY", "EXA_API_KEY", "ANYSEARCH_API_KEY", "ANYSEARCH_ENDPOINT",
];

function scrubEnv(overrides: NodeJS.ProcessEnv = {}): { env: NodeJS.ProcessEnv; restore: () => void } {
  const saved: Record<string, string | undefined> = {};
  for (const key of SCRUB) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const env: NodeJS.ProcessEnv = {};
  for (const key of SCRUB) if (overrides[key] !== undefined) env[key] = overrides[key];
  return {
    env,
    restore: () => {
      for (const key of SCRUB) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    },
  };
}

test("a stored key with no environment authenticates the REAL model client", async () => {
  const { home, cleanup } = tempHome();
  const scrub = scrubEnv();
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    (server as unknown as { seen: unknown[] }).seen.push({
      authorization: req.headers["authorization"],
      body,
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: " + JSON.stringify({
      id: "c301", object: "chat.completion.chunk", created: 1, model: "probe-model",
      choices: [{ index: 0, delta: { role: "assistant", content: "pong" }, finish_reason: null }],
    }) + "\n\n");
    res.write("data: " + JSON.stringify({
      id: "c301", object: "chat.completion.chunk", created: 1, model: "probe-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  });
  const seen = ((server as unknown as { seen: unknown[] }).seen = []) as {
    authorization?: string; body: string;
  }[];
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    // The stored entry is bound to this exact endpoint, which is what makes the
    // key usable for it (a key entered for the default endpoint would not be).
    const endpoint = "http://127.0.0.1:" + port + "/v1";
    writeUserCredential({ provider: "openai", endpoint, apiKey: STORED_MODEL_KEY }, { home });
    // A GUI host has no shell env, but it does have the user config file that
    // `ans llm set` wrote. That is the whole point: config + key both live where
    // the host can read them without an exported variable.
    mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
    writeFileSync(
      join(home, ".anysearch-cli", "config.toml"),
      '[llm]\nprovider = "openai"\nmodel = "probe-model"\nbase_url = "' + endpoint + '"\napi = "chat"\n',
      "utf8",
    );

    // Nothing in the environment names a provider, model, endpoint or key.
    const cfg = resolveLlmConfig({
      env: scrub.env,
      home,
      cwd: home,
      warn: () => {},
    });
    assert.equal(cfg.provider, "openai");
    assert.equal(cfg.apiKey, STORED_MODEL_KEY, "the resolver read the stored key with no env present");
    assert.equal(cfg.sources.apiKey, "credentials");

    const session = await createLlmSession({
      provider: "openai",
      model: "probe-model",
      baseUrl: endpoint,
      api: "chat",
      apiKey: cfg.apiKey,
    });
    const stream = session.streamFn(session.model, {
      messages: [{ role: "user", content: "ping" }],
    } as never, { apiKey: session.apiKey } as never);
    let text = "";
    for await (const event of stream as AsyncIterable<{ type?: string; delta?: string; content?: string }>) {
      if (event.type === "text_delta" && typeof event.delta === "string") text += event.delta;
      else if (event.type === "text" && typeof event.content === "string") text += event.content;
    }
    assert.ok(text.length > 0 || seen.length === 1, "the real client ran a turn");

    assert.equal(seen.length, 1, "exactly one wire request reached the endpoint");
    assert.equal(seen[0]?.authorization, "Bearer " + STORED_MODEL_KEY,
      "the STORED key travelled on the wire, not a placeholder");
    assert.ok(!seen[0]!.body.includes(STORED_MODEL_KEY), "the key stays out of the request body");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    scrub.restore();
    cleanup();
  }
});

test("a stored key bound to another endpoint is never sent", async () => {
  const { home, cleanup } = tempHome();
  const scrub = scrubEnv();
  try {
    writeUserCredential({ provider: "openai", apiKey: STORED_MODEL_KEY }, { home });
    const warnings: string[] = [];
    // The effective endpoint is a custom one; the stored key was entered for the
    // provider default. It must be refused, never forwarded.
    const cfg = resolveLlmConfig({
      env: { ...scrub.env, ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "probe-model" },
      home,
      cwd: home,
      flags: { baseUrl: "http://127.0.0.1:9/v1", api: "chat" },
      warn: (m) => warnings.push(m),
    });
    assert.equal(cfg.apiKey, undefined);
    assert.ok(warnings.some((w) => w.includes("refusing to send that secret to a different endpoint")));
    assert.ok(!warnings.some((w) => w.includes(STORED_MODEL_KEY)), "the warning never repeats the key");
  } finally {
    scrub.restore();
    cleanup();
  }
});

test("stored SEARCH keys reach the real provider arms built by createEngine", async () => {
  const { home, cleanup } = tempHome();
  const scrub = scrubEnv();
  try {
    writeUserCredential({ provider: "anysearch", apiKey: STORED_ANYS_KEY }, { home });

    // A real local MCP endpoint. The anysearch arm is the one search client
    // whose endpoint can be pointed at a test server (ANYSEARCH_ENDPOINT), so it
    // is the arm that can prove the stored key reaches the WIRE — not merely the
    // constructor. Requests are recorded, then answered with a minimal
    // handshake + tools/call so the arm completes normally.
    const seenAuth: (string | undefined)[] = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      seenAuth.push(req.headers["authorization"] as string | undefined);
      let parsed: { id?: number; method?: string } = {};
      try { parsed = JSON.parse(body); } catch { /* notification framing */ }
      const reply = (result: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
      };
      if (parsed.method === "initialize") {
        return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } });
      }
      if (parsed.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (parsed.method === "tools/call") {
        return reply({ content: [{ type: "text", text: "## Search Results (0 results, 1ms)\n" }] });
      }
      return reply({});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    const env: NodeJS.ProcessEnv = {
      ...scrub.env,
      USERPROFILE: home,
      HOME: home,
      ANYSEARCH_ENDPOINT: "http://127.0.0.1:" + port + "/mcp",
    };
    const resolved = resolveSearchCredentials(env);
    assert.equal(resolved.anysearch?.apiKey, STORED_ANYS_KEY);
    assert.equal(resolved.anysearch?.source, "user");
    assert.equal(resolved.exa, undefined, "no exa key anywhere - that arm stays keyless");

    const engine = createEngine(undefined, {
      dbPath: ":memory:",
      domainsDirs: [],
      env,
      searchCredentials: (e) => resolveSearchCredentials(e),
    });
    try {
      assert.equal(engine.credentialSources?.anysearch, "user", "the engine reports where the anysearch key came from");
      assert.equal(engine.providerBuildErrors.anysearch, undefined, "the anysearch arm built from the stored key");

      // Drive the real arm through the engine: this is the search client the
      // product assembles, and the assertion below reads the wire.
      const envelope = await (engine.retriever as {
        search: (q: { query: string; mode: string }) => Promise<unknown>;
      }).search({ query: "credential wiring probe", mode: "fast" });
      assert.ok(envelope, "the engine returned an envelope from the real arm");

      assert.ok(seenAuth.length >= 3, "the arm made a real handshake plus a tool call (" + seenAuth.length + " requests)");
      assert.ok(
        seenAuth.every((h) => h === "Bearer " + STORED_ANYS_KEY),
        "every request carried the STORED key on the wire: " + JSON.stringify(seenAuth),
      );
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    scrub.restore();
    cleanup();
  }
});

test("a search arm with no stored key and no env still degrades by name, never pretending", () => {
  const { home, cleanup } = tempHome();
  const scrub = scrubEnv();
  try {
    // An explicitly empty credential file: readable, but no keys at all.
    assert.deepEqual(readUserCredentials({ home }).bindings, []);
    const env: NodeJS.ProcessEnv = { ...scrub.env, USERPROFILE: home, HOME: home };
    const engine = createEngine(undefined, {
      dbPath: ":memory:",
      domainsDirs: [],
      env,
      searchCredentials: (e) => resolveSearchCredentials(e),
    });
    try {
      // exa refuses to construct without a key, and that stays a named
      // degradation instead of a silent skip.
      assert.ok(engine.providerBuildErrors.exa, "the keyless exa arm reports a named failure");
      assert.equal(engine.credentialSources?.exa, undefined);
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
    }
  } finally {
    scrub.restore();
    cleanup();
  }
});
