// #266 acceptance (D12, T3) at the MCP layer: two REAL `ans-mcp` processes,
// one temp database, one PI session directory, and a local OpenAI-compatible
// SSE endpoint whose delays make the lock windows observable.
//
//   C1  a healthy long run is not stolen: with the 3 s test stale window, a
//       6 s run passes the expiry line at second 4 and the second process
//       still waits — provider calls never overlap, the session record
//       continues, and the lock is cleaned up (production wait cap 120 s
//       stays in force; only the stale window is shortened for the test).
//   C2  a really killed holder recovers: NO lock env overrides — production
//       10 min stale and 120 s wait — and the waiting process takes over in
//       seconds once the holder's pid is confirmed dead, without a fake
//       success, a half-written record, or a settlement for the killed run.
//   C3  the wait cap: with a 3 s test cap, a contender gets an explicit
//       "session busy" error, and the session is usable again right after
//       the hanging holder is killed.
//
// The short windows come from ANS_PI_LOCK_STALE_MS / ANS_PI_LOCK_TIMEOUT_MS
// and are test values, not production defaults (#266: production keeps
// 10 min / 120 s). Plain node:test file with manual assert counting (repo
// convention); same stdio JSON-RPC shape as coldstart-race.test.ts.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
// The lock's on-disk layout and busy wording come from the product, so the
// test fails when they change instead of drifting alongside them.
import { SESSION_BUSY_MESSAGE, SESSION_LOCKS_DIRNAME } from "@anysearch-cli/kernel";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(MCP_DIR, "src", "index.ts");
const LEGACY_PROTOCOL = "2025-11-25";
const NONCE = "n" + Date.now().toString(36);
const RPC_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- local OpenAI-compatible SSE endpoint ----------

function sseChunk(delta: unknown, finish: string | null, usage?: unknown) {
  return "data: " + JSON.stringify({
    id: "lock", object: "chat.completion.chunk", created: 1, model: "probe-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) + "\n\n";
}
function ssePayload(text: string) {
  return [
    sseChunk({ role: "assistant", content: text }, null),
    sseChunk({}, "stop", { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}

interface ProviderRequest { key: string; start: number; end: number | null; body: string }

// One endpoint serves every scenario, so the bookkeeping is switched per
// scenario instead of being a module-level log the next block inherits. A
// stale entry from a previous block is exactly what made C2 report "the
// hanging run never reached the provider" while it plainly had.
let requestLog: ProviderRequest[] = [];
let openResponses = new Set<ServerResponse>();
function resetEndpointState(): void {
  requestLog = [];
  openResponses = new Set();
}

function lastUserText(body: string): string {
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return ""; }
  const msgs = parsed?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i]?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join(" ");
  }
  return "";
}

const MARKERS = ["LOCK-A-START", "LOCK-B-CONTINUE", "LOCK-B-AFTER-CRASH", "LOCK-HANG", "LOCK-BUSY-B", "LOCK-C-AFTER-KILL", "LOCK-P-ONE", "LOCK-P-TWO"] as const;
function keyFor(text: string): string {
  return MARKERS.find((m) => text.includes(m)) ?? "other";
}
function replyFor(text: string): string {
  if (text.includes("LOCK-A-START")) return "LOCK-A-ANSWER-" + NONCE;
  if (text.includes("LOCK-B-CONTINUE")) return "LOCK-B-ANSWER-" + NONCE;
  if (text.includes("LOCK-B-AFTER-CRASH")) return "LOCK-B-AFTER-CRASH-ANSWER-" + NONCE;
  if (text.includes("LOCK-HANG")) return "LOCK-HANG-PARTIAL-" + NONCE;
  if (text.includes("LOCK-BUSY-B")) return "LOCK-BUSY-B-ANSWER-" + NONCE;
  if (text.includes("LOCK-C-AFTER-KILL")) return "LOCK-C-AFTER-KILL-ANSWER-" + NONCE;
  if (text.includes("LOCK-P-ONE")) return "LOCK-P-ONE-ANSWER-" + NONCE;
  if (text.includes("LOCK-P-TWO")) return "LOCK-P-TWO-ANSWER-" + NONCE;
  return "LOCK-GENERIC-" + NONCE;
}

const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const text = lastUserText(body);
  const key = keyFor(text);
  const entry: ProviderRequest = { key, start: Date.now(), end: null, body };
  requestLog.push(entry);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  openResponses.add(res);
  if (key === "LOCK-HANG") {
    // Hold the connection open after a partial chunk: the holder keeps the
    // session lock until the test kills it.
    res.write(sseChunk({ role: "assistant", content: "LOCK-HANG-PARTIAL-" + NONCE }, null));
    return;
  }
  await sleep(key === "LOCK-A-START" ? 6_000 : 800);
  res.end(ssePayload(replyFor(text)));
  entry.end = Date.now();
  openResponses.delete(res);
});

// ---------- MCP stdio client ----------

interface McpClient {
  child: ChildProcess;
  init: () => Promise<void>;
  stderr: () => string;
  rpc: (method: string, params: unknown, timeoutMs?: number) => Promise<any>;
  chat: (markerMessage: string, sessionId: string, timeoutMs?: number) => Promise<{
    ok: boolean; isError: boolean; text: string; structured: any; elapsedMs: number; transportError: boolean;
  }>;
  chatOrTransport: (markerMessage: string, sessionId: string, timeoutMs?: number) => Promise<{
    ok: boolean; isError: boolean; text: string; structured: any; elapsedMs: number; transportError: boolean;
  }>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function startMcp(env: Record<string, string>): McpClient {
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY, "--transport", "stdio"], {
    cwd: MCP_DIR, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
  let stderr = "";
  child.stderr?.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map<number, { resolve: (m: any) => void; timer: NodeJS.Timeout }>();
  let buf = "";
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      // A pending call whose process died can never be answered; settle it as
      // a failure instead of leaving the caller waiting for the timer.
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ error: { message: "MCP exited (code=" + code + ", signal=" + signal + ")" } });
      }
      pending.clear();
      resolve({ code, signal });
    });
  });
  child.stdout?.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(m);
      }
    }
  });
  const rpc = (method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS) =>
    new Promise<any>((resolve, reject) => {
      const id = Date.now() + Math.floor(Math.random() * 1e6) + pending.size;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("rpc timeout: " + method + " stderr=" + stderr.slice(-400)));
      }, timeoutMs);
      pending.set(id, {
        timer,
        resolve: (m: any) => {
          // A JSON-RPC error reply is a failed call, not a successful one:
          // resolving it would let a broken tools/list pass the handshake.
          if (m.error) {
            reject(new Error(method + " failed: " + JSON.stringify(m.error).slice(0, 300)));
            return;
          }
          resolve(m);
        },
      });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const notify = (method: string, params: unknown) =>
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
  const init = async () => {
    await rpc("initialize", {
      protocolVersion: LEGACY_PROTOCOL, capabilities: {},
      clientInfo: { name: "session-lock-recovery", version: "0" },
    });
    notify("notifications/initialized", {});
    // T3: a live process is not a started one — both handshake steps must
    // succeed before the process is used for the lock assertions.
    const tools = await rpc("tools/list", {});
    const names = (tools.result?.tools ?? []).map((t: any) => t.name);
    if (!names.includes("ans_chat")) {
      throw new Error("tools/list did not list ans_chat; got " + JSON.stringify(names));
    }
  };
  const chat = (markerMessage: string, sessionId: string, timeoutMs = RPC_TIMEOUT_MS) => {
    const started = Date.now();
    return rpc("tools/call", {
      name: "ans_chat",
      arguments: { sessionId, message: markerMessage },
    }, timeoutMs).then((res) => {
      const sc = res.result?.structuredContent ?? null;
      const text = (res.result?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      return {
        ok: res.result?.isError !== true, isError: res.result?.isError === true,
        elapsedMs: Date.now() - started, text, structured: sc, transportError: false,
      };
    });
  };
  // A call whose process is killed mid-flight has no reply at all. That is a
  // transport outcome, not the tool saying "I failed", so it is tagged apart
  // from a server error instead of being folded into the same shape.
  const chatOrTransport = (markerMessage: string, sessionId: string, timeoutMs = RPC_TIMEOUT_MS) => {
    const started = Date.now();
    return chat(markerMessage, sessionId, timeoutMs).catch((e: Error) => ({
      ok: false, isError: true, elapsedMs: Date.now() - started,
      text: "TRANSPORT ERROR: " + e.message, structured: null, transportError: true,
    }));
  };
  return { child, rpc, chat, chatOrTransport, exited, init, stderr: () => stderr };
}

// ---------- sandbox helpers ----------

function sessionFiles(piDir: string): string[] {
  if (!existsSync(piDir)) return [];
  return readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(piDir, f));
}
function readJsonl(path: string): any[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsable: line.slice(0, 120) }; }
  });
}
function fileContaining(piDir: string, marker: string): string[] {
  return sessionFiles(piDir).filter((f) => readFileSync(f, "utf8").includes(marker));
}
function lockEntries(piDir: string) {
  // SESSION_LOCKS_DIRNAME, not a copied "locks": the test reads the product's
  // on-disk layout, so it must follow it rather than restate it.
  const locksDir = join(piDir, SESSION_LOCKS_DIRNAME);
  if (!existsSync(locksDir)) return [] as { name: string; owner: any; heartbeatAgeMs: number | null }[];
  return readdirSync(locksDir).map((name) => {
    const path = join(locksDir, name);
    let owner: any = null;
    let heartbeatAgeMs: number | null = null;
    try { owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")); } catch { /* none */ }
    try { heartbeatAgeMs = Date.now() - statSync(join(path, "heartbeat")).mtimeMs; } catch { /* none */ }
    return { name, owner, heartbeatAgeMs };
  });
}
function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException)?.code === "EPERM"; }
}
function makeEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ANS_DB_PATH: join(root, "anysearch.db"),
    ANS_PI_SESSION_DIR: join(root, "pi"),
    USERPROFILE: root,
    HOME: root,
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: "", // filled by the caller once the endpoint is up
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "session-lock-test-key-not-real",
    ANS_LLM_CONTEXT_WINDOW: "100000",
    ...extra,
  };
}

/**
 * A domain that declares `[budget]`, so a session gets a real budget_ledger
 * row and "the killed run settled nothing" is a statement about an actual
 * row rather than an empty table where `every()` passes by itself. The row
 * exists from the start: the test checks it exists before the kill.
 */
function budgetDomainDir(root: string): string {
  const dir = join(root, "domains");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lock-probe.toml"), [
    'name = "lock-probe"',
    "sources = { enabled = [] }",
    'prompts = [{ name = "system", content = "LOCK-PROBE: answer briefly." }]',
    'skills = { active = ["search"] }',
    'hooks = { toolWhitelist = ["search"] }',
    'rag = { adapter = "none" }',
    "",
    "[budget]",
    "tokenCap = 1000000",
    "callCap = 100",
    "",
  ].join("\n"));
  return dir;
}
function conversationText(lines: any[]): { users: string[]; assistants: string[] } {
  const users: string[] = [];
  const assistants: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (typeof node.role === "string" && node.content !== undefined) {
      let text = "";
      if (typeof node.content === "string") text = node.content;
      else if (Array.isArray(node.content)) text = node.content.map((c: any) => c?.text ?? "").join(" ");
      if (text) (node.role === "user" ? users : node.role === "assistant" ? assistants : []).push(text);
    }
    for (const v of Object.values(node)) walk(v);
  };
  for (const line of lines) walk(line);
  return { users, assistants };
}

async function waitForKey(key: string, timeoutMs = 10_000): Promise<ProviderRequest | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = requestLog.find((r) => r.key === key);
    if (hit) return hit;
    if (Date.now() >= deadline) return undefined;
    await sleep(25);
  }
}

async function main() {
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", () => resolve()));
  const baseUrl = "http://127.0.0.1:" + (fake.address() as any).port + "/v1";
  const base = mkdtempSync(join(tmpdir(), "ans-266-mcp-"));

  try {
    // ================= C1: healthy long run is not stolen =================
    {
      resetEndpointState();
      const root = join(base, "c1");
      const env = { ...makeEnv(root), ANS_LLM_BASE_URL: baseUrl, ANS_PI_LOCK_STALE_MS: "3000" };
      const a = startMcp(env); await a.init();
      const b = startMcp(env); await b.init();
      const shared = "lock-live-" + NONCE;

      const aCall = a.chat("LOCK-A-START. Reply with exactly LOCK-A-ANSWER-" + NONCE + ".", shared);
      const aEntry = await waitForKey("LOCK-A-START");
      assert(aEntry !== undefined, "C1: the long run reached the provider");

      // The lock is now ~4 s old — past the 3 s test stale window — while its
      // holder is alive and well. This is exactly the moment a plain
      // mtime-only lock would be stolen.
      await sleep(3_800);
      const entries = lockEntries(join(root, "pi"));
      const owner = entries[0]?.owner ?? null;
      assert(entries.length === 1 && owner?.pid === a.child.pid,
        "C1: at second 4 the lock names process A (got " + JSON.stringify(entries) + ")");
      assert(pidAlive(owner?.pid), "C1: the recorded owner pid is alive on this machine");
      assert(entries[0].heartbeatAgeMs !== null && entries[0].heartbeatAgeMs! < 1_600,
        "C1: the heartbeat is fresh while the holder runs (age " + entries[0].heartbeatAgeMs + " ms)");

      const bCall = b.chat("LOCK-B-CONTINUE. Restate the previous answer, then add LOCK-B-ANSWER-" + NONCE + ".", shared);
      const [aRes, bRes] = await Promise.all([aCall, bCall]);
      const bEntry = requestLog.find((r) => r.key === "LOCK-B-CONTINUE");

      assert(aRes.ok && bRes.ok, "C1: both runs succeed (A " + aRes.ok + ", B " + bRes.ok + " — " + bRes.text.slice(0, 200) + ")");
      assert(bRes.structured?.sessionId === shared,
        "C1: B continues the same session (got " + JSON.stringify(bRes.structured?.sessionId) + ")");
      assert(aEntry?.end != null && bEntry != null && aEntry.end <= bEntry.start,
        "C1: provider calls do not overlap (A end " + aEntry?.end + ", B start " + bEntry?.start + ")");
      assert(bEntry?.body.includes("LOCK-A-ANSWER-" + NONCE),
        "C1: B's request carries A's answer — the resumed record reached the model");

      const files = fileContaining(join(root, "pi"), "LOCK-A-ANSWER-" + NONCE);
      const lines = files.length === 1 ? readJsonl(files[0]) : [];
      const { users, assistants } = conversationText(lines);
      assert(files.length === 1, "C1: one session, one PI record (got " + files.length + ")");
      assert(lines.every((l) => !l.unparsable), "C1: every JSONL line parses");
      assert(users.length === 2 && assistants.length === 2,
        "C1: the record holds both turns (got " + users.length + " user / " + assistants.length + " assistant)");
      assert(assistants[0]?.includes("LOCK-A-ANSWER-" + NONCE) && !assistants[0]?.includes("LOCK-B-ANSWER-" + NONCE)
        && assistants[1]?.includes("LOCK-B-ANSWER-" + NONCE),
        "C1: the turns are in order — B continues A's record instead of replacing it");
      assert(lockEntries(join(root, "pi")).length === 0, "C1: the lock directory is empty after both runs");

      a.child.kill("SIGKILL"); b.child.kill("SIGKILL");
      await Promise.all([a.exited, b.exited]);
    }

    // ================= C2: a really killed holder recovers =================
    {
      resetEndpointState();
      const root = join(base, "c2");
      // Production lock windows on purpose: recovery must not need them.
      // The domain declares [budget], so the session really has a
      // budget_ledger row to make "nothing was settled" a real statement.
      const env = {
        ...makeEnv(root), ANS_LLM_BASE_URL: baseUrl,
        ANS_DOMAIN: "lock-probe", ANS_DOMAINS_DIR: budgetDomainDir(root),
      };
      const a = startMcp(env); await a.init();
      const b = startMcp(env); await b.init();
      const shared = "lock-crash-" + NONCE;

      const hangCall = a.chatOrTransport("LOCK-HANG. Hold the session open.", shared);
      const hangEntry = await waitForKey("LOCK-HANG");
      assert(hangEntry !== undefined,
        "C2: the hanging run reached the provider (A stderr: " + a.stderr().slice(-500) + ")");

      const bStart = Date.now();
      const bCall = b.chat("LOCK-B-AFTER-CRASH. The previous process died; continue the same session.", shared);
      await sleep(600);
      const beforeKill = lockEntries(join(root, "pi"));
      assert(beforeKill.length === 1 && beforeKill[0].owner?.pid === a.child.pid,
        "C2: the lock names the hanging process before the kill");

      // The budget row must exist BEFORE the kill, otherwise an empty table
      // would satisfy every() vacuously.
      const dbBefore = new Database(join(root, "anysearch.db"), { readonly: true });
      const ledgerBefore = dbBefore.prepare(
        "SELECT session_id, reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?"
      ).all(shared) as Array<{ session_id: string; reserved_tokens: number; spent_tokens: number }>;
      // #275: the killed run reserved real tokens, which is what makes "the
      // recovery released them" a statement about a non-zero number instead of
      // about a counter that was never moved. The owner row is read too, so the
      // post-kill assertion below can tell "this run's reservation was
      // released" apart from "the unowned sweep happened to clear a counter".
      const reservationsBefore = dbBefore.prepare(
        "SELECT owner_pid, dim, amount FROM budget_reservations WHERE session_id = ?"
      ).all(shared) as Array<{ owner_pid: number; dim: string; amount: number }>;
      dbBefore.close();
      assert(ledgerBefore.length === 1,
        "C2: the session has a real budget_ledger row before the kill (got " + JSON.stringify(ledgerBefore) + ")");
      assert(Number(ledgerBefore[0]?.reserved_tokens) > 0,
        "C2: the killed run holds a real reservation before the kill (got " + JSON.stringify(ledgerBefore) + ")");
      assert(reservationsBefore.some((r) => r.owner_pid === a.child.pid && r.dim === "tokens"),
        "C2/#275: the killed run recorded its reservation under its own pid (got "
        + JSON.stringify(reservationsBefore) + ")");

      a.child.kill("SIGKILL");
      for (const res of openResponses) { try { res.destroy(); } catch { /* already gone */ } }
      const killedExit = await a.exited;

      // Between the kill and the takeover nothing may be settled for the
      // killed run: no fake success, no "settled as 0" illusion.
      await sleep(400);
      const db = new Database(join(root, "anysearch.db"), { readonly: true });
      const ledgerMid = db.prepare(
        "SELECT session_id, reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?"
      ).all(shared) as Array<{ session_id: string; reserved_tokens: number; spent_tokens: number }>;
      db.close();
      // A killed run may leave its reservation or clear it, but it must never
      // book spend: spent_tokens is the count of what the provider actually
      // returned for a completed run.
      assert(ledgerMid.length === 1 && Number(ledgerMid[0].spent_tokens) === 0,
        "C2: the killed request settled no spend on a real row (ledger " + JSON.stringify(ledgerMid) + ")");

      const bRes = await bCall;
      const recoveryMs = Date.now() - bStart;
      const hangRes = await hangCall;

      // A killed client cannot receive a reply, so "failed" here means the
      // transport went away — explicitly tagged, not inferred from a catch
      // that would pass no matter what the tool did.
      assert(hangRes.transportError === true && hangRes.ok === false,
        "C2: the killed request ends as a transport failure, never as a completed answer (got "
        + JSON.stringify(hangRes.text.slice(0, 160)) + ")");
      assert(bRes.ok === true && bRes.structured?.sessionId === shared,
        "C2: the waiter takes over and completes the same session (got " + bRes.text.slice(0, 200) + ")");
      assert(recoveryMs < 30_000,
        "C2: recovery takes seconds, not the 10 min stale window (took " + recoveryMs + " ms)");

      const files = fileContaining(join(root, "pi"), "LOCK-B-AFTER-CRASH-ANSWER-" + NONCE);
      const lines = files.length === 1 ? readJsonl(files[0]) : [];
      const allText = lines.map((l) => JSON.stringify(l)).join("\n");
      const { assistants: crashAssistants } = conversationText(lines);
      assert(files.length === 1 && !allText.includes("LOCK-HANG-PARTIAL-" + NONCE),
        "C2: no half-written answer lands in the session record");
      assert(allText.includes("LOCK-B-AFTER-CRASH-ANSWER-" + NONCE),
        "C2: the recovering run's completion is recorded");
      // Exactly one assistant record for the recovering run: a duplicated
      // completion line would otherwise pass every other assertion here.
      assert(crashAssistants.filter((t) => t.includes("LOCK-B-AFTER-CRASH-ANSWER-" + NONCE)).length === 1,
        "C2: the recovering run is recorded exactly once, not duplicated (got "
        + JSON.stringify(crashAssistants.map((t) => t.slice(0, 40))) + ")");
      assert(lines.every((l) => !l.unparsable), "C2: every JSONL line parses after recovery");
      assert(lockEntries(join(root, "pi")).length === 0,
        "C2: the reclaimed lock is cleaned up (exit " + JSON.stringify(killedExit) + ")");

      // #275: the takeover released the killed run's reservation, so the session
      // is not left looking exhausted. This is the defect the ticket measured
      // (reserved_tokens = 12304 with spent_tokens = 0 after the takeover) and
      // the recovery path is where it has to stop being true.
      const dbAfter = new Database(join(root, "anysearch.db"), { readonly: true });
      const ledgerAfter = dbAfter.prepare(
        "SELECT reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?"
      ).all(shared) as Array<{ reserved_tokens: number; spent_tokens: number }>;
      const leftoverOwners = dbAfter.prepare(
        "SELECT owner_pid, dim, amount FROM budget_reservations WHERE session_id = ?"
      ).all(shared) as Array<{ owner_pid: number; dim: string; amount: number }>;
      dbAfter.close();
      // The recovering run reserved and then settled its own work, so zero is
      // the only correct leftover. A surviving killed-owner row is the bug.
      assert(ledgerAfter.length === 1 && Number(ledgerAfter[0].reserved_tokens) === 0,
        "C2/#275: no reservation is left behind after the takeover (ledger "
        + JSON.stringify(ledgerAfter) + ")");
      assert(!leftoverOwners.some((r) => r.owner_pid === a.child.pid),
        "C2/#275: the killed process owns no reservation after the takeover (got "
        + JSON.stringify(leftoverOwners) + ")");
      assert(Number(ledgerAfter[0]?.spent_tokens) > 0,
        "C2: the recovering run's spend is booked on the same row");

      b.child.kill("SIGKILL");
      await b.exited;
    }

    // ================= C3: the wait cap says "session busy" =================
    {
      resetEndpointState();
      const root = join(base, "c3");
      const env = {
        ...makeEnv(root), ANS_LLM_BASE_URL: baseUrl,
        ANS_PI_LOCK_TIMEOUT_MS: "3000", // test value; production keeps 120 s
      };
      const a = startMcp(env); await a.init();
      const b = startMcp(env); await b.init();
      const shared = "lock-busy-" + NONCE;

      const hangCall = a.chat("LOCK-HANG. Hold the session open.", shared).catch(() => ({ ok: false }));
      await waitForKey("LOCK-HANG");
      const bStart = Date.now();
      const bRes = await b.chat("LOCK-BUSY-B. This request should hit the wait cap.", shared);
      const waitedMs = Date.now() - bStart;

      assert(bRes.isError === true && bRes.text.includes(SESSION_BUSY_MESSAGE.slice(0, 20)),
        "C3: a contender past the wait cap gets an explicit session-busy error (got "
        + JSON.stringify(bRes.text.slice(0, 200)) + ")");
      assert(waitedMs >= 2_500 && waitedMs < 15_000,
        "C3: the cap fires at the configured window, not earlier (waited " + waitedMs + " ms)");
      assert(!requestLog.some((r) => r.key === "LOCK-BUSY-B"),
        "C3: the busy contender never reaches the provider");

      a.child.kill("SIGKILL");
      await a.exited;
      const cRes = await b.chat("LOCK-C-AFTER-KILL. The hanging process is gone; continue.", shared);
      assert(cRes.ok === true && cRes.structured?.sessionId === shared,
        "C3: the session is usable again right after the holder dies (got " + cRes.text.slice(0, 200) + ")");
      await hangCall;

      b.child.kill("SIGKILL");
      await b.exited;
    }

    // ================= C4: different sessions run in parallel =================
    {
      resetEndpointState();
      const root = join(base, "c4");
      const env = { ...makeEnv(root), ANS_LLM_BASE_URL: baseUrl };
      const a = startMcp(env); await a.init();
      const b = startMcp(env); await b.init();

      // Two different handles, one process each, started together. A shared
      // lock key would make one wait for the other; overlapping provider
      // calls are the observable proof they did not.
      const started = Date.now();
      const [r1, r2] = await Promise.all([
        a.chat("LOCK-P-ONE. Reply with exactly LOCK-P-ONE-ANSWER-" + NONCE + ".", "parallel-one-" + NONCE),
        b.chat("LOCK-P-TWO. Reply with exactly LOCK-P-TWO-ANSWER-" + NONCE + ".", "parallel-two-" + NONCE),
      ]);
      const elapsed = Date.now() - started;
      const p1 = requestLog.find((r) => r.key === "LOCK-P-ONE");
      const p2 = requestLog.find((r) => r.key === "LOCK-P-TWO");

      assert(r1.ok && r2.ok && r1.structured?.sessionId === "parallel-one-" + NONCE
        && r2.structured?.sessionId === "parallel-two-" + NONCE,
        "C4: both different-session calls complete with their own handle");
      // Overlap is the proof, not wall-clock: engine cold start is on the
      // clock too, so a serialized pair and a parallel pair can both be slow.
      assert(p1 != null && p2 != null && p1.start < (p2.end ?? Infinity) && p2.start < (p1.end ?? Infinity),
        "C4: the two sessions' provider calls overlap — different sessions are not serialized "
        + JSON.stringify({ p1, p2: { start: p2?.start, end: p2?.end }, elapsed }));

      a.child.kill("SIGKILL"); b.child.kill("SIGKILL");
      await Promise.all([a.exited, b.exited]);
    }
  } finally {
    try { rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* OS temp */ }
    try { fake.close(); } catch { /* already closed */ }
  }

  console.log("mcp-session-lock-recovery: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("mcp-session-lock-recovery crashed: " + (e as Error)?.message);
  console.error((e as Error)?.stack);
  process.exit(1);
});
