// #262 — the concurrent-correction race between TWO REAL OS PROCESSES
// sharing one temp database (spec D11, test T3; acceptance: "用两个真实进程
// 和共享临时库验证目标版本检查"). The confirmed B-sample definition runs
// here: "两个真实进程（两个独立 Node 进程，各自一个 SQLite 连接），共用一个
// 临时库。计划阶段用一个文件屏障保证两边都先读到旧版本，之后才允许写。"
//
// What makes this a REAL-process test:
//   - beta and alpha are separate `node` child processes, each with its own
//     SQLite connection and its own store instance — the cross-process
//     BEGIN IMMEDIATE contention and the write-phase target-version check
//     run for real;
//   - the plan-phase barrier is a file, not an in-process hook: beta's first
//     judgment polls until the parent drops the gate, exactly the barrier
//     the confirmed sample describes, and beta's plan-phase scan read the
//     old knowledge before alpha wrote anything.
//
// What is deliberately NOT real here (marked, per the ticket): the checker
// verdicts are scripted — the CONTROLLED CHECKER. The B2 retry branches have
// no real-model coverage (labels in
// packages/kernel/test/correction-a1-a4.online.ts) and are not forced on the
// model. Embeddings are the deterministic test vectors: the real e5 arm
// would depend on a model download that no CI gate provisions, and the
// correction decision is verdict-driven anyway (never trusts the cosine
// score), so the race behaviour does not change with the arm.
//
// The parent seeds the shared database in-process (injected seams, like the
// engine tests), writes the child script into the scenario's temp dir (the
// parent knows these bytes; nothing else runs there), and asserts on the
// children's reports PLUS the persisted rows — never the printed counts
// alone.
//
// No test framework (repo convention).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { __setExtractorForTest } from "@anysearch-cli/embedding";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

// Deterministic embedding for the parent's seeds AND both children: the real
// e5 arm would trigger a model download on first use, which the CI gates
// never provision. See the header: the race is verdict-driven.
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
__setExtractorForTest(async (input: string) => ({ data: vecFor(input) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const STORE_SRC = join(PKG, "src", "index.ts");
const EMBEDDING_SRC = join(PKG, "..", "embedding", "src", "index.ts");

// Confirmed sample text (SAMPLES-Q20-Q21-LOCK-COLDSTART.md, commit 7afa2d1d).
const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。";
const HOURS_NOTICE = "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。";
const A4_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱 help@example.com 和公共假期暂停人工客服、仅保留自助服务的安排保持不变。";
const B2_CANDIDATE = "A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。";

const CORRECTION = { alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction", reason: "official notice with an effective date corrects the same fact" };
const B1_REJUDGE = { alreadyCurrent: true, sameFact: true, reliable: true, relation: "same", reason: "the live version already states the same official correction" };
const B2_REJUDGE = { alreadyCurrent: false, sameFact: true, reliable: true, relation: "unclear", reason: "两份通知说法相反，没有生效日期或适用范围能解释差异，无法判定哪份更可靠" };

// One session = one OS process, driven by env. The seams are the CONTROLLED
// CHECKER; the verdicts are scripted, not model judgement.
const CHILD_SCRIPT = String.raw`
const { pathToFileURL } = await import("node:url");
const { existsSync, writeFileSync } = await import("node:fs");
const { __setExtractorForTest } = await import(pathToFileURL(process.env.RACER_EMBEDDING).href);
function vecFor(input) {
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
__setExtractorForTest(async (input) => ({ data: vecFor(input) }));
const { SqliteSessionStore } = await import(pathToFileURL(process.env.RACER_STORE).href);
const verdicts = JSON.parse(process.env.RACER_VERDICTS);
let verifyCalls = 0;
let sumCalls = 0;
const verify = async () => {
  const mine = verifyCalls++;
  if (mine === 0 && process.env.RACER_ARRIVED) {
    writeFileSync(process.env.RACER_ARRIVED, "1");
  }
  if (mine === 0 && process.env.RACER_GATE) {
    const t0 = Date.now();
    while (!existsSync(process.env.RACER_GATE)) {
      if (Date.now() - t0 > 15_000) throw new Error("gate timeout: the concurrent writer never landed");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  return verdicts[Math.min(mine, verdicts.length - 1)];
};
const summarize = async (eps) => {
  sumCalls++;
  const ck = eps.find((e) => e.title === "CURRENT KNOWLEDGE");
  if (!ck) return process.env.RACER_CANDIDATE;
  if (ck.snippet.includes("7×24")) return process.env.RACER_REMERGED;
  return process.env.RACER_MERGED;
};
const store = new SqliteSessionStore(process.env.RACER_DB);
const report = await store.consolidateMemory(
  { scope: { by: "memory", sessionIds: [], memoryIds: [Number(process.env.RACER_SCOPE_ID)], sessionIdNotApplied: false }, allowSingleEvidence: true },
  {
    summarize,
    classify: () => ({ label: "supported", confidence: 0.95 }),
    verify,
    verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
  },
);
store.close();
writeFileSync(process.env.RACER_OUTPUT, JSON.stringify({ report, verifyCalls, sumCalls }));
`;

interface ChildResult { report: any; verifyCalls: number; sumCalls: number }

function runChild(root: string, env: Record<string, string>): {
  done: Promise<ChildResult>;
  kill: () => void;
} {
  const out = join(root, "report-" + env.RACER_SLOT + ".json");
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ["--import", "tsx", join(root, "racer.mjs")], {
      cwd: PKG,
      env: { ...process.env, RACER_OUTPUT: out, ...env } as NodeJS.ProcessEnv,
    });
  } catch (e) {
    return {
      done: Promise.reject(e as Error),
      kill: () => { /* never started */ },
    };
  }
  let stderr = "";
  child.stderr?.on("data", (c) => { stderr += String(c); });
  const done = new Promise<ChildResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error("child " + env.RACER_SLOT + " timed out after 150s; stderr=" + stderr.slice(-400)));
    }, 25_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("child " + env.RACER_SLOT + " exited " + code + "; stderr=" + stderr.slice(-500)));
        return;
      }
      try {
        resolve(JSON.parse(readFileSync(out, "utf8")) as ChildResult);
      } catch (e) {
        reject(new Error("child " + env.RACER_SLOT + " left no readable report; stderr=" + stderr.slice(-400) + "; " + (e as Error).message));
      }
    });
  });
  return { done, kill: () => { try { child.kill(); } catch { /* already gone */ } } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(cond: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error("timeout waiting for " + what);
    await sleep(25);
  }
}

async function seed(
  root: string, db: string,
  betaUrl: string, betaTitle: string, betaSnippet: string,
): Promise<{ alphaNoticeId: number; betaNoticeId: number; oldRowId: number }> {
  const store = new SqliteSessionStore(join(root, db));
  const sessSeed = await store.createSession("eval");
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const ra = await store.adjudicateMemory(sessSeed.id, [{
      url: "https://a.example/support-facts-v" + i,
      title: "A 公司客服说明 v" + i,
      snippet: A4_OLD, source: "tavily", evidence: 0.9, entity: "a-support-hours",
    }]);
    if (typeof ra[0]?.insertedId === "number") ids.push(ra[0].insertedId);
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
    { summarize: async () => A4_OLD, classify: () => ({ label: "supported", confidence: 0.95 }) },
  );
  if (rep.add !== 1) throw new Error("seed failed: knowledge row not built");
  const sessA = await store.createSession("alpha-race");
  const sessB = await store.createSession("beta-race");
  const raA = await store.adjudicateMemory(sessA.id, [{
    url: "https://a.example/notice-2026-11-01", title: "A 公司客服时间更新通知（官方）",
    snippet: HOURS_NOTICE, source: "tavily", evidence: 0.9, entity: "a-support-hours",
  }]);
  const raB = await store.adjudicateMemory(sessB.id, [{
    url: betaUrl, title: betaTitle, snippet: betaSnippet, source: "tavily", evidence: 0.9, entity: "a-support-hours",
  }]);
  const d = new Database(join(root, db), { readonly: true });
  let oldRowId = -1;
  try {
    const row = d.prepare("SELECT id FROM semantic_memories WHERE valid_until IS NULL").get() as { id: number };
    oldRowId = row.id;
  } finally {
    d.close();
    store.close();
  }
  return { alphaNoticeId: raA[0]!.insertedId as number, betaNoticeId: raB[0]!.insertedId as number, oldRowId };
}

async function runRace(
  label: string,
  rejudgeVerdict: Record<string, unknown>,
  seedArgs: { betaUrl: string; betaTitle: string; betaSnippet: string },
  expect: { conflict: boolean },
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ans-262-race-"));
  const db = "race.db";
  const children: Array<{ kill: () => void; done: Promise<ChildResult> }> = [];
  try {
    writeFileSync(join(root, "racer.mjs"), CHILD_SCRIPT);
    const seeded = await seed(root, db, seedArgs.betaUrl, seedArgs.betaTitle, seedArgs.betaSnippet);
    const arrivedPath = join(root, "beta-arrived");
    const gatePath = join(root, "gate");

    // Beta plans first: its plan-phase scan must read the OLD knowledge
    // before anything else writes, so the file barrier holds it inside its
    // first judgment until alpha has fully landed — the confirmed sample's
    // race construction, now as two real processes.
    const beta = runChild(root, {
      RACER_SLOT: "beta",
      RACER_DB: join(root, db),
      RACER_SCOPE_ID: String(seeded.betaNoticeId),
      RACER_ARRIVED: arrivedPath,
      RACER_GATE: gatePath,
      RACER_VERDICTS: JSON.stringify([CORRECTION, rejudgeVerdict]),
      RACER_CANDIDATE: expect.conflict ? B2_CANDIDATE : HOURS_NOTICE,
      RACER_MERGED: A4_MERGED,
      RACER_REMERGED: A4_MERGED,
      RACER_STORE: STORE_SRC,
      RACER_EMBEDDING: EMBEDDING_SRC,
    });
    children.push(beta);
    await waitUntil(() => existsSync(arrivedPath), label + ": beta to reach its first judgment");

    const alpha = runChild(root, {
      RACER_SLOT: "alpha",
      RACER_DB: join(root, db),
      RACER_SCOPE_ID: String(seeded.alphaNoticeId),
      RACER_VERDICTS: JSON.stringify([CORRECTION]),
      RACER_CANDIDATE: HOURS_NOTICE,
      RACER_MERGED: A4_MERGED,
      RACER_REMERGED: A4_MERGED,
      RACER_STORE: STORE_SRC,
      RACER_EMBEDDING: EMBEDDING_SRC,
    });
    children.push(alpha);
    const alphaRun = await alpha.done;
    assert(alphaRun.report.update === 1, label + ": alpha's correction landed in its own process");
    writeFileSync(gatePath, "1");

    const betaRun = await beta.done;

    // Retry-cap accounting first: at most TWO judgments for the later
    // submitter — initial + one re-judge. No third; the barrier proves the
    // extra spend was a real retry after a real cross-process collision.
    assert(betaRun.verifyCalls === 2,
      label + ": the later submitter spends at most two judgments, no third (got " + betaRun.verifyCalls + ")");
    // Both scenarios spent one plan summarize + one first merge (the discarded
    // merge that targeted the old version); neither resolution re-merged here
    // (duplicate / unresolved). The spend is visible work, priced at 2 seams.
    assert(betaRun.sumCalls === 2,
      label + ": the later submitter's discarded first merge is honest spend (sumCalls=" + betaRun.sumCalls + ")");

    const d = new Database(join(root, db), { readonly: true });
    try {
      const lives = d.prepare("SELECT id, content, source_episode_ids FROM semantic_memories WHERE valid_until IS NULL").all() as any[];
      assert(lives.length === 1, label + ": exactly ONE live version after the cross-process race (got " + lives.length + ")");
      const live = lives[0];
      assert(live.content === A4_MERGED, label + ": the live version is alpha's merged content");
      const old = d.prepare("SELECT superseded_by FROM semantic_memories WHERE id = ?").get(seeded.oldRowId) as any;
      assert(old.superseded_by === live.id, label + ": the old row's supersede relation is a clean single chain");
      const sources: number[] = JSON.parse(live.source_episode_ids);
      assert(sources.includes(seeded.betaNoticeId) === !expect.conflict,
        label + ": beta's material joined the live row's sources only in the duplicate resolution");
      const betaRow = d.prepare("SELECT superseded_by FROM retrieval_results WHERE id = ?").get(seeded.betaNoticeId) as any;
      assert(betaRow.superseded_by === null, label + ": beta's material was not deleted or retired");
    } finally {
      d.close();
    }

    if (!expect.conflict) {
      // B1: duplicate resolution — no new version, countable resolution.
      assert(betaRun.report.update === 0 && betaRun.report.noop === 1,
        "B1: the later submitter wrote no update; the resolution reads as a noop");
      assert(betaRun.report.conflicts === 0 && betaRun.report.resolvedCollisions.length === 1,
        "B1: one collision resolved, zero unresolved");
      const res = betaRun.report.resolvedCollisions[0];
      assert(res.resolution === "duplicate" && res.retries === 1 && res.targetId,
        "B1: the resolution is named duplicate with exactly one retry");
      assert(res.plannedTargetId === seeded.oldRowId, "B1: the report remembers the original plan target");
    } else {
      // B2: unresolved conflict — both sides handed back, current untouched.
      assert(betaRun.report.conflicts === 1 && betaRun.report.conflictDetails.length === 1,
        "B2: one unresolved conflict reported");
      assert(betaRun.report.update === 0 && betaRun.report.noop === 0, "B2: nothing was written");
      const det = betaRun.report.conflictDetails[0];
      assert(det.plannedTargetId === seeded.oldRowId && det.plannedContent === A4_OLD,
        "B2: the planned target id and text travel back");
      assert(det.currentTargetId === liveRowId(root, db) && det.currentContent === A4_MERGED,
        "B2: the current live id and content travel back");
      assert(det.evidence.some((e: any) => e.url === seedArgs.betaUrl), "B2: our side's material travels back");
      assert(det.currentEvidence.some((e: any) => e.url === "https://a.example/notice-2026-11-01"),
        "B2: the other side's material travels back");
      assert(det.relation === "unclear" && det.retries === 1, "B2: the re-judge verdict and its one retry travel back");
    }
  } finally {
    for (const c of children) c.kill();
    await Promise.allSettled(children.map((c) => c.done));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function liveRowId(root: string, db: string): number {
  const d = new Database(join(root, db), { readonly: true });
  try {
    return (d.prepare("SELECT id FROM semantic_memories WHERE valid_until IS NULL").get() as { id: number }).id;
  } finally {
    d.close();
  }
}

await runRace(
  "B1",
  B1_REJUDGE,
  {
    betaUrl: "https://a.example/notice-2026-11-01-copy",
    betaTitle: "A 公司客服时间更新通知（官方）",
    betaSnippet: HOURS_NOTICE,
  },
  { conflict: false },
);
await runRace(
  "B2",
  B2_REJUDGE,
  {
    betaUrl: "https://b.example/notice-2",
    betaTitle: "A 公司客服时间通知（另一份）",
    betaSnippet: "A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。",
  },
  { conflict: true },
);

__setEmbeddingModuleForTest("auto");
console.log("consolidate-race-processes: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
