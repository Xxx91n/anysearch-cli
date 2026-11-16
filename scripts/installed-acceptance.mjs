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
// A fact only the out-of-scope material carries, so its absence from the
// knowledge row is checkable.
const OUTSIDE_FACT = "UNRELATEDPARKING policy applies to the Berlin office only.";
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
  // Echo a token from the LATEST user turn. A later request that carries this
  // answer proves the session record resumed; a fixed "answer" would not,
  // because the same constant would appear even on a fresh session.
  //
  // The last user message is what matters, not the first match in the body: on a
  // resumed turn the body still contains turn 1's question, so matching the raw
  // text returned `REPLY-TO-FIRST-TURN-QUESTION` again and repeated first turns
  // would have passed the resume checks.
  res.end(sseText("REPLY-TO-" + (latestUserMarker(body) ?? "UNKNOWN-TURN")));
});

/** The marker in the newest user message, or undefined when there is none. */
function latestUserMarker(body) {
  let messages = [];
  try { messages = JSON.parse(body)?.messages ?? []; } catch { return undefined; }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join(" ")
        : "";
    const marker = (text.match(/(FIRST-TURN-QUESTION|SECOND-TURN-QUESTION)/) ?? [])[1];
    if (marker) return marker;
  }
  return undefined;
}

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
    /**
     * Stop the server and resolve once it is really gone.
     *
     * Windows keeps an open handle on a killed child's database/WAL files until
     * the process object is reaped, so deleting the sandbox before that lands
     * throws EPERM. Awaiting the exit event is what makes cleanup deterministic
     * instead of a race; the timeout keeps a wedged child from hanging the run.
     *
     * `stderr` is captured only for the timeout message above: a hung RPC is
     * almost always the child failing to boot, and that reason lands on stderr.
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

/**
 * Run a command and capture its combined output.
 *
 * Two platforms, two mechanisms, because one string cannot be safe on both:
 *
 * - POSIX: pass the argv array straight to spawnSync with `shell: false`. The
 *   temporary directory name comes from mkdtemp, and a path containing `&`, `;`,
 *   `$` or a backtick would be reinterpreted by a shell. argv passing has no
 *   parser to fool, so those characters stay literal.
 * - Windows: the installed bin is `ans.cmd`, a batch shim that only starts
 *   through cmd.exe. So the command line is built here and quoted explicitly —
 *   a path with spaces needs quotes, and a bare name like `npm` must stay
 *   unquoted (cmd.exe resolves `"npm"` to another shim and the install dies with
 *   MODULE_NOT_FOUND). Anything else is refused rather than guessed at: an
 *   argument carrying a quote, `%`, `&`, `|`, `<`, `>` or `^` has no escaping
 *   rule this file can trust through cmd.exe.
 */
function sh(cmd, args, opts = {}) {
  if (process.platform !== "win32") {
    const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }
  const UNSAFE = /["%&|<>^]/;
  if (UNSAFE.test(cmd) || args.some((a) => UNSAFE.test(a))) {
    throw new Error("sh(): refusing a command line cmd.exe cannot be trusted to quote safely: " + cmd);
  }
  const isPath = cmd.includes("/") || cmd.includes("\\");
  const parts = [isPath ? '"' + cmd + '"' : cmd];
  for (const a of args) parts.push(/\s/.test(a) || a === "" ? '"' + a + '"' : a);
  const r = spawnSync(parts.join(" "), { encoding: "utf8", shell: true, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
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
    //
    // Every command runs with HOME/USERPROFILE and ANS_DB_PATH pointed into the
    // sandbox. `doctor` resolves the durable database path and creates its
    // directory, so inheriting the real environment would touch the operator's
    // own ~/.anysearch — a test must not do that.
    console.log("\n== A. CLI ==");
    const cliEnv = {
      ...process.env,
      USERPROFILE: work,
      HOME: work,
      ANS_DB_PATH: join(work, "cli-probe.db"),
      ANS_DOMAINS_DIR: join(work, "empty-domains"),
    };
    mkdirSync(cliEnv.ANS_DOMAINS_DIR, { recursive: true });
    const v = sh(ansBin, ["--version"], { cwd: prefix, env: cliEnv });
    check(v.code === 0, "installed ans --version exits 0", v.out);
    check(/\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), "version is a real release version", v.out);

    const doctor = sh(ansBin, ["doctor"], { cwd: prefix, env: cliEnv });
    check(doctor.code === 0, "installed ans doctor exits 0", doctor.out);
    check(/vector arm/.test(doctor.out), "doctor reports the vector arm status", doctor.out.slice(-400));

    const noScope = sh(ansBin, ["consolidate"], { cwd: prefix, env: cliEnv });
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
    // The stub is a custom endpoint with no price table and no server-sent
    // price, so the honest label is "estimated"/"unknown" — never "provider".
    // Asserting the actual value keeps a later regression toward
    // "provider-reported" visible instead of merely "a string was present".
    // The exact label, not a list of acceptable ones. This stub sends no price,
    // so pi-ai fills the figure from its own rate card: "estimated". A run that
    // ever started claiming "provider" (a server-sent bill) has changed behaviour
    // and must be caught here, not read as "a string was present".
    check(usage1?.costSource === "estimated",
      "the run labels its cost as a rate-card estimate, not a server-sent price", JSON.stringify(usage1?.costSource));
    check(usage1?.costUsd === 0, "the run's cost figure is the estimator's zero, not a bill", JSON.stringify(usage1?.costUsd));
    check(Array.isArray(usage1?.missing) && usage1.missing.some((m) => m === "cost (estimated)"),
      "the run names the estimated cost gap instead of rendering it as free", JSON.stringify(usage1?.missing));
    const ctx1 = turn1.result?.structuredContent?.context;
    check(!!ctx1 && typeof ctx1.window === "number" && ctx1.window > 0, "turn 1 reports the context window it used", JSON.stringify(ctx1));

    const sid = turn1.result?.structuredContent?.sessionId;
    check(typeof sid === "string" && sid.length > 0, "turn 1 returns a resumable session handle", String(sid));

    const turn2 = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "SECOND-TURN-QUESTION", sessionId: sid } });
    check(turn2.result?.isError !== true, "turn 2 with the handle completes", textOf(turn2).slice(0, 200));
    const t2text = textOf(turn2);
    // The answer must be to turn 2's question. Without this, repeating turn 1
    // passes the resume check: the body still contains turn 1's question and its
    // answer either way, so only the NEW turn proves the run moved forward.
    check(/REPLY-TO-SECOND-TURN-QUESTION/.test(t2text),
      "turn 2's answer is to turn 2's question, not a repeat of turn 1", t2text.slice(0, 200));
    check(turn2.result?.structuredContent?.sessionId === sid, "turn 2 keeps the same session handle", String(turn2.result?.structuredContent?.sessionId));
    const turn2Body = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(turn2Body.includes("FIRST-TURN-QUESTION"), "turn 2 request carries turn 1's question (the record resumed)");
    check(turn2Body.includes("REPLY-TO-FIRST-TURN-QUESTION"), "turn 2 request carries turn 1's answer (the record resumed)");
    check(turn2Body.includes("SECOND-TURN-QUESTION"), "turn 2 request carries its own question too", turn2Body.slice(-300));

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
      let coldTables = [];
      try {
        coldTables = coldCheck.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      } finally { coldCheck.close(); }
      // Name the tables each layer depends on instead of asserting a count
      // floor: "at least 30" also passes when one whole later-layer table is
      // missing, which is exactly the partial schema this lane exists to catch.
      const requiredTables = [
        "sessions", "messages", "retrieval_results", "resume_anchors", "budget_ledger",
        "semantic_memories", "summary_sources", "summary_suspensions",
        "legacy_summary_states", "legacy_summary_attempts", "entities", "edges",
      ];
      const missingTables = requiredTables.filter((t) => !coldTables.includes(t));
      check(missingTables.length === 0,
        "the cold-started database carries every layer's table (" + coldTables.length + " tables)",
        "missing: " + missingTables.join(","));
      await coldA.kill();
      await coldB.kill();
    }

    // ================= D. consolidate on the installed artifact =================
    console.log("\n== D. consolidate: scope guard, dry-run, apply ==");

    const noScopeCall = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate" } });
    check(noScopeCall.result?.isError === true, "consolidate through MCP with no scope is a tool error", textOf(noScopeCall).slice(0, 200));
    check(/explicit scope is required/.test(textOf(noScopeCall)), "the MCP no-scope error names the missing scope", textOf(noScopeCall).slice(0, 200));

    // Seed three materials straight into the installed schema FIRST, so the
    // dry-run below reads a real, non-empty scope. Called before the dry-run on
    // purpose: a preview over an empty session would pass whether or not it
    // wrote anything, which is the assertion that proves nothing.
    // The out-of-scope rows live in the SAME session as the selected three, and
    // carry a different entity and fact.
    //
    // There are THREE of them on purpose. One out-of-scope row proves nothing:
    // the batch threshold will not build knowledge from a single material, so a
    // session-scoped run would look identical to a list-scoped one. Three makes
    // the two scopes drift apart — a widened run would add a second knowledge
    // row — which is what the assertions below can actually catch. Verified by
    // mutation: swapping memoryIds for sessionId turns them red.
    const seedSession = "acc267-seed";
    let seededIds = [];
    let outsideIds = [];
    {
      const db = new Database(baseEnv.ANS_DB_PATH);
      try {
        db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run(seedSession, "probe");
        for (let i = 1; i <= 3; i++) {
          const r = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?,?,?,?,?,?)")
            .run(seedSession, "https://acme.example/hours-v" + i, "acme hours v" + i, FACT, "exa", "acme-hours");
          seededIds.push(Number(r.lastInsertRowid));
        }
        for (let i = 1; i <= 3; i++) {
          const r = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?,?,?,?,?,?)")
            .run(seedSession, "https://outside.example/untouched-v" + i, "outside material v" + i, OUTSIDE_FACT, "exa", "outside-entity");
          outsideIds.push(Number(r.lastInsertRowid));
        }
      } finally { db.close(); }
    }
    check(seededIds.length === 3, "seeded three materials for the apply lane", seededIds.join(","));
    check(outsideIds.length === 3, "seeded three materials deliberately outside the scope (enough to pass the batch threshold)", outsideIds.join(","));

    const dry = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate", memoryIds: seededIds, dryRun: true } });
    check(dry.result?.isError !== true, "consolidate dry-run completes", textOf(dry).slice(0, 200));
    const dryScope = dry.result?.structuredContent?.scope;
    check(dryScope?.by === "memory", "consolidate dry-run echoes the scope kind it actually read", JSON.stringify(dryScope));
    check((dry.result?.structuredContent?.report?.clustersScanned ?? 0) > 0,
      "the dry-run really scanned the seeded materials", JSON.stringify(dry.result?.structuredContent?.report?.clustersScanned));
    check((dry.result?.structuredContent?.report?.add ?? 0) === 1,
      "the dry-run reports what an apply would add", JSON.stringify(dry.result?.structuredContent?.counts));
    {
      // "Nothing saved" is the promise. Check the database, not the wording.
      const db = new Database(baseEnv.ANS_DB_PATH, { readonly: true });
      let rows;
      try { rows = db.prepare("SELECT count(*) c FROM semantic_memories").get().c; }
      finally { db.close(); }
      check(rows === 0, "the dry-run wrote no knowledge row", "semantic_memories rows=" + rows);
    }

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
    // Consolidation answers differently from the run, and for a real reason: its
    // seams read the session's price table, a custom endpoint declares none, so
    // the honest label is "unknown" rather than the run's rate-card "estimated".
    // Asserting each surface's own value is what makes a swap between them fail.
    check(usageApply?.costBasis === "unknown",
      "consolidation labels an unpriced endpoint as unknown, not as a server-sent price", JSON.stringify(usageApply?.costBasis));
    check(usageApply?.costUsd === 0, "consolidation's unknown cost is a placeholder, not a zero bill", JSON.stringify(usageApply?.costUsd));
    check(Array.isArray(usageApply?.missing) && usageApply.missing.some((m) => /consolidation cost/.test(m)),
      "consolidation names the unknown cost dimension", JSON.stringify(usageApply?.missing));
    {
      const db = new Database(baseEnv.ANS_DB_PATH, { readonly: true });
      try {
        const rows = db.prepare("SELECT content, valid_until FROM semantic_memories").all();
        check(rows.length === 1, "the knowledge row is really in the database", JSON.stringify(rows));
        check(rows.length === 1 && rows[0].valid_until === null, "the written row is live", JSON.stringify(rows));
        check(rows.length === 1 && String(rows[0].content).includes("Acme"), "the written row carries the summarised fact", JSON.stringify(rows).slice(0, 200));

        // Scope did not widen. Two independent signals, because either alone can
        // pass for the wrong reason: no second knowledge row was built from the
        // outside entity, and those rows are still live and un-superseded.
        check(rows.length === 1, "no knowledge row was built from the out-of-scope entity", JSON.stringify(rows.map((r) => r.content).slice(0, 2)));
        const outsideRows = db.prepare("SELECT id, valid_until, superseded_by FROM retrieval_results WHERE id IN (?,?,?)").all(...outsideIds);
        check(outsideRows.length === 3 && outsideRows.every((r) => r.valid_until === null && r.superseded_by === null),
          "the materials outside the scope were left alone", JSON.stringify(outsideRows));
        const inScope = db.prepare("SELECT count(*) c FROM retrieval_results WHERE id IN (?,?,?) AND (valid_until IS NULL AND superseded_by IS NULL)").get(...seededIds).c;
        check(inScope === 3, "the selected materials are still live after the run", "live=" + inScope);
        check(!String(rows[0]?.content ?? "").includes("UNRELATEDPARKING"),
          "the knowledge row does not contain the out-of-scope fact", String(rows[0]?.content ?? "").slice(0, 120));
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
      //
      // Take it from the part of the row the adapter will actually hand back:
      // `query_knowledge` collapses whitespace and keeps only the first
      // RAG_HIT_MAX_CHARS (600) characters of each hit. A token picked from
      // beyond that point hits in the database but never appears in the returned
      // block, so the assertion would fail on a row that was recalled correctly.
      const ADAPTER_HIT_CHARS = 600;
      const token = rows
        .map((r) => (String(r.snippet ?? "")
          .replace(/\s+/g, " ").trim().slice(0, ADAPTER_HIT_CHARS)
          .toLowerCase().match(/[a-z0-9]{7,}/g) ?? [])[0])
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
      //
      // `consolidate` is the opener because it opens the DURABLE store at
      // ANS_DB_PATH. `doctor`'s store check runs in memory, so it would report
      // green while writing no schema file at all — the wrong probe for this
      // lane. The exit code must be 0: the stub endpoint is up and the scope has
      // no materials, so a non-zero code is a real failure, not "LLM absent".
      const warm = sh(ansBin, ["consolidate", "--session", "warm-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(warm.code === 0, "a fresh database opens through the installed CLI (consolidate exits 0)", warm.out.slice(0, 400));
      check(/scanned \d+ cluster/.test(warm.out), "the fresh-database run reports what it scanned", warm.out.slice(0, 300));

      // The add-on tables a later release introduced. Dropping them makes this
      // file look like one an earlier version wrote.
      const laterTables = ["summary_sources", "summary_suspensions", "legacy_summary_states", "legacy_summary_attempts", "budget_reservations", "semantic_memories_fts"];
      let before = null;
      {
        const db = new Database(legacyPath);
        try {
          db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("older-session", "probe");
          db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source) VALUES (?,?,?,?,?)")
            .run("older-session", "https://older.example/x", "OLDER-ROW-TITLE", "OLDER-ROW-SNIPPET orphanword", "exa");
          for (const t of laterTables) db.exec("DROP TABLE IF EXISTS " + t);
          before = {
            tables: db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c,
            rows: db.prepare("SELECT count(*) c FROM retrieval_results").get().c,
          };
        } finally { db.close(); }
      }
      check(before.rows >= 1, "the older database carries a row before migration", JSON.stringify(before));

      const open1 = sh(ansBin, ["consolidate", "--session", "older-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(open1.code === 0, "the older database opens and migrates (first open)", open1.out.slice(0, 400));
      const open2 = sh(ansBin, ["consolidate", "--session", "older-session"], {
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
        restored = laterTables.map((t) => [t, db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c > 0]);
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
