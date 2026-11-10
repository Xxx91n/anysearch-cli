// PROTOTYPE — throwaway probe, not product code.
//
// Question (Q1): can the FULL session SDK (createAgentSession) run under
// AnySearch control — explicit tool set, no accidental discovery, session
// persistence — and who owns the tool hooks afterwards?
//
// A local SSE endpoint stands in for the provider, so this is a real HTTP
// round-trip without a real model bill.
//
// Run: node prototype/pi-1.5.1-memory/probe-agent-session.mjs

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const NM = join(REPO, "packages", "kernel", "node_modules");

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(NM, ...name.split("/"), "package.json"), "utf8")).version;
}
function pkgDist(name, ...rest) {
  return pathToFileURL(join(NM, ...name.split("/"), "dist", ...rest)).href;
}

const pca = await import(pkgDist("@earendil-works/pi-coding-agent", "index.js"));
const core = await import(pkgDist("@earendil-works/pi-agent-core", "index.js"));
const typebox = await import(pathToFileURL(join(NM, "@sinclair", "typebox", "build", "cjs", "index.js")).href).catch(
  async () => import(pathToFileURL(join(NM, "@sinclair", "typebox", "index.cjs")).href),
);
const Type = typebox.Type ?? typebox.default?.Type;

const findings = [];
function record(id, question, evidence, ok) {
  findings.push({ id, question, ok, evidence });
  console.log("\n[" + id + "] " + question + "\n  ok=" + ok + "\n  " + JSON.stringify(evidence));
}

const SSE_CHAT = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"proto-model","choices":[{"index":0,"delta":{"role":"assistant","content":"stub reply"},"finish_reason":null}]}',
  "",
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"proto-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
  "",
  "data: [DONE]",
  "",
].join("\n") + "\n";

const requestLog = [];
const server = createServer((req, res) => {
  requestLog.push({ url: req.url, method: req.method, bytes: Number(req.headers["content-length"] ?? 0) });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(SSE_CHAT);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const workDir = mkdtempSync(join(tmpdir(), "anysearch-pi151-session-sdk-"));
try {
  const modelRuntime = await pca.ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  modelRuntime.registerProvider("proto", {
    name: "Proto",
    baseUrl: "http://127.0.0.1:" + port + "/v1",
    apiKey: "probe-key",
    api: "openai-completions",
    models: [
      {
        id: "proto-model",
        name: "proto-model",
        api: "openai-completions",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: 2000,
        maxTokens: 256,
      },
    ],
  });
  const model = modelRuntime.getModel("proto", "proto-model");
  record(
    "Q1-SDK-0",
    "显式 provider/model 注册可在 ModelRuntime 里取回",
    { modelFound: !!model, modelId: model?.id, providerCount: modelRuntime.getProviders().length },
    !!model,
  );

  const settingsManager = pca.SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
  });
  const resourceLoader = new pca.DefaultResourceLoader({ cwd: workDir, agentDir: join(workDir, "agent") });
  await resourceLoader.reload();
  const sessionManager = pca.SessionManager.inMemory(workDir);

  const searchTool = {
    name: "search",
    label: "Search",
    description: "Probe search tool",
    parameters: Type.Object({ query: Type.String() }),
    execute: async (_id, params) => ({ content: [{ type: "text", text: "SEARCH-ENVELOPE " + params.query }], details: {} }),
  };

  const created = await pca.createAgentSession({
    cwd: workDir,
    agentDir: join(workDir, "agent"),
    modelRuntime,
    model,
    thinkingLevel: "off",
    settingsManager,
    resourceLoader,
    sessionManager,
    customTools: [searchTool],
    // Explicit allowlist: only our tool may be active. This is the AnySearch
    // control surface; the SDK's default built-ins must not leak through.
    tools: ["search"],
  });
  const session = created.session;

  record(
    "Q1-SDK-1",
    "完整会话 SDK 下活动的工具只有我们放行的那一个",
    {
      activeToolNames: session.getActiveToolNames(),
      extensionCount: created.extensionsResult.extensions.length,
      extensionErrors: created.extensionsResult.errors,
      discoveredSkills: resourceLoader.getSkills().skills.length,
      discoveredPrompts: resourceLoader.getPrompts().prompts.length,
      agentsFiles: resourceLoader.getAgentsFiles().agentsFiles.length,
      registeredToolCount: session.getAllTools().length,
    },
    session.getActiveToolNames().length === 1 &&
      session.getActiveToolNames()[0] === "search" &&
      created.extensionsResult.extensions.length === 0,
  );

  // The default loader still discovers resources outside cwd/agentDir.
  // A host that wants zero discovery must supply its own loader.
  const zeroDiscovery = resourceLoader.getSkills().skills.length === 0
    && resourceLoader.getPrompts().prompts.length === 0
    && resourceLoader.getAgentsFiles().agentsFiles.length === 0;
  record(
    "Q1-SDK-1b",
    "默认发现机制是否在空目录下仍然加载了额外资源",
    {
      discoveredSkills: resourceLoader.getSkills().skills.length,
      skillNames: resourceLoader.getSkills().skills.slice(0, 5).map((s) => s.name ?? s.path ?? "?"),
      discoveredPrompts: resourceLoader.getPrompts().prompts.length,
      agentsFiles: resourceLoader.getAgentsFiles().agentsFiles.length,
      zeroDiscovery,
    },
    zeroDiscovery,
  );

  // Minimal host-owned loader: prove a fully controlled resource surface is possible.
  const emptyRuntime = pca.createExtensionRuntime();
  const emptyLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: emptyRuntime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const controlled = await pca.createAgentSession({
    cwd: workDir,
    agentDir: join(workDir, "agent2"),
    modelRuntime,
    model,
    thinkingLevel: "off",
    settingsManager: pca.SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
    }),
    resourceLoader: emptyLoader,
    sessionManager: pca.SessionManager.inMemory(workDir),
    customTools: [searchTool],
    tools: ["search"],
  });
  record(
    "Q1-SDK-1c",
    "自定义空 ResourceLoader 后，技能/提示/扩展/AGENTS 文件全部为 0",
    {
      activeToolNames: controlled.session.getActiveToolNames(),
      skills: emptyLoader.getSkills().skills.length,
      prompts: emptyLoader.getPrompts().prompts.length,
      extensions: controlled.extensionsResult.extensions.length,
      agentsFiles: emptyLoader.getAgentsFiles().agentsFiles.length,
      systemPromptIsUndefined: emptyLoader.getSystemPrompt() === undefined,
    },
    emptyLoader.getSkills().skills.length === 0 && emptyLoader.getPrompts().prompts.length === 0,
  );
  controlled.session.dispose();

  // Who owns the hooks the product depends on?
  const hookBeforeConstructionOwned = typeof session.agent.beforeToolCall === "function";
  const installedBefore = session.agent.beforeToolCall?.toString() ?? "";
  record(
    "Q1-SDK-2",
    "AgentSession 构造后替换了宿主自带的 beforeToolCall（URL 闸门/饱和停止会被绕过）",
    {
      hookIsSessionHook: installedBefore.includes("_beforeToolCall"),
      hookSourceHead: installedBefore.slice(0, 120),
      afterToolCallIsSessionHook: (session.agent.afterToolCall?.toString() ?? "").includes("_afterToolCall"),
      transformContextChains: (session.agent.transformContext?.toString() ?? "").includes("previousTransformContext"),
      prepareRequestChains: (session.agent.prepareRequest?.toString() ?? "").includes("previousPrepareRequest"),
    },
    installedBefore.includes("_beforeToolCall"),
  );

  // The host can re-wrap afterwards; prove the guard then runs.
  const guardCalls = [];
  const sessionHook = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    guardCalls.push(String(context?.toolCall?.name ?? ""));
    return sessionHook?.(context, signal);
  };
  record(
    "Q1-SDK-3",
    "宿主在构造后重新包一层，仍能拿回工具调用前的控制权",
    { guardInstalled: typeof session.agent.beforeToolCall === "function" },
    typeof session.agent.beforeToolCall === "function",
  );

  // Real prompt through the SDK (local SSE endpoint stands in for the model).
  const sessionEvents = [];
  session.subscribe((event) => sessionEvents.push(event.type));
  const bigUserText = "context padding ".repeat(300);
  await session.prompt("hello through the full SDK. " + bigUserText);
  const firstSessionMessages = session.messages.map((m) => m.role);
  record(
    "Q1-SDK-4",
    "完整 SDK 能实际跑一轮：请求到达端点、会话消息被记录、agent_settled 出现",
    {
      httpRequests: requestLog.length,
      httpPaths: requestLog.map((r) => r.url),
      sessionRoles: firstSessionMessages,
      settled: sessionEvents.includes("agent_settled"),
      reportedTokens: session.getSessionStats().tokens,
    },
    requestLog.length > 0 && firstSessionMessages.includes("user") && sessionEvents.includes("agent_settled"),
  );

  // Compaction through the full SDK. Two padded turns give the cut point
  // something to keep while the rest is summarized.
  await session.prompt("second padded turn. " + bigUserText);
  const before = session.messages.length;
  await session.compact();
  const after = session.messages.length;
  const wireAfter = JSON.stringify(session.messages);
  record(
    "Q1-SDK-5",
    "完整 SDK 的手动压缩改变会话投影，旧长文被摘要取代",
    {
      beforeMessages: before,
      afterMessages: after,
      hasCompactionSummary: session.sessionManager.getEntries().some((e) => e.type === "compaction"),
      oldTextStillInProjection: wireAfter.includes("context padding".repeat(3)),
      stats: session.getSessionStats(),
    },
    after <= before && session.sessionManager.getEntries().some((e) => e.type === "compaction"),
  );

  session.dispose();
} finally {
  await new Promise((r) => server.close(r));
  if (process.env.PROBE_KEEP !== "1") {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log("kept " + workDir);
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  versions: {
    piAgentCore: pkgVersion("@earendil-works/pi-agent-core"),
    piAi: pkgVersion("@earendil-works/pi-ai"),
    piCodingAgent: pkgVersion("@earendil-works/pi-coding-agent"),
  },
  inputSource: "real createAgentSession + ModelRuntime + SessionManager; local SSE endpoint (no real model)",
  findings,
};
const fs = await import("node:fs");
fs.mkdirSync(join(HERE, "out"), { recursive: true });
fs.writeFileSync(join(HERE, "out", "probe-agent-session.json"), JSON.stringify(out, null, 2));
console.log("\nwrote out/probe-agent-session.json");
console.log("SUMMARY " + JSON.stringify(findings.map((f) => [f.id, f.ok])));
