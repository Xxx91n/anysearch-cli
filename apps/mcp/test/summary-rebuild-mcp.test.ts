// #264 acceptance at the MCP layer (spec D9, entry T1): a REAL `ans_chat` call
// over stdio, one temp database, and a local OpenAI-compatible SSE endpoint that
// records every request body. The point is to read what actually reached the
// model, not to trust the store's own bookkeeping.
//
//   M1  the rebuilt summary reaches the model: the text the generator produced
//       appears in a later request, and the user's own turn is still there
//   M2  the replaced fact does NOT reach the model as current: the old value
//       never appears in the request that carries the rebuilt summary
//   M3  the caller is told: structuredContent.summaryRebuilds says `rebuilt`,
//       and the answer text carries one `[summary]` line
//   M4  a run that fails after the rebuild still reports it (the review's first
//       finding: the error exit used to drop the report)
//
// Everything runs against a temp DB and a fake endpoint: no real model, no
// network, no cost, and nothing points at r19 or the real experiment data.
//
// Run: pnpm --filter @anysearch-cli/mcp run test
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(MCP_DIR, "src", "index.ts");
const RPC_TIMEOUT_MS = 120_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the facts this test is about ----------

const OLD_FACT = "Acme online support runs weekdays 9:00-17:00.";
const NEW_FACT = "Acme online support is now 24x7 every day, effective 2026-11-01.";
const TASK_1 = "Find out when Acme support is reachable. Keep the answer short.";
const TASK_2 = "Change of plan: I only need the weekend schedule.";
// What the "model" answers when the rebuild prompt arrives. It restates the
// current fact and carries the task forward, the way a working rebuild does.
const REBUILT = "Acme online support is now 24x7 every day, effective 2026-11-01. Task: weekend schedule only.";

// ---------- local OpenAI-compatible SSE endpoint ----------

function sseChunk(delta: unknown, finish: string | null, usage?: unknown) {
  return "data: " + JSON.stringify({
    id: "rebuild", object: "chat.completion.chunk", created: 1, model: "probe-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) + "\n\n";
}
function ssePayload(text: string, finish = "stop") {
  return [
    sseChunk({ role: "assistant", content: text }, null),
    sseChunk({}, finish, { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}

interface ProviderRequest { role: "rebuild" | "chat"; body: string }
let requestLog: ProviderRequest[] = [];
let openResponses = new Set<ServerResponse>();

/**
 * Which call this request is.
 *
 * The rebuild prompt carries the section headings this feature writes; a normal
 * agent call does not. Keying on the prompt text — not on arrival order — keeps
 * the classification honest when the background rebuild and the main turn
 * interleave.
 */
function classify(body: string): "rebuild" | "chat" {
  return body.includes("=== CURRENT MATERIAL ===") || body.includes("=== TASK (the user's own turns")
    ? "rebuild"
    : "chat";
}

const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const role = classify(body);
  requestLog.push({ role, body });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  openResponses.add(res);
  await sleep(120);
  if (role === "rebuild") {
    res.end(ssePayload(REBUILT));
  } else {
    res.end(ssePayload("Here is the weekend schedule answer."));
  }
  openResponses.delete(res);
});

// ---------- MCP stdio client ----------

interface ChatOutcome {
  ok: boolean;
  isError: boolean;
  text: string;
  structured: any;
  transportError: boolean;
}

interface McpClient {
  child: ChildProcess;
  init: () => Promise<void>;
  stderr: () => string;
  rpc: (method: string, params: unknown, timeoutMs?: number) => Promise<any>;
  chat: (message: string, sessionId?: string, timeoutMs?: number) => Promise<ChatOutcome>;
  kill: () => void;
}

function startMcp(env: Record<string, string>): McpClient {
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY, "--transport", "stdio"], {
    cwd: MCP_DIR, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
  let stderr = "";
  child.stderr?.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map<number, { resolve: (m: any) => void; timer: NodeJS.Timeout }>();
  let buf = "";
  let nextId = 1;

  child.stdout?.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(m);
      }
    }
  });
  child.once("exit", () => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ error: { message: "MCP exited" } });
    }
    pending.clear();
  });

  const rpc = (method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("rpc timeout: " + method));
      }, timeoutMs);
      pending.set(id, {
        resolve: (m: any) => {
          clearTimeout(timer);
          resolve(m);
        },
        timer,
      });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  const exitPromise = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  void exitPromise;

  const init = async () => {
    await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "ans-264-test", version: "0.0.1" },
    });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  };

  const chat = async (message: string, sessionId?: string, timeoutMs = RPC_TIMEOUT_MS): Promise<ChatOutcome> => {
    const args: Record<string, unknown> = { message, operation: "chat" };
    if (sessionId) args.sessionId = sessionId;
    const r: any = await rpc("tools/call", { name: "ans_chat", arguments: args }, timeoutMs);
    if (r?.error) return { ok: false, isError: true, text: "", structured: null, transportError: true };
    const result = r?.result ?? {};
    const content: any[] = Array.isArray(result.content) ? result.content : [];
    const text = content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    return {
      ok: true,
      isError: result.isError === true,
      text,
      structured: result.structuredContent ?? null,
      transportError: false,
    };
  };

  return { child, init, stderr: () => stderr, rpc, chat, kill: () => { try { child.kill(); } catch { /* gone */ } } };
}

// ---------- fixture: a suspended summary in a temp database ----------

/**
 * Build the state the feature acts on, through the product's own seams.
 *
 * A rolling summary records three materials; one reliable new material corrects
 * the knowledge they built, and the correction suspends the summary. Done in
 * this process against the same temp DB file the MCP server will open.
 */
async function seedSuspendedSummary(dbPath: string, sessionId: string): Promise<{ anchorId: number }> {
  const { SqliteSessionStore } = await import("@anysearch-cli/store");
  const store = new SqliteSessionStore(dbPath);
  try {
    await store.createSession("acme");
    await store.ensureSession(sessionId, "acme");
    await store.append(sessionId, { role: "user", content: TASK_1 });

    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const ra = await store.adjudicateMemory(sessionId, [{
        url: "https://acme.example/hours-v" + i, title: "acme hours v" + i,
        snippet: OLD_FACT, source: "tavily", evidence: 0.9, entity: "acme-hours",
      }]);
      if (typeof ra[0]?.insertedId === "number") ids.push(ra[0]!.insertedId!);
    }
    const built = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      { summarize: async () => OLD_FACT, classify: () => ({ label: "supported" as const, confidence: 0.95 }) },
    );
    const knowledgeId = built.semanticIds[0];
    if (typeof knowledgeId !== "number") throw new Error("fixture: no knowledge row");

    await store.saveAnchor(sessionId, "rolling_summary", {
      summary: "Acme support runs weekdays 9-17",
      sources: [{ kind: "knowledge", id: knowledgeId }],
    });
    const anchorId = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;

    const fresh = await store.adjudicateMemory(sessionId, [{
      url: "https://acme.example/notice-2026-11-01", title: "notice",
      snippet: NEW_FACT, source: "tavily", evidence: 0.9, entity: "acme-hours",
    }]);
    const correctionId = fresh[0]?.insertedId;
    if (typeof correctionId !== "number") throw new Error("fixture: no correction material");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [correctionId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: async () => NEW_FACT,
        classify: () => ({ label: "supported" as const, confidence: 0.95 }),
        verify: async () => ({ alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction" as const }),
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    if (rep.summariesSuspended !== 1) {
      throw new Error("fixture: the correction suspended " + rep.summariesSuspended + " summaries, expected 1");
    }
    return { anchorId };
  } finally {
    store.close();
  }
}

function domainDir(root: string): string {
  const dir = join(root, "domains");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rebuild-probe.toml"), [
    'name = "rebuild-probe"',
    "sources = { enabled = [] }",
    'prompts = [{ name = "system", content = "REBUILD-PROBE: answer briefly." }]',
    'skills = { active = ["search"] }',
    'hooks = { toolWhitelist = ["search"] }',
    'rag = { adapter = "none" }',
    "",
  ].join("\n"));
  return dir;
}

let endpointUrl = "";
const roots: string[] = [];

function makeRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "ans-264-mcp-" + name + "-"));
  roots.push(root);
  return root;
}

function makeEnv(root: string): Record<string, string> {
  return {
    ANS_DB_PATH: join(root, "anysearch.db"),
    ANS_PI_SESSION_DIR: join(root, "pi"),
    ANS_DOMAINS_DIR: domainDir(root),
    USERPROFILE: root,
    HOME: root,
    ANS_DOMAIN: "rebuild-probe",
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: endpointUrl,
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "rebuild-test-key-not-real",
    ANS_LLM_CONTEXT_WINDOW: "100000",
  };
}

async function waitForRebuildRequest(timeoutMs = 20_000): Promise<ProviderRequest | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = requestLog.find((r) => r.role === "rebuild");
    if (hit) return hit;
    if (Date.now() >= deadline) return undefined;
    await sleep(50);
  }
}

function bodyText(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msgs = parsed?.messages ?? [];
    return msgs.map((m: any) => {
      if (typeof m?.content === "string") return m.content;
      if (Array.isArray(m?.content)) return m.content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join(" ");
      return "";
    }).join("\n");
  } catch {
    return body;
  }
}

// ---------- run ----------

await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", () => resolve()));
const addr = fake.address();
if (!addr || typeof addr === "string") throw new Error("fake endpoint did not bind");
endpointUrl = "http://127.0.0.1:" + addr.port + "/v1";

// ---- M1-M3: the rebuilt summary reaches the model, the old fact does not ----
{
  const root = makeRoot("main");
  const sessionId = "mcp-rebuild-" + Date.now().toString(36);
  const dbPath = join(root, "anysearch.db");
  await seedSuspendedSummary(dbPath, sessionId);
  requestLog = [];
  openResponses = new Set();

  const mcp = startMcp(makeEnv(root));
  try {
    await mcp.init();
    // Turn one: the suspended summary is not injected, and the background
    // rebuild is dispatched with the live turn.
    const first = await mcp.chat(TASK_1, sessionId);
    assert(first.ok && !first.transportError, "M1: the first ans_chat call completes over stdio");

    // The rebuild call really went out, and its prompt carries the user's words.
    const rebuildReq = await waitForRebuildRequest();
    assert(!!rebuildReq, "M1: the rebuild prompt reached the provider");
    const rebuildBody = rebuildReq ? bodyText(rebuildReq.body) : "";
    assert(rebuildBody.includes(TASK_1), "M1: the rebuild prompt carries the user's own turn");
    assert(rebuildBody.includes(OLD_FACT) || rebuildBody.includes(NEW_FACT),
      "M1: the rebuild prompt carries material (old or current), so it is not empty");

    // Turn two: the rebuilt summary is now current, so the request must show it.
    requestLog = [];
    const second = await mcp.chat(TASK_2, sessionId);
    assert(second.ok && !second.transportError, "M1: the second ans_chat call completes");
    const chatBodies = requestLog.filter((r) => r.role === "chat").map((r) => bodyText(r.body)).join("\n");
    assert(chatBodies.includes(TASK_2),
      "M1: the user's own second turn is in the request, not pushed out");
    assert(chatBodies.includes("24x7"),
      "M1: the rebuilt summary text reached the model on the next turn");
    assert(!chatBodies.includes("weekdays 9:00-17:00"),
      "M2: the replaced fact is NOT presented as a current conclusion");

    // The caller is told what happened to the suspended summary.
    const rebuilds = first.structured?.summaryRebuilds;
    assert(Array.isArray(rebuilds) && rebuilds.length >= 1,
      "M3: structuredContent.summaryRebuilds is present");
    assert(rebuilds.some((r: any) => r.cleared === true && r.outcome === "rebuilt"),
      "M3: it reports a cleared rebuild");
    assert(first.text.includes("[summary]") && first.text.includes("rebuilt as anchor"),
      "M3: the answer text carries a readable [summary] line too");
  } finally {
    mcp.kill();
  }
}

// ---- M4: the failure exit keeps the rebuild report ------------------------
//
// The review's first finding: the error exit returned before the report was
// attached, so a caller who got an error learned nothing about the summary even
// though the background rebuild had already finished.
//
// This checks the exit's own shape rather than staging a real provider failure:
// the report only ever arrives through this builder, and a flaky endpoint would
// make the assertion about the endpoint, not about the code.
{
  const { buildAnsChatErrorResult } = await import("../src/ans-chat-session.js");
  const { formatSummaryRebuildLine } = await import("@anysearch-cli/kernel");

  const attempt = {
    anchorId: 7,
    outcome: "rebuilt" as const,
    reasons: [] as string[],
    newAnchorId: 8,
    cleared: true,
  };
  const withReport = buildAnsChatErrorResult("the provider returned no choices", [attempt], formatSummaryRebuildLine);
  assert(withReport.isError === true, "M4: the failure result stays an error");
  assert(withReport.content[0]!.text === "ans_chat error: the provider returned no choices",
    "M4: the error text comes first and keeps its stable prefix");
  assert(withReport.content.length === 2, "M4: the rebuild line is appended as a second block");
  assert(withReport.content[1]!.text.includes("rebuilt as anchor 8"),
    "M4: the appended line says what happened to the summary");
  assert(Array.isArray((withReport.structuredContent as any)?.summaryRebuilds) &&
    (withReport.structuredContent as any).summaryRebuilds.length === 1,
    "M4: structuredContent carries the report too");

  // No attempt means a bare failure: nothing invented to fill the slot.
  const bare = buildAnsChatErrorResult("boom", [], formatSummaryRebuildLine);
  assert(bare.content.length === 1, "M4: with no attempt the result is a bare error");
  assert(bare.structuredContent === undefined, "M4: and no empty summaryRebuilds array is invented");
}

// ---------- cleanup ----------

for (const res of openResponses) { try { res.destroy(); } catch { /* gone */ } }
await new Promise<void>((resolve) => fake.close(() => resolve()));
for (const root of roots.splice(0)) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (e) {
    console.error("cleanup warning (temp dir left in place): " + (e instanceof Error ? e.message : String(e)));
  }
}

console.log("summary-rebuild-mcp: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exitCode = 1;
