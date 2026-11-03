// #129 — the CLI composition root actually wires MemoryPipeline.
//
// The kernel test proves the seam; this one proves the ROOT. It drives the
// exact helper `runChat` calls (wireChatMemory) against a real SqliteSessionStore
// and then runs the runtime built from its result, so a regression in the
// wiring (dropped store, session id that never gets registered) turns this red
// even though every kernel-level assertion would stay green.
//
// Run: pnpm --filter @anysearch-cli/cli test

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAgentRuntime, readMessageText } from "@anysearch-cli/kernel";
import type { DomainConfigPort, Query } from "@anysearch-cli/kernel";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import { wireChatMemory, type ChatMemoryWiring } from "../src/commands/chat";

let passed = 0, failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

const domainWith = (adapter: string, note?: string): DomainConfigPort => ({
  sources: { enabled: [] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: note ? { adapter, config: { note } } : { adapter },
});

const retriever = {
  search: async (q: Query): Promise<FusedEnvelope> => ({
    results: [], answers: [],
    metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
  } as any),
} as any;

// Captures the messages the model is actually given, then answers immediately.
function makeStreamFn(sink: any[][]) {
  return (_model: any, context: any, _o?: any) => {
    sink.push(Array.isArray(context) ? context : context?.messages ?? []);
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
      api: "test", provider: "test", model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() { yield { type: "done", message: finalMessage, partial: finalMessage }; },
      result: async () => finalMessage,
    };
  };
}

const textOf = (m: any) => readMessageText(m)?.text ?? "";
const allText = (msgs: any[]) => msgs.map(textOf).join("\n");

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-129-cli-"));
  const dbPath = join(dir, "anysearch.db");
  const prevSessionEnv = process.env.ANS_SESSION_ID;
  // Pin the durable anchor id so the "same id after restart" assertion does not
  // depend on whatever ~/.anysearch-cli/session holds on this machine.
  process.env.ANS_SESSION_ID = "cli-wiring-session-129";
  try {
    // 1. wireChatMemory returns BOTH halves, and the session row exists before
    //    any anchor write (the FK the durable anchor id would otherwise break).
    const writer = new SqliteSessionStore(dbPath);
    let wiring: ChatMemoryWiring;
    try {
      wiring = await wireChatMemory(writer, "default");
      check(Boolean(wiring.store) && typeof wiring.sessionId === "string" && wiring.sessionId!.length > 0,
        "wireChatMemory returns store + a non-empty sessionId");
      // Only reachable if ensureSession ran first: resume_anchors has an FK to
      // sessions(id) under foreign_keys = ON.
      await writer.saveAnchor(wiring.sessionId!, "query", { query: "seed", timestamp: 1 });
      check(true, "the wired session id accepts anchor writes (FK satisfied)");

      // Seed recall-able Research Memory the way the MCP search path does.
      await writer.saveResults(wiring.sessionId!, [
        { url: "https://intra.example/wiki", title: "internal wiki", snippet: "the intranet wiki proxy runs on port 8080", source: "tavily" },
      ]);
    } finally {
      writer.close();
    }

    // 2. Restart: reopen the DB and build the runtime from a FRESH wiring call,
    //    exactly as a second `ans chat` process would.
    const store = new SqliteSessionStore(dbPath);
    try {
      const fresh = await wireChatMemory(store, "default");
      check(fresh.sessionId === wiring.sessionId, "the durable anchor yields the same session id after a restart");

      const sink: any[][] = [];
      const runtime = new PiAgentRuntime({
        retriever,
        domain: domainWith("fts"),
        model: { id: "test-model", provider: "test" } as any,
        streamFn: makeStreamFn(sink) as any,
        ...fresh,
      });
      const errors: any[] = [];
      for await (const ev of runtime.run("how do I reach the internal wiki?")) {
        if (ev.type === "error") errors.push(ev);
      }
      check(errors.length === 0, "wired run completes without error");

      const text = allText(sink.flat());
      check(text.includes("[RAG Context]"), "AC1: RAG block reaches the model through the CLI wiring");
      check(text.includes("port 8080"), "AC3: memory written before the restart is recalled");
      check(/adapter=fts/.test(text) && /provenance=memory/.test(text), "AC1: the injected block carries provenance");
      check(text.includes("how do I reach the internal wiki?"), "AC1: the user turn survives injection");

      // 3. AC2 regression on the SAME wired path: adapter="none" injects no RAG
      //    block. The user turn may still carry L1/L2 anchor text, so assert the
      //    RAG block is absent AND the question survives.
      const noneSink: any[][] = [];
      const noneRuntime = new PiAgentRuntime({
        retriever,
        domain: domainWith("none"),
        model: { id: "test-model", provider: "test" } as any,
        streamFn: makeStreamFn(noneSink) as any,
        ...fresh,
      });
      for await (const _ev of noneRuntime.run("how do I reach the internal wiki?")) { /* drain */ }
      const noneUser = textOf(noneSink.flat().filter((m: any) => m?.role === "user").pop());
      check(!noneUser.includes("[RAG Context]"), "AC2: adapter=none injects no RAG block");
      check(noneUser.includes("how do I reach the internal wiki?"), "AC2: adapter=none preserves the user question");
    } finally {
      store.close();
    }

    // 4. A failed registration closes the gate instead of pretending to wire it.
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
  } finally {
    if (prevSessionEnv === undefined) delete process.env.ANS_SESSION_ID;
    else process.env.ANS_SESSION_ID = prevSessionEnv;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
  }

  console.log("--- chat memory wiring tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
