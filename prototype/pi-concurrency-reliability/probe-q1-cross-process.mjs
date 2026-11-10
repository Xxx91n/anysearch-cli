#!/usr/bin/env node
// Q1 probe: two REAL MCP server processes, one SQLite DB, one PI session
// directory, one sessionId. A local OpenAI-compatible SSE endpoint makes the
// timing observable.
//
//   S1 same session: A then B -> serialized by the cross-process file lock;
//      B's provider request carries A's completed answer.
//   S2 the PI JSONL session file: one file, every line parses, each answer
//      appears exactly once, and B only appends.
//   S3 a holder is SIGKILLed mid-run; the lock goes stale and B recovers.
//   S4 the killed request is not recorded as a completed run.
//   S5 different sessionIds still run in parallel.
//
// Run: node prototype/pi-concurrency-reliability/probe-q1-cross-process.mjs
// (requires a prior `pnpm -r build`)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MCP_DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const OUT = join(HERE, "out");
const NONCE = "n" + Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(MCP_DIST)) {
  console.error("missing built MCP dist; run pnpm -r build");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const findings = [];
function record(id, question, pass, evidence) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

// ---------- local OpenAI-compatible SSE endpoint ----------

function sseChunk(delta, finish, usage) {
  return "data: " + JSON.stringify({
    id: "q1", object: "chat.completion.chunk", created: 1, model: "probe-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) + "\n\n";
}
function ssePayload(text) {
  return [
    sseChunk({ role: "assistant", content: text }, null),
    sseChunk({}, "stop", { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}

const requestLog = [];
const openResponses = new Set();
function lastUserText(body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { return ""; }
  const msgs = parsed?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i]?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : x?.text ?? "")).join(" ");
  }
  return "";
}
function replyFor(text) {
  if (text.includes("Q1-A-START")) return "Q1-A-ANSWER-" + NONCE;
  if (text.includes("Q1-B-CONTINUE")) return "Q1-B-ANSWER-" + NONCE;
  if (text.includes("Q1-B-AFTER-CRASH")) return "Q1-B-AFTER-CRASH-ANSWER-" + NONCE;
  if (text.includes("Q1-PAR-A")) return "Q1-PAR-A-ANSWER-" + NONCE;
  if (text.includes("Q1-PAR-B")) return "Q1-PAR-B-ANSWER-" + NONCE;
  if (text.includes("Q1-HANG")) return "Q1-HANG-PARTIAL";
  return "Q1-GENERIC-" + NONCE;
}
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const text = lastUserText(body);
  const entry = { key: "", text, start: Date.now(), end: null, body };
  requestLog.push(entry);
  if (text.includes("Q1-A-START")) entry.key = "A";
  else if (text.includes("Q1-B-CONTINUE")) entry.key = "B";
  else if (text.includes("Q1-B-AFTER-CRASH")) entry.key = "B-crash";
  else if (text.includes("Q1-PAR-A")) entry.key = "parA";
  else if (text.includes("Q1-PAR-B")) entry.key = "parB";
  else if (text.includes("Q1-HANG")) entry.key = "hang";
  else entry.key = "other";

  res.writeHead(200, { "Content-Type": "text/event-stream" });
  openResponses.add(res);
  if (entry.key === "hang") {
    // Start the answer, then hold the connection so the MCP process stays
    // inside its run() and keeps the file lock.
    res.write(sseChunk({ role: "assistant", content: "Q1-HANG-PARTIAL" }, null));
    return;
  }
  await sleep(entry.key === "B-crash" ? 800 : 1200);
  res.end(ssePayload(replyFor(text)));
  entry.end = Date.now();
  openResponses.delete(res);
});
await new Promise((r) => fake.listen(0, "127.0.0.1", () => r()));
const port = fake.address().port;
const baseUrl = "http://127.0.0.1:" + port + "/v1";

// ---------- MCP stdio client (one per real process) ----------

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  const exited = new Promise((resolveExit) => child.on("exit", (code, signal) => {
    // A dead child must reject waiting RPCs, otherwise a failed start looks
    // like a hang and the probe never reports.
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("MCP process exited (code=" + code + ", signal=" + signal + ")\nstderr: " + stderr.slice(0, 400))); pending.delete(id); }
    resolveExit({ code, signal });
  }));
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); p.resolve(m);
      }
    }
  });
  function rpc(method, params, timeoutMs = 60000) {
    return new Promise((resolveRpc, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("rpc timeout: " + method + "\nstderr: " + stderr.slice(0, 400))); }, timeoutMs);
      pending.set(id, { resolve: resolveRpc, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
  }
  async function init() {
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "q1-probe", version: "1" } });
    notify("notifications/initialized", {});
  }
  return { child, rpc, init, exited, stderr: () => stderr, kill: () => child.kill("SIGKILL") };
}

async function chat(mcp, label, args) {
  const started = Date.now();
  try {
    const res = await mcp.rpc("tools/call", { name: "ans_chat", arguments: args }, 60000);
    const sc = res.result?.structuredContent ?? null;
    const text = (res.result?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { label, ok: res.result?.isError !== true, elapsedMs: Date.now() - started, isError: res.result?.isError === true, text, structured: sc };
  } catch (e) {
    return { label, ok: false, isError: true, elapsedMs: Date.now() - started, text: "TRANSPORT ERROR: " + (e instanceof Error ? e.message : String(e)), structured: null };
  }
}

// ---------- sandbox ----------

const tmpRoot = mkdtempSync(join(tmpdir(), "ans-q1-cross-"));
const dbPath = join(tmpRoot, "anysearch.db");
const piDir = join(tmpRoot, "pi-sessions");
mkdirSync(piDir, { recursive: true });
const baseEnv = {
  ANS_DB_PATH: dbPath,
  ANS_PI_SESSION_DIR: piDir,
  ANS_LLM_PROVIDER: "openai",
  ANS_LLM_MODEL: "probe-model",
  ANS_LLM_BASE_URL: baseUrl,
  ANS_LLM_API: "chat",
  ANS_LLM_API_KEY: "q1-probe-key-not-real",
  ANS_LLM_CONTEXT_WINDOW: "100000",
  ANS_PI_LOCK_STALE_MS: "3000",
  ANS_PI_LOCK_TIMEOUT_MS: "15000",
};

function sessionFiles() {
  if (!existsSync(piDir)) return [];
  return readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(piDir, f));
}
function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsable: line.slice(0, 120) }; }
  });
}
function fileWith(marker) {
  return sessionFiles().filter((f) => readFileSync(f, "utf8").includes(marker));
}
function entriesFor(key) {
  return requestLog.filter((r) => r.key === key);
}
function overlaps(a, b) {
  return a.start < (b.end ?? Date.now()) && b.start < (a.end ?? Date.now());
}

const evidence = {
  probe: "q1-cross-process",
  startedAt: new Date().toISOString(),
  fixedSamples: "SAMPLES-Q1-Q3.md",
  nonce: NONCE,
  checks: {},
  calls: {},
};

try {
  // ---------- S1: same session across two processes ----------
  console.log("S1: starting two MCP processes (sequential init avoids the schema-race)");
  const a = startMcp(baseEnv);
  await a.init();
  const b = startMcp(baseEnv);
  await b.init();
  const shared = "q1-shared-" + NONCE;

  const aCall = chat(a, "A", {
    sessionId: shared,
    message: "Q1-A-START. Reply with exactly: Q1-A-ANSWER-" + NONCE + ".",
  });
  // Wait until A actually holds the lock and is talking to the provider.
  const deadline = Date.now() + 5000;
  while (entriesFor("A").length === 0 && Date.now() < deadline) await sleep(25);
  await sleep(300);
  const bCall = chat(b, "B", {
    sessionId: shared,
    message: "Q1-B-CONTINUE. Restate the previous answer verbatim, then add: Q1-B-ANSWER-" + NONCE + ".",
  });
  const [aRes, bRes] = await Promise.all([aCall, bCall]);
  evidence.calls.sameSession = { a: aRes, b: bRes };

  const aEntries = entriesFor("A");
  const bEntries = entriesFor("B");
  record("S1-serialized", "same sessionId: A and B provider requests do not overlap",
    aEntries.length === 1 && bEntries.length === 1 && aEntries[0].end !== null && aEntries[0].end <= bEntries[0].start,
    { a: aEntries.map((e) => ({ start: e.start, end: e.end })), b: bEntries.map((e) => ({ start: e.start, end: e.end })) });

  record("S1-continuity", "B's provider request carries A's completed answer from the shared session record",
    bEntries.length === 1 && bEntries[0].body.includes("Q1-A-ANSWER-" + NONCE),
    bEntries[0] ? { bPromptIncludesA: bEntries[0].body.includes("Q1-A-ANSWER-" + NONCE), bLastUser: bEntries[0].text.slice(0, 120) } : null);

  record("S1-both-succeed", "both calls return a completed structured result with the same sessionId",
    aRes.ok && bRes.ok && aRes.structured?.sessionId === shared && bRes.structured?.sessionId === shared,
    { a: { ok: aRes.ok, sessionId: aRes.structured?.sessionId }, b: { ok: bRes.ok, sessionId: bRes.structured?.sessionId } });

  // ---------- S2: PI JSONL integrity ----------
  const sharedFiles = fileWith("Q1-A-ANSWER-" + NONCE);
  const lines = sharedFiles.length === 1 ? readJsonl(sharedFiles[0]) : [];
  const unparsable = lines.filter((l) => l.unparsable);
  // Count assistant MESSAGE OBJECTS, not raw substring hits: one JSONL entry
  // may echo a string in more than one field, which is not a duplicate write.
  const assistantTexts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (typeof node.role === "string" && typeof node.content !== "undefined") {
      let text = "";
      if (typeof node.content === "string") text = node.content;
      else if (Array.isArray(node.content)) text = node.content.map((c) => (c?.text ?? "")).join(" ");
      if (text) assistantTexts.push({ role: node.role, text });
    }
    for (const v of Object.values(node)) walk(v);
  };
  for (const line of lines) walk(line);
  const count = (marker) => assistantTexts.filter((m) => m.text.includes(marker)).length;
  const rawCount = (marker) => lines.map((l) => JSON.stringify(l)).join("\n").split(marker).length - 1;
  record("S2-one-file", "the shared sessionId has exactly one PI JSONL file", sharedFiles.length === 1, { files: sharedFiles.map((f) => f.replace(tmpRoot, "<tmp>")) });
  record("S2-lines-parse", "every PI JSONL line parses (no truncated/partial write)",
    lines.length >= 4 && unparsable.length === 0, { lines: lines.length, unparsable: unparsable.length });
  // B is asked to restate A's answer, so A's marker legitimately appears twice
  // across messages. The duplicate-write question is whether the turn record
  // itself was appended twice: exactly two user + two assistant entries, in order.
  const assistants = assistantTexts.filter((m) => m.role === "assistant");
  const users = assistantTexts.filter((m) => m.role === "user");
  record("S2-no-duplicate", "the shared turn record was appended once: 2 user + 2 assistant entries, in order",
    assistants.length === 2 && users.length === 2 &&
      assistants[0].text.includes("Q1-A-ANSWER-" + NONCE) &&
      assistants[1].text.includes("Q1-B-ANSWER-" + NONCE) &&
      !assistants[0].text.includes("Q1-B-ANSWER-" + NONCE),
    {
      assistantMessages: assistants.length, userMessages: users.length,
      answerRawOccurrences: { a: rawCount("Q1-A-ANSWER-" + NONCE), b: rawCount("Q1-B-ANSWER-" + NONCE) },
      note: "A marker occurs twice because B restates A's answer by sample design",
    });

  // ---------- S3/S4: holder killed mid-run ----------
  const crashSession = "q1-crash-" + NONCE;
  const c = startMcp(baseEnv);
  await c.init();
  const d = startMcp(baseEnv);
  await d.init();
  const hangCall = chat(c, "HANG", { sessionId: crashSession, message: "Q1-HANG. Hold the session open." });
  const hangDeadline = Date.now() + 5000;
  while (entriesFor("hang").length === 0 && Date.now() < hangDeadline) await sleep(25);
  await sleep(300);
  const crashCall = chat(d, "AFTER-CRASH", {
    sessionId: crashSession,
    message: "Q1-B-AFTER-CRASH. The previous process died; continue the same session.",
  });
  await sleep(500);
  c.kill();
  // The hanging HTTP response belongs to the killed process's provider call.
  for (const res of openResponses) { try { res.destroy(); } catch { /* already gone */ } }
  const killedExit = await c.exited;
  const hangRes = await hangCall;
  const afterCrashRes = await crashCall;
  evidence.calls.crash = { killed: hangRes, recovered: afterCrashRes, killedExit };

  record("S3-recovered", "after the holder is SIGKILLed the next process acquires the stale lock and completes",
    afterCrashRes.ok === true,
    { elapsedMs: afterCrashRes.elapsedMs, text: afterCrashRes.text.slice(0, 160), killedExit });

  const lockDir = join(piDir, "locks");
  const locksLeft = existsSync(lockDir) ? readdirSync(lockDir) : [];
  record("S3-lock-cleared", "no lock is left behind after recovery (not permanently stuck)", locksLeft.length === 0, { locksLeft });

  record("S4-no-fake-success", "the killed request never returns a successful result",
    hangRes.ok === false && hangRes.isError === true, { killed: { ok: hangRes.ok, text: hangRes.text.slice(0, 160) } });

  const crashFiles = fileWith("Q1-B-AFTER-CRASH-ANSWER-" + NONCE);
  const crashLines = crashFiles.length === 1 ? readJsonl(crashFiles[0]) : [];
  const crashText = crashLines.map((l) => JSON.stringify(l)).join("\n");
  record("S4-no-completion-record", "the killed run is not recorded as a completed answer in the PI JSONL",
    crashFiles.length === 1 && crashText.includes("Q1-B-AFTER-CRASH-ANSWER-" + NONCE) && !crashText.includes("Q1-HANG-PARTIAL"),
    { crashFiles: crashFiles.map((f) => f.replace(tmpRoot, "<tmp>")), hasPartial: crashText.includes("Q1-HANG-PARTIAL"), lines: crashLines.length });

  const db = new Database(dbPath, { readonly: true });
  const ledger = db.prepare("SELECT session_id, reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?").all(crashSession);
  db.close();
  record("S4-no-settlement", "the killed run is not settled as spent in the budget ledger",
    ledger.every((r) => Number(r.spent_tokens) === 0),
    { ledger });

  // ---------- S5: different sessions still parallel ----------
  const e = startMcp(baseEnv);
  await e.init();
  const f = startMcp(baseEnv);
  await f.init();
  const [parA, parB] = await Promise.all([
    chat(e, "PAR-A", { sessionId: "q1-par-a-" + NONCE, message: "Q1-PAR-A. Reply with Q1-PAR-A-ANSWER-" + NONCE + "." }),
    chat(f, "PAR-B", { sessionId: "q1-par-b-" + NONCE, message: "Q1-PAR-B. Reply with Q1-PAR-B-ANSWER-" + NONCE + "." }),
  ]);
  const pa = entriesFor("parA");
  const pb = entriesFor("parB");
  evidence.calls.parallel = { a: parA, b: parB };
  record("S5-parallel", "different sessionIds really overlap at the provider",
    pa.length === 1 && pb.length === 1 && overlaps(pa[0], pb[0]),
    { parA: pa.map((r) => ({ start: r.start, end: r.end })), parB: pb.map((r) => ({ start: r.start, end: r.end })) });
  record("S5-separate-files", "different sessions write separate JSONL files",
    fileWith("Q1-PAR-A-ANSWER-" + NONCE).length === 1 && fileWith("Q1-PAR-B-ANSWER-" + NONCE).length === 1,
    {
      aFiles: fileWith("Q1-PAR-A-ANSWER-" + NONCE).map((p) => p.replace(tmpRoot, "<tmp>")),
      bFiles: fileWith("Q1-PAR-B-ANSWER-" + NONCE).map((p) => p.replace(tmpRoot, "<tmp>")),
    });

  // ---------- credential hygiene ----------
  const allText = JSON.stringify(evidence) + readdirSync(OUT).filter((n) => n.endsWith(".json")).map((n) => readFileSync(join(OUT, n), "utf8")).join("");
  record("S6-no-credential", "evidence carries no credential material", !allText.includes("q1-probe-key-not-real"),
    { checkedChars: allText.length });

  // Diagnostic only: two processes starting at the SAME instant against a
  // brand-new empty DB. This was observed once as "database is locked"; record
  // it rather than hide it behind the sequential starts used above.
  const coldAttempts = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const coldRoot = mkdtempSync(join(tmpdir(), "ans-q1-cold-" + attempt + "-"));
    const coldEnv = {
      ...baseEnv,
      ANS_DB_PATH: join(coldRoot, "anysearch.db"),
      ANS_PI_SESSION_DIR: join(coldRoot, "pi"),
    };
    mkdirSync(coldEnv.ANS_PI_SESSION_DIR, { recursive: true });
    const ca = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], { env: { ...process.env, ...coldEnv }, stdio: ["pipe", "pipe", "pipe"] });
    const cb = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], { env: { ...process.env, ...coldEnv }, stdio: ["pipe", "pipe", "pipe"] });
    const cold = { attempt, a: { alive: true, stderr: "" }, b: { alive: true, stderr: "" } };
    for (const [name, child] of [["a", ca], ["b", cb]]) {
      child.stderr.on("data", (c) => { cold[name].stderr += c.toString().slice(0, 600); });
      child.on("exit", (code, signal) => { cold[name].alive = false; cold[name].exit = { code, signal }; });
    }
    await sleep(4000);
    cold.a.alive = ca.exitCode === null;
    cold.b.alive = cb.exitCode === null;
    // Snapshot before killing; the exit listener would otherwise mark every
    // recorded attempt as dead after cleanup.
    coldAttempts.push({ attempt, a: { ...cold.a }, b: { ...cold.b } });
    try { ca.kill("SIGKILL"); } catch { /* dead */ }
    try { cb.kill("SIGKILL"); } catch { /* dead */ }
    await sleep(200);
    rmSync(coldRoot, { recursive: true, force: true, maxRetries: 10 });
  }
  const coldFailures = coldAttempts.filter((c) => c.a.exit || c.b.exit);
  evidence.coldStart = { attempts: coldAttempts, failures: coldFailures.length };
  console.log((coldFailures.length === 0 ? "  ok   " : "  NOTE ") + "S0-cold-start — 4 simultaneous first starts on empty DBs (" +
    coldFailures.length + "/4 lost a process" +
    (coldFailures.length ? ", stderr=" + JSON.stringify(coldFailures[0].b.stderr.slice(0, 120)) : "") + ")");

  const failed = findings.filter((x) => !x.pass);
  evidence.checks = Object.fromEntries(findings.map((x) => [x.id, x]));
  evidence.failed = failed.map((x) => x.id);
  writeFileSync(join(OUT, "q1-cross-process.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q1-cross-process.json");
  for (const m of [a, b, c, d, e, f]) { try { m.child.kill(); } catch { /* already dead */ } }
  await sleep(300);
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10 });
  for (const res of openResponses) { try { res.destroy(); } catch { /* already gone */ } }
  fake.close();
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error("probe failed: " + (err instanceof Error ? err.stack ?? err.message : String(err)));
  try { fake.close(); } catch { /* closed */ }
  process.exitCode = 2;
}
