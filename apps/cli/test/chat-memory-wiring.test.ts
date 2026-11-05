// #129 — the CLI composition root really wires memory.
//
// This drives the exact helper `runChat` calls (wireChatMemory) against a real
// SqliteSessionStore. A dropped store, or a session id that never gets
// registered, fails here even though the kernel-level assertions stay green.
//
// Deliberately NOT imported: ../src/commands/chat (it pulls in the kernel, and
// this CLI package is CommonJS while pi-agent-core ships ESM-only exports).
// The runtime side — injection reaching the model, restart recall — is proven
// in packages/kernel/test/pi-runtime.test.ts.
//
// Run: pnpm --filter @anysearch-cli/cli test

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore, BudgetLedger, loadDomainFromString } from "@anysearch-cli/store";
import { wireChatMemory, type ChatMemoryWiring } from "../src/commands/chat-memory";

let passed = 0, failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-129-cli-"));
  const dbPath = join(dir, "anysearch.db");
  const prevSessionEnv = process.env.ANS_SESSION_ID;
  // Pin the durable anchor id so "same id after restart" does not depend on
  // whatever ~/.anysearch-cli/session holds on this machine.
  process.env.ANS_SESSION_ID = "cli-wiring-session-129";
  try {
    // 1. Both halves come back, and the sessions row exists before any child
    //    write — resume_anchors has an FK to sessions(id) under foreign_keys = ON.
    const writer = new SqliteSessionStore(dbPath);
    let wiring: ChatMemoryWiring;
    try {
      wiring = await wireChatMemory(writer, "default", { tokenCap: 1234, callCap: 7 });
      check(Boolean(wiring.store) && typeof wiring.sessionId === "string" && wiring.sessionId.length > 0,
        "wireChatMemory returns store + a non-empty sessionId");
      // #187: [budget] is registered at the same session-registration point.
      const ledger = new BudgetLedger((writer as any).db);
      const budgetRow = ledger.getBalance(wiring.sessionId!);
      check(budgetRow?.tokenCap === 1234 && budgetRow?.callCap === 7,
        "#187: Active Domain [budget] creates the session ledger row");
      await writer.saveAnchor(wiring.sessionId!, "query", { query: "seed", timestamp: 1 });
      check(true, "the wired session id accepts anchor writes (FK satisfied)");

      // Seed recall-able Research Memory the way the MCP search path does.
      await writer.saveResults(wiring.sessionId!, [
        { url: "https://intra.example/wiki", title: "internal wiki", snippet: "the intranet wiki proxy runs on port 8080", source: "tavily" },
      ]);
    } finally {
      writer.close();
    }

    // 2. Restart: reopen and wire again, as a second `ans chat` process would.
    const store = new SqliteSessionStore(dbPath);
    try {
      const fresh = await wireChatMemory(store, "default");
      check(fresh.sessionId === wiring.sessionId,
        "the durable anchor yields the same session id after a restart");
      // #187: the restart runs a domain without [budget]; the existing row is
      // released to unlimited (history kept) rather than silently continuing
      // to enforce the previous domain's caps.
      const released = new BudgetLedger((store as any).db).getBalance(fresh.sessionId!);
      check(released?.tokenCap === Number.MAX_SAFE_INTEGER && released?.callCap === Number.MAX_SAFE_INTEGER,
        "#187: dropping [budget] releases an existing session's caps");
      // The memory written before the restart is still recallable through the
      // same store surface the fts adapter uses.
      const hits = await store.searchMemory("internal wiki port", 5);
      check(hits.some((h) => (h.content ?? "").includes("port 8080")),
        "AC3: memory written before the restart is recalled after rewiring");
    } finally {
      store.close();
    }

    // 3. A failed registration closes the gate instead of pretending to wire it,
    //    and says so.
    const broken = {
      ensureSession: async () => { throw new Error("disk on fire"); },
    } as any;
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    let failedWiring: ChatMemoryWiring;
    try {
      failedWiring = await wireChatMemory(broken, "default");
    } finally {
      process.stderr.write = origWrite;
    }
    check(failedWiring.store === undefined && failedWiring.sessionId === undefined,
      "a failed ensureSession yields empty wiring (the runtime gate stays closed)");
    check(/session row registration failed/.test(captured), "a failed registration is reported, not swallowed");

    // 4. An empty anchor id never reaches the store (no bogus sessions row).
    const origEnv = process.env.ANS_SESSION_ID;
    delete process.env.ANS_SESSION_ID;
    const emptyHome = mkdtempSync(join(tmpdir(), "ans-129-home-"));
    const prevProfile = process.env.USERPROFILE;
    const prevHome = process.env.HOME;
    process.env.USERPROFILE = emptyHome;
    process.env.HOME = emptyHome;
    let emptyWiring: ChatMemoryWiring | undefined;
    let ensuredCalls = 0;
    try {
      // First call generates + persists an anchor (normal path, not empty).
      const probeStore = { ensureSession: async () => { ensuredCalls += 1; } } as any;
      emptyWiring = await wireChatMemory(probeStore, "default");
    } finally {
      process.env.USERPROFILE = prevProfile;
      process.env.HOME = prevHome;
      if (origEnv === undefined) delete process.env.ANS_SESSION_ID;
      else process.env.ANS_SESSION_ID = origEnv;
      try { rmSync(emptyHome, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    check(emptyWiring?.sessionId !== undefined && ensuredCalls === 1,
      "a cold anchor generates a non-empty id and registers it (no empty-id wiring)");

    // 5. #187: a domain with no [budget] creates no ledger row — the absence of
    //    the row is the unmetered (pass) state, not a zero-cap row.
    process.env.ANS_SESSION_ID = "cli-no-budget-187";
    const plainDir = mkdtempSync(join(tmpdir(), "ans-187-plain-"));
    const plainStore = new SqliteSessionStore(join(plainDir, "anysearch.db"));
    try {
      const plain = await wireChatMemory(plainStore, "default");
      check(plain.sessionId === "cli-no-budget-187", "no-budget wiring still registers the session");
      check(new BudgetLedger((plainStore as any).db).getBalance(plain.sessionId!) === null,
        "#187: no [budget] section -> no budget row (unmetered)");
    } finally {
      plainStore.close();
      try { rmSync(plainDir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
    }

    // 6. #187: full TOML -> toBudgetCaps -> DB chain (the unit tests covered the
    //    pieces; this pins the wiring that would hide a `||` regression).
    const chainDir = mkdtempSync(join(tmpdir(), "ans-187-chain-"));
    const chainStore = new SqliteSessionStore(join(chainDir, "anysearch.db"));
    const chainLedger = new BudgetLedger((chainStore as any).db);
    try {
      process.env.ANS_SESSION_ID = "cli-zero-caps-187";
      const zero = loadDomainFromString('name = "zero"\n[rag]\nadapter = "x"\n[budget]\ntokenCap = 0\ncallCap = 0\n');
      const zeroWiring = await wireChatMemory(chainStore, "default", zero.budget);
      check(zeroWiring.sessionId === "cli-zero-caps-187", "TOML 0 case wires the session");
      const zeroRow = chainLedger.getBalance("cli-zero-caps-187");
      check(zeroRow?.tokenCap === 0 && zeroRow?.callCap === 0, "TOML explicit 0 reaches the ledger as 0");
      check(!chainLedger.reserveTokens("cli-zero-caps-187", 0), "TOML 0 rejects even a zero token reserve");
      check(!chainLedger.reserveCalls("cli-zero-caps-187", 1), "TOML 0 rejects calls");

      process.env.ANS_SESSION_ID = "cli-partial-caps-187";
      const partialDoc = loadDomainFromString('name = "partial"\n[rag]\nadapter = "x"\n[budget]\noutputReserveTokens = 4096\n');
      await wireChatMemory(chainStore, "default", partialDoc.budget);
      const partialRow = chainLedger.getBalance("cli-partial-caps-187");
      check(partialRow?.tokenCap === Number.MAX_SAFE_INTEGER && partialRow?.callCap === Number.MAX_SAFE_INTEGER,
        "TOML omitted caps reach the ledger as unlimited, not 0");
      check(chainLedger.reserveTokens("cli-partial-caps-187", 1), "omitted token cap passes a real reserve");
    } finally {
      chainStore.close();
      try { rmSync(chainDir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
    }
  } finally {
    if (prevSessionEnv === undefined) delete process.env.ANS_SESSION_ID;
    else process.env.ANS_SESSION_ID = prevSessionEnv;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
  }

  console.log("--- chat memory wiring tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
