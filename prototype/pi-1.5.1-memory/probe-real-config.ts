// PROTOTYPE — throwaway probe, not product code.
//
// Question (Q1): does the real endpoint + credential path work on PI 1.5.1,
// and is the model's real context window carried into the product (instead of
// the historical 128K placeholder)?
//
// Reads ANS_LLM_* from the environment. The credential is never printed.
// Run: node --import tsx prototype/pi-1.5.1-memory/probe-real-config.ts

import { createLlmSession, parseContextWindow } from "../../packages/kernel/src/llm-init";
import { resolveLowWatermark } from "../../packages/kernel/src/memory-pipeline";

const findings: Array<{ id: string; question: string; ok: boolean; evidence: unknown }> = [];
function record(id: string, question: string, evidence: unknown, ok: boolean) {
  findings.push({ id, question, ok, evidence });
  console.log("\n[" + id + "] " + question + "\n  ok=" + ok + "\n  " + JSON.stringify(evidence).slice(0, 900));
}

const apiKey = process.env.ANS_LLM_API_KEY;
const provider = process.env.ANS_LLM_PROVIDER ?? "openai";
const modelName = process.env.ANS_LLM_MODEL ?? "";
const baseUrl = process.env.ANS_LLM_BASE_URL;
const apiRaw = process.env.ANS_LLM_API;
const api = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
const declaredWindow = parseContextWindow(process.env.ANS_LLM_CONTEXT_WINDOW);

record(
  "Q1-REAL-1",
  "配置输入完整（不含凭据内容）",
  {
    provider,
    modelName,
    baseUrl,
    api,
    declaredWindow,
    apiKeyPresent: typeof apiKey === "string" && apiKey.length > 0,
    apiKeyLength: apiKey?.length ?? 0,
  },
  !!modelName && !!baseUrl && !!api && !!apiKey,
);

const session = await createLlmSession({
  provider,
  model: modelName,
  baseUrl,
  api,
  apiKey,
  contextWindow: declaredWindow,
});

record(
  "Q1-REAL-2",
  "真实模型的上下文窗口进入产品（不是 128K 占位）",
  {
    modelContextWindow: (session.model as any).contextWindow,
    sessionContextWindow: session.contextWindow,
    declaredWindow,
    modelApi: (session.model as any).api,
    modelProvider: (session.model as any).provider,
    lowWatermarkAt80Percent: resolveLowWatermark({ fraction: 0.8 }, session.contextWindow),
  },
  session.contextWindow === declaredWindow && session.contextWindow !== 128000,
);

// One tiny real completion: proves endpoint + credential + PI 1.5.1 wire.
let answer = "";
let error: string | undefined;
try {
  const stream = (session.streamFn as any)(
    session.model,
    { messages: [{ role: "user", content: "Reply with exactly: OK" }] },
    { apiKey: session.apiKey },
  );
  for await (const event of stream as AsyncIterable<any>) {
    if (event?.type === "text_delta") answer += event.delta ?? "";
    else if (event?.type === "text") answer += event.content ?? "";
  }
  const final = await (stream as any).result?.();
  record(
    "Q1-REAL-3",
    "真实端点 + 凭据可完成一次模型调用，用量可核对",
    {
      answerHead: answer.slice(0, 80),
      usage: final?.usage,
      stopReason: final?.stopReason,
    },
    typeof answer === "string" && answer.trim().length > 0 && !!final?.usage,
  );
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  record("Q1-REAL-3", "真实端点 + 凭据可完成一次模型调用", { error }, false);
}

const fs = await import("node:fs");
const { join, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const HERE = dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(join(HERE, "out"), { recursive: true });
fs.writeFileSync(
  join(HERE, "out", "probe-real-config.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), inputSource: "real ANS_LLM_* endpoint", findings }, null, 2),
);
console.log("\nwrote out/probe-real-config.json");
console.log("SUMMARY " + JSON.stringify(findings.map((f) => [f.id, f.ok])));
