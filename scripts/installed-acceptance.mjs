#!/usr/bin/env node
// #267 acceptance — the release plan's last ticket: prove the PACKED, INSTALLED
// product can actually be used, not just that the source tree passes tests.
//
// Why this lane exists
// --------------------
// `scripts/install-smoke.mjs` already packs and installs, but it only drives
// `ans --version / doctor / domain / search`. Nothing ever started the INSTALLED
// MCP server, ran an `ans_chat` turn, resumed a session, consolidated materials,
// or proved an older database still opens. So "the tarballs install" and "a user
// can research with them" were two different claims, and only the first was
// checked automatically (T6 in spec #255).
//
// What this lane proves, all against the tarballs this job just built
// -------------------------------------------------------------------
//   A. CLI on the installed artifact: --version / doctor / consolidate scope guard
//   B. MCP on the installed artifact: initialize + tools/list, then a real
//      ans_chat turn against a controlled OpenAI-compatible endpoint
//   C. Explicit session resume: the second turn carries the first turn's answer
//   D. Consolidate on the installed artifact: a dry-run saves nothing, an apply
//      writes one knowledge row and is metered/reported honestly
//   E. Internal search ingest -> another session recalls the row through
//      query_knowledge (needs one provider key; SKIPPED loudly otherwise)
//   F. An older database opens, is migrated, keeps its rows, and survives a
//      second migration (the schema script is idempotent in practice)
//
// Honesty rules this file follows
// -------------------------------
// - A missing model endpoint prints SKIPPED and marks the run partial; it never
//   prints a pass for a lane that did not run.
// - The model is a local SSE stub. It proves the wiring, the request shape and
//   the accounting path — NOT the quality of a real model's judgement.
// - Nothing points at r19 or any real experiment database; everything is a temp
//   directory deleted on exit.
//
// Run: node scripts/installed-acceptance.mjs
// Env: EXA_API_KEY / TAVILY_API_KEY (lane E; skipped when absent)
//      ANS_ACC_TARBALLS=<dir>   install the tarballs in that directory instead of
//                               packing. Used to check this script against a
//                               CI-built artifact without compiling locally.
// Exit 0 = every lane that could run passed. Exit 1 = a real failure.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

let passed = 0;
let failed = 0;
let skipped = 0;
function check(cond, name, detail) {
  if (cond) { passed++; console.log("[OK]   " + name); }
  else { failed++; console.error("[FAIL] " + name + (detail ? " — " + String(detail).slice(0, 400) : "")); }
}
function skip(name, why) { skipped++; console.log("[SKIP] " + name + " — " + why); }

// ---------- the controlled model endpoint ----------
//
// One local SSE server. It answers three kinds of request differently, keyed on
// the prompt text rather than arrival order, because consolidation calls and
// agent turns really do interleave:
//   - a search intent     -> a tool_call frame, so the internal search runs
//   - a consolidation     -> the fact text
//   - anything else       -> a plain answer naming its own turn
const FACT = "Acme online support runs weekdays 9:00-17:00.";
const requestLog = [];

function sseChunk(delta, finish, usage) {
  return "data: " + JSON.stringify({
    id: "acc267", object: "chat.completion.chunk", created: 1, model: "probe-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) + "\n\n";
}
function sseText(text) {
  return [
    sseChunk({ role: "assistant", content: text }, null),
    sseChunk({}, "stop", { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}
function sseToolCall(name, args) {
  return [
    sseChunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_" + requestLog.length, type: "function", function: { name, arguments: "" } }] }, null),
    sseChunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }, null),
    sseChunk({}, "tool_calls", { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}

function classify(body) {
  // Consolidation prompts carry these headings; an agent turn does not.
  if (body.includes("Summarize these episodic memories") || body.includes("You are a memory adjudicator")
    || body.includes("You are a context summarization assistant")) return "consolidate";
  // A turn that already carries a tool result must NOT ask for the search
  // again: the request history still contains the original wording, so keying
  // on the text alone would loop forever.
  let messages = [];
  try { messages = JSON.parse(body)?.messages ?? []; } catch { /* not JSON */ }
  if (messages.some((m) => m?.role === "tool")) return "chat";
  if (body.includes("TOOL-CALL-PLEASE")) return "toolcall";
  return "chat";
}

const endpoint = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const role = classify(body);
  requestLog.push({ role, body });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (role === "toolcall") return res.end(sseToolCall("search", JSON.stringify({ query: "anysearch-cli GitHub repository" })));
  if (role === "consolidate") return res.end(sseText(FACT));
  // Echo a token from the user's turn. A later request that carries this answer
  // proves the session record resumed; a fixed "answer" would not, because the
  // same constant would appear even on a fresh session.
  const marker = (body.match(/(FIRST-TURN-QUESTION|SECOND-TURN-QUESTION)/) ?? [])[1];
  res.end(sseText(marker ? "REPLY-TO-" + marker : "PLAIN-ANSWER"));
});

// ---------- tiny MCP stdio client (newline-delimited JSON-RPC) ----------
function mcpClient(bin, env, tag) {
  const child = spawn(process.execPath, [bin, "--transport", "stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  child.once("exit", () => {
    for (const [, fn] of pending) fn({ error: { message: tag + ": MCP exited" } });
    pending.clear();
  });
  const rpc = (method, params, ms = 240_000) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(tag + ": timeout on " + method + "\nstderr: " + stderr.slice(-400))); }, ms);
    pending.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const ready = async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: tag, version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return init;
  };
  return {
    rpc,
    ready,
    stderr: () => stderr,
    /**
     * Stop the server and resolve once it is really gone.
     *
     * Windows keeps an open handle on a killed child's database/WAL files until
     * the process object is reaped, so deleting the sandbox before that lands
     * throws EPERM. Awaiting the exit event is what makes cleanup deterministic
     * instead of a race; the timeout keeps a wedged child from hanging the run.
     */
    kill: () => new Promise((res) => {
      if (child.exitCode !== null || child.signalCode !== null) return res();
      const timer = setTimeout(res, 5_000);
      child.once("exit", () => { clearTimeout(timer); res(); });
      try { child.kill(); } catch { clearTimeout(timer); res(); }
    }),
  };
}
const textOf = (r) => (r?.result?.content ?? []).map((c) => c?.text ?? "").join("\n");

// ---------- environment helpers ----------
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
}

function writeDomain(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + ".toml"), body.join("\n") + "\n", "utf8");
}

const DOMAIN_MIN = (name, system, rag = "none") => [
  'name = "' + name + '"',
  'sources = { enabled = [] }',
  'prompts = [{ name = "system", content = "' + system + '" }]',
  'skills = { active = ["search"] }',
  'hooks = { toolWhitelist = ["search"] }',
  'rag = { adapter = "' + rag + '" }',
];

/**
 * Remove the sandbox, with a bounded retry.
 *
 * The real fix for Windows EPERM here was loading `better-sqlite3` from this
 * repo instead of from the install prefix: a loaded native module keeps its
 * file handle until the process exits, and the sandbox lives under that prefix.
 * This retry is only the backstop for a killed child whose handles have not been
 * released yet. A leftover temp directory is a hygiene note, not a product
 * failure, so this never throws — the verdict must come from the checks above.
 */
function rmTempWithRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (e) {
      if (attempt === 4) {
        console.error("[WARN] could not delete the temp sandbox " + dir + " (" + (e?.code ?? e?.message) + "); it is a temp directory, not a product failure");
        return;
      }
      // Synchronous backoff: the caller is the process's final step.
      const until = Date.now() + 200 * (attempt + 1);
      while (Date.now() < until) { /* wait */ }
    }
  }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "ans-installed-acc-"));
  const outDir = join(work, "out");
  const prefix = join(work, "prefix");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ name: "ans-installed-acc", private: true }), "utf8");

  const clients = [];
  try {
    // ================= pack + install =================
    //
    // `ANS_ACC_TARBALLS` exists so this script can be checked against a CI-built
    // artifact without a local compile; CI leaves it unset and packs its own.
    const preset = process.env.ANS_ACC_TARBALLS?.trim();
    const PACK_DIRS = ["apps/cli", "apps/mcp", "apps/plugin"];
    if (preset) {
      console.log("== clean install (prebuilt tarballs from " + preset + ") ==");
      for (const f of readdirSync(preset)) {
        if (f.endsWith(".tgz")) writeFileSync(join(outDir, f), readFileSync(join(preset, f)));
      }
    } else {
      console.log("== pack + clean install ==");
      for (const d of PACK_DIRS) {
        const r = sh("pnpm", ["-C", join(ROOT, d), "pack", "--pack-destination", outDir], { cwd: ROOT });
        if (r.code !== 0) check(false, "pack " + d, r.out);
      }
    }

    const tgz = readdirSync(outDir).filter((f) => f.endsWith(".tgz"));
    check(tgz.length === PACK_DIRS.length, "the install set has " + PACK_DIRS.length + " app tarballs", tgz.join(","));
    check(tgz.every((f) => !f.includes("0.0.0")), "no 0.0.0 placeholder version in the packed set", tgz.join(","));

    const appTgz = tgz.filter((f) => /anysearch-cli-(cli|mcp|plugin)-/.test(f));
    const inst = sh("npm", ["install", ...appTgz.map((f) => join(outDir, f))], { cwd: prefix });
    check(inst.code === 0, "npm install into a clean prefix", inst.out);

    // Load better-sqlite3 from THIS repo, not from the installed prefix.
    // On Windows a loaded native module keeps its file handle until this process
    // exits, and the sandbox lives inside the install prefix — deleting it would
    // then fail with EPERM. The repo pins the same version, so it reads the
    // installed product's database faithfully without holding the sandbox.
    const Database = createRequire(join(ROOT, "apps", "mcp", "package.json"))("better-sqlite3");

    const nm = join(prefix, "node_modules");
    const ansBin = join(nm, ".bin", process.platform === "win32" ? "ans.cmd" : "ans");
    const mcpBin = join(nm, "@anysearch-cli", "mcp", "dist", "index.js");
    check(existsSync(ansBin), "installed ans bin exists", ansBin);
    check(existsSync(mcpBin), "installed MCP entry exists", mcpBin);

    // ================= A. CLI on the installed artifact =================
    console.log("\n== A. CLI ==");
    const v = sh("\"" + ansBin + "\"", ["--version"], { cwd: prefix });
    check(v.code === 0, "installed ans --version exits 0", v.out);
    check(/\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), "version is a real release version", v.out);

    const doctor = sh("\"" + ansBin + "\"", ["doctor"], { cwd: prefix });
    check(doctor.code === 0, "installed ans doctor exits 0", doctor.out);
    check(/vector arm/.test(doctor.out), "doctor reports the vector arm status", doctor.out.slice(-400));

    const noScope = sh("\"" + ansBin + "\"", ["consolidate"], { cwd: prefix });
    check(noScope.code === 2, "consolidate with no scope exits 2 instead of consolidating everything", noScope.out);
    check(/explicit scope is required/.test(noScope.out), "the no-scope refusal says what is missing", noScope.out);

    // ================= the model stub =================
    await new Promise((r) => endpoint.listen(0, "127.0.0.1", r));
    const port = endpoint.address().port;
    const llmEnv = {
      ANS_LLM_PROVIDER: "openai",
      ANS_LLM_MODEL: "probe-model",
      ANS_LLM_BASE_URL: "http://127.0.0.1:" + port + "/v1",
      ANS_LLM_API: "chat",
      ANS_LLM_API_KEY: "probe-key",
    };

    const domainsDir = join(work, "domains");
    writeDomain(domainsDir, "probe", DOMAIN_MIN("probe", "PROBE-SYSTEM-PROMPT."));
    writeDomain(domainsDir, "recall", DOMAIN_MIN("recall", "RECALL-SYSTEM.", "fts"));

    const baseEnv = {
      ...process.env,
      ...llmEnv,
      ANS_DOMAINS_DIR: domainsDir,
      ANS_DB_PATH: join(work, "anysearch.db"),
      ANS_PI_SESSION_DIR: join(work, "pi"),
      ANS_NO_INTERACTIVE: "1",
      // Keep the install's own config out of the run: HOME/USERPROFILE point at
      // the sandbox so a developer's real ~/.anysearch-cli never leaks in.
      USERPROFILE: work,
      HOME: work,
    };

    // ================= B/C. MCP: initialize, chat, explicit resume =================
    console.log("\n== B/C. installed MCP: initialize -> chat -> resume ==");
    const prober = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe" }, "probe");
    clients.push(prober);
    const init = await prober.ready();
    check(!!init.result?.serverInfo?.name, "installed MCP answers initialize", JSON.stringify(init).slice(0, 200));
    check(init.result?.serverInfo?.version && init.result.serverInfo.version !== "0.0.0",
      "initialize reports a real server version", JSON.stringify(init.result?.serverInfo));

    const list = await prober.rpc("tools/list", {});
    const tools = (list.result?.tools ?? []).map((t) => t.name);
    check(["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"].every((n) => tools.includes(n)),
      "installed MCP lists all five tools", tools.join(","));

    const turn1 = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "FIRST-TURN-QUESTION" } });
    const t1text = textOf(turn1);
    check(turn1.result?.isError !== true, "turn 1 completes without a tool error", t1text.slice(0, 200));
    check(/REPLY-TO-FIRST-TURN-QUESTION/.test(t1text), "turn 1 carries the model's answer", t1text.slice(0, 200));

    const usage1 = turn1.result?.structuredContent?.usage?.run;
    check(!!usage1 && usage1.assistantCalls >= 1, "turn 1 reports run usage", JSON.stringify(usage1));
    check(!!usage1 && typeof usage1.costSource === "string", "turn 1 names where its cost figure came from", JSON.stringify(usage1));
    const ctx1 = turn1.result?.structuredContent?.context;
    check(!!ctx1 && typeof ctx1.window === "number" && ctx1.window > 0, "turn 1 reports the context window it used", JSON.stringify(ctx1));

    const sid = turn1.result?.structuredContent?.sessionId;
    check(typeof sid === "string" && sid.length > 0, "turn 1 returns a resumable session handle", String(sid));

    const turn2 = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "SECOND-TURN-QUESTION", sessionId: sid } });
    check(turn2.result?.isError !== true, "turn 2 with the handle completes", textOf(turn2).slice(0, 200));
    check(turn2.result?.structuredContent?.sessionId === sid, "turn 2 keeps the same session handle", String(turn2.result?.structuredContent?.sessionId));
    const turn2Body = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(turn2Body.includes("FIRST-TURN-QUESTION"), "turn 2 request carries turn 1's question (the record resumed)");
    check(turn2Body.includes("REPLY-TO-FIRST-TURN-QUESTION"), "turn 2 request carries turn 1's answer (the record resumed)");

    // The fixed prompt must not be re-invented per turn: compare the system
    // message of two requests in the same session.
    const systemOf = (body) => {
      try {
        const j = JSON.parse(body);
        const msgs = j.messages ?? [];
        const sys = msgs.find((m) => m.role === "system" || m.role === "developer");
        return JSON.stringify(sys ?? null);
      } catch { return null; }
    };
    const chatBodies = requestLog.filter((r) => r.role === "chat").map((r) => r.body);
    const sameSystem = chatBodies.length >= 2 && systemOf(chatBodies[chatBodies.length - 1]) === systemOf(chatBodies[chatBodies.length - 2]);
    check(sameSystem, "the system prompt is byte-identical across the two turns (stable cacheable prefix)",
      systemOf(chatBodies[chatBodies.length - 1])?.slice(0, 200));

    // ================= C2. cold start: two servers, one brand-new database =================
    //
    // Spec D12 / T3: a brand-new file must not lose a process to SQLITE_BUSY. The
    // store's bounded retry is what makes that true; this checks it through the
    // installed servers instead of trusting the unit test alone. Two processes
    // initialize at once and each must serve tools/list afterwards — answering
    // initialize only proves the transport opened, not that the schema landed.
    console.log("\n== C2. cold start: two installed servers on a brand-new database ==");
    {
      const coldDb = join(work, "cold.db");
      const coldA = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: coldDb }, "cold-a");
      const coldB = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: coldDb }, "cold-b");
      clients.push(coldA, coldB);
      const [initA, initB] = await Promise.all([coldA.ready(), coldB.ready()]);
      check(!!initA.result?.serverInfo?.name && !!initB.result?.serverInfo?.name,
        "both processes initialize against the same brand-new database",
        JSON.stringify([initA.error, initB.error]).slice(0, 300));
      const [listA, listB] = await Promise.all([coldA.rpc("tools/list", {}), coldB.rpc("tools/list", {})]);
      check((listA.result?.tools ?? []).length === 5 && (listB.result?.tools ?? []).length === 5,
        "both processes serve all five tools after the concurrent cold start",
        JSON.stringify([(listA.result?.tools ?? []).length, (listB.result?.tools ?? []).length]));
      const coldCheck = new Database(coldDb, { readonly: true });
      let tableCount = 0;
      try { tableCount = coldCheck.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c; }
      finally { coldCheck.close(); }
      check(tableCount >= 30, "the cold-started database has the complete schema (" + tableCount + " tables)");
      await coldA.kill();
      await coldB.kill();
    }

    // ================= D. consolidate on the installed artifact =================
    console.log("\n== D. consolidate: scope guard, dry-run, apply ==");

    const noScopeCall = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate" } });
    check(noScopeCall.result?.isError === true, "consolidate through MCP with no scope is a tool error", textOf(noScopeCall).slice(0, 200));
    check(/explicit scope is required/.test(textOf(noScopeCall)), "the MCP no-scope error names the missing scope", textOf(noScopeCall).slice(0, 200));

    const dry = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate", sessionId: sid, dryRun: true } });
    check(dry.result?.isError !== true, "consolidate dry-run completes", textOf(dry).slice(0, 200));
    const dryScope = dry.result?.structuredContent?.scope;
    check(!!dryScope, "consolidate dry-run echoes the scope it actually read", JSON.stringify(dryScope));

    // Seed three materials straight into the installed schema, so the apply lane
    // has something to work on without spending a provider call.
    const seedSession = "acc267-seed";
    let seededIds = [];
    {
      const db = new Database(baseEnv.ANS_DB_PATH);
      try {
        db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run(seedSession, "probe");
        for (let i = 1; i <= 3; i++) {
          const r = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?,?,?,?,?,?)")
            .run(seedSession, "https://acme.example/hours-v" + i, "acme hours v" + i, FACT, "exa", "acme-hours");
          seededIds.push(Number(r.lastInsertRowid));
        }
      } finally { db.close(); }
    }
    check(seededIds.length === 3, "seeded three materials for the apply lane", seededIds.join(","));

    const applyCall = await prober.rpc("tools/call", {
      name: "ans_chat",
      arguments: { operation: "consolidate", memoryIds: seededIds },
    });
    const applyText = textOf(applyCall);
    check(applyCall.result?.isError !== true, "consolidate apply completes", applyText.slice(0, 300));
    const counts = applyCall.result?.structuredContent?.counts;
    check(counts?.add === 1, "consolidate apply wrote exactly one knowledge row", JSON.stringify(counts));
    check(!!applyCall.result?.structuredContent?.usage, "consolidate reports its own model usage", JSON.stringify(applyCall.result?.structuredContent?.usage));
    const usageApply = applyCall.result?.structuredContent?.usage;
    check(usageApply?.calls >= 1, "consolidate counted the model call it made", JSON.stringify(usageApply));
    check(typeof usageApply?.costBasis === "string" && usageApply.costBasis !== "provider-reported",
      "an unpriced endpoint is not reported as a server-sent price", JSON.stringify(usageApply));
    {
      const db = new Database(baseEnv.ANS_DB_PATH, { readonly: true });
      try {
        const rows = db.prepare("SELECT content, valid_until FROM semantic_memories").all();
        check(rows.length === 1, "the knowledge row is really in the database", JSON.stringify(rows));
        check(rows.length === 1 && rows[0].valid_until === null, "the written row is live", JSON.stringify(rows));
        check(rows.length === 1 && String(rows[0].content).includes("Acme"), "the written row carries the summarised fact", JSON.stringify(rows).slice(0, 200));
      } finally { db.close(); }
    }

    // ================= E. internal search ingest -> cross-session recall =================
    console.log("\n== E. internal search ingest -> another session recalls ==");
    const online = Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY);
    if (!online) {
      skip("internal search ingest + cross-session recall", "EXA_API_KEY / TAVILY_API_KEY not set");
    } else {
      // A domain with one real provider, so the internal search has an arm.
      const providerName = process.env.EXA_API_KEY ? "exa" : "tavily";
      writeDomain(domainsDir, "ingest", [
        'name = "ingest"',
        'sources = { enabled = ["' + providerName + '"] }',
        'prompts = [{ name = "system", content = "INGEST-SYSTEM." }]',
        'skills = { active = ["search"] }',
        'hooks = { toolWhitelist = ["search"] }',
        'rag = { adapter = "none" }',
      ]);
      // The stub answers the tool-call intent with a real `search` call.
      const ingestEnv = { ...baseEnv, ANS_DOMAIN: "ingest", ANS_DB_PATH: join(work, "ingest.db") };
      const writer = mcpClient(mcpBin, ingestEnv, "ingest");
      clients.push(writer);
      await writer.ready();
      const asked = await writer.rpc("tools/call", {
        name: "ans_chat",
        arguments: { message: "TOOL-CALL-PLEASE find the anysearch-cli GitHub repository and report its URL." },
      });
      check(asked.result?.isError !== true, "the ingest turn completes", textOf(asked).slice(0, 200));
      const toolCalls = asked.result?.structuredContent?.toolCalls ?? {};
      check((toolCalls.search ?? 0) >= 1, "the model's search tool call really ran", JSON.stringify(toolCalls));

      const ingestDb = new Database(ingestEnv.ANS_DB_PATH, { readonly: true });
      let rows = [];
      try {
        rows = ingestDb.prepare("SELECT session_id, url, title, snippet FROM retrieval_results ORDER BY id DESC LIMIT 20").all();
      } finally { ingestDb.close(); }
      check(rows.length > 0, "the internal search wrote " + rows.length + " row(s) into the archive", JSON.stringify(rows.slice(0, 2)));

      // Recall's strict FTS rung ANDs every query term, so pick one long token.
      const token = rows
        .map((r) => (String(r.snippet ?? "").toLowerCase().match(/[a-z0-9]{7,}/g) ?? [])[0])
        .find(Boolean);
      if (!token) {
        skip("cross-session recall", "no archived row carried a token long enough for the strict recall rung");
      } else {
        const reader = mcpClient(mcpBin, { ...ingestEnv, ANS_DOMAIN: "recall" }, "recall");
        clients.push(reader);
        await reader.ready();
        const qk = await reader.rpc("tools/call", { name: "query_knowledge", arguments: { query: token } });
        const block = textOf(qk);
        check(qk.result?.isError !== true, "query_knowledge in the second session does not error", block.slice(0, 200));
        check(/provenance=memory/.test(block), "the recalled block names its trust tier", block.slice(0, 300));
        check(block.toLowerCase().includes(token), "the second session recalls a row the first session's search wrote", token);
        await reader.kill();
      }
      await writer.kill();
    }
    await prober.kill();

    // ================= F. older database: opens, migrates, keeps rows =================
    console.log("\n== F. older database: read, migrate, migrate again ==");
    {
      const legacyPath = join(work, "older.db");
      // Build it with the installed product, then strip the newest add-ons so it
      // looks like a database written by an earlier release. Stripping tables the
      // product shipped later is the closest honest stand-in for an old file: no
      // invented rows, no rewritten history.
      const warm = sh("\"" + ansBin + "\"", ["consolidate", "--session", "warm-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(warm.code === 0 || warm.code === 1, "a fresh database opens through the installed CLI", warm.out.slice(0, 300));

      const later = ["summary_sources", "summary_suspensions", "legacy_summary_states", "legacy_summary_attempts", "budget_reservations", "semantic_memories_fts"];
      let before = null;
      {
        const db = new Database(legacyPath);
        try {
          db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("older-session", "probe");
          db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source) VALUES (?,?,?,?,?)")
            .run("older-session", "https://older.example/x", "OLDER-ROW-TITLE", "OLDER-ROW-SNIPPET orphanword", "exa");
          for (const t of later) db.exec("DROP TABLE IF EXISTS " + t);
          before = {
            tables: db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c,
            messages: db.prepare("SELECT count(*) c FROM messages").get().c,
            rows: db.prepare("SELECT count(*) c FROM retrieval_results").get().c,
          };
        } finally { db.close(); }
      }
      check(before.rows >= 1, "the older database carries a row before migration", JSON.stringify(before));

      const open1 = sh("\"" + ansBin + "\"", ["consolidate", "--session", "older-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(open1.code === 0, "the older database opens and migrates (first open)", open1.out.slice(0, 400));
      const open2 = sh("\"" + ansBin + "\"", ["consolidate", "--session", "older-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(open2.code === 0, "opening the same database again is a no-op, not a failure (repeatable migration)", open2.out.slice(0, 400));

      const db = new Database(legacyPath, { readonly: true });
      let after;
      let restored;
      let keptRow;
      try {
        after = {
          tables: db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c,
          rows: db.prepare("SELECT count(*) c FROM retrieval_results").get().c,
        };
        restored = later.map((t) => [t, db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c > 0]);
        keptRow = db.prepare("SELECT title, snippet FROM retrieval_results WHERE url = ?").get("https://older.example/x");
      } finally { db.close(); }
      check(after.tables > before.tables, "the migration restored the newer tables", JSON.stringify({ before: before.tables, after: after.tables }));
      for (const [t, present] of restored) check(present, "migration restored table " + t);
      check(keptRow && keptRow.title === "OLDER-ROW-TITLE", "the old row survived the migration unchanged", JSON.stringify(keptRow));

      // The installed MCP must read the migrated file too — the CLI passing is
      // not the same claim as the server that serves tools.
      const legacyReader = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: legacyPath }, "legacy");
      clients.push(legacyReader);
      await legacyReader.ready();
      const recall = await legacyReader.rpc("tools/call", { name: "recall_memory", arguments: { query: "OLDER-ROW-SNIPPET" } });
      const recallText = textOf(recall);
      check(recall.result?.isError !== true, "the installed MCP opens the migrated database", recallText.slice(0, 200));
      check(/"hitsCount":\s*[1-9]/.test(recallText), "the migrated database still answers a recall for the old row", recallText.slice(0, 300));
      await legacyReader.kill();
    }
  } finally {
    await Promise.all(clients.map((c) => c.kill()));
    endpoint.close();
    // Windows keeps a handle on a just-killed child's files for a moment, so a
    // plain rmSync races the OS and throws EPERM. The sandbox is a temp dir; a
    // few bounded retries is the fix, and a failure here must never turn a green
    // acceptance run into a crash (the run's verdict is about the product).
    rmTempWithRetry(work);
  }

  console.log("\ninstalled-acceptance: " + passed + " passed, " + failed + " failed, " + skipped + " skipped");
  if (skipped > 0) {
    console.log("NOTE: skipped lanes did not run. This run proves the rest, not the skipped part.");
  }
  process.exit(failed === 0 ? 0 : 1);
}

await main();
