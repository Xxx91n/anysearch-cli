// PROTOTYPE — throwaway probe, not production code.
// Answers the three handoff questions about memory wiring in the real
// pi-agent-core 0.84.2 loop. Uses a scripted provider stream (no network) but
// real Agent, real message shapes, real MemoryPipeline/SufficiencyEvaluator.
//
// Run: node --import tsx prototype/memory-wiring/probe.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateContextTokens } from "@earendil-works/pi-agent-core";
import { PiAgentRuntime } from "../../packages/kernel/src/pi-runtime";
import {
  MemoryPipeline,
  distillGap,
  adjudicateReuseCompress,
} from "../../packages/kernel/src/memory-pipeline";
import { SufficiencyEvaluator } from "../../packages/kernel/src/sufficiency-gate";
import { readMessageText } from "../../packages/kernel/src/message-text";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

const findings = [];
function record(id, question, reproduced, evidence, detail) {
  findings.push({ id, question, reproduced, evidence, detail });
  console.log("\n[" + id + "] " + question + "\n  reproduced=" + reproduced + "\n  " + evidence);
}

// ---------- real pi-ai message shapes ----------

function usage(totalTokens = 2000) {
  return {
    input: totalTokens - 10,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(content, stopReason, totalTokens = 2000) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    usage: usage(totalTokens),
    stopReason,
    timestamp: Date.now(),
  };
}

function toolResult(toolCallId, toolName, text) {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

// Scripted StreamFn implementing the real contract (model, context, options) ->
// AsyncIterable<AssistantMessageEvent> with result(). No network.
function scriptedProvider(script) {
  const captured = [];
  let call = 0;
  const fn = (model, context, options) => {
    const index = call++;
    const spec = script[Math.min(index, script.length - 1)];
    captured.push({
      index,
      modelArgIsModel: !!model && typeof model === "object" && "api" in model,
      systemPrompt: String(context?.systemPrompt || "").slice(0, 80),
      messages: context?.messages ?? [],
      tools: (context?.tools ?? []).map((t) => t.name),
      optionsKeys: Object.keys(options || {}),
      estimatedTokens: estimateContextTokens(context?.messages ?? []).tokens,
    });
    const final = assistant(spec.content, spec.stopReason, spec.totalTokens);
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "start", partial: { ...final, content: [] } };
        yield { type: "done", reason: spec.stopReason === "toolUse" ? "toolUse" : "stop", message: final };
      },
      result: async () => final,
    };
  };
  return { fn, captured };
}

// ---------- fake store ----------

class ProbeStore {
  constructor() {
    this.anchors = new Map();
    this.searchMemoryCalls = [];
    this.searchMemoryMultiCalls = [];
    this.saveAnchorCalls = [];
    this.appended = [];
  }
  async getAnchors(sessionId) { return this.anchors.get(sessionId) || []; }
  async saveAnchor(sessionId, anchorType, payload) {
    const list = this.anchors.get(sessionId) || [];
    list.push({ anchorType, payload, timestamp: Date.now() });
    this.anchors.set(sessionId, list);
    this.saveAnchorCalls.push({ sessionId, anchorType, payload });
  }
  async listPreferences() { return []; }
  async searchMemory(query, limit = 5) {
    this.searchMemoryCalls.push({ query, limit });
    return [{ content: "remembered: prior probe fact", role: "assistant", rank: 1, sessionId: "probe" }];
  }
  async searchMemoryMulti(queries, limit = 5) {
    this.searchMemoryMultiCalls.push({ queries, limit });
    return [{ content: "remembered: prior probe fact", role: "assistant", rank: 1, sessionId: "probe" }];
  }
  async append(sessionId, message) { this.appended.push({ sessionId, message }); }
  anchorTypes(sessionId) { return (this.anchors.get(sessionId) || []).map((a) => a.anchorType); }
}

const domain = {
  sources: { enabled: ["tavily", "exa"] },
  prompts: [{ name: "system", content: "You are a probe research agent." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
  compaction: { lowWatermark: 1000, reuseCap: 3, sufficiencyMaxRerounds: 1 },
};

function bigSnippet(n) {
  return "probe evidence paragraph ".repeat(Math.ceil(n / 24)).slice(0, n);
}

class ProbeRetriever {
  constructor() { this.calls = 0; this.queries = []; }
  async search(q) {
    this.calls++;
    this.queries.push(q.query);
    return {
      query: q.query,
      mode: q.mode || "fast",
      results: [
        { url: "https://probe.example/a", title: "Probe A", snippet: bigSnippet(1200), source: "tavily", score: 1 },
        { url: "https://probe.example/b", title: "Probe B", snippet: bigSnippet(1200), source: "exa", score: 0.9 },
      ],
      metadata: { sufficiency: { verdict: "insufficient", missing: ["the second half of the question"] }, providerAnswers: [] },
    };
  }
}

// Fake Models object: only completeSimple is used by generateSummaryWithUsage.
function fakeModels(model, summaryLog) {
  return {
    getModel: () => model,
    async completeSimple(m, context, options) {
      const promptText = String(context?.messages?.[0]?.content?.[0]?.text ?? "");
      summaryLog.push({
        systemPrompt: String(context?.systemPrompt || "").slice(0, 60),
        promptChars: promptText.length,
        estimatedTokens: estimateContextTokens(context?.messages ?? []).tokens,
        optionsKeys: Object.keys(options || {}),
        includesOldToolResult: promptText.includes("Probe A"),
      });
      return assistant([{ type: "text", text: "SUMMARY PROBE: fact A and fact B." }], "stop", 500);
    },
  };
}

const model = {
  id: "probe-model",
  name: "probe-model",
  api: "openai-completions",
  provider: "probe",
  contextWindow: 2000,
  maxTokens: 8192,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

// ---------- spies on the real classes ----------

const consolidateArgs = [];
const origConsolidate = MemoryPipeline.prototype.consolidate;
MemoryPipeline.prototype.consolidate = async function (messages, totalTokens, hasRetrievalEvidence) {
  consolidateArgs.push({
    messageCount: messages.length,
    roles: messages.map((m) => m.role),
    totalTokens,
    hasRetrievalEvidence,
  });
  return origConsolidate.call(this, messages, totalTokens, hasRetrievalEvidence);
};

const evaluateArgs = [];
const origEvaluate = SufficiencyEvaluator.prototype.evaluate;
SufficiencyEvaluator.prototype.evaluate = async function (messages) {
  const out = await origEvaluate.call(this, messages);
  evaluateArgs.push({
    inputRoles: messages.map((m) => m.role),
    hasToolResultMessage: messages.some((m) => m.role === "toolResult"),
    hasLegacyToolResultBlock: messages.some(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result"),
    ),
    resultHasEnvelope: out.enrichedEnvelope !== null,
    resultEvidence: out.hasRetrievalEvidence,
  });
  return out;
};

// ---------- end-to-end real loop ----------

const store = new ProbeStore();
const retriever = new ProbeRetriever();
const summaryLog = [];
const models = fakeModels(model, summaryLog);
const script = [
  { content: [{ type: "toolCall", id: "call-1", name: "search", arguments: { query: "anysearch memory pipeline", mode: "fast" } }], stopReason: "toolUse", totalTokens: 2000 },
  { content: [{ type: "text", text: "probe answer one" }], stopReason: "stop", totalTokens: 2000 },
  { content: [{ type: "text", text: "probe answer two" }], stopReason: "stop", totalTokens: 2000 },
];
const provider = scriptedProvider(script);

const runtime = new PiAgentRuntime({
  retriever,
  store,
  sessionId: "probe-session",
  domain,
  model,
  streamFn: provider.fn,
  models,
  getApiKey: async () => "test-key",
});

async function drain(run) {
  const events = [];
  for await (const event of run) events.push(event);
  return events;
}

const turn1Events = await drain(runtime.run("what does the memory pipeline remember?"));
await runtime.flushMemory();
const anchorsAfterTurn1 = store.anchorTypes("probe-session");
const turn2Events = await drain(runtime.run("and what did we just learn?"));
await runtime.flushMemory();
const anchorsAfterTurn2 = store.anchorTypes("probe-session");
const contexts = provider.captured;
const nextRequest = contexts[1];
const turn2FirstRequest = contexts[2];

// Q1.1: which steps executed / skipped on genuine PI messages.
const realToolResultMsg = nextRequest.messages.find((m) => m.role === "toolResult");
const gateOnReal = evaluateArgs[0];
record(
  "Q1-1",
  "真实 PI 消息进入流程时，哪些步骤执行、哪些跳过",
  gateOnReal && gateOnReal.resultHasEnvelope === false,
  "shouldStopAfterTurn ran; gate.evaluate saw " + JSON.stringify(gateOnReal) +
    "; consolidate received roles=" + JSON.stringify(consolidateArgs[0]?.roles) +
    "; real tool result message role=" + (realToolResultMsg?.role ?? "missing"),
  "The gate is reached but finds no target: it searches user messages for a legacy tool_result block, while PI appends a separate toolResult message.",
);

// Q1.2: automatic L2 recall
record(
  "Q1-2",
  "自动回忆是否调用存储检索并产生 l2_recall",
  store.searchMemoryCalls.length === 0 && store.searchMemoryMultiCalls.length === 0 && !anchorsAfterTurn1.includes("l2_recall"),
  "searchMemory calls=" + store.searchMemoryCalls.length +
    ", searchMemoryMulti calls=" + store.searchMemoryMultiCalls.length +
    ", anchors after turn 1=" + JSON.stringify(anchorsAfterTurn1) +
    ", consolidate hasRetrievalEvidence=" + JSON.stringify(consolidateArgs.map((a) => a.hasRetrievalEvidence)),
  "The L2 lookup scans assistant content for type 'tool_use' with .input.query; PI writes type 'toolCall' with .arguments, so the query is never found.",
);

// Q1.3: reuse recognition
const realReuseStream = () => ({
  async *[Symbol.asyncIterator]() {
    yield { type: "text_delta", delta: "reuse" };
    yield { type: "done", reason: "stop", message: assistant([{ type: "text", text: "reuse" }], "stop") };
  },
  result: async () => assistant([{ type: "text", text: "reuse" }], "stop"),
});
const adjudicatedReal = await adjudicateReuseCompress(realReuseStream, model, "new evidence", "old summary");
const legacyReuseStream = () => ({
  async *[Symbol.asyncIterator]() { yield { type: "text", text: "reuse" }; },
});
const adjudicatedLegacy = await adjudicateReuseCompress(legacyReuseStream, model, "new evidence", "old summary");
record(
  "Q1-3",
  "模型返回 reuse 时程序是否正确识别",
  adjudicatedReal === "compress" && adjudicatedLegacy === "reuse",
  "real event shape {type:'text_delta',delta:'reuse'} -> " + adjudicatedReal +
    "; legacy event shape {type:'text',text:'reuse'} -> " + adjudicatedLegacy,
  "adjudicateReuseCompress only accumulates event.type === 'text' && event.text; runner then read its verdict from the empty text and defaults to compress.",
);

// Q1.4: do reround results enter the next model request?
const reroundUrls = [];
const turn2Text = JSON.stringify(turn2FirstRequest.messages);
record(
  "Q1-4",
  "额外补搜取得的资料是否进入下一次模型请求",
  !turn2Text.includes("reround.example"),
  "turn 2 request roles=" + JSON.stringify(turn2FirstRequest.messages.map((m) => m.role)) +
    "; reround URL absent (and no reround happened: retriever calls=" + retriever.calls + ")",
  "The gate never produced an enriched envelope, and even if it had, shouldStopAfterTurn can only return a boolean; its applyTo() array is not written back to agent state. pi-agent-core 0.84.2 offers prepareNextTurn(context) for that, which production does not use.",
);

// Q2: compression and actual next-request input
function hasSessionMemory(messages) {
  return messages.some((m) => {
    const text = readMessageText(m)?.text ?? "";
    return text.includes("[Session Memory]");
  });
}
const summaryInSameRunNext = hasSessionMemory(nextRequest.messages);
const summaryInNextCall = hasSessionMemory(turn2FirstRequest.messages);
const oldToolResultStillFull = (realToolResultMsg?.content?.[0]?.text?.length ?? 0) > 1000;
const req1Tokens = contexts[0].estimatedTokens;
const req2Tokens = nextRequest.estimatedTokens;
record(
  "Q2-1",
  "压缩有没有减少实际输入；旧工具结果是否仍完整发送",
  oldToolResultStillFull && summaryInSameRunNext && summaryInNextCall && req2Tokens > req1Tokens,
  "same-run request#1(messages=" + contexts[0].messages.length + ", est tokens=" + req1Tokens +
    ") -> request#2(messages=" + nextRequest.messages.length + ", est tokens=" + req2Tokens +
    "); old tool result text chars=" + (realToolResultMsg?.content?.[0]?.text?.length ?? 0) +
    "; [Session Memory] in same-run request#2=" + summaryInSameRunNext +
    ", in next ans_chat-style run=" + summaryInNextCall,
  "No old message is dropped: request#2 still carries the full tool result plus the summary block when it arrives. The summary lands on the NEXT call (fresh Agent); within the same run the background summarization loses the race with the next provider request.",
);

const summaryCalls = summaryLog.length;
record(
  "Q2-2",
  "总结和判断额外增加了多少调用与 token",
  summaryCalls >= 1,
  "summary calls=" + summaryCalls + "; " + JSON.stringify(summaryLog.map((s) => ({ chars: s.promptChars, estTokens: s.estimatedTokens, includesOldToolResult: s.includesOldToolResult }))) +
    "; adjudication calls=0 (post-search trigger never true)",
  "Each compression adds one standalone summarization request that re-serializes the whole conversation. Adjudication is unreachable because hasRetrievalEvidence stays false.",
);

record(
  "Q2-3",
  "摘要锚点是否按预期保存",
  anchorsAfterTurn1.includes("rolling_summary") && anchorsAfterTurn1.includes("consolidation_state"),
  "anchors=" + JSON.stringify(anchorsAfterTurn1) + "; summary prompt char/token=" + JSON.stringify(summaryLog.map((s) => [s.promptChars, s.estimatedTokens])),
  "rolling_summary and consolidation_state are written; the summary content itself is injected later, but only as an addition.",
);

// Q1.5 + minimal adapters (all in-memory, production files untouched)
const realMessages = nextRequest.messages;

function textOfMessage(m) {
  if (typeof m.content === "string") return m.content;
  return (m.content || []).map((c) => c.text || "").join("");
}
function toLegacyToolMessages(messages) {
  return messages.map((m) =>
    m.role === "toolResult"
      ? { role: "tool", toolName: m.toolName, content: textOfMessage(m) }
      : m,
  );
}
function toLegacyBlockMessages(messages) {
  return messages.map((m) =>
    m.role === "toolResult"
      ? {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_call_id: m.toolCallId,
              content: [{ type: "text", text: textOfMessage(m) }],
            },
          ],
        }
      : m,
  );
}

const gapReal = distillGap(realMessages, 0);
const gapLegacy = distillGap(toLegacyToolMessages(realMessages), 0);
record(
  "Q5-1",
  "最小适配：把 toolResult 折成旧 role:'tool' 后，缺口提炼是否恢复",
  gapReal.text.length === 0 && gapLegacy.text.length > 0 && gapLegacy.results.length > 0,
  "real gap text chars=" + gapReal.text.length + ", results=" + gapReal.results.length +
    "; adapted gap text chars=" + gapLegacy.text.length + ", results=" + gapLegacy.results.length,
  "One shape adapter restores distillGap; without it the summarizer prompt's gap section stays empty.",
);

const legacyStreamCalls = [];
const legacyEvalDeps = {
  retriever: new ProbeRetriever(),
  domain,
  model,
  streamFn: (first, second) => {
    // Legacy 2-arg call: (object with .model/.messages/.thinkingLevel, {apiKey}).
    legacyStreamCalls.push({
      firstArgKeys: Object.keys(first || {}),
      secondArgKeys: Object.keys(second || {}),
      firstArgLooksLikeModel: !!first && typeof first === "object" && "api" in first,
    });
    return {
      async *[Symbol.asyncIterator]() { yield { type: "text", text: "probe gap query" }; },
    };
  },
};
const evaluator = new SufficiencyEvaluator(legacyEvalDeps);
const legacyBlockMessages = toLegacyBlockMessages(realMessages);
const gateLegacy = await evaluator.evaluate(legacyBlockMessages);
const appliedLegacy = evaluator.applyTo(legacyBlockMessages, gateLegacy);
record(
  "Q5-2",
  "最小适配：把 toolResult 折成旧 user/tool_result 合并块后，补搜是否恢复",
  gateLegacy.hasRetrievalEvidence === true && legacyEvalDeps.retriever.calls > 0,
  "hasRetrievalEvidence=" + gateLegacy.hasRetrievalEvidence + "; reround retriever calls=" + legacyEvalDeps.retriever.calls +
    "; gate streamFn call shape=" + JSON.stringify(legacyStreamCalls),
  "Shape adapter restores discovery and reround. The gate's own streamFn call still uses the old 2-argument form, separate from the message-shape mismatch.",
);

const reenriched = JSON.stringify(appliedLegacy);
record(
  "Q5-3",
  "补搜结果是否能进入下一次主模型请求（即使 gate 已恢复）",
  !turn2Text.includes("reround.example") && reenriched.includes("probe.example"),
  "applyTo produced enriched adapted messages containing probe.example=" + reenriched.includes("probe.example") +
    "; the real next request still has no reround URL. Production hook cannot return a message array.",
  "Even with the shape fixed, shouldStopAfterTurn returns only a boolean. Wiring reround evidence into the next request needs prepareNextTurn(context) (available in 0.84.2), which is a wiring change, not a shape fix.",
);

// Q1.5: hasSearchTurn extraction from the real context
const realTurnContext = { message: assistant([{ type: "toolCall", id: "x", name: "search", arguments: {} }], "toolUse"), toolResults: [realToolResultMsg], context: {}, newMessages: [] };
const currentExtraction = realTurnContext.lastToolName || realTurnContext.toolName || "";
const adaptedExtraction = realTurnContext.toolResults?.some((t) => String(t.toolName || "").includes("search"));
record(
  "Q5-4",
  "最小适配：回合结束上下文里如何取到“这一轮搜索过”",
  !String(currentExtraction).includes("search") && adaptedExtraction === true,
  "current code reads lastToolName/toolName -> " + JSON.stringify(currentExtraction) +
    "; real context keys=" + JSON.stringify(Object.keys(realTurnContext)) +
    "; toolResults-based extraction -> " + adaptedExtraction,
  "ShouldStopAfterTurnContext exposes message/toolResults/context/newMessages. The tool name is on toolResults, not on the context root.",
);

// Q5-5: L2 recall through an adapted message array.
const l2Store = new ProbeStore();
const l2Pipeline = new MemoryPipeline({
  store: l2Store,
  retriever: new ProbeRetriever(),
  domain,
  model,
  streamFn: legacyEvalDeps.streamFn,
  sessionId: "l2-adapted",
});
const adaptedForL2 = realMessages.map((m) => {
  if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
  return {
    ...m,
    content: m.content.map((c) =>
      c.type === "toolCall"
        ? { type: "tool_use", id: c.id, name: c.name, input: c.arguments }
        : c,
    ),
  };
});
await l2Pipeline.consolidate(adaptedForL2, 2000, false);
await l2Pipeline.flush();
record(
  "Q5-5",
  "最小适配：把 toolCall/arguments 折成 tool_use/input 后，L2 回忆是否恢复",
  l2Store.searchMemoryMultiCalls.length + l2Store.searchMemoryCalls.length > 0 && l2Store.anchorTypes("l2-adapted").includes("l2_recall"),
  "searchMemory calls=" + l2Store.searchMemoryCalls.length + ", searchMemoryMulti calls=" + l2Store.searchMemoryMultiCalls.length +
    ", anchors=" + JSON.stringify(l2Store.anchorTypes("l2-adapted")),
  "The same content re-expressed in the legacy names restores query extraction, store recall, and the l2_recall anchor.",
);

// Q5-7: L2 recall needs TWO conditions, not one: hasRetrievalEvidence AND
// messages.length > 4 (consolidateState's triggerPostSearch). A single search
// turn is only 3 messages.
const l2StoreTwo = new ProbeStore();
const l2PipelineTwo = new MemoryPipeline({
  store: l2StoreTwo,
  retriever: new ProbeRetriever(),
  domain,
  model,
  streamFn: legacyEvalDeps.streamFn,
  sessionId: "l2-two-conditions",
});
const fiveMessages = [
  ...realMessages,
  assistant([{ type: "toolCall", id: "call-2", name: "search", arguments: { query: "second probe query", mode: "fast" } }], "toolUse"),
  toolResult("call-2", "search", "second probe tool result"),
].map((m) => {
  if (m.role === "toolResult") return { role: "tool", toolName: m.toolName, content: textOfMessage(m) };
  if (m.role === "assistant" && Array.isArray(m.content)) {
    return { ...m, content: m.content.map((c) => c.type === "toolCall" ? { type: "tool_use", id: c.id, name: c.name, input: c.arguments } : c) };
  }
  return m;
});
await l2PipelineTwo.consolidate(fiveMessages, 0, true);
await l2PipelineTwo.flush();
record(
  "Q5-7",
  "最小适配下，L2 回忆还受 messages.length > 4 约束",
  fiveMessages.length === 5 && l2StoreTwo.anchorTypes("l2-two-conditions").includes("l2_recall"),
  "messages=" + fiveMessages.length + ", hasRetrievalEvidence=true, totalTokens=0 -> anchors=" +
    JSON.stringify(l2StoreTwo.anchorTypes("l2-two-conditions")) +
    "; one search turn alone is " + realMessages.length + " messages",
  "Even with names and evidence flag fixed, a single search turn never triggers post-search consolidation; L2 recall needs at least five messages (two tool rounds) or the token watermark.",
);

// Q1.5: adjudication through a legacy event adapter.
const adaptedReuseStream = () => ({
  async *[Symbol.asyncIterator]() {
    for await (const event of realReuseStream()) {
      if (event?.type === "text_delta" && typeof event.delta === "string") {
        yield { type: "text", text: event.delta };
      } else {
        yield event;
      }
    }
  },
});
const adjudicatedAdapted = await adjudicateReuseCompress(adaptedReuseStream, model, "new evidence", "old summary");
record(
  "Q5-6",
  "最小适配：把 text_delta 映射为旧 text 事件后，reuse 识别是否恢复",
  adjudicatedAdapted === "reuse",
  "adapted event stream -> " + adjudicatedAdapted,
  "An event-name shim restores the adjudicator's verdict parsing.",
);

// Q2 cache observation under the scripted provider.
record(
  "Q2-4",
  "缓存能否观察到（客户端复用 / 服务商输入缓存 / 历史资料复用）",
  false,
  "scripted provider reports cacheRead=" + JSON.stringify(provider.captured.map((c) => "no usage fields")) + "; no provider cache exists in this loop",
  "The scripted provider cannot show provider-side cache. Client-side reuse is absent too: each ans_chat call builds a fresh Agent with no carried history, so only anchors (summary/digest) cross calls.",
);

const result = {
  generatedAt: new Date().toISOString(),
  piVersions: {
    kernelPin: "0.84.2",
    piAi: "0.84.2",
    piAgentCore: "0.84.2",
  },
  inputSource:
    "Real pi-agent-core Agent/message shapes; scripted StreamFn (no network); in-memory ProbeStore; production kernel source imported unmodified.",
  findings,
  raw: {
    consolidateArgs,
    evaluateArgs,
    anchorsAfterTurn1,
    anchorsAfterTurn2: store.anchorTypes("probe-session"),
    contexts: contexts.map((c) => ({
      index: c.index,
      roles: c.messages.map((m) => m.role),
      messageCount: c.messages.length,
      estimatedTokens: c.estimatedTokens,
      tools: c.tools,
      optionsKeys: c.optionsKeys,
      systemPrompt: c.systemPrompt,
      lastUserText: ((() => {
        const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
        return lastUser ? readMessageText(lastUser)?.text ?? "" : "";
      })().slice(-120)),
    })),
    summaryLog,
    turn2TextHasReround: turn2Text.includes("reround.example"),
    adaptedEnriched: reenriched,
    gapReal,
    gapAdapted: { textChars: gapLegacy.text.length, results: gapLegacy.results.length },
  },
};

writeFileSync(join(OUT, "probe-sim.json"), JSON.stringify(result, null, 2));
console.log("\nwrote " + join(OUT, "probe-sim.json"));
console.log("SUMMARY " + JSON.stringify({ findings: findings.map((f) => [f.id, f.reproduced]), summaryCalls, anchorsAfterTurn1 }));
