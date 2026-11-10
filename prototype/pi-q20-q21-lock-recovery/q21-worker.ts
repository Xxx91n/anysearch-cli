// Q21 worker: one real process, one SQLite connection, a real model. Writes a
// readiness file after the plan (summarize + verify) and waits for the other
// worker before entering the write transaction, so both plans read the old
// version. The loser must re-read the current version and judge once more.
//
// Env: Q21_ROLE (alpha|beta), Q21_MODE (B1|B2), Q21_DB, Q21_SESSION,
// Q21_BARRIER_DIR, plus the usual ANS_LLM_* credentials.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLlmSession } from "../../packages/kernel/src/llm-init";
import { createConsolidationSeams } from "../../packages/kernel/src/consolidation";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const role = process.env.Q21_ROLE ?? "";
const mode = process.env.Q21_MODE ?? "";
const dbPath = process.env.Q21_DB ?? "";
const sessionId = process.env.Q21_SESSION ?? "";
const barrierDir = process.env.Q21_BARRIER_DIR ?? "";
if (!role || !mode || !dbPath || !sessionId || !barrierDir) {
  console.error("Q21 worker: missing Q21_ROLE/Q21_MODE/Q21_DB/Q21_SESSION/Q21_BARRIER_DIR");
  process.exit(2);
}
const provider = process.env.ANS_LLM_PROVIDER ?? "";
const modelName = process.env.ANS_LLM_MODEL ?? "";
if (!provider || !modelName) {
  console.error("Q21 worker: missing ANS_LLM_PROVIDER / ANS_LLM_MODEL");
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(barrierDir, { recursive: true });

let summarizeCalls = 0;
let verifyCalls = 0;
let lastVerifyPrompt = "";
const prompts: Array<{ kind: string; text: string }> = [];

async function barrier(): Promise<void> {
  const mine = join(barrierDir, role + ".ready");
  writeFileSync(mine, JSON.stringify({ at: Date.now(), summarizeCalls, verifyCalls }));
  const other = role === "alpha" ? "beta" : "alpha";
  const otherFile = join(barrierDir, other + ".ready");
  const deadline = Date.now() + 60_000;
  while (!existsSync(otherFile) && Date.now() < deadline) await sleep(20);
  if (!existsSync(otherFile)) throw new Error("plan barrier timed out waiting for " + other);
  await sleep(50);
}

try {
  const llm = await createLlmSession({
    provider,
    model: modelName,
    baseUrl: process.env.ANS_LLM_BASE_URL,
    api: process.env.ANS_LLM_API,
    apiKey: process.env.ANS_LLM_API_KEY,
  } as any);
  const seams = createConsolidationSeams({
    ...llm,
    streamFn: (model: any, context: any, options: any) => {
      try {
        const messages = context?.messages ?? [];
        const last = messages.slice().reverse().find((m: any) => m?.role === "user");
        const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
        prompts.push({ kind: text.startsWith("You are checking") ? "verify" : "summarize", text: String(text).slice(0, 2500) });
      } catch { /* logging must not break the call */ }
      return llm.streamFn(model, context, options);
    },
  } as any);

  const scriptedVerify = process.env.Q21_SCRIPTED_VERIFY === "1";
  const store = new SqliteSessionStore(dbPath, {
    consolidateSummarize: async (episodes) => { summarizeCalls++; return seams.summarize(episodes); },
    consolidateClassify: seams.classify,
    consolidateVerify: async (input) => {
      verifyCalls++;
      lastVerifyPrompt = "CURRENT:\n" + input.oldContent + "\nCANDIDATE:\n" + input.summary;
      if (scriptedVerify) {
        // DIAGNOSTIC ONLY: first judgment (against the old 9-5 knowledge) accepts
        // the correction; the second judgment (after losing the race) says it
        // still cannot resolve which claim is right. This isolates the retry
        // machinery from the real model's judgment.
        return verifyCalls === 1
          ? { sameFact: true, reliable: true, relation: "correction", reason: "diagnostic: 初次判断为同一事实的明确更正" }
          : { sameFact: true, reliable: false, relation: "unclear", reason: "diagnostic: 重读后仍无法确定哪边正确" };
      }
      return seams.verify(input);
    },
  });

  const report = await store.consolidateMemory({
    sessionIds: [sessionId],
    allowSingleEvidence: true,
    thetaDup: 0.999,
    preserveOnUpdate: true,
    planBarrier: barrier,
  });

  process.stdout.write("RESULT " + JSON.stringify({
    role, mode,
    report: {
      add: report.add, update: report.update, skip: report.skip, conflict: report.conflict,
      noop: report.noop, singleEvidenceSkipped: report.singleEvidenceSkipped,
      staleUpdates: report.staleUpdates, staleDetails: report.staleDetails,
      retriedAfterStale: report.retriedAfterStale,
      concurrentConflicts: report.concurrentConflicts,
      conflictDetails: report.conflictDetails,
      verifyRejected: report.verifyRejected, verifyDetails: report.verifyDetails,
      verifiedCorrections: report.verifiedCorrections,
      updates: report.updates, semanticIds: report.semanticIds,
      retiredEpisodeIds: report.retiredEpisodeIds,
      summariesNeedingRefresh: report.summariesNeedingRefresh,
    },
    calls: { summarize: summarizeCalls, verify: verifyCalls },
    usage: seams.usage,
    lastVerifyPrompt,
    prompts,
  }) + "\n");
  store.close();
} catch (e) {
  process.stdout.write("RESULT " + JSON.stringify({
    role, mode, error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    calls: { summarize: summarizeCalls, verify: verifyCalls },
  }) + "\n");
  process.exitCode = 1;
}
