#!/usr/bin/env node
// Q1 real-path probe: BUILT ESM MCP server (apps/mcp/dist/index.js), stdio
// transport, real provider endpoint, real search providers, REAL `ans_chat`
// call (not /health), then a second call threading the returned sessionId.
//
// Evidence checked:
//   - dist is ESM and starts; tools/list carries the 5 tools
//   - ans_chat returns structuredContent.sessionId (server-minted handle)
//   - structuredContent.context.window === ANS_LLM_CONTEXT_WINDOW (1,048,000)
//   - usage block is present and names its missing dimensions (never a fake 0)
//   - PI session record exists on disk, one file per handle, grows on resume
//   - SQLite has the session row + retrieval archive rows
//   - stderr/stdout/evidence contain no API key material
//
// Env: inherits ANS_LLM_* (provider/model/baseUrl/api/key). Forces the real
// 1,048,000 window and a throwaway DB / PI session dir under a temp root.
// Output: prototype/pi-esm-full-sdk/out/q1-mcp-real.json

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const OUT = join(HERE, "out");
const WINDOW = 1048000;

const apiKey = process.env.ANS_LLM_API_KEY ?? "";
if (!process.env.ANS_LLM_PROVIDER || !process.env.ANS_LLM_MODEL) {
  console.error("missing ANS_LLM_PROVIDER / ANS_LLM_MODEL");
  process.exit(2);
}
if (!existsSync(DIST)) {
  console.error("missing built MCP dist: " + DIST + " (run pnpm -r build)");
  process.exit(2);
}

const tmpRoot = mkdtempSync(join(tmpdir(), "ans-q1-"));
const dbPath = join(tmpRoot, "anysearch.db");
const piDir = join(tmpRoot, "pi-sessions");
mkdirSync(OUT, { recursive: true });

const env = {
  ...process.env,
  ANS_LLM_CONTEXT_WINDOW: String(WINDOW),
  ANS_DB_PATH: dbPath,
  ANS_PI_SESSION_DIR: piDir,
};

const child = spawn(process.execPath, [DIST, "--transport", "stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString(); });

const pending = new Map();
let nextId = 1;
let buf = "";
const notifications = [];
child.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) {
      const { resolve: res, timer } = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(timer);
      res(m);
    } else if (m.method) {
      notifications.push(m);
    }
  }
});

function rpc(method, params, timeoutMs = 300000) {
  return new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error("rpc timeout: " + method + "\nstderr:\n" + redact(stderr)));
    }, timeoutMs);
    pending.set(id, { resolve: res, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");
}
function redact(text) {
  let t = String(text);
  if (apiKey && apiKey.length >= 8) t = t.split(apiKey).join("<REDACTED_API_KEY>");
  return t;
}

function sessionFiles() {
  if (!existsSync(piDir)) return [];
  return readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(piDir, f));
}
function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 120) }; }
  });
}

const evidence = {
  probe: "q1-mcp-real",
  startedAt: new Date().toISOString(),
  versions: {},
  checks: {},
  calls: [],
};

function check(name, cond, detail) {
  evidence.checks[name] = { pass: !!cond, detail: typeof detail === "string" ? detail : detail ?? null };
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail !== undefined && typeof detail === "string" ? " — " + detail : ""));
}

try {
  const pkg = JSON.parse(readFileSync(join(ROOT, "apps", "mcp", "package.json"), "utf8"));
  evidence.versions.mcpPackage = pkg.version;
  evidence.versions.mcpType = pkg.type;
  evidence.versions.node = process.version;
  check("apps/mcp manifest is ESM (type=module)", pkg.type === "module", String(pkg.type));
  const distText = readFileSync(DIST, "utf8");
  check("dist has no CJS marker (no require of node builtins)", !/require\(\s*["']node:/.test(distText));

  const init = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "q1-probe", version: "1.0.0" },
  }, 30000);
  evidence.serverInfo = init.result?.serverInfo ?? null;
  check("initialize succeeds", !!init.result, JSON.stringify(init.result?.serverInfo));
  notify("notifications/initialized", {});

  const list = await rpc("tools/list", {}, 30000);
  const names = (list.result?.tools ?? []).map((t) => t.name).sort();
  evidence.toolNames = names;
  check("tools/list returns the 5 expected tools",
    ["ans_chat", "query_knowledge", "recall_memory", "research_web", "search_web"].every((n) => names.includes(n)),
    names.join(","));

  async function chat(label, args) {
    const started = Date.now();
    const res = await rpc("tools/call", { name: "ans_chat", arguments: args }, 300000);
    const elapsedMs = Date.now() - started;
    const sc = res.result?.structuredContent ?? null;
    const textBlocks = (res.result?.content ?? []).filter((b) => b.type === "text").map((b) => b.text);
    const rec = {
      label,
      args,
      elapsedMs,
      isError: res.result?.isError === true,
      structured: sc,
      textChars: textBlocks[0]?.length ?? 0,
      textHead: (textBlocks[0] ?? "").slice(0, 400),
      sessionId: sc?.sessionId ?? null,
    };
    evidence.calls.push(rec);
    return rec;
  }

  const q1 = await chat("research", {
    message:
      "Research question for a memory-capability probe. Using web search, find the official Node.js release page and state which Node.js major version line is currently marked as Current. Answer in at most two sentences and include the source URL you used.",
  });
  check("ans_chat #1 returns without tool error", !q1.isError, q1.isError ? q1.textHead : "ok");
  check("ans_chat #1 mints a sessionId", typeof q1.sessionId === "string" && q1.sessionId.length > 0, q1.sessionId);
  check("ans_chat #1 carries run usage", !!q1.structured?.usage?.run, JSON.stringify(q1.structured?.usage?.run ?? null));
  check("run usage names missing dimensions instead of zero-filling",
    Array.isArray(q1.structured?.usage?.run?.missing), JSON.stringify(q1.structured?.usage?.run?.missing ?? null));
  check("context.window equals the configured 1,048,000",
    q1.structured?.context?.window === WINDOW, String(q1.structured?.context?.window));
  check("the internal search is counted as a tool call, separate from LLM usage",
    Number(q1.structured?.toolCalls?.search ?? 0) >= 1, JSON.stringify(q1.structured?.toolCalls ?? null));
  check("run usage carries cache reads and a cost figure",
    typeof q1.structured?.usage?.run?.cacheReadTokens === "number" &&
      typeof q1.structured?.usage?.run?.costUsd === "number",
    JSON.stringify({ cacheReadTokens: q1.structured?.usage?.run?.cacheReadTokens, costUsd: q1.structured?.usage?.run?.costUsd }));
  check("memory-side summary usage also carries cache fields",
    q1.structured?.usage?.memorySummary === null ||
      typeof q1.structured?.usage?.memorySummary?.cacheReadTokens === "number",
    JSON.stringify(q1.structured?.usage?.memorySummary ?? null));

  const filesAfter1 = sessionFiles();
  const jsonl1 = filesAfter1.length === 1 ? readJsonl(filesAfter1[0]) : [];
  evidence.piFiles = filesAfter1.map((f) => ({ path: f.replace(tmpRoot, "<tmp>"), lines: readJsonl(f).length }));
  check("PI wrote exactly one session record", filesAfter1.length === 1, String(filesAfter1.length));
  check("session record is non-trivial JSONL",
    jsonl1.length >= 2, String(jsonl1.length) + " lines");
  const jsonlText1 = JSON.stringify(jsonl1);
  check("session record keeps the original question text",
    jsonlText1.includes("which Node.js major version line is currently marked as Current"));

  // Resume: same handle, second turn. A resumed session must append to the SAME
  // file, not mint a second one, and the call must see the first answer.
  const q2 = await chat("resume", {
    sessionId: q1.sessionId,
    message: "In one sentence, restate the Node.js version line and source URL you just reported. Do not search again.",
  });
  check("ans_chat #2 resumes the same handle", q2.sessionId === q1.sessionId, String(q2.sessionId));
  check("ans_chat #2 returns without tool error", !q2.isError, q2.isError ? q2.textHead : "ok");
  const filesAfter2 = sessionFiles();
  evidence.piFilesAfterResume = filesAfter2.map((f) => ({ path: f.replace(tmpRoot, "<tmp>"), lines: readJsonl(f).length }));
  check("resume appended to the same PI record (still one file)", filesAfter2.length === 1, String(filesAfter2.length));
  const linesAfter2 = filesAfter2.length ? readJsonl(filesAfter2[0]).length : 0;
  check("resume grew the PI record", linesAfter2 > jsonl1.length, jsonl1.length + " -> " + linesAfter2);

  // SQLite: the handle is a real row and the research entered the archive.
  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  evidence.tables = tables;
  const sessionRow = db.prepare("SELECT * FROM sessions WHERE id = ?").get(q1.sessionId);
  check("SQLite has the session row for the minted handle", !!sessionRow, JSON.stringify(sessionRow ?? null));
  const retrievalCount = db.prepare("SELECT COUNT(*) AS n FROM retrieval_results").get().n;
  check("research material entered the archive (retrieval_results)", retrievalCount > 0, String(retrievalCount));
  const messages = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?").get(q1.sessionId).n;
  evidence.messageRows = messages;
  db.close();

  // Credential leakage: the key must not appear in stderr or the tool output.
  const allText = JSON.stringify(evidence.calls) + "\n" + stderr;
  const leaked = apiKey.length >= 8
    ? (allText.includes(apiKey) || allText.includes(apiKey.slice(0, 12)))
    : false;
  check("no API key material in tool output or server stderr", !leaked, leaked ? "LEAK" : "clean");
  check("stderr has no server crash", !/MCP server error|UnhandledPromiseRejection|TypeError/.test(stderr),
    stderr ? redact(stderr).slice(0, 300) : "(empty)");

  evidence.stderrHead = redact(stderr).slice(0, 1200);
} catch (e) {
  evidence.checks.probeCompleted = { pass: false, detail: redact(e instanceof Error ? e.stack ?? e.message : String(e)) };
  console.error(redact(e instanceof Error ? e.stack ?? e.message : String(e)));
} finally {
  const exited = new Promise((res) => { if (child.exitCode !== null) return res(); child.once("exit", res); setTimeout(res, 5000); });
  child.kill();
  await exited;
  evidence.finishedAt = new Date().toISOString();
  const failed = Object.entries(evidence.checks).filter(([, v]) => !v.pass);
  evidence.failures = failed.map(([k]) => k);
  writeFileSync(join(OUT, "q1-mcp-real.json"), redact(JSON.stringify(evidence, null, 2)));
  try { rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows handle lag; temp root is disposable */ }
  console.log("\n" + (failed.length === 0 ? "Q1 REAL-PATH: PASS" : "Q1 REAL-PATH: FAIL (" + failed.length + ")"));
  process.exit(failed.length === 0 ? 0 : 1);
}
