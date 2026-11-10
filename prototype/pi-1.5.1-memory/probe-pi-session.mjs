// PROTOTYPE — throwaway probe, not product code.
//
// Question (Q1): with PI 1.5.1's SessionManager as the authoritative context
// source, does a session restore across process boundaries, does PI's own
// compaction actually replace older history in the NEXT request, and is the
// original transcript still readable afterwards?
//
// No network: a scripted provider implements the real 1.5.1 StreamFn contract.
// Run: node prototype/pi-1.5.1-memory/probe-pi-session.mjs

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
// pnpm puts the SDK under the workspace package that depends on it.
const NODE_MODULES = join(REPO, "packages", "kernel", "node_modules");

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(NODE_MODULES, ...name.split("/"), "package.json"), "utf8")).version;
}
function pkgDist(name, ...rest) {
  return pathToFileURL(join(NODE_MODULES, ...name.split("/"), "dist", ...rest)).href;
}

const pca = await import(pkgDist("@earendil-works/pi-coding-agent", "index.js"));
const core = await import(pkgDist("@earendil-works/pi-agent-core", "index.js"));
const compactionMod = await import(
  pkgDist("@earendil-works/pi-coding-agent", "core", "compaction", "compaction.js")
);
const { Agent } = core;
const { SessionManager } = pca;
const { prepareCompaction, compact, estimateContextTokens } = compactionMod;

const findings = [];
function record(id, question, evidence, ok) {
  findings.push({ id, question, ok, evidence });
  console.log("\n[" + id + "] " + question + "\n  ok=" + ok + "\n  " + evidence);
}

// ---------- scripted provider (real 1.5.1 StreamFn contract) ----------

function usage(totalTokens) {
  return {
    input: totalTokens - 10,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(content, stopReason, totalTokens = 500) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "proto",
    model: "proto-model",
    usage: usage(totalTokens),
    stopReason,
    timestamp: Date.now(),
  };
}

function streamOf(message) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      yield {
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      };
    },
    result: async () => message,
  };
}

// One reusable scripted provider: each call returns the next scripted reply and
// records exactly what the SDK handed to the wire.
function scriptedProvider(script) {
  const calls = [];
  let index = 0;
  const fn = (model, context, options) => {
    const reply = script[Math.min(index, script.length - 1)];
    index++;
    calls.push({
      index: calls.length,
      messages: context?.messages ?? [],
      estimatedTokens: estimateContextTokens(context?.messages ?? []).tokens,
      optionsKeys: Object.keys(options ?? {}),
    });
    return streamOf(reply);
  };
  return { fn, calls };
}

const model = {
  id: "proto-model",
  name: "proto-model",
  api: "openai-completions",
  provider: "proto",
  contextWindow: 20000,
  maxTokens: 4096,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const systemPrompt = "You are a probe research agent.";
const toolSink = [];
function searchTool() {
  return {
    name: "search",
    label: "Search",
    description: "Probe search tool",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    execute: async (_id, params) => {
      toolSink.push(params.query);
      return {
        content: [{ type: "text", text: "SEARCH-ENVELOPE " + params.query + " " + "x".repeat(2000) }],
        details: {},
      };
    },
  };
}

const workDir = mkdtempSync(join(tmpdir(), "anysearch-pi151-session-"));
const sessionDir = join(workDir, "sessions");

function newAgent(messages, script) {
  const provider = scriptedProvider(script);
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "off",
      tools: [searchTool()],
      messages,
    },
    streamFn: provider.fn,
    // Required for a session-managed transcript: PI stores the compaction
    // summary as a `compactionSummary` message, which the Agent's default
    // passthrough drops. pi-coding-agent's convertToLlm maps it to a user
    // message carrying the summary text.
    convertToLlm: pca.convertToLlm,
    getApiKey: async () => "probe-key",
  });
  return { agent, provider };
}

function assistantText(text, tokens = 500) {
  return assistantMessage([{ type: "text", text }], "stop", tokens);
}

try {
  // ---------- turn 1: one search round, persisted through SessionManager ----------
  const sm1 = SessionManager.create(workDir, sessionDir);
  const script1 = [
    assistantMessage([{ type: "toolCall", id: "call-1", name: "search", arguments: { query: "probe memory wiring" } }], "toolUse", 800),
    assistantText("turn-1 answer: the probe found the FIRST-EVIDENCE marker.", 900),
  ];
  const run1 = newAgent([], script1);
  await run1.agent.prompt("first question");
  const messages1 = run1.agent.state.messages;
  const appended1 = [];
  for (const message of messages1) {
    if (message.role === "system") continue;
    sm1.appendMessage(message);
    appended1.push(message.role);
  }
  const file1 = sm1.getSessionFile();
  const rawFileText = file1 && existsSync(file1) ? readFileSync(file1, "utf8") : "";
  record(
    "Q1-SESS-1",
    "第一条会话写入 JSONL，条目类型与消息角色可核对",
    {
      sessionFile: file1,
      roles: appended1,
      entryCount: sm1.getEntryCount(),
      fileBytes: rawFileText.length,
      toolCalls: toolSink.slice(),
    },
    appended1.includes("user") && appended1.includes("assistant") && file1 !== undefined && rawFileText.length > 0,
  );

  // ---------- simulated process restart ----------
  // Open the file the manager actually wrote. SessionManager.open() creates a
  // fresh session for a missing path, which would silently look like a "restore".
  const restored = SessionManager.open(file1);
  const restoredContext = restored.buildSessionContext();
  record(
    "Q1-SESS-2",
    "重启后从同一 JSONL 恢复出正确上下文（SessionManager 为权威来源）",
    {
      restoredSessionId: restored.getSessionId(),
      sameId: restored.getSessionId() === sm1.getSessionId(),
      restoredRoles: restoredContext.messages.map((m) => m.role),
      restoredText: restoredContext.messages
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join(" ")
        .slice(-500),
    },
    restored.getSessionId() === sm1.getSessionId() &&
      restoredContext.messages.some((m) => JSON.stringify(m.content ?? "").includes("FIRST-EVIDENCE")),
  );

  // ---------- turn 2 in the restored session: does the old turn reach the wire? ----------
  const run2 = newAgent(restoredContext.messages, [assistantText("turn-2 answer uses the restored context.", 700)]);
  await run2.agent.prompt("second question, continue");
  const secondRequest = run2.provider.calls[0];
  const appended2 = [];
  for (const message of run2.agent.state.messages) {
    if (message.role === "system") continue;
    if (!restoredContext.messages.some((m) => sameMessage(m, message))) {
      restored.appendMessage(message);
      appended2.push(message.role);
    }
  }
  const turn2WireText = JSON.stringify(secondRequest.messages);
  record(
    "Q1-SESS-3",
    "同一 sessionId 的下一轮请求真的带上上一轮内容",
    {
      requestMessageCount: secondRequest.messages.length,
      requestRoles: secondRequest.messages.map((m) => m.role),
      hasFirstEvidence: turn2WireText.includes("FIRST-EVIDENCE"),
      hasToolResult: secondRequest.messages.some((m) => m.role === "toolResult"),
      appendedRoles: appended2,
      estimatedTokens: secondRequest.estimatedTokens,
    },
    turn2WireText.includes("FIRST-EVIDENCE"),
  );

  // ---------- PI compaction: summarize old history, keep the recent tail ----------
  const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 200 };
  const branch = restored.getBranch();
  const prep = prepareCompaction(branch, settings);
  if (!prep) {
    record("Q1-COMPACT-1", "压缩前置准备可用", { branchEntries: branch.length }, false);
  } else {
    const summaryProvider = scriptedProvider([assistantText("SUMMARY-MARKER: turn 1 searched and found FIRST-EVIDENCE.", 300)]);
    const result = await compact(
      prep,
      model,
      "probe-key",
      undefined,
      undefined,
      undefined,
      "off",
      summaryProvider.fn,
    );
    restored.appendCompaction(result.summary, result.firstKeptEntryId, result.tokensBefore);

    const forNext = restored.buildSessionContext();
    const beforeReq = secondRequest;
    const afterReq = {
      messages: forNext.messages,
      estimatedTokens: estimateContextTokens(forNext.messages).tokens,
    };
    const afterText = JSON.stringify(afterReq.messages);
    record(
      "Q1-COMPACT-1",
      "压缩产物替换较早历史：下一请求里旧工具原文消失、摘要出现",
      {
        tokensBefore: result.tokensBefore,
        keptEntryId: result.firstKeptEntryId,
        beforeMessageCount: beforeReq.messages.length,
        beforeEstimatedTokens: beforeReq.estimatedTokens,
        afterMessageCount: afterReq.messages.length,
        afterEstimatedTokens: afterReq.estimatedTokens,
        summaryPresent: afterText.includes("SUMMARY-MARKER"),
        oldToolResultStillPresent: afterText.includes("SEARCH-ENVELOPE"),
        oldTurnTextStillPresent: afterText.includes("FIRST-EVIDENCE"),
      },
      afterText.includes("SUMMARY-MARKER") &&
        !afterText.includes("SEARCH-ENVELOPE") &&
        afterReq.estimatedTokens < beforeReq.estimatedTokens,
    );

    // ---------- compacted context actually answers through a fresh Agent ----------
    const run3 = newAgent(forNext.messages, [assistantText("turn-3 answer after compaction.", 400)]);
    await run3.agent.prompt("third question after compaction");
    const thirdRequest = run3.provider.calls[0];
    const thirdText = JSON.stringify(thirdRequest.messages);
    record(
      "Q1-COMPACT-2",
      "压缩后的上下文能继续回答，且线上请求就是压缩后的内容",
      {
        requestMessageCount: thirdRequest.messages.length,
        hasSummary: thirdText.includes("SUMMARY-MARKER"),
        hasOldToolResult: thirdText.includes("SEARCH-ENVELOPE"),
        answerSettled: run3.agent.state.errorMessage === undefined,
        estimatedTokens: thirdRequest.estimatedTokens,
      },
      thirdText.includes("SUMMARY-MARKER") && !thirdText.includes("SEARCH-ENVELOPE") && run3.agent.state.errorMessage === undefined,
    );

    // ---------- original transcript still readable (append-only) ----------
    const entries = restored.getEntries();
    const entryText = JSON.stringify(entries);
    record(
      "Q1-COMPACT-3",
      "压缩后原始记录仍可查回（append-only 条目未删除）",
      {
        entryCount: entries.length,
        compactionEntries: entries.filter((e) => e.type === "compaction").length,
        hasOriginalToolText: entryText.includes("SEARCH-ENVELOPE"),
        hasSummaryText: entryText.includes("SUMMARY-MARKER"),
      },
      entryText.includes("SEARCH-ENVELOPE") && entryText.includes("SUMMARY-MARKER"),
    );
  }

  // ---------- product session handle as the PI session id ----------
  const fixed = SessionManager.create(workDir, sessionDir, { id: "ans-probe-session-handle" });
  fixed.appendMessage({ role: "user", content: "handle probe", timestamp: Date.now() });
  const fixedFile = fixed.getSessionFile();
  const fixedReopened = SessionManager.open(fixedFile);
  record(
    "Q1-SESS-4",
    "可以用产品自己的 sessionId 作为 PI 会话 id（Q8 的关联键）",
    {
      createdId: fixed.getSessionId(),
      reopenedId: fixedReopened.getSessionId(),
      file: fixedFile,
      entries: fixedReopened.getEntryCount(),
    },
    fixed.getSessionId() === "ans-probe-session-handle" && fixedReopened.getSessionId() === fixed.getSessionId(),
  );

  // ---------- usage accounting from the authoritative message_end ----------
  const run4 = newAgent([], [assistantText("usage probe answer", 1200)]);
  const usageEvents = [];
  run4.agent.subscribe((event) => {
    if (event.type === "message_end" && event.message?.role === "assistant" && event.message.usage) {
      usageEvents.push(event.message.usage.totalTokens);
    }
  });
  await run4.agent.prompt("usage question");
  record(
    "Q1-USAGE-1",
    "每次模型调用的用量可从 message_end 完整核对",
    { assistantMessageEndEvents: usageEvents.length, totals: usageEvents },
    usageEvents.length === 1 && usageEvents[0] === 1200,
  );

  // ---------- cancellation seam ----------
  // The scripted stream hangs until the host's abort signal fires, so the
  // measured property is "the run stops on request", not a race with a timer.
  let forwardedSignal;
  function hangingStream(signal) {
    const message = assistantText("never delivered", 100);
    return {
      async *[Symbol.asyncIterator]() {
        await new Promise((resolveHang) => {
          if (signal?.aborted) return resolveHang();
          signal?.addEventListener("abort", () => resolveHang(), { once: true });
        });
        yield { type: "start", partial: { ...message, content: [] } };
        yield { type: "done", reason: "stop", message };
      },
      result: async () => message,
    };
  }
  const run5Agent = new Agent({
    initialState: { systemPrompt, model, thinkingLevel: "off", tools: [], messages: [] },
    streamFn: (_model, _context, options) => {
      forwardedSignal = options?.signal;
      return hangingStream(options?.signal);
    },
    getApiKey: async () => "probe-key",
  });
  const run5Events = [];
  run5Agent.subscribe((event) => run5Events.push(event.type));
  const runStart = Date.now();
  const run5 = run5Agent.prompt("cancel me");
  await new Promise((r) => setTimeout(r, 30));
  run5Agent.abort();
  let abortedError;
  try { await run5; } catch (e) { abortedError = String(e?.message ?? e); }
  const elapsedMs = Date.now() - runStart;
  record(
    "Q1-CANCEL-1",
    "取消行为由宿主控制：挂住的请求在 abort 后结束",
    {
      elapsedMs,
      errorMessage: run5Agent.state.errorMessage,
      abortedError,
      events: run5Events,
      signalWasForwarded: forwardedSignal instanceof AbortSignal,
    },
    elapsedMs < 1000 && run5Events.includes("agent_end"),
  );

  const result = {
    generatedAt: new Date().toISOString(),
    versions: {
      piAgentCore: pkgVersion("@earendil-works/pi-agent-core"),
      piAi: pkgVersion("@earendil-works/pi-ai"),
      piCodingAgent: pkgVersion("@earendil-works/pi-coding-agent"),
    },
    inputSource: "real PI 1.5.1 Agent/SessionManager/compaction; scripted StreamFn (no network)",
    findings,
  };
  await import("node:fs").then((fs) => fs.mkdirSync(join(HERE, "out"), { recursive: true }));
  await import("node:fs").then((fs) =>
    fs.writeFileSync(join(HERE, "out", "probe-pi-session.json"), JSON.stringify(result, null, 2)),
  );
  console.log("\nwrote out/probe-pi-session.json");
  console.log("SUMMARY " + JSON.stringify(findings.map((f) => [f.id, f.ok])));
} finally {
  if (process.env.PROBE_KEEP !== "1") {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log("kept " + workDir);
  }
}

function sameMessage(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
