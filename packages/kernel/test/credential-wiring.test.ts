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
import { redactSecrets } from "@anysearch-cli/retriever";
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
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(
      join(home, ".ans", "config.toml"),
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
  const domains = mkdtempSync(join(home, "domains-"));
  try {
    writeUserCredential({ provider: "anysearch", apiKey: STORED_ANYS_KEY }, { home });
    // The domain narrows the fanout to the arm under test: #500 lets a keyless
    // exa build too, and this test must not send its search to the free-quota
    // endpoint (the offline suite does not reach the network).
    writeFileSync(join(domains, "wire.toml"), [
      'name = "wire"',
      '[sources]',
      'enabled = ["anysearch"]',
      '[rag]',
      'adapter = "none"',
      "",
    ].join("\n"), "utf8");

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

    const engine = createEngine("wire", {
      dbPath: ":memory:",
      domainsDirs: [domains],
      env,
      searchCredentials: (e) => resolveSearchCredentials(e),
    });
    try {
      assert.equal(
        engine.credentialSources?.status === "resolved" ? engine.credentialSources.anysearch : undefined,
        "user",
        "the engine reports where the anysearch key came from",
      );
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
    rmSync(domains, { recursive: true, force: true });
    cleanup();
  }
});

test("a search arm with no stored key and no env is labelled none, never left out", () => {
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
      // 「构造失败必须点名」这条契约的样本不在这里：它由 test「a search arm holding a
      // key it cannot use degrades by name」拿一把用不了的 key 顶着（#499）。这个
      // test 只管「没 key 的臂记成 none，不是被漏掉」。
      // #459: a keyless arm is labelled, not omitted. Before this the record
      // named only the arms that had a key, so "no key here" and "this arm was
      // never looked at" had the same shape.
      const sources = engine.credentialSources;
      assert.equal(sources?.status, "resolved");
      assert.equal(sources?.status === "resolved" ? sources.tavily : "unset", "none");
      assert.equal(sources?.status === "resolved" ? sources.exa : "unset", "none");
      assert.equal(sources?.status === "resolved" ? sources.anysearch : "unset", "none");
      // #500: a keyless exa is not a construction failure any more — the arm
      // builds on the free-quota endpoint, it just has no key to report.
      assert.equal(engine.providerBuildErrors.exa, undefined,
        "a keyless exa arm builds; 'no key' is not a build error");
      // The key set itself is the contract: an arm added later cannot be
      // skipped silently, because this assertion counts what the record carries.
      assert.deepEqual(
        Object.keys(sources ?? {}).sort(),
        ["anysearch", "exa", "status", "tavily"],
        "resolved names all three arms plus status",
      );
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
    }
  } finally {
    scrub.restore();
    cleanup();
  }
});

test("a search arm holding a key it cannot use degrades by name, never pretending", () => {
  const { home, cleanup } = tempHome();
  // 值里带换行：exa-js 构造时往请求头里塞就当场抛。这是全仓剩下唯一一个「构造会抛」
  // 的真实样本（#499）——tavily 没 key 也能建，anysearch 匿名也能建。
  const unusable = "sk-unusable\nheader-fault";
  const scrub = scrubEnv({ EXA_API_KEY: unusable });
  try {
    assert.deepEqual(readUserCredentials({ home }).bindings, []);
    const env: NodeJS.ProcessEnv = { ...scrub.env, USERPROFILE: home, HOME: home };
    const engine = createEngine(undefined, {
      dbPath: ":memory:",
      domainsDirs: [],
      env,
      searchCredentials: (e) => resolveSearchCredentials(e),
    });
    try {
      assert.equal(
        engine.providerBuildErrors.exa,
        "permanent: missing/invalid credential — set the provider's API key env",
        "a key that cannot be used is named, worded as the credential category",
      );
      // 标签说的是「key 从哪来」，不是「这一臂建没建起来」：配了但用不了，仍是 env。
      const sources = engine.credentialSources;
      assert.equal(sources?.status === "resolved" ? sources.exa : "unset", "env");
      assert.equal(sources?.status === "resolved" ? sources.tavily : "unset", "none");
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
    }
  } finally {
    scrub.restore();
    cleanup();
  }
});

test("a blank key from a hand-built seam is labelled none, not env", () => {
  // The seam is public (tests and embedders pass their own resolver), so the
  // record cannot assume its caller trimmed. A whitespace-only key is not a key:
  // it is labelled `none` and the arm builds on the free quota instead.
  // The env is scrubbed too: an explicit blank value must not borrow an ambient
  // EXA_API_KEY, or "the blank key built the free arm" would pass for the wrong
  // reason on a developer machine.
  const scrub = scrubEnv();
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => ({
      warnings: [],
      tavily: { apiKey: "   ", source: "env" },
      exa: { apiKey: "", source: "user" },
      anysearch: { apiKey: "  ", endpoint: "http://127.0.0.1:1", source: "env" },
    }),
  });
  try {
    const sources = engine.credentialSources;
    assert.equal(sources?.status, "resolved");
    assert.equal(sources?.status === "resolved" ? sources.tavily : "unset", "none");
    assert.equal(sources?.status === "resolved" ? sources.exa : "unset", "none");
    assert.equal(sources?.status === "resolved" ? sources.anysearch : "unset", "none");
    // The constructors see the same normalised value: a blank key is not a key.
    // #500: exa takes its free-quota arm from here instead of failing to build.
    assert.equal(engine.providerBuildErrors.exa, undefined,
      "a blank key builds the free-quota arm, not a build error");
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
    scrub.restore();
  }
});

test("a throwing credential resolver degrades to env, it does not kill the engine", () => {
  // Review (second round), high: the MCP entry exits the process on a throw from
  // this seam, so an unreadable credential file would kill the server at startup
  // instead of falling back to the environment like every other arm.
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => { throw new Error("EACCES: credentials.json is unreadable"); },
  });
  try {
    assert.ok(engine.retriever, "the engine was still assembled");
    // `failed`, never `resolved`: resolution THREW, so
    // nothing is known about any arm, and a consumer that read this as "checked,
    // found no keys" would hide the real fault from whoever diagnoses it.
    assert.equal(engine.credentialSources?.status, "failed", "the failure is its own state");
    // The message is classified, not forwarded verbatim: the resolver reads a
    // credential file, so its raw error text is not assumed free of a key.
    const failed = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(failed, /could not be read/);
    assert.doesNotMatch(failed, /credentials\.json is unreadable/, "the raw message is not forwarded");
    assert.doesNotMatch(failed, /EACCES: credentials\.json/, "a path-and-message fragment is not forwarded");
    // The point is only that the throw did not propagate: the arms are built as
    // if no credentials were supplied, which is the pre-#301 path.
    assert.equal(typeof (engine.retriever as { search?: unknown }).search, "function",
      "the retriever is usable, not a half-built object");
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("an endpoint without a key is reported as keyless, not as authenticated", () => {
  // `resolveSearchCredentials` emits the anysearch arm with an endpoint alone
  // when ANYSEARCH_ENDPOINT is set and no key exists (that is how the offline
  // acceptance lane points the arm at a dead port). Reporting `"env"` would say
  // "this arm has a key"; reporting nothing would lose the fact that the arm IS
  // configured. `"none"` is the honest answer.
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: { ANYSEARCH_ENDPOINT: "http://127.0.0.1:1" },
    searchCredentials: (e) => resolveSearchCredentials(e),
  });
  try {
    assert.equal(engine.credentialSources?.status, "resolved");
    assert.equal(
      engine.credentialSources?.status === "resolved" ? engine.credentialSources.anysearch : "unset",
      "none",
      "an endpoint with no key is a configured but keyless arm",
    );
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("no seam passed leaves credentialSources absent, so a truthiness check still works", () => {
  // Before #301 this field did not exist at all. Keeping "nobody asked" as
  // `undefined` is what lets an existing `if (engine.credentialSources)` keep
  // meaning "resolution was configured".
  const engine = createEngine(undefined, { dbPath: ":memory:", domainsDirs: [], env: {} });
  try {
    assert.equal(engine.credentialSources, undefined);
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("a credential fault is classified by cause, not flattened into one sentence", () => {
  // Each refusal has a different fix, so the reported cause has to survive the
  // classification: a held lock is not a permissions problem, and a broken file
  // is neither.
  const cases: Array<[string, RegExp]> = [
    ["another ans process is holding it: refusing to write the credential file /x: another ans process is writing it (x.lock is still held after 5s)", /another ans process is writing/],
    ["refusing to write the credential file /x: cannot take the write lock /x.lock (EACCES)", /folder refused access \(EACCES\)/],
    ["refusing to write the credential file /x: its Windows DACL still allows BA", /could not be locked to your account/],
    ["/x: not valid JSON (line 3 column 5); fix or remove the file", /not readable as stored keys/],
  ];
  for (const [raw, want] of cases) {
    const engine = createEngine(undefined, {
      dbPath: ":memory:",
      domainsDirs: [],
      env: {},
      searchCredentials: () => { throw new Error(raw); },
    });
    try {
      const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
      assert.match(message, want, "cause: " + raw);
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
    }
  }
});

test("a permission fault on a parse-shaped message is not advice to delete the file", () => {
  // The store uses the same "could not read it" wording for EACCES and for a
  // syntax error. Telling a user to remove the file on a permissions problem
  // would destroy every other key in it for nothing.
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => {
      throw new Error("/home/me/.ans/credentials.json: not valid JSON (line 1 column 2): EACCES");
    },
  });
  try {
    const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(message, /EACCES/);
    assert.doesNotMatch(message, /fix or remove/i, "a permissions fault is not a broken file");
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("a disk-full failure is not reported as a permissions problem", () => {
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => {
      throw new Error("refusing to write the credential file /x: cannot create /x (ENOSPC). Set the key in the environment instead");
    },
  });
  try {
    const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(message, /no space left/i);
    assert.doesNotMatch(message, /permission/i, "space is not permission");
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("a path containing 'acl' is not mistaken for a failed ACL check", () => {
  // The refusal message always carries the file path, so a bare /ACL/ would match
  // a folder named "acl-backup" and report a protection fault that never happened.
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => {
      throw new Error("refusing to write the credential file /home/me/acl-backup/credentials.json: cannot create /home/me/acl-backup (EACCES)");
    },
  });
  try {
    const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(message, /refused access \(EACCES\)/);
    assert.doesNotMatch(message, /locked to your account/, "the path is not evidence of a DACL fault");
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("a timeout says the storage did not answer, not that the file is unreadable", () => {
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => { throw new Error("could not read it (ETIMEDOUT)"); },
  });
  try {
    const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(message, /did not respond in time/);
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});

test("a key is redacted under every shape a real one takes", () => {
  // Each case below broke an earlier version of this function, so they stay.
  const mustRedact = [
    "value was sk-abcdefghijklmnopqrstuvwx",               // all letters, no digits
    "value was sk-proj-abcd1234/efgh5678",                 // a slash inside the key
    "sk-live-abcdefghijklmnopqrstuvwxyz012345",            // normal prefixed key
    "env_key_sk-abc12345",                                 // preceded by an underscore
    "x_token_sk-abc12345xyz",                              // the same, mid-identifier
    "value was abcdefghij-klmnopqrst-uvwxyzab-cdefghij",   // 39 chars, words-shaped
    "value was tvly-dev-alphabeticalonlybody",             // words-shaped behind a prefix
    "a".repeat(48),                                        // a long bare run
    "bad value Aa1+" + "b".repeat(40),                     // base64 with +
    "value was Q7xR2mN8pL4vK1wZ9tY3",                      // 20 chars, no known prefix
  ];
  for (const input of mustRedact) {
    assert.ok(redactSecrets(input).includes("[redacted]"), "must be redacted: " + input);
  }
});

test("a path survives, because the message exists to name the file", () => {
  // A warning that cannot say which file failed is not worth printing. Every
  // case here was eaten by an earlier version.
  const mustSurvive = [
    "/srv/api-gateway-service/v2/credentials.json: EACCES",
    "/Users/me/dev/api-service/v2/.ans/credentials.json: not valid JSON",
    "/home/me/workspace/attributiongoldrevisions/credentials.json: EACCES",
    "/home/me/.ans/config.toml: not valid JSON",
    "C:\\Users\\me\\.ans\\credentials.json: EACCES",
  ];
  for (const input of mustSurvive) {
    assert.equal(redactSecrets(input), input, "path must stay readable: " + input);
  }
});

test("an identifier that merely embeds a prefix is left alone", () => {
  assert.equal(redactSecrets("my_key_abc123"), "my_key_abc123");
});

test("the useful part of a warning survives redaction", () => {
  const secret = "sk-live-abcdefghijklmnopqrstuvwxyz012345";
  const out = redactSecrets("/home/me/credentials.json: could not read it (EACCES); value was " + secret);
  assert.ok(!out.includes(secret), "the key is gone");
  assert.match(out, /\[redacted\]/);
  assert.match(out, /credentials\.json/, "the file name is still there");
  assert.match(out, /EACCES/, "and so is the errno");
});


test("ENOTDIR is reported as a path fault, not as a permission fault", () => {
  // `writeProtectedFile` re-throws the raw errno, so classification has to key on
  // the code. A path that is not a directory is not fixed by changing modes.
  const engine = createEngine(undefined, {
    dbPath: ":memory:",
    domainsDirs: [],
    env: {},
    searchCredentials: () => {
      throw new Error("refusing to write the credential file /x: ENOTDIR: not a directory, mkdir '/x'");
    },
  });
  try {
    const message = engine.credentialSources?.status === "failed" ? engine.credentialSources.error : "";
    assert.match(message, /path is not usable \(ENOTDIR\)/);
    assert.doesNotMatch(message, /permission|refused access/i);
  } finally {
    (engine.store as { close?: () => void }).close?.();
    engine.observation.close();
  }
});
