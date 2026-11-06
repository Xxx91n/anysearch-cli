// #132 acceptance — ans_chat's explicit session handle.
//
// The mental model under test (MCP 2026-07-28 / SEP-2567): a session id is a
// resumable checkpoint key inside the store, threaded by the client as an
// ordinary tool argument. It is NOT a transport session and NOT a hidden
// process-wide singleton.
//
// Covered:
//   1. absent handle -> server mints one (single-shot call)
//   2. supplied handle -> ensureSession() runs before reuse (FK safe), no mint
//   3. absent handle on two calls -> two different sessions (no hidden sharing)
//   4. invalid handles -> fail-open, no memory wiring, no fake handle
//   5. mint/registration failures -> fail-open and a failed mint is not cached
//   6. real SqliteSessionStore -> an anchor written under the minted handle is
//      readable when the handle is threaded back (cross-call continuity)
//
// Seam: the real resolver + real SqliteSessionStore (offline, no LLM, no network).
// No test framework (repo convention).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAgentRuntime, type CompositionResult } from "@anysearch-cli/kernel";
import { SqliteSessionStore, BudgetLedger } from "@anysearch-cli/store";
import {
  buildAnsChatResult,
  isValidSessionHandle,
  resetAnsChatSessionWarnings,
  resolveAnsChatSession,
} from "../src/ans-chat-session.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

function engineWith(
  store: unknown,
  config?: CompositionResult["config"],
  ledger?: CompositionResult["ledger"],
): CompositionResult {
  return {
    retriever: {},
    store,
    observation: {},
    ...(config ? { config } : {}),
    ...(ledger ? { ledger } : {}),
  } as unknown as CompositionResult;
}

async function main() {
  resetAnsChatSessionWarnings();

  // ---- 1. absent handle: mint exactly one "mcp" session, single-shot ----
  {
    const calls: string[] = [];
    const store = {
      createSession: async (domain: string) => {
        calls.push(domain);
        return { id: "mcp-mint-0001", domain, createdAt: new Date().toISOString() };
      },
      ensureSession: async () => {},
    };
    const ledger = {} as CompositionResult["ledger"];
    const wiring = await resolveAnsChatSession(engineWith(store, undefined, ledger));
    assert(wiring.sessionId === "mcp-mint-0001", "mint: returns the created session id");
    assert(wiring.store === store, "mint: returns the same store handle");
    // #178: the ledger rides with the registered session, so the tool hands
    // PiAgentRuntime the engine's own instance.
    assert(wiring.ledger === ledger, "#178: mint path returns the engine ledger");
    assert(calls.length === 1 && calls[0] === "mcp", "mint: createSession called once with domain mcp");
  }

  // ---- 1b. result shape: handle is structured AND model-visible ----
  {
    const noHandle = buildAnsChatResult("hello");
    assert(
      noHandle.content.length === 1 && noHandle.content[0].text === "hello",
      "result: single-shot keeps one text block",
    );
    assert(noHandle.structuredContent === undefined, "result: single-shot carries no handle");

    const withHandle = buildAnsChatResult("hello", "mcp-mint-0001");
    assert(withHandle.content.length === 2, "result: handle adds a second text block");
    assert(withHandle.content[0].text === "hello", "result: answer block is untouched");
    const parsed = JSON.parse(withHandle.content[1].text);
    assert(parsed.sessionId === "mcp-mint-0001", "result: trailing block carries the handle");
    assert(
      withHandle.structuredContent?.sessionId === "mcp-mint-0001",
      "result: structuredContent carries the same handle",
    );

    const empty = buildAnsChatResult("");
    assert(empty.content[0].text === "ans_chat: no response", "result: empty output keeps the fallback copy");
  }

  // ---- 2. supplied handle: ensureSession first, never mint ----
  {
    const ensured: Array<[string, string]> = [];
    const store = {
      createSession: async () => {
        throw new Error("must not mint when a handle is supplied");
      },
      ensureSession: async (id: string, domain: string) => {
        ensured.push([id, domain]);
      },
    };
    const ledger = {} as CompositionResult["ledger"];
    const wiring = await resolveAnsChatSession(engineWith(store, undefined, ledger), "client-handle-01");
    assert(wiring.sessionId === "client-handle-01", "handle: echoed back unchanged");
    assert(wiring.ledger === ledger, "#178: threaded-handle path returns the engine ledger");
    assert(
      ensured.length === 1 && ensured[0][0] === "client-handle-01" && ensured[0][1] === "mcp",
      "handle: ensureSession(id, mcp) runs before reuse",
    );
  }

  // ---- 3. absent handle twice: no hidden shared session ----
  {
    let seq = 0;
    const store = {
      createSession: async (domain: string) => ({ id: "fresh-" + (++seq) + "-0000", domain }),
      ensureSession: async () => {},
    };
    const first = await resolveAnsChatSession(engineWith(store));
    const second = await resolveAnsChatSession(engineWith(store));
    assert(
      !!first.sessionId && !!second.sessionId && first.sessionId !== second.sessionId,
      "single-shot: two handle-less calls get distinct sessions",
    );
  }

  // ---- 4. invalid handles: fail-open, no ensureSession, no fabricated handle ----
  {
    let ensured = 0;
    const store = {
      createSession: async () => {
        throw new Error("must not mint on an invalid supplied handle");
      },
      ensureSession: async () => {
        ensured++;
      },
    };
    const invalid: unknown[] = ["", "   ", "line\nbreak", "x".repeat(129), null, 42, {}];
    for (const value of invalid) {
      const wiring = await resolveAnsChatSession(engineWith(store), value);
      assert(
        wiring.store === undefined && wiring.sessionId === undefined,
        "invalid handle " + JSON.stringify(value) + ": no memory wiring",
      );
    }
    assert(ensured === 0, "invalid handles: ensureSession never called");
    assert(isValidSessionHandle("a"), "handle: 1 visible ASCII char is accepted");
    assert(isValidSessionHandle("0123456789abcdef"), "handle: 32-hex (CLI anchor shape) accepted");
    assert(isValidSessionHandle("8f14e45f-ea0f-4f3a-9c1b-2c3d4e5f6a7b"), "handle: UUID shape accepted");
    assert(!isValidSessionHandle("bad handle"), "handle: embedded space rejected");
    assert(!isValidSessionHandle("x".repeat(129)), "handle: >128 chars rejected");
  }

  // ---- 5a. mint failure is fail-open AND not cached ----
  {
    let attempts = 0;
    const store = {
      createSession: async (domain: string) => {
        attempts++;
        if (attempts === 1) throw new Error("lock unavailable");
        return { id: "retry-ok-0001", domain };
      },
      ensureSession: async () => {},
    };
    const first = await resolveAnsChatSession(engineWith(store));
    assert(first.sessionId === undefined, "mint failure: first call continues without memory");
    const second = await resolveAnsChatSession(engineWith(store));
    assert(second.sessionId === "retry-ok-0001", "mint failure: next call retries and succeeds");
    assert(attempts === 2, "mint failure: createSession retried (no poisoned cache)");
  }

  // ---- 5b. registration failure is fail-open ----
  {
    const store = {
      createSession: async () => {
        throw new Error("must not mint");
      },
      ensureSession: async () => {
        throw new Error("FK target rejected");
      },
    };
    const wiring = await resolveAnsChatSession(
      engineWith(store, undefined, {} as CompositionResult["ledger"]),
      "unregistered-01",
    );
    assert(wiring.sessionId === undefined, "registration failure: no memory wiring");
    // #178: no session row -> no ledger either; settlement must not target it.
    assert(wiring.ledger === undefined, "registration failure: no ledger handed to the runtime");
  }

  // ---- 5c. store without the seam: fail-open ----
  {
    const wiring = await resolveAnsChatSession(engineWith({ createSession: async () => ({ id: "x-000000" }) }));
    assert(wiring.sessionId === undefined, "store without ensureSession: no memory wiring");
  }

  // ---- 5d. #200: failed budget setup omits the ledger, memory stays wired ----
  {
    const store = {
      ensureSession: async () => {},
      createSession: async (domain: string) => ({ id: "budget-broken-01", domain }),
      initBudget: () => { throw new Error("budget row locked"); },
    };
    const config: CompositionResult["config"] = {
      sources: { enabled: [] },
      prompts: [],
      skills: { active: [] },
      hooks: { toolWhitelist: [] },
      rag: { adapter: "none" },
      budget: { callCap: 1 },
    };
    const ledger = {} as CompositionResult["ledger"];
    const byHandle = await resolveAnsChatSession(engineWith(store, config, ledger), "budget-broken-01");
    assert(byHandle.sessionId === "budget-broken-01", "#200: budget failure keeps the supplied handle");
    assert(byHandle.ledger === undefined, "#200: supplied-handle path omits ledger on budget failure");
    const minted = await resolveAnsChatSession(engineWith(store, config, ledger));
    assert(!!minted.sessionId && minted.ledger === undefined, "#200: mint path omits ledger on budget failure");
  }

  // ---- 6. real store: anchor written under the handle survives the round trip ----
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-132-"));
    const store = new SqliteSessionStore(join(dir, "anysearch.db"));
    try {
      const first = await resolveAnsChatSession(engineWith(store));
      assert(!!first.sessionId, "real store: first call mints a handle");
      const handle = first.sessionId!;
      await store.saveAnchor(handle, "rolling_summary", { summary: "remember the checkpoint" });

      const second = await resolveAnsChatSession(engineWith(store), handle);
      assert(second.sessionId === handle, "real store: threaded handle resumes the same session");

      const anchors = await store.getAnchors(handle);
      assert(
        anchors.some((a) => a.anchorType === "rolling_summary"),
        "real store: the earlier anchor is readable under the threaded handle",
      );

      const third = await resolveAnsChatSession(engineWith(store));
      assert(
        !!third.sessionId && third.sessionId !== handle,
        "real store: a handle-less call starts a distinct single-shot session",
      );

      // The acceptance that matters: the pair this resolver returns is exactly
      // what opens PiAgentRuntime's `store && sessionId` gate.
      const runtime = new PiAgentRuntime({
        retriever: { search: async () => ({}) } as any,
        domain: {
          sources: { enabled: [] },
          prompts: [],
          skills: { active: [] },
          hooks: { toolWhitelist: [] },
          rag: { adapter: "none" },
        } as any,
        model: { id: "test-model" } as any,
        streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
        ...second,
      });
      assert(
        (runtime as any).pipeline !== undefined,
        "real store: store + threaded handle constructs MemoryPipeline",
      );

      // ...and that pipeline actually reads the anchor under that handle.
      const injected = await (runtime as any).pipeline.inject([{ role: "user", content: "hello" }]);
      assert(
        JSON.stringify(injected).includes("remember the checkpoint"),
        "real store: pipeline injects the anchor written under the threaded handle",
      );
    } finally {
      store.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* OS temp */
      }
    }
  }

  // ---- 7. #187: [budget] is registered at both session-registration paths ----
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-187-mcp-"));
    const store = new SqliteSessionStore(join(dir, "anysearch.db"));
    const config: CompositionResult["config"] = {
      sources: { enabled: [] },
      prompts: [],
      skills: { active: [] },
      hooks: { toolWhitelist: [] },
      rag: { adapter: "none" },
      budget: { tokenCap: 4321, usdCap: 1.5, callCap: 3, outputReserveTokens: 4096 },
    };
    const ledger = new BudgetLedger((store as any).db);
    try {
      const byHandle = await resolveAnsChatSession(engineWith(store, config), "budget-handle-187");
      assert(byHandle.sessionId === "budget-handle-187", "budget: supplied handle still echoes back");
      const handleRow = ledger.getBalance("budget-handle-187");
      assert(handleRow?.tokenCap === 4321 && handleRow?.callCap === 3 && handleRow?.usdCap === 1.5,
        "#187: ensureSession path creates the budget row from the Active Domain");

      const minted = await resolveAnsChatSession(engineWith(store, config));
      assert(!!minted.sessionId, "budget: handle-less call still mints");
      assert(ledger.getBalance(minted.sessionId!)?.tokenCap === 4321,
        "#187: createSession path creates the budget row from the Active Domain");

      const plain = await resolveAnsChatSession(engineWith(store), "no-budget-handle-187");
      assert(plain.sessionId === "no-budget-handle-187", "budget: no-config wiring still registers");
      assert(ledger.getBalance("no-budget-handle-187") === null,
        "#187: no [budget] -> no row -> unmetered (pass), not a zero-cap row");

      // The same threaded handle under a domain that dropped [budget] must stop
      // enforcing the old caps (history stays internally for audit).
      const released = await resolveAnsChatSession(engineWith(store), "budget-handle-187");
      assert(released.sessionId === "budget-handle-187", "budget: released handle still resumes");
      assert(ledger.getBalance("budget-handle-187") === null,
        "#187: dropping [budget] makes the existing MCP session unmetered");
    } finally {
      store.close();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* OS temp */ }
    }
  }

  console.log("--- ans_chat session tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});