// Q1 SDK control-surface probe (scripted provider, real kernel + real store).
//
// Proves the agent loop built on the FULL pi-coding-agent AgentSession keeps the
// AnySearch controls that used to live on hand-rolled hooks:
//   C1 zero host-resource discovery (AGENTS.md / .pi skills / .claude skills)
//   C2 tool allowlist (only the domain-whitelisted tools reach the model)
//   C3 URL trust boundary still blocks retrieved-derived URLs via tool_call
//      (allowed host passes, denied host never executes)
//   C4 saturation stop: repeated stale searches are blocked, run still answers
//   C5 token budget rejection: no provider call when the ledger refuses
//   C6 cancellation: pre-aborted -> nothing starts; mid-run -> no done summary
//   C7 compaction: next request carries the summary, originals stay in JSONL,
//      done.context reports PI's own context usage
//   C8 resolveReserveInputTokens counts the static system header exactly once
//
// Run: node --import tsx prototype/pi-esm-full-sdk/probe-q1-sdk-controls.ts

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { SqliteSessionStore } from "../../packages/store/src/session-store";
import { PiAgentRuntime, resolveReserveInputTokens, estimateMessagesTokens } from "../../packages/kernel/src/pi-runtime";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
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
  if (Array.isArray(message.content)) return message.content.map((c: any) => c?.text ?? (c?.type === "toolResult" ? JSON.stringify(c) : "")).join("\n");
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

function scriptedProvider(decide: (ctx: { turn: number; kind: string; context: any }) => any) {
  const calls: CallRecord[] = [];
  let mainTurn = 0;
  const fn = (_model: any, context: any, _options: any) => {
    const system = systemText(context);
    const kind = system.includes("context summarization assistant") ? "summary" : "main";
    let reply: any;
    if (kind === "summary") {
      reply = assistantMessage([{ type: "text", text: "SUMMARY-MARKER-Q1: condensed probe history." }], "stop", 100);
    } else {
      reply = decide({ turn: mainTurn, kind, context });
      mainTurn++;
    }
    calls.push({
      kind,
      system: system.slice(0, 200),
      tools: systemToolNames(context),
      text: contextText(context),
    });
    return streamOf(reply);
  };
  return { fn, calls };
}

function lastUserText(context: any): string {
  const msgs = context?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === "user") return messageText(msgs[i]);
  return "";
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
        url, title: "R" + i, snippet: i === 0 ? "ORIGINAL-TOOL-RESULT-MARKER: probe evidence." : "S" + i,
        source: "tavily", score: 1 - i * 0.1,
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

const workDir = mkdtempSync(join(tmpdir(), "ans-q1-sdk-"));
const store = new SqliteSessionStore(join(workDir, "anysearch.db"));

try {
  // ---------- C1 zero host-resource discovery ----------
  {
    const cwd = join(workDir, "host-env");
    mkdirSync(join(cwd, ".pi", "skills", "host-skill"), { recursive: true });
    mkdirSync(join(cwd, ".claude", "skills", "host-skill"), { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "HOST-CONTEXT-MARKER-9f2: host global instructions\n");
    writeFileSync(join(cwd, ".pi", "skills", "host-skill", "SKILL.md"), "HOST-SKILL-MARKER-9f2\n");
    writeFileSync(join(cwd, ".claude", "skills", "host-skill", "SKILL.md"), "HOST-SKILL-MARKER-9f2\n");

    const provider = scriptedProvider(({ turn }) =>
      turn === 0
        ? assistantMessage([{ type: "text", text: "probe answer" }], "stop", 200)
        : assistantMessage([{ type: "text", text: "probe answer" }], "stop", 200));
    const runtime = new PiAgentRuntime({
      retriever: new ProbeRetriever() as any,
      domain,
      model,
      streamFn: provider.fn as any,
      cwd,
    });
    await drain(runtime.run("hello"));
    const main = provider.calls.find((c) => c.kind === "main");
    const discovery = {
      systemHead: main?.system.slice(0, 120),
      toolNames: main?.tools,
      hostContextLeaked: (main?.system ?? "").includes("HOST-CONTEXT-MARKER-9f2"),
      hostSkillLeaked: (main?.system ?? "").includes("HOST-SKILL-MARKER-9f2"),
      domainPromptPresent: (main?.system ?? "").includes("PROBE-DOMAIN-PROMPT"),
    };
    record("C1", "zero host discovery: no AGENTS.md/.pi/.claude skills; only the domain prompt + whitelisted tool", 
      !discovery.hostContextLeaked && !discovery.hostSkillLeaked && discovery.domainPromptPresent &&
        JSON.stringify(discovery.toolNames) === JSON.stringify(["search"]),
      discovery);
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
    record("C2", "domain toolWhitelist is the security upper bound on the model-visible tool list",
      JSON.stringify(tools) === JSON.stringify(["search"]), { tools });
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
    const toolResults = events.filter((e) => e.type === "tool_result");
    const blockedText = JSON.stringify(toolResults.map((e) => e.result));

    // Same tool, allowlisted host: the boundary must let it through and run.
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
    record("C3", "tool_call extension blocks a non-allowlisted URL before execute() and lets an allowlisted one run",
      executed === 0 &&
        /URL rejected by trust boundary|Blocked retrieved-derived URL/.test(blockedText) &&
        allowedExecuted === 1 &&
        okEvents.some((e) => e.type === "text" && /allowed fetch done/.test(e.content)),
      { executed, blockedText: blockedText.slice(0, 300), allowedExecuted,
        allowedAnswer: okEvents.filter((e) => e.type === "text").map((e) => e.content).join("").slice(0, 120) });
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
    record("C4", "stale searches stop early and the run still answers",
      retriever.calls.length <= 3 && /FINAL-ANSWER/.test(text) && /Search stopped:/.test(contextText({ messages: [] }) + JSON.stringify(provider.calls)),
      { searchCalls: retriever.calls.length, finalAnswer: /FINAL-ANSWER/.test(text) });
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
    record("C5", "a refused token reserve stops the run before any provider call",
      streamCalls === 0 && tokenReserves === 1 && /Token budget exhausted/.test(error),
      { streamCalls, tokenReserves, error: error.slice(0, 200) });
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

    const mid = new AbortController();
    let midCalls = 0;
    const midRuntime = new PiAgentRuntime({
      retriever: new ProbeRetriever() as any, domain, model,
      streamFn: ((_m: any, _c: any, options: any) => {
        midCalls++;
        setTimeout(() => mid.abort("mid-run"), 20);
        return new Promise(() => {}) as any;
      }) as any,
      signal: mid.signal,
    });
    const done = drain(midRuntime.run("cancel mid run"));
    const midEvents = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 2000))]);
    record("C6", "pre-aborted signal starts nothing; mid-run abort ends without a done summary",
      preCalls === 0 && preEvents.length === 0 && midCalls === 1 && midEvents !== null &&
        !midEvents.some((e: any) => e.type === "done"),
      { preCalls, preEvents: preEvents.length, midCalls, midSettled: midEvents !== null,
        midDoneEvent: midEvents?.some((e: any) => e.type === "done") ?? null });
  }

  // ---------- C7 compaction ----------
  {
    const session = await store.createSession("chat");
    const piDir = join(workDir, "pi-sessions");
    const provider = scriptedProvider(({ turn, context }) => {
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
    const done = events.find((e) => e.type === "done");
    const summaryCalls = provider.calls.filter((c) => c.kind === "summary").length;
    const mainsAfterSummary = provider.calls.slice(provider.calls.findIndex((c) => c.kind === "summary") + 1).filter((c) => c.kind === "main");
    const nextRequestText = mainsAfterSummary[0]?.text ?? "";
    const files = readdirSync(piDir).filter((f) => f.endsWith(".jsonl"));
    const jsonl = files.length ? readFileSync(join(piDir, files[0]), "utf8") : "";
    record("C7", "PI compaction: next request carries the summary, originals remain in the PI JSONL, done.context reports usage",
      summaryCalls >= 1 &&
        nextRequestText.includes("SUMMARY-MARKER-Q1") &&
        nextRequestText.includes("COMPACTED") === false &&
        jsonl.includes("ORIGINAL-QUERY-MARKER") &&
        jsonl.includes("ORIGINAL-TOOL-RESULT-MARKER") &&
        done?.usage?.compactionCalls >= 1 &&
        done?.usage?.compactionTokens > 0 &&
        done?.context?.window === 2000,
      {
        summaryCalls,
        mainCalls: provider.calls.map((c) => c.kind),
        nextRequestHead: nextRequestText.slice(0, 400),
        jsonlHasOriginalQuery: jsonl.includes("ORIGINAL-QUERY-MARKER"),
        jsonlHasOriginalToolResult: jsonl.includes("ORIGINAL-TOOL-RESULT-MARKER"),
        jsonlLines: jsonl.split("\n").filter(Boolean).length,
        usage: done?.usage ?? null,
        context: done?.context ?? null,
        contextNote: done?.context?.tokens === null
          ? "PI reports tokens=null right after compaction; window still comes from the session"
          : null,
      });
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
    record("C8", "system header is excluded from carried history and added exactly once on cold start",
      headerOnly.tokens === 0 && headerOnly.coldStart === true &&
        cold.coldStart === true && cold.tokens === expectedCold &&
        withConversation.coldStart === false && withConversation.tokens === expectedConversation,
      { headerOnly, cold, expectedCold, withConversation, expectedConversation });
  }
} finally {
  try { store.close?.(); } catch {}
  const failed = findings.filter((f) => !f.pass);
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", "q1-sdk-controls.json"), JSON.stringify({
    probe: "q1-sdk-controls",
    generatedAt: new Date().toISOString(),
    inputSource: "real kernel PiAgentRuntime + real SqliteSessionStore, scripted provider (no network)",
    findings,
  }, null, 2));
  try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log("\n" + (failed.length === 0 ? "Q1 SDK CONTROLS: PASS" : "Q1 SDK CONTROLS: FAIL (" + failed.length + ")"));
  process.exit(failed.length === 0 ? 0 : 1);
}
