// #257 acceptance (D12, T3) at the MCP layer: two REAL `ans-mcp` processes
// start on one brand-new database, five rounds, and in every round BOTH
// processes complete `initialize` and `tools/list`.
//
// The ticket is explicit that a live process is not a start: this file asserts
// the protocol handshake and the five tools, then checks the resulting
// database is complete. The store-level counterpart
// (packages/store/test/coldstart-race.test.ts) owns the structure checks and
// the deterministic lock cases; here the point is the host-visible behaviour.
//
// Nothing is pre-created: no database file, no schema, no parent directory
// beyond what the MCP entry's own ensureOwnerOnlyDb() creates. Each round gets
// a private HOME so session/observation files cannot leak between rounds.
//
// Plain node:test file with manual assert counting (repo convention). The
// transport is newline-delimited JSON-RPC over the child's stdio, same shape
// scripts/mcp-smoke.mjs uses against the built dist.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(MCP_DIR, "src", "index.ts");
const ROUNDS = 5;
const TOOL_NAMES = ["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"];
const LEGACY_PROTOCOL = "2025-11-25";
// A cold start compiles nothing but does load the whole engine; on a loaded CI
// runner two of them at once still finish well inside this.
const RPC_TIMEOUT_MS = 60000;

interface RpcResult { ok: boolean; init?: any; tools?: any[]; error?: string; elapsedMs: number }

function startClient(home: string, dbPath: string): {
  rpc: (method: string, params: unknown) => Promise<any>;
  notify: (method: string) => void;
  stop: () => Promise<void>;
  stderr: () => string;
} {
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY, "--transport", "stdio"], {
    cwd: MCP_DIR,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANS_DB_PATH: dbPath,
      USERPROFILE: home,
      HOME: home,
      // A stable session anchor so the observation path does not generate files
      // the test would then have to distinguish from a cold-start artefact.
      ANS_SESSION_ID: "coldstart-race",
    },
  });
  const pending = new Map<number, (m: any) => void>();
  let buf = "";
  let err = "";
  let nextId = 1;
  child.stderr.on("data", (c) => { err += c.toString(); });
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const resolve = pending.get(m.id)!;
        pending.delete(m.id);
        resolve(m);
      }
    }
  });
  const rpc = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + " timed out after " + RPC_TIMEOUT_MS + "ms; stderr: " + err.slice(-400)));
      }, RPC_TIMEOUT_MS);
      pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const notify = (method: string) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  // Resolve only once the child is really gone: on Windows an open handle (or a
  // half-written -wal/-shm pair) makes the subsequent read-only integrity
  // check fail with "disk I/O error" for reasons that have nothing to do with
  // initialization.
  const stop = () => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once("close", () => resolve());
    child.stdin.end();
    child.kill();
  });
  return { rpc, notify, stop, stderr: () => err };
}

async function driveOne(home: string, dbPath: string): Promise<RpcResult> {
  const t0 = Date.now();
  const client = startClient(home, dbPath);
  try {
    const init = await client.rpc("initialize", {
      protocolVersion: LEGACY_PROTOCOL,
      capabilities: {},
      clientInfo: { name: "coldstart-race", version: "0" },
    });
    client.notify("notifications/initialized");
    const list = await client.rpc("tools/list", {});
    return { ok: true, init: init.result, tools: list.result?.tools, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, elapsedMs: Date.now() - t0 };
  } finally {
    await client.stop();
  }
}

// Same completeness bar as the store-level test, narrowed to what a host notices.
function checkDatabase(dbPath: string, label: string): void {
  const db = new Database(dbPath, { readonly: true });
  try {
    assert(db.pragma("integrity_check", { simple: true }) === "ok", label + ": integrity_check is ok");
    assert(db.pragma("journal_mode", { simple: true }) === "wal", label + ": journal_mode is wal");
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all() as Array<{ name: string }>).map((r) => r.name));
    for (const t of ["sessions", "retrieval_results", "messages_fts", "retrieval_results_fts", "observability_traces"]) {
      assert(names.has(t), label + ": " + t + " exists");
    }
    assert(names.has("messages_ai") && names.has("retrieval_ai"), label + ": FTS triggers exist");
    const anchors = db.prepare("SELECT COUNT(*) AS n FROM access_chain_anchor").get() as { n: number };
    assert(anchors.n === 1, label + ": exactly one access-chain anchor (got " + anchors.n + ")");
  } finally {
    db.close();
  }
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), "ans-mcp-coldstart-"));
  try {
    let failedRounds = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      const home = join(base, "home-" + round);
      const dbPath = join(home, "anysearch.db");
      // Cold HOME: nothing exists yet, not the directory, not the database. The
      // MCP entry's own ensureOwnerOnlyDb() has to create both — that is the
      // path the ticket describes as "not pre-created, not pre-initialized".
      assert(!existsSync(dbPath), "round " + round + ": database does not exist before startup");

      const [a, b] = await Promise.all([driveOne(home, dbPath), driveOne(home, dbPath)]);
      for (const [label, r] of [["A", a], ["B", b]] as const) {
        if (!r.ok) failedRounds++;
        assert(r.ok, "round " + round + ": process " + label + " completed initialize + tools/list (" + r.elapsedMs + "ms): " + (r.error ?? ""));
        assert(r.init?.serverInfo?.name === "anysearch", "round " + round + ": process " + label + " initialize reports server anysearch (got " + JSON.stringify(r.init?.serverInfo) + ")");
        assert(r.init?.protocolVersion === LEGACY_PROTOCOL, "round " + round + ": process " + label + " negotiated " + LEGACY_PROTOCOL + " (got " + String(r.init?.protocolVersion) + ")");
        const toolNames = (r.tools ?? []).map((t: any) => t.name);
        assert(toolNames.length === TOOL_NAMES.length, "round " + round + ": process " + label + " tools/list returns " + TOOL_NAMES.length + " tools (got " + toolNames.length + ")");
        // tools/list carrying names means the whole engine (both stores) is up.
        const missing = TOOL_NAMES.filter((n) => !toolNames.includes(n));
        assert(missing.length === 0, "round " + round + ": process " + label + " lists every tool (missing: " + missing.join(",") + ")");
      }
      if (a.ok && b.ok) checkDatabase(dbPath, "round " + round);
    }
    assert(failedRounds === 0, "all " + ROUNDS + " rounds had both processes complete the handshake (failed: " + failedRounds + ")");
  } finally {
    // Windows keeps sqlite handles briefly after child exit; best effort.
    try { rmSync(base, { recursive: true, force: true }); } catch { /* OS temp */ }
  }

  console.log("mcp-coldstart-race: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("mcp-coldstart-race crashed: " + (e as Error)?.message);
  console.error((e as Error)?.stack);
  process.exit(1);
});
