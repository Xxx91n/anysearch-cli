#!/usr/bin/env node
// Lock probe: C1 (a healthy long run must not lose the lock) and C2 (a really
// killed holder must recover). Uses two REAL MCP processes, one temp DB, one
// PI session directory and a local OpenAI-compatible SSE endpoint whose delay
// makes the 3-second stale window observable.
//
// C1 is run twice on the same binary:
//   before  ANS_PROTOTYPE_LOCK_HEARTBEAT=0 -> old mtime-only rule: B steals a
//           lock held by a live process, provider requests overlap.
//   after   heartbeat default on           -> owner pid/host + heartbeat keep
//           the lock valid: B waits, then continues A's session.
// C2 is the preserved crash-recovery assertion set from the previous round.
//
// Run: node prototype/pi-q20-q21-lock-recovery/probe-lock-live.mjs
// (requires a prior build of apps/mcp)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  console.error("missing built MCP dist; build first");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const findings = [];
function record(id, question, pass, evidence) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

// ---------- local SSE endpoint ----------

function sseChunk(delta, finish, usage) {
  return "data: " + JSON.stringify({
    id: "lock", object: "chat.completion.chunk", created: 1, model: "probe-model",
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
  if (text.includes("LOCK-A-START")) return "LOCK-A-ANSWER-" + NONCE;
  if (text.includes("LOCK-B-CONTINUE")) return "LOCK-B-ANSWER-" + NONCE;
  if (text.includes("LOCK-B-AFTER-CRASH")) return "LOCK-B-AFTER-CRASH-ANSWER-" + NONCE;
  if (text.includes("LOCK-HANG")) return "LOCK-HANG-PARTIAL-" + NONCE;
  return "LOCK-GENERIC-" + NONCE;
}
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const text = lastUserText(body);
  const key = text.includes("LOCK-A-START") ? "A"
    : text.includes("LOCK-B-CONTINUE") ? "B"
    : text.includes("LOCK-B-AFTER-CRASH") ? "B-crash"
    : text.includes("LOCK-HANG") ? "hang" : "other";
  const entry = { key, text, start: Date.now(), end: null, body };
  requestLog.push(entry);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  openResponses.add(res);
  if (entry.key === "hang") {
    res.write(sseChunk({ role: "assistant", content: "LOCK-HANG-PARTIAL-" + NONCE }, null));
    return; // hold the connection: the holder keeps the session lock
  }
  await sleep(entry.key === "A" ? 6000 : 800);
  res.end(ssePayload(replyFor(text)));
  entry.end = Date.now();
  openResponses.delete(res);
});
await new Promise((r) => fake.listen(0, "127.0.0.1", () => r()));
const baseUrl = "http://127.0.0.1:" + fake.address().port + "/v1";

// ---------- MCP client ----------

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  const exited = new Promise((resolveExit) => child.on("exit", (code, signal) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("MCP exited (code=" + code + ", signal=" + signal + ")")); pending.delete(id); }
    resolveExit({ code, signal });
  }));
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
    }
  });
  function rpc(method, params, timeoutMs = 60000) {
    return new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("rpc timeout: " + method + " stderr=" + stderr.slice(0, 300))); }, timeoutMs);
      pending.set(id, { resolve: res, reject: rej, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
  }
  async function init() {
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "lock-probe", version: "1" } });
    notify("notifications/initialized", {});
  }
  return { child, rpc, init, exited, stderr: () => stderr, kill: () => child.kill("SIGKILL") };
}

async function chat(mcp, kind, args) {
  const started = Date.now();
  try {
    const res = await mcp.rpc("tools/call", { name: "ans_chat", arguments: args }, 60000);
    const sc = res.result?.structuredContent ?? null;
    const text = (res.result?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { kind, ok: res.result?.isError !== true, isError: res.result?.isError === true, elapsedMs: Date.now() - started, text, structured: sc };
  } catch (e) {
    return { kind, ok: false, isError: true, elapsedMs: Date.now() - started, text: "TRANSPORT ERROR: " + (e instanceof Error ? e.message : String(e)), structured: null };
  }
}

// ---------- sandbox helpers ----------

function sessionFiles(piDir) {
  if (!existsSync(piDir)) return [];
  return readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(piDir, f));
}
function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsable: line.slice(0, 120) }; }
  });
}
function fileWith(piDir, marker) {
  return sessionFiles(piDir).filter((f) => readFileSync(f, "utf8").includes(marker));
}
function lockSnapshot(piDir) {
  const locksDir = join(piDir, "locks");
  if (!existsSync(locksDir)) return { dirs: [], entries: [] };
  const dirs = readdirSync(locksDir);
  const entries = dirs.map((name) => {
    const path = join(locksDir, name);
    let owner = null;
    let heartbeatAgeMs = null;
    let dirAgeMs = null;
    try { owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")); } catch { /* missing owner */ }
    try { heartbeatAgeMs = Date.now() - statSync(join(path, "heartbeat")).mtimeMs; } catch { /* no heartbeat */ }
    try { dirAgeMs = Date.now() - statSync(path).mtimeMs; } catch { /* gone */ }
    return { name, owner, heartbeatAgeMs, dirAgeMs };
  });
  return { dirs, entries };
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
}
function makeEnv(piDir, dbPath) {
  return {
    ANS_DB_PATH: dbPath,
    ANS_PI_SESSION_DIR: piDir,
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: baseUrl,
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "lock-probe-key-not-real",
    ANS_LLM_CONTEXT_WINDOW: "100000",
    ANS_PI_LOCK_STALE_MS: "3000",
    ANS_PI_LOCK_TIMEOUT_MS: "20000",
  };
}

const evidence = {
  probe: "lock-live-recovery",
  startedAt: new Date().toISOString(),
  samples: "SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed)",
  nonce: NONCE,
  note: "short stale window is a test value, not the formal default",
  c1: {},
  c2: {},
  checks: findings,
};

try {
  // ================= C1 before: mtime-only lock =================
  {
    const root = mkdtempSync(join(tmpdir(), "ans-lock-before-"));
    const dbPath = join(root, "anysearch.db");
    const piDir = join(root, "pi");
    mkdirSync(piDir, { recursive: true });
    const env = { ...makeEnv(piDir, dbPath), ANS_PROTOTYPE_LOCK_HEARTBEAT: "0" };
    const a = startMcp(env); await a.init();
    const b = startMcp(env); await b.init();
    const shared = "lock-live-" + NONCE;
    const aCall = chat(a, "A", { sessionId: shared, message: "LOCK-A-START. Reply with exactly LOCK-A-ANSWER-" + NONCE + "." });
    const deadline = Date.now() + 5000;
    while (!requestLog.some((r) => r.key === "A") && Date.now() < deadline) await sleep(25);
    await sleep(3600); // lock is ~3.6s old: past the 3s stale window, holder alive
    const snapAt4s = lockSnapshot(piDir);
    const bCall = chat(b, "B", {
      sessionId: shared,
      message: "LOCK-B-CONTINUE. Restate the previous answer, then add LOCK-B-ANSWER-" + NONCE + ".",
    });
    const [aRes, bRes] = await Promise.all([aCall, bCall]);
    const aEntry = requestLog.find((r) => r.key === "A");
    const bEntry = requestLog.find((r) => r.key === "B");
    const overlap = !!(aEntry && bEntry && bEntry.start < (aEntry.end ?? Date.now()));
    const files = fileWith(piDir, "LOCK-A-ANSWER-" + NONCE);
    const lines = files.length === 1 ? readJsonl(files[0]) : [];
    const badLines = lines.filter((l) => l.unparsable).length;
    evidence.c1.before = {
      snapAt4s,
      a: { ok: aRes.ok, elapsedMs: aRes.elapsedMs },
      b: { ok: bRes.ok, elapsedMs: bRes.elapsedMs },
      provider: {
        a: aEntry ? { start: aEntry.start, end: aEntry.end } : null,
        b: bEntry ? { start: bEntry.start, end: bEntry.end } : null,
        overlap,
      },
      jsonl: { files: files.length, lines: lines.length, unparsable: badLines },
    };
    console.log("C1 before (heartbeat=0): overlap=" + overlap + ", jsonl lines=" + lines.length + ", unparsable=" + badLines);
    a.child.kill(); b.child.kill();
    await sleep(300);
    requestLog.length = 0;
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }

  // ================= C1 after: heartbeat + live-pid protection =================
  {
    const root = mkdtempSync(join(tmpdir(), "ans-lock-after-"));
    const dbPath = join(root, "anysearch.db");
    const piDir = join(root, "pi");
    mkdirSync(piDir, { recursive: true });
    const env = makeEnv(piDir, dbPath);
    const a = startMcp(env); await a.init();
    const b = startMcp(env); await b.init();
    const shared = "lock-live-" + NONCE;
    const aCall = chat(a, "A", { sessionId: shared, message: "LOCK-A-START. Reply with exactly LOCK-A-ANSWER-" + NONCE + "." });
    const deadline = Date.now() + 5000;
    while (!requestLog.some((r) => r.key === "A") && Date.now() < deadline) await sleep(25);
    await sleep(3800); // past the 3s stale window while A is still running
    const snapAt4s = lockSnapshot(piDir);
    const owner = snapAt4s.entries[0]?.owner ?? null;
    const bCall = chat(b, "B", {
      sessionId: shared,
      message: "LOCK-B-CONTINUE. Restate the previous answer, then add LOCK-B-ANSWER-" + NONCE + ".",
    });
    const [aRes, bRes] = await Promise.all([aCall, bCall]);
    const aEntry = requestLog.find((r) => r.key === "A");
    const bEntry = requestLog.find((r) => r.key === "B");

    const files = fileWith(piDir, "LOCK-A-ANSWER-" + NONCE);
    const lines = files.length === 1 ? readJsonl(files[0]) : [];
    const unparsable = lines.filter((l) => l.unparsable).length;
    const msgs = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (typeof node.role === "string" && typeof node.content !== "undefined") {
        let text = "";
        if (typeof node.content === "string") text = node.content;
        else if (Array.isArray(node.content)) text = node.content.map((c) => (c?.text ?? "")).join(" ");
        if (text) msgs.push({ role: node.role, text });
      }
      for (const v of Object.values(node)) walk(v);
    };
    for (const line of lines) walk(line);
    const assistants = msgs.filter((m) => m.role === "assistant");
    const users = msgs.filter((m) => m.role === "user");
    const locksLeft = lockSnapshot(piDir).dirs;

    evidence.c1.after = {
      snapAt4s,
      ownerPid: owner?.pid ?? null,
      ownerPidAlive: owner ? pidAlive(owner.pid) : false,
      aPid: a.child.pid,
      a: { ok: aRes.ok, elapsedMs: aRes.elapsedMs },
      b: { ok: bRes.ok, elapsedMs: bRes.elapsedMs },
      provider: {
        a: aEntry ? { start: aEntry.start, end: aEntry.end } : null,
        b: bEntry ? { start: bEntry.start, end: bEntry.end } : null,
        overlap: !!(aEntry && bEntry && bEntry.start < (aEntry.end ?? Date.now())),
      },
      jsonl: {
        files: files.length, lines: lines.length, unparsable,
        assistantMessages: assistants.length, userMessages: users.length,
        orderOk: assistants[0]?.text.includes("LOCK-A-ANSWER-" + NONCE) &&
          assistants[1]?.text.includes("LOCK-B-ANSWER-" + NONCE) &&
          !assistants[0]?.text.includes("LOCK-B-ANSWER-" + NONCE),
      },
      locksLeft,
    };

    record("C1-no-steal", "A 正常跑过 3 秒过期线时，B 不抢锁，两个 provider 请求不重叠",
      !evidence.c1.after.provider.overlap &&
        aEntry?.end != null && bEntry != null && aEntry.end <= bEntry.start,
      evidence.c1.after.provider);
    record("C1-heartbeat", "锁在 4 秒时仍有活进程证据：owner pid 是本机活进程，心跳是新的",
      owner !== null && owner.pid === a.child.pid && pidAlive(owner.pid) &&
        snapAt4s.entries[0].heartbeatAgeMs !== null && snapAt4s.entries[0].heartbeatAgeMs < 1600,
      { owner, heartbeatAgeMs: snapAt4s.entries[0]?.heartbeatAgeMs });
    record("C1-continuity", "B 接上 A 的会话并成功返回同一个 sessionId",
      aRes.ok && bRes.ok && bRes.structured?.sessionId === shared,
      { a: aRes.structured?.sessionId, b: bRes.structured?.sessionId });
    record("C1-jsonl", "同一会话只有一份 JSONL，每行可解析，2 user + 2 assistant 顺序正确",
      files.length === 1 && unparsable === 0 &&
        assistants.length === 2 && users.length === 2 && evidence.c1.after.jsonl.orderOk,
      evidence.c1.after.jsonl);
    record("C1-lock-cleared", "结束后锁目录清空", locksLeft.length === 0, { locksLeft });
    console.log("C1 after: overlap=" + evidence.c1.after.provider.overlap +
      ", heartbeatAgeMs=" + evidence.c1.after.snapAt4s.entries[0]?.heartbeatAgeMs);

    a.child.kill(); b.child.kill();
    await sleep(300);
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }

  // ================= C2: holder really killed =================
  {
    const root = mkdtempSync(join(tmpdir(), "ans-lock-crash-"));
    const dbPath = join(root, "anysearch.db");
    const piDir = join(root, "pi");
    mkdirSync(piDir, { recursive: true });
    const env = makeEnv(piDir, dbPath);
    const a = startMcp(env); await a.init();
    const b = startMcp(env); await b.init();
    const shared = "lock-crash-" + NONCE;
    const hangCall = chat(a, "HANG", { sessionId: shared, message: "LOCK-HANG. Hold the session open." });
    const deadline = Date.now() + 5000;
    while (!requestLog.some((r) => r.key === "hang") && Date.now() < deadline) await sleep(25);
    await sleep(400);
    const crashCall = chat(b, "B-crash", {
      sessionId: shared,
      message: "LOCK-B-AFTER-CRASH. The previous process died; continue the same session.",
    });
    await sleep(500);
    const beforeKill = lockSnapshot(piDir);
    a.kill();
    for (const res of openResponses) { try { res.destroy(); } catch { /* already gone */ } }
    const killedExit = await a.exited;
    const hangRes = await hangCall;
    const afterCrashRes = await crashCall;

    const crashFiles = fileWith(piDir, "LOCK-B-AFTER-CRASH-ANSWER-" + NONCE);
    const crashLines = crashFiles.length === 1 ? readJsonl(crashFiles[0]) : [];
    const crashText = crashLines.map((l) => JSON.stringify(l)).join("\n");
    const db = new Database(dbPath, { readonly: true });
    const ledger = db.prepare("SELECT session_id, reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?").all(shared);
    db.close();
    const locksLeft = lockSnapshot(piDir).dirs;

    evidence.c2 = {
      beforeKill,
      killedExit,
      killed: { ok: hangRes.ok, isError: hangRes.isError, text: hangRes.text.slice(0, 200) },
      recovered: { ok: afterCrashRes.ok, elapsedMs: afterCrashRes.elapsedMs, sessionId: afterCrashRes.structured?.sessionId },
      jsonl: {
        files: crashFiles.length,
        lines: crashLines.length,
        hasPartial: crashText.includes("LOCK-HANG-PARTIAL-" + NONCE),
        hasRecovered: crashText.includes("LOCK-B-AFTER-CRASH-ANSWER-" + NONCE),
      },
      ledger,
      locksLeft,
    };

    record("C2-recovered", "持锁进程真被杀后，等待方拿到锁并完成",
      afterCrashRes.ok === true && afterCrashRes.structured?.sessionId === shared, evidence.c2.recovered);
    record("C2-no-fake-success", "被杀请求以失败/传输错误结束，不能算成功",
      hangRes.ok === false && hangRes.isError === true, evidence.c2.killed);
    record("C2-no-partial-record", "PI JSONL 没有半截回答，B 的完成记录存在",
      crashFiles.length === 1 && !evidence.c2.jsonl.hasPartial && evidence.c2.jsonl.hasRecovered,
      evidence.c2.jsonl);
    record("C2-no-settlement", "被杀请求没有把已花 token 记进 budget ledger",
      ledger.every((r) => Number(r.spent_tokens) === 0), { ledger });
    record("C2-lock-cleared", "恢复后锁目录清空", locksLeft.length === 0, { locksLeft });
    record("C2-jsonl-integrity", "JSONL 无损坏/重复写入：每一行可解析",
      crashLines.length > 0 && crashLines.every((l) => !l.unparsable), { lines: crashLines.length });
    console.log("C2: recovered=" + afterCrashRes.ok + ", partial=" + evidence.c2.jsonl.hasPartial +
      ", ledgerSpent=" + ledger.map((r) => r.spent_tokens).join(","));

    a.child.kill(); b.child.kill();
    await sleep(300);
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }

  // Credential hygiene.
  const text = JSON.stringify(evidence);
  record("SEC", "证据文件不含密钥材料", !text.includes("lock-probe-key-not-real"), { checkedChars: text.length });

  writeFileSync(join(OUT, "lock-live-recovery.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  for (const f of failed) console.log("  FAIL DETAIL " + f.id + " " + JSON.stringify(f.evidence).slice(0, 1200));
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/lock-live-recovery.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error("probe failed: " + (err instanceof Error ? err.stack ?? err.message : String(err)));
  evidence.error = String(err?.stack ?? err);
  writeFileSync(join(OUT, "lock-live-recovery.json"), JSON.stringify(evidence, null, 2) + "\n");
  process.exitCode = 2;
} finally {
  try { fake.close(); } catch { /* closed */ }
}
