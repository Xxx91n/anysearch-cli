// Q2 worker: one real process, one SQLite connection, one session's
// consolidation. Writes a readiness file after planning, waits until both
// workers are ready, then commits. That makes both plans read the old version
// before either writer starts its transaction.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const role = process.env.Q2_ROLE ?? "";
const dbPath = process.env.Q2_DB ?? "";
const sessionId = process.env.Q2_SESSION ?? "";
const barrierDir = process.env.Q2_BARRIER_DIR ?? "";
if (!role || !dbPath || !sessionId || !barrierDir) {
  console.error("Q2 worker: missing Q2_ROLE/Q2_DB/Q2_SESSION/Q2_BARRIER_DIR");
  process.exit(2);
}

const ALPHA = "Support hours are now 24/7, no longer Monday to Friday 9-5.";
const OMEGA = "Support hours are now 10:00-18:00 on weekends, no longer Monday to Friday 9-5.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(barrierDir, { recursive: true });

const store = new SqliteSessionStore(dbPath, {
  consolidateSummarize: async (episodes) => {
    const text = episodes.map((e) => e.snippet + " " + e.title).join(" ");
    if (text.includes("OMEGA")) return OMEGA;
    if (text.includes("ALPHA")) return ALPHA;
    // UPDATE-path merge call carries CURRENT KNOWLEDGE; keep the same claim.
    if (text.includes("CURRENT KNOWLEDGE")) return role === "omega" ? OMEGA : ALPHA;
    return role === "omega" ? OMEGA : ALPHA;
  },
  consolidateClassify: () => ({ label: "supported" as const, confidence: 0.95 }),
});

async function barrier(): Promise<void> {
  const mine = join(barrierDir, role + ".ready");
  writeFileSync(mine, new Date().toISOString());
  const other = role === "alpha" ? "omega" : "alpha";
  const otherFile = join(barrierDir, other + ".ready");
  const deadline = Date.now() + 20_000;
  while (!existsSync(otherFile) && Date.now() < deadline) await sleep(20);
  if (!existsSync(otherFile)) throw new Error("plan barrier timed out waiting for " + other);
  await sleep(50); // both are provably past the plan phase
}

try {
  const report = await store.consolidateMemory({
    sessionIds: [sessionId],
    thetaDup: 0.999,
    planBarrier: barrier,
  });
  process.stdout.write("RESULT " + JSON.stringify({
    role,
    report: {
      add: report.add,
      update: report.update,
      skip: report.skip,
      conflict: report.conflict,
      staleUpdates: report.staleUpdates,
      verifyRejected: report.verifyRejected,
      updates: report.updates,
      staleDetails: report.staleDetails,
      semanticIds: report.semanticIds,
      summariesNeedingRefresh: report.summariesNeedingRefresh,
    },
  }) + "\n");
} catch (e) {
  process.stdout.write("RESULT " + JSON.stringify({ role, error: e instanceof Error ? e.message : String(e) }) + "\n");
  process.exitCode = 1;
} finally {
  store.close();
}
