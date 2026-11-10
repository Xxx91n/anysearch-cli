// Q4 probe — unified consolidation entry + complete usage accounting.
//
// Real built MCP server (apps/mcp/dist/index.js, stdio) and real built CLI
// (apps/cli/dist/index.js) against a local OpenAI-compatible SSE endpoint, so
// the wire usage is controlled and both entries exercise the SAME shared seams
// (`createConsolidationSeams`). Real SQLite store on a temp DB.
//
// Shows:
//   S1 dry-run is an exact prediction and writes nothing.
//   S2 apply adds only the selected session; unrelated materials untouched.
//   S3 a rerun reports skip (noop), not another add.
//   S4 single-evidence correction scoped by memoryIds reports update + pauses
//      the affected summary.
//   S5 a claim the fidelity gate rejects reports conflict.
//   S6 no LLM configured reports failure and an explicit MISSING usage list.
//   S7 the CLI subcommand produces the same categories/counts through the same
//      shared logic, and prints cache-read accounting.
//   S8 the token budget reserves the static system header exactly once.
//
// Run: node --import tsx prototype/pi-esm-full-sdk/probe-q4.ts
// (requires a prior `pnpm -r build`)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";
import { PiAgentRuntime, estimateMessagesTokens, resolveReserveInputTokens, resolveTokenReserve } from "../../packages/kernel/src/pi-runtime";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MCP_DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const CLI_DIST = join(ROOT, "apps", "cli", "dist", "index.js");
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- local OpenAI-compatible SSE endpoint ----------

const OLD_FACT = "Business hours are Monday to Friday 9-5.";
const NEW_FACT = "Support hours are now 24/7, no longer Monday to Friday 9-5.";
const CLI_FACT = "The CLI probe color is vermilion.";
const UNRELATED_FACT = "UNRELATED-KNOWLEDGE: the other conclusion holds.";
const CONFLICT_CLAIM = "The moon is made of cheese and has craters.";

function pickReply(bodyText: string): string {
  if (bodyText.includes("CONFLICT-EVIDENCE")) return CONFLICT_CLAIM;
  if (bodyText.includes("CLI-EVIDENCE")) return CLI_FACT;
  if (bodyText.includes("24/7")) return NEW_FACT;
  if (bodyText.includes("UNRELATED-EVIDENCE")) return UNRELATED_FACT;
  return OLD_FACT;
}
function ssePayload(content: string): string {
  const chunk = (delta: any, finish: string | null, usage?: any) =>
    "data: " + JSON.stringify({
      id: "q4", object: "chat.completion.chunk", created: 1, model: "probe-model",
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    }) + "\n\n";
  return [
    chunk({ role: "assistant", content }, null),
    chunk({}, "stop", {
      prompt_tokens: 120, completion_tokens: 20, total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 40 },
    }),
    "data: [DONE]\n\n",
  ].join("");
}

const requestLog: Array<{ promptHead: string; replyHead: string }> = [];
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const reply = pickReply(body);
  requestLog.push({ promptHead: body.slice(0, 160), replyHead: reply.slice(0, 80) });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(ssePayload(reply));
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const fakePort = (fake.address() as any).port;
const fakeBase = "http://127.0.0.1:" + fakePort + "/v1";

// ---------- MCP stdio client ----------

function startMcp(env: Record<string, string | undefined>) {
  if (!existsSync(MCP_DIST)) throw new Error("missing built MCP dist; run pnpm -r build");
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map<number, { resolve: (v: any) => void; timer: NodeJS.Timeout }>();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id)!; pending.delete(m.id); clearTimeout(p.timer); p.resolve(m);
      }
    }
  });
  const rpc = (method: string, params: any, timeoutMs = 120000) => new Promise<any>((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error("rpc timeout " + method + " stderr=" + stderr.slice(-300))); }, timeoutMs);
    pending.set(id, { resolve: res, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method: string, params?: any) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");
  return {
    rpc, notify, stderr: () => stderr,
    close: async () => {
      const done = new Promise<void>((r) => { if (child.exitCode !== null) return r(); child.once("exit", () => r()); });
      child.kill(); await Promise.race([done, sleep(3000)]);
    },
  };
}

async function consolidate(client: ReturnType<typeof startMcp>, args: any) {
  const res = await client.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate", ...args } });
  return res.result ?? {};
}

// ---------- seed ----------

const workDir = mkdtempSync(join(tmpdir(), "ans-q4-"));
const dbPath = join(workDir, "anysearch.db");
const store = new SqliteSessionStore(dbPath);
function episode(sessionId: string, entity: string, fact: string, n: number) {
  return { url: entity + "/page/" + n, entity, title: "Probe " + entity, snippet: fact + " (page " + n + ")", source: "tavily", score: 1 };
}
const seed = async (tag: string, fact: string) => {
  const s = await store.createSession("chat");
  await store.saveResults(s.id, [1, 2, 3].map((n) => episode(s.id, "https://" + tag + ".example/item", fact, n)));
  return s;
};

let sMain!: { id: string }, sUnrelated!: { id: string }, sConflict!: { id: string }, sFail!: { id: string }, sCli!: { id: string };
try {
  sMain = await seed("biz", OLD_FACT);
  sUnrelated = await seed("other", UNRELATED_FACT);
  sConflict = await seed("moon", "CONFLICT-EVIDENCE: the moon is not made of cheese and has craters.");
  sFail = await seed("fail", "FAILURE-EVIDENCE: a cluster with no LLM configured.");
  sCli = await seed("cli", "CLI-EVIDENCE: the CLI probe color is vermilion.");
  await store.saveAnchor(sMain.id, "rolling_summary", { summary: "Session summary: " + OLD_FACT, timestamp: Date.now() });
  store.close();

  const llmEnv = {
    ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: fakeBase, ANS_LLM_API: "chat", ANS_LLM_API_KEY: "probe-key",
    ANS_LLM_CONTEXT_WINDOW: "1048000",
    ANS_DB_PATH: dbPath, ANS_PI_SESSION_DIR: join(workDir, "pi-sessions"),
  };

  const mcp = startMcp(llmEnv);
  await mcp.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "q4", version: "1" } }, 30000);
  mcp.notify("notifications/initialized", {});

  // ---------- S1 dry-run ----------
  const dry = await consolidate(mcp, { sessionId: sMain.id, dryRun: true });
  const db1 = new Database(dbPath, { readonly: true });
  const semAfterDry = db1.prepare("SELECT COUNT(*) AS n FROM semantic_memories").get() as any;
  db1.close();
  record("S1", "dry-run predicts the add and writes nothing",
    dry.structuredContent?.report?.dryRun === true && dry.structuredContent?.report?.add === 1 &&
      dry.structuredContent?.counts?.add === 1 && semAfterDry.n === 0,
    { counts: dry.structuredContent?.counts, report: dry.structuredContent?.report, semanticRowsAfterDryRun: semAfterDry.n,
      promptSeenByFake: requestLog.at(-1)?.replyHead, usage: dry.structuredContent?.usage });

  // ---------- S2 apply, scoped to one session ----------
  const apply = await consolidate(mcp, { sessionId: sMain.id });
  const db2 = new Database(dbPath, { readonly: true });
  const mainSem = db2.prepare("SELECT id, content FROM semantic_memories WHERE content LIKE 'Business hours%'").all() as any[];
  const unrelatedEps = db2.prepare("SELECT id, superseded_by, archived FROM retrieval_results WHERE session_id = ?").all(sUnrelated.id) as any[];
  const unrelatedSem = db2.prepare("SELECT id FROM semantic_memories WHERE content LIKE 'UNRELATED%'").all() as any[];
  db2.close();
  record("S2", "apply adds only the selected session's cluster; unrelated materials are untouched",
    apply.structuredContent?.report?.add === 1 && mainSem.length === 1 &&
      apply.structuredContent?.report?.clustersScanned === 1 &&
      unrelatedEps.length === 3 && unrelatedEps.every((r) => r.superseded_by === null && r.archived === 0) &&
      unrelatedSem.length === 0,
    { counts: apply.structuredContent?.counts, scanned: apply.structuredContent?.report?.clustersScanned,
      mainSemantic: mainSem, unrelatedEpisodes: unrelatedEps.length, unrelatedSemantic: unrelatedSem.length,
      usage: apply.structuredContent?.usage });

  // ---------- S3 rerun -> skip, not add ----------
  const rerun = await consolidate(mcp, { sessionId: sMain.id });
  const db3 = new Database(dbPath, { readonly: true });
  const semCount3 = (db3.prepare("SELECT COUNT(*) AS n FROM semantic_memories").get() as any).n;
  db3.close();
  record("S3", "an identical rerun reports skip (noop) and adds no row",
    rerun.structuredContent?.report?.skip === 1 && rerun.structuredContent?.report?.add === 0 &&
      semCount3 === 1 && rerun.structuredContent?.counts?.skip === 1,
    { counts: rerun.structuredContent?.counts, semanticRows: semCount3, usage: rerun.structuredContent?.usage });

  // ---------- S4 single-evidence correction scoped by memoryId ----------
  const db4 = new Database(dbPath);
  db4.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)").run(
    sMain.id, "https://biz.example/hours-2026", "Support hours updated",
    "Official update: Support hours are now 24/7 every day, effective 2026-11-01.", "tavily", "https://biz.example/hours-2026",
  );
  const newEpisodeId = (db4.prepare("SELECT id FROM retrieval_results WHERE url = ?").get("https://biz.example/hours-2026") as any).id;
  db4.close();
  const update = await consolidate(mcp, { memoryIds: [newEpisodeId], allowSingleEvidence: true });
  const db4r = new Database(dbPath, { readonly: true });
  const oldRow = db4r.prepare("SELECT id, valid_until, superseded_by FROM semantic_memories WHERE content LIKE 'Business hours%'").get() as any;
  const newRow = db4r.prepare("SELECT id, content, valid_until FROM semantic_memories WHERE content LIKE 'Support hours are now%'").get() as any;
  const retired = db4r.prepare("SELECT id, superseded_by FROM retrieval_results WHERE entity = 'https://biz.example/item'").all() as any[];
  db4r.close();
  record("S4", "single-evidence correction via memoryIds reports update, points the old row forward, pauses the summary",
    update.structuredContent?.report?.update === 1 && update.structuredContent?.counts?.update === 1 &&
      oldRow.valid_until !== null && oldRow.superseded_by === newRow.id &&
      retired.every((r) => r.superseded_by === newRow.id) &&
      Array.isArray(update.structuredContent?.report?.summariesNeedingRefresh) &&
      update.structuredContent.report.summariesNeedingRefresh.includes(sMain.id),
    { counts: update.structuredContent?.counts, updates: update.structuredContent?.report?.updates,
      oldRow, newRow, retired, summariesNeedingRefresh: update.structuredContent?.report?.summariesNeedingRefresh,
      usage: update.structuredContent?.usage });

  // ---------- S5 conflict ----------
  const conflict = await consolidate(mcp, { sessionId: sConflict.id });
  record("S5", "a claim the fidelity gate rejects is reported as conflict, not add",
    conflict.structuredContent?.report?.conflict === 1 && conflict.structuredContent?.counts?.conflict === 1 &&
      conflict.structuredContent?.report?.add === 0 && conflict.structuredContent?.report?.gateRejected === 1,
    { counts: conflict.structuredContent?.counts, report: conflict.structuredContent?.report, usage: conflict.structuredContent?.usage });

  // ---------- S6 failure + explicit missing usage ----------
  await mcp.close();
  // Empty strings (not deletes) so the probe shell's real ANS_LLM_* env cannot
  // leak back through the `{...process.env, ...env}` merge.
  const failEnv = {
    ...llmEnv,
    ANS_LLM_PROVIDER: "", ANS_LLM_MODEL: "", ANS_LLM_BASE_URL: "", ANS_LLM_API: "", ANS_LLM_API_KEY: "",
  };
  const noLlm = startMcp(failEnv);
  await noLlm.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "q4-fail", version: "1" } }, 30000);
  noLlm.notify("notifications/initialized", {});
  const failure = await consolidate(noLlm, { sessionId: sFail.id });
  await noLlm.close();
  const missing = failure.structuredContent?.usage?.missing ?? [];
  record("S6", "no LLM configured reports failure and names every missing usage dimension",
    failure.structuredContent?.report?.llmUnavailable === 1 && failure.structuredContent?.counts?.failure === 1 &&
      failure.structuredContent?.usage?.calls === 0 &&
      ["consolidation usage", "consolidation cache usage", "consolidation cost"].every((m) => missing.includes(m)),
    { counts: failure.structuredContent?.counts, usage: failure.structuredContent?.usage, missing });

  // ---------- S7 CLI shares the logic and reports cache reads ----------
  const cliEnv = { ...process.env, ...llmEnv };
  const cli = spawn(process.execPath, [CLI_DIST, "consolidate", "--session", sCli.id], { env: cliEnv, stdio: ["ignore", "pipe", "pipe"] });
  let cliOut = "", cliErr = "";
  cli.stdout.on("data", (c) => { cliOut += c.toString(); });
  cli.stderr.on("data", (c) => { cliErr += c.toString(); });
  const cliCode = await new Promise<number>((r) => cli.on("exit", (code) => r(code ?? -1)));
  const usageLine = cliOut.split("\n").find((l) => l.startsWith("usage:")) ?? "";
  const db7 = new Database(dbPath, { readonly: true });
  const cliSem = db7.prepare("SELECT id, content FROM semantic_memories WHERE content LIKE 'The CLI probe color%'").all() as any[];
  db7.close();
  record("S7", "the CLI subcommand produces the same categories through the shared seams, with cache-read usage",
    cliCode === 0 && /add 1/.test(cliOut) && cliSem.length === 1 &&
      /cacheRead 40/.test(usageLine) && /costUsd/.test(usageLine) && !/MISSING/.test(usageLine),
    { exitCode: cliCode, output: cliOut.trim().split("\n").slice(0, 6), stderr: cliErr.trim().slice(0, 300),
      cliSemantic: cliSem, usageLine });

  // ---------- S8 budget reserves the static header exactly once ----------
  {
    const bStore = new SqliteSessionStore(join(workDir, "budget.db"));
    const bSession = await bStore.createSession("chat");
    const prompt = "budget header check";
    const systemPrompt = "PROBE-BUDGET-PROMPT: you are a probe research agent.";
    const outputReserve = 2048;
    let reserved = 0;
    const ledger: any = {
      reserveCalls: () => true, settleCalls: () => {},
      reserveTokens: (_s: string, n: number) => { reserved = n; return true; }, settleTokens: () => {},
      reserveUsd: () => true, settleUsd: () => {},
    };
    let firstRequest: any;
    const provider = (_m: any, context: any) => {
      firstRequest ??= context;
      const message = {
        role: "assistant", content: [{ type: "text", text: "ok" }],
        api: "openai-completions", provider: "probe", model: "probe-model",
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: { ...message, content: [] } };
          yield { type: "text_delta", contentIndex: 0, delta: "ok", partial: message };
          yield { type: "done", reason: "stop", message };
        },
        result: async () => message,
      };
    };
    const runtime = new PiAgentRuntime({
      retriever: { async search() { return { query: "", mode: "fast", results: [] } as any; } } as any,
      store: bStore, sessionId: bSession.id, ledger,
      domain: {
        sources: { enabled: [] }, prompts: [{ name: "system", content: systemPrompt }],
        skills: { active: ["search"] }, hooks: { toolWhitelist: ["search"] }, rag: { adapter: "none" },
        budget: { outputReserveTokens: outputReserve },
      },
      model: { id: "probe-model", api: "openai-completions", contextWindow: 200000 } as any,
      streamFn: provider as any,
    });
    for await (const _ of runtime.run(prompt)) { /* drain */ }
    bStore.close();
    // The runtime's cold-start estimate is prompt + systemPrompt, each counted once.
    const expectedInput =
      Math.ceil(estimateMessagesTokens([{ role: "user", content: prompt }] as any)) +
      Math.ceil(estimateMessagesTokens([{ role: "user", content: systemPrompt }] as any));
    const expected = resolveTokenReserve(expectedInput, outputReserve);
    // What a double count of the normalized header (sections + toolsAdded) would add.
    const sysMsg = (firstRequest?.messages ?? []).find((m: any) => m?.role === "system");
    const headerTokens = Math.ceil(estimateMessagesTokens([{ role: "user", content: JSON.stringify(sysMsg ?? {}) }] as any));
    const direct = resolveReserveInputTokens(0, [], prompt, systemPrompt);
    record("S8", "the budget reserve counts the static system header once, not twice",
      reserved === expected && direct.tokens === expectedInput && headerTokens > 100 &&
        reserved !== expectedInput + headerTokens + outputReserve,
      { reserved, expected, expectedInput, direct, headerTokensIfDoubleCounted: headerTokens,
        reserveBreakdown: "input " + expectedInput + " + output " + outputReserve });
  }
} catch (e) {
  record("probe", "probe completed", false, { error: e instanceof Error ? e.stack ?? e.message : String(e) });
} finally {
  fake.close();
  const failed = findings.filter((f) => !f.pass);
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", "q4.json"), JSON.stringify({
    probe: "q4", generatedAt: new Date().toISOString(),
    inputSource: "built MCP + built CLI + real SQLite; local OpenAI-compatible SSE endpoint with controlled usage",
    fakeRequests: requestLog.length,
    findings,
  }, null, 2));
  try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log("\n" + (failed.length === 0 ? "Q4: PASS" : "Q4: FAIL (" + failed.length + ")"));
  process.exit(failed.length === 0 ? 0 : 1);
}
