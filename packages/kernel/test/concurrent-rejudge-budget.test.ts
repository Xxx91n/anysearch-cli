// #262 (D11 / D4) — the collision resolution's EXTRA model calls go through
// the same kernel seams, the same usage accumulator and the same budget
// reserve/settle as every other consolidation call. The spec names this
// directly: "额外合并和检查纳入预算与用量，不能藏在主调用之外" (D4) and "允许一次
// 必要的重新合并，并计入预算" (D11).
//
// End-to-end here: TWO real store races over one shared temp database each
// (two sessions, two connections — the confirmed B-sample shape), where the
// later session's seams are createConsolidationSeams over a scripted provider
// session and a RECORDING ledger:
//   - B1 (duplicate): the one re-judge = the FIFTH accounted call, fifth
//     reserve/settle pair;
//   - M1 (re-merged): the re-judge + ONE re-merge + the re-check = the fifth,
//     sixth and seventh calls, all reserved and settled — the re-merge is
//     never hidden spend.
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

// Confirmed B-sample text (SAMPLES-Q20-Q21-LOCK-COLDSTART.md, commit 7afa2d1d)
// plus the #262-confirmed M1 fixture.
const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。";
const HOURS_NOTICE = "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。";
const A4_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱 help@example.com 和公共假期暂停人工客服、仅保留自助服务的安排保持不变。";
const EMAIL_NOTICE = "A 公司官方通知（2026-11-05 生效）：在线客服邮箱自 2026-11-05 起改为 support@example.com，替代原邮箱 help@example.com。服务时间与公共假期的人工客服安排保持不变。";
const M1_FINAL = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱自 2026-11-05 起改为 support@example.com，替代原邮箱 help@example.com。公共假期暂停人工客服、仅保留自助服务的安排保持不变。";

const REPLY_ACCEPT = '{"alreadyCurrent": false, "sameFact": true, "reliable": true, "relation": "correction", "reason": "official notice with an effective date corrects the same fact"}';
const REPLY_SAME = '{"alreadyCurrent": true, "sameFact": true, "reliable": true, "relation": "same", "reason": "the live version already states the same official correction"}';
const REPLY_FINAL = '{"supported": true, "preserved": true, "corrected": true, "noExtras": true, "reason": "keeps every uncorrected fact and states the correction"}';

// Marker that separates the RE-judge prompt from the plan-phase judgment:
// only the re-judge's CURRENT-KNOWLEDGE section carries alpha's landed text.
// ("7×24" alone cannot tell them apart — the candidate and the notice snippet
// already contain it; the plain summary template also contains the literal
// words "CURRENT KNOWLEDGE", so the evidence ITEM shape "CURRENT KNOWLEDGE - "
// is what identifies a merge call.)
const LANDED_OLD_MARKER = "help@example.com 和公共假期暂停";

interface RaceGate {
  betaGate: Promise<void>;
  release: () => void;
  arrived: Promise<void>;
  announce: () => void;
}
function makeGate(): RaceGate {
  let release: () => void = () => {};
  const betaGate = new Promise<void>((r) => { release = r; });
  let announce: () => void = () => {};
  const arrived = new Promise<void>((r) => { announce = r; });
  let fired = false;
  return {
    betaGate, release, arrived,
    announce: () => { if (!fired) { fired = true; announce(); } },
  };
}

function replyFor(prompt: string, rejudge: "same" | "accept", betaMarker: string): string {
  if (prompt.includes("You are checking a correction")) {
    if (prompt.includes(LANDED_OLD_MARKER)) {
      return rejudge === "same" ? REPLY_SAME : REPLY_ACCEPT;
    }
    return REPLY_ACCEPT;
  }
  if (prompt.includes("You are checking the final text")) return REPLY_FINAL;
  if (prompt.includes("CURRENT KNOWLEDGE - ")) {
    if (prompt.includes(betaMarker)) {
      // Beta's merge calls: the first one (CURRENT KNOWLEDGE = the old row)
      // produces the draft the resolution discards; the RE-merge (CURRENT
      // KNOWLEDGE = the landed version) is what may land.
      return prompt.includes(LANDED_OLD_MARKER) ? M1_FINAL : "被丢弃的合并草稿，不会写入";
    }
    return A4_MERGED;
  }
  return HOURS_NOTICE;
}

function scriptedSession(
  gate: RaceGate, rejudge: "same" | "accept", betaMarker: string,
): { model: unknown; streamFn: unknown; apiKey: string } {
  const model = {
    id: "fake-model", name: "fake-model", api: "openai-completions", provider: "fake",
    baseUrl: "http://127.0.0.1:1/v1", reasoning: false, input: ["text"],
    // No price table: the endpoint reality D4 names — unknown cost, never free.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 8192,
  };
  const streamFn = (_model: never, req: never) => {
    const prompt = (req as { messages: Array<{ content: string }> }).messages[0]!.content;
    const reply = replyFor(prompt, rejudge, betaMarker);
    const events = [
      { type: "text_delta", delta: reply },
      { type: "done", message: { role: "assistant", content: [], usage: { input: 100, output: 30, totalTokens: 130 } } },
    ];
    return (async function* () {
      const isBetaPlanJudgment = prompt.includes("You are checking a correction")
        && prompt.includes(betaMarker)
        && !prompt.includes(LANDED_OLD_MARKER);
      if (isBetaPlanJudgment) {
        gate.announce();
        await gate.betaGate;
      }
      for (const e of events) yield e;
    })();
  };
  return { model, streamFn, apiKey: "fake-key" };
}

// A recording ledger: every reserve and settle lands in `calls`, so the test
// can assert the EXACT number of call pairs — including the resolution's
// extra spend.
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
function q(db: string, sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, db), { readonly: true });
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

// Seed one race database: the shared old knowledge (three episodes, one batch
// run with plain deterministic seams), then each session's notice.
async function seedDb(
  db: string, betaUrl: string, betaTitle: string, betaSnippet: string,
): Promise<{ alphaNoticeId: number; betaNoticeId: number }> {
  const seed = openStore(db);
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
  assert(rep.add === 1, "seed (" + db + "): the old knowledge row exists before the race");
  const sessA = await seed.createSession("alpha-" + db);
  const sessB = await seed.createSession("beta-" + db);
  const alphaNoticeId = await seedEpisode(seed, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const betaNoticeId = await seedEpisode(seed, sessB.id, betaUrl, betaTitle, betaSnippet, "a-support-hours");
  seed.close();
  return { alphaNoticeId, betaNoticeId };
}

// One race: beta plans first and is held inside its first judgment; alpha
// lands fully; beta proceeds and its write collides. The resolution then
// spends its retries — all through the metered seams.
async function runRace(
  label: string,
  db: string,
  rejudge: "same" | "accept",
  seedArgs: { betaUrl: string; betaTitle: string; betaSnippet: string },
): Promise<void> {
  const ids = await seedDb(db, seedArgs.betaUrl, seedArgs.betaTitle, seedArgs.betaSnippet);
  const gate = makeGate();
  const alpha = openStore(db);
  const beta = openStore(db);
  const alphaSeams = createConsolidationSeams(scriptedSession(gate, rejudge, seedArgs.betaUrl) as never);
  const betaLedger = recordingLedger();
  const betaSeams = createConsolidationSeams(scriptedSession(gate, rejudge, seedArgs.betaUrl) as never, {
    budget: { ledger: betaLedger, sessionId: "race-" + label },
  });

  const betaRun = beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [ids.betaNoticeId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: betaSeams.summarize,
      classify: betaSeams.classify,
      verify: betaSeams.verify,
      verifyFinal: betaSeams.verifyFinal,
    },
  );
  let betaSettled = false;
  betaRun.then(() => { betaSettled = true; }, (e) => {
    betaSettled = true;
    console.error("concurrent-rejudge-budget: " + label + ": beta run rejected: " + (e instanceof Error ? e.message : String(e)));
  });
  // Hang guard: a race that settles before its held judgment, or never
  // reaches it, must fail loudly instead of draining the event loop.
  const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  await Promise.race([
    gate.arrived,
    sleepMs(5000).then(() => {
      if (!betaSettled) throw new Error(label + ": beta never reached its first judgment and never settled");
      throw new Error(label + ": beta settled WITHOUT reaching its first judgment");
    }),
  ]);

  const alphaReport = await alpha.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [ids.alphaNoticeId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: alphaSeams.summarize,
      classify: alphaSeams.classify,
      verify: alphaSeams.verify,
      verifyFinal: alphaSeams.verifyFinal,
    },
  );
  assert(alphaReport.update === 1, label + ": alpha's correction landed through the real kernel seams");
  gate.release();
  const betaReport = await betaRun;

  assert(q(db, "SELECT COUNT(*) AS n FROM semantic_memories WHERE valid_until IS NULL").n === 1,
    label + ": exactly one live version exists after the race");
  assert(alphaSeams.usage.calls === 4,
    label + ": alpha spent exactly its four plan-phase calls (calls=" + alphaSeams.usage.calls + ")");

  // Expected provider calls through beta's seams:
  //   plan: summarize + verify + merge + final check = 4;
  //   duplicate resolution: + re-judge = 5;
  //   re-merged resolution: + re-judge + re-merge + final re-check = 7.
  const expectCalls = rejudge === "same" ? 5 : 7;
  assert(betaSeams.usage.calls === expectCalls,
    label + ": the resolution spend is accounted call-by-call (calls=" + betaSeams.usage.calls + ", want " + expectCalls + ")");
  assert(betaSeams.usage.inputTokens === expectCalls * 100 && betaSeams.usage.totalTokens === expectCalls * 130,
    label + ": usage accumulates the retry tokens (in=" + betaSeams.usage.inputTokens + ")");
  assert(betaSeams.usage.costBasis === "unknown",
    label + ": a custom endpoint reports the cost basis as unknown — the retry is not free either");
  assert(betaSeams.usage.missing.length > 0,
    label + ": the missing cost dimension is named, not zeroed");

  const callReserves = betaLedger.calls.filter((c) => c.kind === "reserve" && c.dimension === "call").length;
  const callSettles = betaLedger.calls.filter((c) => c.kind === "settle" && c.dimension === "call").length;
  assert(callReserves === expectCalls && callSettles === expectCalls,
    label + ": the ledger reserved and settled ALL " + expectCalls + " calls — no hidden spend (reserves=" + callReserves + ")");

  const live = q(db, "SELECT id, content, source_episode_ids FROM semantic_memories WHERE valid_until IS NULL");
  const sourceIds = JSON.parse(String(live.source_episode_ids)) as number[];
  assert(sourceIds.includes(ids.betaNoticeId),
    label + ": beta's material is a source of the live version");
  if (rejudge === "same") {
    assert(betaReport.update === 0 && betaReport.noop === 1,
      label + ": the duplicate resolution reads as a noop, not a write");
    assert(betaReport.conflicts === 0 && betaReport.resolvedCollisions.length === 1
      && betaReport.resolvedCollisions[0]!.resolution === "duplicate",
      label + ": the collision resolved as duplicate after the one re-judge");
    assert(live.content === A4_MERGED, label + ": the live text is alpha's");
  } else {
    assert(betaReport.update === 1 && betaReport.noop === 0,
      label + ": the re-merged correction landed (update=" + betaReport.update + ")");
    assert(betaReport.conflicts === 0 && betaReport.resolvedCollisions.length === 1
      && betaReport.resolvedCollisions[0]!.resolution === "re-merged"
      && betaReport.resolvedCollisions[0]!.newId === live.id,
      label + ": the collision resolved as re-merged onto the landed version");
    assert(live.content === M1_FINAL,
      label + ": the live text is the re-merge — both sessions' facts preserved, the discarded draft never written");
    assert(sourceIds.includes(ids.alphaNoticeId),
      label + ": the other session's material was carried into the re-merged sources");
  }
}

await runRace(
  "B1-duplicate", "race-b1.db", "same",
  {
    betaUrl: "https://a.example/notice-2026-11-01-copy",
    betaTitle: "A 公司客服时间更新通知（官方）",
    betaSnippet: HOURS_NOTICE,
  },
);
await runRace(
  "M1-remerged", "race-m1.db", "accept",
  {
    betaUrl: "https://a.example/notice-2026-11-05",
    betaTitle: "A 公司客服邮箱变更通知（官方）",
    betaSnippet: EMAIL_NOTICE,
  },
);

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
rmSync(dir, { recursive: true, force: true });

console.log("concurrent-rejudge-budget: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
