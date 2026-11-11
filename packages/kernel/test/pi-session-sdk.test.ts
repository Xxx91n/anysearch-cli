// Full PI SDK session controls (#258).
//
// The runtime moved from a hand-wired pi-agent-core Agent to the complete
// pi-coding-agent AgentSession. These cases prove the controls that used to live
// on the old hooks survived the move, using the real kernel runtime and the real
// SQLite store with a scripted provider (no network):
//
//   C1 zero host-resource discovery (AGENTS.md / .pi skills / .claude skills)
//   C2 domain toolWhitelist is the model-visible upper bound
//   C3 tool_call seam blocks a non-allowlisted retrieved URL before execute()
//   C4 saturation stop: repeated stale searches stop, the run still answers
//   C5 a refused token reserve stops the run before any provider call
//   C6 pre-aborted starts nothing; mid-run abort ends without a done summary
//   C7 compaction: next request carries the summary, originals stay in the JSONL,
//      done.context reports PI's own window
//   C8 the static system head is counted once by the token reserve
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { estimateMessagesTokens, PiAgentRuntime, resolveReserveInputTokens } from "../src/pi-runtime";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

// ---------- scripted provider (no network) ----------

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
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((c: any) => c?.text ?? (c?.type === "toolResult" ? JSON.stringify(c) : "")).join("\n");
  }
  return "";
}

// pi-agent-core 1.5.1 normalizes the prompt into one leading system message:
// the static head lives in `sections` and the tool declarations in `toolsAdded`,
// not in `content`. Read those or the prompt/tool checks silently see "".
function systemText(context: any): string {
  const fromField = typeof context?.systemPrompt === "string" ? context.systemPrompt : "";
  const fromMessages = (context?.messages ?? [])
    .filter((m: any) => m?.role === "system")
    .map((m: any) => messageText(m) + "\n" + JSON.stringify(m?.sections ?? {}))
    .join("\n");
  return fromField + "\n" + fromMessages;
}

function systemToolNames(context: any): string[] {
  const msg = (context?.messages ?? []).find((m: any) => m?.role === "system");
  const added = msg?.toolsAdded;
  if (Array.isArray(added)) return added.map((t: any) => t?.name).filter(Boolean);
  return (context?.tools ?? []).map((t: any) => t.name);
}

function contextText(context: any): string {
  return JSON.stringify((context?.messages ?? []).map((m: any) => ({ role: m.role, text: messageText(m) })));
}

interface CallRecord { kind: string; system: string; tools: string[]; text: string }

// PI's own summarizer is a separate provider call. Detecting it by its system
// prompt keeps the scripted provider honest about which call is which.
function scriptedProvider(decide: (ctx: { turn: number; kind: string; context: any }) => any) {
  const calls: CallRecord[] = [];
  let mainTurn = 0;
  const fn = (_model: any, context: any, _options: any) => {
    const system = systemText(context);
    const kind = system.includes("context summarization assistant") ? "summary" : "main";
    let reply: any;
    if (kind === "summary") {
      reply = assistantMessage([{ type: "text", text: "SUMMARY-MARKER-258: condensed probe history." }], "stop", 100);
    } else {
      reply = decide({ turn: mainTurn, kind, context });
      mainTurn++;
    }
    calls.push({ kind, system: system.slice(0, 4000), tools: systemToolNames(context), text: contextText(context) });
    return streamOf(reply);
  };
  return { fn, calls };
}

class ProbeRetriever {
  calls: string[] = [];
  constructor(private readonly urls: string[] = ["https://probe.example/a"]) {}
  async search(q: any) {
    this.calls.push(String(q.query));
    return {
      query: String(q.query),
      mode: q.mode ?? "fast",
      results: this.urls.map((url, i) => ({
        url,
        title: "R" + i,
        snippet: i === 0 ? "ORIGINAL-TOOL-RESULT-MARKER: probe evidence." : "S" + i,
        source: "tavily",
        score: 1 - i * 0.1,
      })),
      answers: [],
      metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 1 },
    } as any;
  }
}

const domain: any = {
  sources: { enabled: ["tavily"] },
  prompts: [{ name: "system", content: "PROBE-DOMAIN-PROMPT: you are a probe research agent." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-258-sdk-"));
  const store = new SqliteSessionStore(join(workDir, "anysearch.db"));

  try {
    // ---------- C1 zero host-resource discovery ----------
    {
      const cwd = join(workDir, "host-env");
      mkdirSync(join(cwd, ".pi", "skills", "host-skill"), { recursive: true });
      mkdirSync(join(cwd, ".claude", "skills", "host-skill"), { recursive: true });
      writeFileSync(join(cwd, "AGENTS.md"), "HOST-CONTEXT-MARKER-258: host global instructions\n");
      writeFileSync(join(cwd, ".pi", "skills", "host-skill", "SKILL.md"), "HOST-SKILL-MARKER-258\n");
      writeFileSync(join(cwd, ".claude", "skills", "host-skill", "SKILL.md"), "HOST-SKILL-MARKER-258\n");

      const provider = scriptedProvider(() => assistantMessage([{ type: "text", text: "probe answer" }], "stop", 200));
      const runtime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any,
        domain,
        model,
        streamFn: provider.fn as any,
        cwd,
      });
      const events = await drain(runtime.run("hello"));
      const main = provider.calls.find((c) => c.kind === "main");
      assert(!(main?.system ?? "").includes("HOST-CONTEXT-MARKER-258"),
        "C1: the host AGENTS.md is not loaded into the session");
      assert(!(main?.system ?? "").includes("HOST-SKILL-MARKER-258"),
        "C1: host .pi/.claude skills are not discovered");
      assert((main?.system ?? "").includes("PROBE-DOMAIN-PROMPT"),
        "C1: the domain prompt is the system head");
      assert(JSON.stringify(main?.tools) === JSON.stringify(["search"]),
        "C1: the model sees only the whitelisted search tool (got " + JSON.stringify(main?.tools) + ")");
      assert(events.some((e) => e.type === "done"), "C1: the scripted run completes");
    }

    // ---------- C2 tool allowlist ----------
    {
      const provider = scriptedProvider(() => assistantMessage([{ type: "text", text: "done" }], "stop", 100));
      const runtime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any,
        domain: { ...domain, hooks: { toolWhitelist: ["search"] } },
        model,
        streamFn: provider.fn as any,
      });
      await drain(runtime.run("hello"));
      const tools = provider.calls[0]?.tools ?? [];
      assert(JSON.stringify(tools) === JSON.stringify(["search"]),
        "C2: the domain toolWhitelist is the model-visible upper bound (got " + JSON.stringify(tools) + ")");
    }

    // ---------- C3 URL trust boundary ----------
    {
      let executed = 0;
      const fetchTool: AgentTool = {
        name: "fetch_page",
        label: "Fetch",
        description: "probe fetch",
        parameters: Type.Object({ url: Type.String() }),
        execute: async (_id: string, params: any) => {
          executed++;
          return { content: [{ type: "text", text: "Fetched " + params.url }], details: {} };
        },
      } as any;
      const provider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "c1", name: "fetch_page", arguments: { url: "https://evil.example/secret" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "blocked as expected" }], "stop", 100));
      const runtime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any,
        domain: {
          ...domain,
          sources: { enabled: ["tavily"], urlAllowlist: ["allowed.example"], urlDenylist: [] },
          hooks: { toolWhitelist: ["search", "fetch_page"] },
        },
        model,
        streamFn: provider.fn as any,
        tools: [fetchTool],
      });
      const events = await drain(runtime.run("fetch the evil URL"));
      const blockedText = JSON.stringify(events.filter((e) => e.type === "tool_result").map((e) => e.result));
      assert(executed === 0, "C3: a non-allowlisted URL never reaches execute()");
      assert(/URL rejected by trust boundary|Blocked retrieved-derived URL/.test(blockedText),
        "C3: the block reason names the trust boundary (got " + blockedText.slice(0, 200) + ")");

      // Same tool, allowlisted host: the boundary must let it through.
      let allowedExecuted = 0;
      const okProvider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "c2", name: "fetch_page", arguments: { url: "https://allowed.example/doc" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "allowed fetch done" }], "stop", 100));
      const okRuntime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any,
        domain: {
          ...domain,
          sources: { enabled: ["tavily"], urlAllowlist: ["allowed.example"], urlDenylist: [] },
          hooks: { toolWhitelist: ["search", "fetch_page"] },
        },
        model,
        streamFn: okProvider.fn as any,
        tools: [{
          name: "fetch_page",
          label: "Fetch",
          description: "probe fetch",
          parameters: Type.Object({ url: Type.String() }),
          execute: async (_id: string, params: any) => {
            allowedExecuted++;
            return { content: [{ type: "text", text: "Fetched " + params.url }], details: {} };
          },
        } as any],
      });
      const okEvents = await drain(okRuntime.run("fetch the allowed URL"));
      assert(allowedExecuted === 1, "C3: an allowlisted host still executes");
      assert(okEvents.some((e) => e.type === "text" && /allowed fetch done/.test(e.content)),
        "C3: the allowlisted run completes its answer");
    }

    // ---------- C4 saturation stop ----------
    {
      const retriever = new ProbeRetriever(["https://same.example/1", "https://same.example/2"]);
      const provider = scriptedProvider(({ turn, context }) => {
        const sawStop = contextText(context).includes("Search stopped:");
        if (sawStop) return assistantMessage([{ type: "text", text: "FINAL-ANSWER: answering from evidence." }], "stop", 200);
        return assistantMessage([{ type: "toolCall", id: "s" + turn, name: "search", arguments: { query: "same stale question " + turn } }], "toolUse", 200);
      });
      const runtime = new PiAgentRuntime({ retriever: retriever as any, domain, model, streamFn: provider.fn as any });
      const events = await drain(runtime.run("adversarial repeated search"));
      const text = events.filter((e) => e.type === "text").map((e) => e.content).join("");
      assert(retriever.calls.length <= 3, "C4: stale searches stop early (calls " + retriever.calls.length + ")");
      assert(/Search stopped:/.test(JSON.stringify(provider.calls)), "C4: the model is told why searching stopped");
      assert(/FINAL-ANSWER/.test(text), "C4: the run still answers from the evidence it has");
    }

    // ---------- C5 token budget rejection ----------
    {
      const session = await store.createSession("chat");
      let streamCalls = 0;
      let tokenReserves = 0;
      const ledger: any = {
        reserveCalls: () => true, settleCalls: () => {},
        reserveTokens: () => { tokenReserves++; return false; }, settleTokens: () => {},
        reserveUsd: () => true, settleUsd: () => {},
      };
      const provider = scriptedProvider(() => { streamCalls++; return assistantMessage([{ type: "text", text: "should not run" }], "stop", 10); });
      const runtime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any, store, sessionId: session.id, ledger,
        domain: { ...domain, budget: { outputReserveTokens: 2048 } },
        model, streamFn: provider.fn as any,
      });
      const events = await drain(runtime.run("budget case"));
      const error = events.find((e) => e.type === "error")?.message ?? "";
      assert(streamCalls === 0, "C5: no provider call after a refused reserve");
      assert(tokenReserves === 1, "C5: the reserve was attempted exactly once");
      assert(/Token budget exhausted/.test(error), "C5: the caller sees a structured rejection (got " + error.slice(0, 160) + ")");
      assert(!events.some((e) => e.type === "done"), "C5: a rejected run never reports as completed");
    }

    // ---------- C6 cancellation ----------
    {
      const pre = new AbortController();
      pre.abort("before");
      let preCalls = 0;
      const preRuntime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any, domain, model,
        streamFn: (() => { preCalls++; throw new Error("must not be called"); }) as any,
        signal: pre.signal,
      });
      const preEvents = await drain(preRuntime.run("cancelled before start"));
      assert(preCalls === 0, "C6: a pre-aborted signal starts no provider call");
      assert(preEvents.length === 0, "C6: a pre-aborted signal yields no events");

      const mid = new AbortController();
      let midCalls = 0;
      const midRuntime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any, domain, model,
        streamFn: ((_m: any, _c: any, _o: any) => {
          midCalls++;
          setTimeout(() => mid.abort("mid-run"), 20);
          return new Promise(() => {}) as any;
        }) as any,
        signal: mid.signal,
      });
      const done = drain(midRuntime.run("cancel mid run"));
      const midEvents = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 3000))]);
      assert(midCalls === 1, "C6: the cancelled run did reach the provider once");
      assert(midEvents !== null, "C6: cancellation ends the run even when the stream never settles");
      assert(!(midEvents as any[]).some((e: any) => e.type === "done"),
        "C6: a cancelled run never reports a done summary");
    }

    // ---------- C7 compaction ----------
    {
      const session = await store.createSession("chat");
      const piDir = join(workDir, "pi-sessions");
      const provider = scriptedProvider(({ turn }) => {
        if (turn === 0) {
          return assistantMessage(
            [{ type: "toolCall", id: "s1", name: "search", arguments: { query: "ORIGINAL-QUERY-MARKER compaction probe" } }],
            "toolUse",
            4000, // above the 2000 window minus reserve -> PI compacts before the next turn
          );
        }
        return assistantMessage([{ type: "text", text: "COMPACTED-ANSWER after summary" }], "stop", 4000);
      });
      const runtime = new PiAgentRuntime({
        retriever: new ProbeRetriever() as any, store, sessionId: session.id,
        piSessionDir: piDir, piCompaction: { reserveTokens: 500, keepRecentTokens: 60 },
        contextWindow: 2000,
        domain, model: { ...model, contextWindow: 2000 }, streamFn: provider.fn as any,
        getApiKey: async () => "probe-key",
      });
      const events = await drain(runtime.run("ORIGINAL-QUERY-MARKER please search and answer"));
      const doneEvent = events.find((e) => e.type === "done");
      const summaryCalls = provider.calls.filter((c) => c.kind === "summary").length;
      const summaryIdx = provider.calls.findIndex((c) => c.kind === "summary");
      const mainsAfterSummary = summaryIdx < 0 ? [] : provider.calls.slice(summaryIdx + 1).filter((c) => c.kind === "main");
      const nextRequestText = mainsAfterSummary[0]?.text ?? "";
      const files = readdirSync(piDir).filter((f) => f.endsWith(".jsonl"));
      const jsonl = files.length ? readFileSync(join(piDir, files[0]), "utf8") : "";

      assert(summaryCalls >= 1, "C7: PI ran its own compaction summary call");
      assert(nextRequestText.includes("SUMMARY-MARKER-258"),
        "C7: the next request carries PI's summary");
      assert(!nextRequestText.includes("COMPACTED-ANSWER"),
        "C7: compaction happened before the answer, not after");
      assert(jsonl.includes("ORIGINAL-QUERY-MARKER"),
        "C7: the original user question survives in the PI record");
      assert(jsonl.includes("ORIGINAL-TOOL-RESULT-MARKER"),
        "C7: the original tool result survives in the PI record");
      assert((doneEvent?.usage?.compactionCalls ?? 0) >= 1,
        "C7: the done event counts PI's compaction calls separately");
      assert((doneEvent?.usage?.compactionTokens ?? 0) > 0,
        "C7: the done event reports the compaction tokens");
      assert(doneEvent?.context?.window === 2000,
        "C7: done.context reports the window the session actually runs with (got " + JSON.stringify(doneEvent?.context) + ")");
    }

    // ---------- C8 static header counted once ----------
    {
      const headerOnly = resolveReserveInputTokens(0, [{ role: "system", content: "SYSTEM HEADER ".repeat(100) }], "", "");
      const cold = resolveReserveInputTokens(0, [], "prompt text", "system prompt text");
      const expectedCold = Math.ceil(estimateMessagesTokens([{ role: "user", content: "prompt text" }] as any)) +
        Math.ceil(estimateMessagesTokens([{ role: "user", content: "system prompt text" }] as any));
      const withConversation = resolveReserveInputTokens(
        0,
        [{ role: "system", content: "SYSTEM HEADER ".repeat(100) }, { role: "user", content: "conversation" }],
        "prompt text",
        "system prompt text",
      );
      const expectedConversation = Math.ceil(estimateMessagesTokens([{ role: "user", content: "conversation" }] as any));
      assert(headerOnly.tokens === 0, "C8: a lone system head is not counted as carried history");
      assert(headerOnly.coldStart === true, "C8: a lone system head still takes the cold-start branch");
      assert(cold.coldStart === true && cold.tokens === expectedCold,
        "C8: a cold start counts the prompt and system prompt once each");
      assert(withConversation.coldStart === false && withConversation.tokens === expectedConversation,
        "C8: with a conversation, only the conversation is counted (got " + withConversation.tokens + " vs " + expectedConversation + ")");
    }
  } finally {
    try { store.close?.(); } catch { /* already closed */ }
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nfull PI SDK session tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("full PI SDK session test threw:", e);
  process.exit(1);
});
