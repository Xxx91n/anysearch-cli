// #262 (D11 / D4) — the collision resolution's EXTRA model calls go through
// the same kernel seams, the same usage accumulator and the same budget
// reserve/settle as every other consolidation call. The spec names this
// directly: "额外合并和检查纳入预算与用量，不能藏在主调用之外" (D4) and "允许一次
// 必要的重新合并，并计入预算" (D11).
//
// End-to-end here: a real store race between two sessions (two connections on
// one shared temp database — the B1 shape, same official notice, distinct
// urls), where beta's seams are createConsolidationSeams over a scripted
// provider session and a RECORDING ledger. The one re-judge the resolution
// spends must appear as a fifth reserve/settle pair and a fifth usage call —
// never a hidden charge.
//
// CONTROLLED CHECKER, marked as such: the provider replies are scripted by
// prompt content; this proves the flow and the accounting, not real judgement
// quality (the real-model retry branches stay UNCOVERED — labels in
// test/correction-a1-a4.online.ts). Embeddings are deterministic test
// vectors: the real e5 arm would depend on a model download no CI gate
// provisions.
//
// No test framework (repo convention).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { createConsolidationSeams } from "../src/consolidation";
import type { BudgetLedgerPort } from "../src/ports";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// Deterministic embedding vectors via the embedding package's test seam. The
// bare specifier is NOT a kernel dependency, so the module is loaded by
// absolute path — the same file the store's arm resolves, one singleton.
const embedPkg = await import(pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "embedding", "src", "index.ts"),
).href) as { __setExtractorForTest: (fn: (input: string) => Promise<{ data: Float32Array }>) => void };
function vecFor(input: string): Float32Array {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const out = new Float32Array(16);
  let state = h || 1;
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}
embedPkg.__setExtractorForTest(async (input: string) => ({ data: vecFor(input) }));

// Confirmed B-sample text (SAMPLES-Q20-Q21-LOCK-COLDSTART.md, commit 7afa2d1d).
const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。";
const HOURS_NOTICE = "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。";
const A4_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱 help@example.com 和公共假期暂停人工客服、仅保留自助服务的安排保持不变。";

const REPLY_ACCEPT = '{"alreadyCurrent": false, "sameFact": true, "reliable": true, "relation": "correction", "reason": "official notice with an effective date corrects the same fact"}';
const REPLY_SAME = '{"alreadyCurrent": true, "sameFact": true, "reliable": true, "relation": "same", "reason": "the live version already states the same official correction"}';
const REPLY_FINAL = '{"supported": true, "preserved": true, "corrected": true, "noExtras": true, "reason": "keeps every uncorrected fact and states the correction"}';

// The hold: beta's FIRST judgment (verify against the pre-race knowledge,
// evidence carrying beta's copy url) does not answer until the test releases
// it — alpha lands its whole correction in that window, so beta's apply finds
// the target replaced and the resolution spends its one re-judge.
let releaseGate: () => void = () => {};
const betaGate = new Promise<void>((resolve) => { releaseGate = resolve; });
let onBetaJudgeArrived: () => void = () => {};
const betaJudgeArrived = new Promise<void>((resolve) => { onBetaJudgeArrived = resolve; });
let announced = false;

// Marker that tells the RE-judge prompt from the plan-phase judgment: only
// the re-judge's CURRENT-KNOWLEDGE section carries alpha's landed text
// ("help@example.com 和公共假期暂停"). "7×24" alone cannot tell them apart —
// the candidate summary and the notice snippet already contain it.
const LANDED_OLD_MARKER = "help@example.com 和公共假期暂停";

function replyFor(prompt: string): string {
  if (prompt.includes("You are checking a correction")) {
    // The re-judge sees the LANDED version as CURRENT KNOWLEDGE; the plan
    // judgment sees the old knowledge.
    return prompt.includes(LANDED_OLD_MARKER) ? REPLY_SAME : REPLY_ACCEPT;
  }
  if (prompt.includes("You are checking the final text")) return REPLY_FINAL;
  // A MERGE call, not a plan summarize: the merge appends a CURRENT KNOWLEDGE
  // evidence ITEM ("[N] CURRENT KNOWLEDGE - <text>"), while the plain summary
  // template also contains the words "CURRENT KNOWLEDGE" in its instructions —
  // the item shape is the reliable discriminator.
  if (prompt.includes("CURRENT KNOWLEDGE - ")) {
    // Alpha's merge (old content in CURRENT KNOWLEDGE) builds the landed
    // text; beta's first merge builds a draft the resolution discards.
    return prompt.includes("-copy") ? "被丢弃的合并草稿，不会写入" : A4_MERGED;
  }
  return HOURS_NOTICE;
}

function scriptedSession(): { model: unknown; streamFn: unknown; apiKey: string } {
  const model = {
    id: "fake-model", name: "fake-model", api: "openai-completions", provider: "fake",
    baseUrl: "http://127.0.0.1:1/v1", reasoning: false, input: ["text"],
    // No price table: the endpoint reality D4 names — unknown cost, never free.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 8192,
  };
  const streamFn = (_model: never, req: never) => {
    const prompt = (req as { messages: Array<{ content: string }> }).messages[0]!.content;
    const reply = replyFor(prompt);
    const events = [
      { type: "text_delta", delta: reply },
      { type: "done", message: { role: "assistant", content: [], usage: { input: 100, output: 30, totalTokens: 130 } } },
    ];
    return (async function* () {
      const isPlanJudgment = prompt.includes("You are checking a correction")
        && prompt.includes("-copy")
        && !prompt.includes(LANDED_OLD_MARKER);
      if (isPlanJudgment) {
        if (!announced) { announced = true; onBetaJudgeArrived(); }
        await betaGate;
      }
      for (const e of events) yield e;
    })();
  };
  return { model, streamFn, apiKey: "fake-key" };
}

// A recording ledger: every reserve and settle lands in `calls`, so the test
// can assert the FIFTH call pair (the resolution's one re-judge) exists.
function recordingLedger(): BudgetLedgerPort & {
  calls: Array<{ kind: string; dimension: string }>;
} {
  const calls: Array<{ kind: string; dimension: string }> = [];
  const ledger = {
    reserveCalls: (_s: string, _n: number) => { calls.push({ kind: "reserve", dimension: "call" }); return true; },
    reserveTokens: (_s: string, _n: number) => { calls.push({ kind: "reserve", dimension: "token" }); return true; },
    reserveUsd: (_s: string, _n: number) => { calls.push({ kind: "reserve", dimension: "usd" }); return true; },
    settleCalls: (_s: string, _r: number, _a: number) => { calls.push({ kind: "settle", dimension: "call" }); },
    settleTokens: (_s: string, _r: number, _a: number) => { calls.push({ kind: "settle", dimension: "token" }); },
    settleUsd: (_s: string, _r: number, _a: number) => { calls.push({ kind: "settle", dimension: "usd" }); },
    calls,
  };
  return ledger as BudgetLedgerPort & { calls: typeof calls };
}

const dir = mkdtempSync(join(tmpdir(), "ans-262-budget-"));
const stores: SqliteSessionStore[] = [];
function openStore(db: string): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db));
  stores.push(s);
  return s;
}
function q(sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, "race.db"), { readonly: true });
  try { return d.prepare(sql).get(...params); } finally { d.close(); }
}

async function seedEpisode(
  store: SqliteSessionStore, sessionId: string, url: string, title: string, snippet: string, entity: string,
): Promise<number> {
  const ra = await store.adjudicateMemory(sessionId, [{ url, title, snippet, source: "tavily", evidence: 0.9, entity }]);
  const id = ra[0]?.insertedId;
  if (typeof id !== "number") throw new Error("seed failed for " + url);
  return id;
}

// Seed: the shared old knowledge (three episodes, one batch run with plain
// deterministic seams), then each session's notice.
let alphaNoticeId = -1;
let betaNoticeId = -1;
{
  const seed = openStore("race.db");
  const sessSeed = await seed.createSession("eval");
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    ids.push(await seedEpisode(seed, sessSeed.id, "https://a.example/support-facts-v" + i,
      "A 公司客服说明 v" + i, A4_OLD, "a-support-hours"));
  }
  const rep = await seed.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
    { summarize: async () => A4_OLD, classify: () => ({ label: "supported", confidence: 0.95 }) },
  );
  assert(rep.add === 1, "seed: the old knowledge row exists before the race");
  const sessA = await seed.createSession("alpha-budget");
  const sessB = await seed.createSession("beta-budget");
  alphaNoticeId = await seedEpisode(seed, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  betaNoticeId = await seedEpisode(seed, sessB.id, "https://a.example/notice-2026-11-01-copy",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  seed.close();
}

// The race itself. Alpha runs unbudgeted (usage still accumulates); beta
// runs metered, so its recording ledger sees every call including the
// resolution's one re-judge.
{
  const alpha = openStore("race.db");
  const beta = openStore("race.db");
  const alphaSeams = createConsolidationSeams(scriptedSession() as never);
  const betaLedger = recordingLedger();
  const betaSeams = createConsolidationSeams(scriptedSession() as never, {
    budget: { ledger: betaLedger, sessionId: "race-beta" },
  });

  const betaRun = beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNoticeId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: betaSeams.summarize,
      classify: betaSeams.classify,
      verify: betaSeams.verify,
      verifyFinal: betaSeams.verifyFinal,
    },
  );
  await betaJudgeArrived;

  const alphaReport = await alpha.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [alphaNoticeId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: alphaSeams.summarize,
      classify: alphaSeams.classify,
      verify: alphaSeams.verify,
      verifyFinal: alphaSeams.verifyFinal,
    },
  );
  assert(alphaReport.update === 1, "alpha's correction landed through the real kernel seams");
  releaseGate();
  const betaReport = await betaRun;

  // The resolution outcome (B1): duplicate, one retry, no second version.
  assert(betaReport.update === 0 && betaReport.noop === 1,
    "beta's resolution reads as a noop, not a write (update=" + betaReport.update + ")");
  assert(betaReport.conflicts === 0 && betaReport.resolvedCollisions.length === 1
    && betaReport.resolvedCollisions[0]!.resolution === "duplicate",
    "beta's collision resolved as duplicate after the one re-judge");
  assert(q("SELECT COUNT(*) AS n FROM semantic_memories WHERE valid_until IS NULL").n === 1,
    "exactly one live version exists after the race");

  // The accounting: 4 plan-phase calls + the ONE re-judge = 5 provider calls,
  // all through the same seam with the same honest cost basis.
  assert(betaSeams.usage.calls === 5,
    "the one re-judge shows up as a FIFTH accounted call (calls=" + betaSeams.usage.calls + ")");
  assert(betaSeams.usage.inputTokens === 500 && betaSeams.usage.totalTokens === 650,
    "usage accumulates the retry's tokens (in=" + betaSeams.usage.inputTokens + ")");
  assert(betaSeams.usage.costBasis === "unknown",
    "a custom endpoint reports the cost basis as unknown — the retry is not free either");
  assert(betaSeams.usage.missing.length > 0,
    "the missing cost dimension is named, not zeroed");
  assert(alphaSeams.usage.calls === 4,
    "alpha spent exactly its four plan-phase calls (calls=" + alphaSeams.usage.calls + ")");

  // The budget: the re-judge is a real reserve/settle pair — the fifth.
  const callReserves = betaLedger.calls.filter((c) => c.kind === "reserve" && c.dimension === "call").length;
  const callSettles = betaLedger.calls.filter((c) => c.kind === "settle" && c.dimension === "call").length;
  assert(callReserves === 5 && callSettles === 5,
    "the ledger saw ALL FIVE calls reserve and settle — the re-judge is not hidden spend (reserves=" + callReserves + ")");
  const sourceIds = JSON.parse(String(
    q("SELECT source_episode_ids FROM semantic_memories WHERE valid_until IS NULL").source_episode_ids,
  )) as number[];
  assert(sourceIds.includes(betaNoticeId),
    "beta's material joined the live version's sources in the duplicate resolution");
}

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
rmSync(dir, { recursive: true, force: true });

console.log("concurrent-rejudget-budget: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
