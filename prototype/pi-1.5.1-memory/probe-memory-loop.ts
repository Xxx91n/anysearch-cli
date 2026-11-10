// PROTOTYPE — throwaway probe, not product code.
//
// Question (Q2): does a search performed inside `ans_chat` travel the full
// loop — search -> retrieval_results -> next session recall -> model request?
// Also checks the newly wired sufficiency reround (prepareNextTurnWithContext)
// and whether a run's own summary reaches the next call.
//
// Real product kernel + real SQLite store; scripted provider (no network).
// Run: node --import tsx prototype/pi-1.5.1-memory/probe-memory-loop.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";
import { PiAgentRuntime } from "../../packages/kernel/src/pi-runtime";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const findings: Array<{ id: string; question: string; ok: boolean; evidence: unknown }> = [];
function record(id: string, question: string, evidence: unknown, ok: boolean) {
  findings.push({ id, question, ok, evidence });
  console.log("\n[" + id + "] " + question + "\n  ok=" + ok + "\n  " + JSON.stringify(evidence).slice(0, 900));
}

// ---------- scripted provider ----------

function assistantMessage(content: any[], stopReason: string, totalTokens = 500) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    usage: {
      input: Math.max(0, totalTokens - 10),
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamOf(message: any) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      // Real providers stream text as text_delta before the terminal done
      // event; the gate and the reuse adjudicator parse that channel.
      for (const block of message.content) {
        if (block?.type === "text" && block.text) {
          yield { type: "text_delta", contentIndex: 0, delta: block.text, partial: message };
        }
      }
      yield { type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message };
    },
    result: async () => message,
  };
}

function messageText(message: any): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? "").join("\n");
  return "";
}

function systemText(context: any): string {
  const fromField = typeof context?.systemPrompt === "string" ? context.systemPrompt : "";
  const fromMessages = (context?.messages ?? [])
    .filter((m: any) => m?.role === "system")
    .map(messageText)
    .join("\n");
  return fromField + "\n" + fromMessages;
}

function lastUserText(context: any): string {
  const messages = context?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messageText(messages[i]);
  }
  return "";
}

interface CallRecord {
  kind: string;
  messages: any[];
  estimatedChars: number;
  systemHead: string;
}

function scriptedProvider(mainReplies: Array<() => any>) {
  const calls: CallRecord[] = [];
  let mainIndex = 0;
  const fn = (model: any, context: any, options: any) => {
    const system = systemText(context);
    const user = lastUserText(context);
    const kind = system.includes("search sufficiency evaluator")
      ? "gap-query"
      : system.includes("memory adjudicator")
        ? "adjudicate"
        : system.includes("context summarization assistant")
          ? "summary"
          : "main";
    calls.push({
      kind,
      messages: (context?.messages ?? []).map((m: any) => ({ role: m.role, text: messageText(m) })),
      estimatedChars: JSON.stringify(context?.messages ?? []).length,
      systemHead: system.slice(0, 60),
    });
    if (kind === "gap-query") return streamOf(assistantMessage([{ type: "text", text: "probe reround query" }], "stop", 50));
    if (kind === "adjudicate") return streamOf(assistantMessage([{ type: "text", text: "compress" }], "stop", 20));
    if (kind === "summary") {
      return streamOf(assistantMessage([{ type: "text", text: "SUMMARY-MARKER: probe summary of the searched topic." }], "stop", 100));
    }
    const reply = mainReplies[Math.min(mainIndex, mainReplies.length - 1)];
    mainIndex++;
    return streamOf(reply());
  };
  return { fn, calls };
}

// ---------- real retriever ----------

const searchCalls: string[] = [];
class ProbeRetriever {
  async search(query: any) {
    searchCalls.push(String(query.query ?? ""));
    const isReround = String(query.query).includes("reround");
    const results = [
      {
        url: isReround ? "https://reround.example/fresh" : "https://probe.example/a",
        title: isReround ? "Reround fresh result" : "Probe result A",
        snippet: isReround
          ? "REROUND-EVIDENCE: the missing half of the probe memory wiring question."
          : "FIRST-EVIDENCE: the probe memory wiring fact lives in this snippet.",
        source: "tavily",
        score: 1,
      },
    ];
    return {
      query: String(query.query),
      mode: query.mode ?? "fast",
      results,
      metadata: {
        sufficiency: {
          verdict: isReround ? "correct" : "insufficient",
          missing: ["the second half of the question"],
        },
        providerAnswers: [],
      },
    } as any;
  }
}

const domain: any = {
  sources: { enabled: ["tavily"] },
  prompts: [{ name: "system", content: "You are a probe research agent." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
  compaction: { lowWatermark: 100, reuseCap: 3, sufficiencyMaxRerounds: 1 },
};

const model: any = {
  id: "probe-model",
  name: "probe-model",
  api: "openai-completions",
  provider: "probe",
  contextWindow: 20000,
  maxTokens: 4096,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const fakeModels = { getModel: () => model };

function searchThenAnswer() {
  return assistantMessage(
    [{ type: "toolCall", id: "call-search-1", name: "search", arguments: { query: "probe memory wiring" } }],
    "toolUse",
    2000,
  );
}
function plainAnswer() {
  return assistantMessage([{ type: "text", text: "ANSWER: used the available evidence." }], "stop", 2000);
}

const workDir = mkdtempSync(join(tmpdir(), "anysearch-pi151-memory-"));
const dbPath = join(workDir, "anysearch.db");
const store = new SqliteSessionStore(dbPath);

function dbRows(sql: string, params: any[] = []): any[] {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const event of run) events.push(event);
  return events;
}

try {
  // ---------- run 1: internal search must index its own results ----------
  const session1 = await store.createSession("chat");
  const provider1 = scriptedProvider([searchThenAnswer, plainAnswer]);
  const runtime1 = new PiAgentRuntime({
    retriever: new ProbeRetriever() as any,
    store,
    sessionId: session1.id,
    domain,
    model,
    streamFn: provider1.fn as any,
    models: fakeModels,
    getApiKey: async () => "probe-key",
  });
  await drain(runtime1.run("what does the probe memory wiring do?"));
  await runtime1.flushMemory();

  const indexed = dbRows("SELECT id, session_id, url, title, snippet, source FROM retrieval_results");
  const anchors = dbRows("SELECT anchor_type, payload FROM resume_anchors WHERE session_id = ?", [session1.id]);
  record(
    "Q2-1",
    "ans_chat 内部搜索的结果写进了 retrieval_results",
    {
      rows: indexed,
      rowCount: indexed.length,
      anchors: anchors.map((a) => a.anchor_type),
      searchCalls,
      providerCalls: provider1.calls.map((c) => c.kind),
    },
    indexed.length >= 1 && indexed.some((r) => String(r.snippet).includes("FIRST-EVIDENCE")),
  );

  record(
    "Q2-2",
    "新一轮补搜在下一轮请求里可见（prepareNextTurnWithContext 接线生效）",
    {
      providerCalls: provider1.calls.map((c) => ({ kind: c.kind, roles: c.messages.map((m: any) => m.role) })),
      mainRequestHasReroundEvidence: provider1.calls
        .filter((c) => c.kind === "main")
        .map((c) => JSON.stringify(c.messages).includes("REROUND-EVIDENCE")),
      gateRan: provider1.calls.some((c) => c.kind === "gap-query"),
    },
    provider1.calls.some((c) => c.kind === "gap-query") &&
      provider1.calls.filter((c) => c.kind === "main").some((c) => JSON.stringify(c.messages).includes("REROUND-EVIDENCE")),
  );

  // ---------- run 2: a later session must recall run 1's stored result ----------
  const provider2 = scriptedProvider([plainAnswer]);
  const runtime2 = new PiAgentRuntime({
    retriever: new ProbeRetriever() as any,
    store,
    sessionId: session1.id,
    domain,
    model,
    streamFn: provider2.fn as any,
    models: fakeModels,
    getApiKey: async () => "probe-key",
  });
  await drain(runtime2.run("what did we learn about the probe memory wiring?"));
  await runtime2.flushMemory();

  const firstRequest2 = provider2.calls.find((c) => c.kind === "main");
  const requestText = JSON.stringify(firstRequest2?.messages ?? []);
  record(
    "Q2-3",
    "后续会话的模型请求真的带上了上次检索到的资料",
    {
      requestRoles: (firstRequest2?.messages ?? []).map((m: any) => m.role),
      hasResearchRecallTag: requestText.includes("[Research Recall]"),
      hasStoredEvidenceText: requestText.includes("FIRST-EVIDENCE"),
      hasSessionMemoryTag: requestText.includes("[Session Memory]"),
      hasRecoveryDigest: requestText.includes("[Recovery Digest]"),
      providerCalls: provider2.calls.map((c) => c.kind),
    },
    requestText.includes("FIRST-EVIDENCE"),
  );

  // ---------- control: the old wiring (no saveResults) closes nothing ----------
  // A fresh database isolates the control: the research archive is global, so
  // reusing the main DB would legitimately recall session 1's rows.
  const controlStore = new SqliteSessionStore(join(workDir, "control.db"));
  const session2 = await controlStore.createSession("chat");
  const originalSave = controlStore.saveResults.bind(controlStore);
  (controlStore as any).saveResults = async () => {};
  try {
    const provider3 = scriptedProvider([searchThenAnswer, plainAnswer]);
    const runtime3 = new PiAgentRuntime({
      retriever: new ProbeRetriever() as any, store: controlStore, sessionId: session2.id, domain, model,
      streamFn: provider3.fn as any, models: fakeModels, getApiKey: async () => "probe-key",
    });
    await drain(runtime3.run("control question about the same topic"));
    await runtime3.flushMemory();
    const provider4 = scriptedProvider([plainAnswer]);
    const runtime4 = new PiAgentRuntime({
      retriever: new ProbeRetriever() as any, store: controlStore, sessionId: session2.id, domain, model,
      streamFn: provider4.fn as any, models: fakeModels, getApiKey: async () => "probe-key",
    });
    await drain(runtime4.run("control follow-up about the same topic"));
    await runtime4.flushMemory();
    const controlText = JSON.stringify(provider4.calls[0]?.messages ?? []);
    const controlRecallHits = await controlStore.searchMemory("probe memory wiring", 5);
    record(
      "Q2-4",
      "对照组：不写下检索结果时，后续会话取不回资料",
      {
        hasStoredEvidenceText: controlText.includes("FIRST-EVIDENCE"),
        hasResearchRecallTag: controlText.includes("[Research Recall]"),
        controlArchiveHits: controlRecallHits.length,
      },
      !controlText.includes("FIRST-EVIDENCE") && controlRecallHits.length === 0,
    );
  } finally {
    (controlStore as any).saveResults = originalSave;
    try { controlStore.close?.(); } catch {}
  }
} finally {
  try { store.close?.(); } catch {}
  if (process.env.PROBE_KEEP !== "1") {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log("kept " + workDir);
  }
}

const fs = await import("node:fs");
fs.mkdirSync(join(HERE, "out"), { recursive: true });
fs.writeFileSync(
  join(HERE, "out", "probe-memory-loop.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), inputSource: "real kernel + real SQLite store, scripted provider", findings }, null, 2),
);
console.log("\nwrote out/probe-memory-loop.json");
console.log("SUMMARY " + JSON.stringify(findings.map((f) => [f.id, f.ok])));
