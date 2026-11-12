// #261 — the correction seams over one LLM session (spec D6/D7, test T4).
//
// The two checks that gate a knowledge replacement:
//   - verify (correction relationship: same object/matter/scope/time + reliable
//     evidence) parses the checker's JSON and refuses conservatively when the
//     reply is not parseable JSON — an unparseable checker never becomes a
//     silent overwrite;
//   - verifyFinal (final content: basis + fact retention) does the same.
//
// Both go through the same reserve-settle path as summarize, so their spend is
// budgeted and accounted, never hidden outside the consolidation ledger.
// Run: pnpm --filter @anysearch-cli/kernel run test

import {
  createConsolidationSeams,
  isConsolidationBudgetError,
} from "../src/consolidation";
import type { BudgetLedgerPort } from "../src/ports";
import type { ConsolidateEvidence } from "@anysearch-cli/store";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

type UsageShape = {
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  totalTokens?: number; cost?: { total?: number; totalFromProvider?: boolean };
};

function fakeSession(opts: { text?: string; usage?: UsageShape }) {
  const model = {
    id: "fake-model",
    name: "fake-model",
    api: "openai-completions",
    provider: "fake",
    baseUrl: "http://127.0.0.1:1/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
  const streamFn = () => {
    const events = [
      { type: "text_delta", delta: opts.text ?? "{}" },
      ...(opts.usage ? [{ type: "done", message: { role: "assistant", content: [], usage: opts.usage } }] : []),
    ];
    return (async function* () { for (const e of events) yield e; })();
  };
  return { model, streamFn, apiKey: "fake-key" } as never;
}

function recordingLedger(opts: { rejectCall?: boolean } = {}) {
  const calls: Array<{ kind: string; dimension: string; amount: number; actual?: number }> = [];
  const ledger: BudgetLedgerPort & { calls: typeof calls } = {
    reserveCalls: (_id, count) => {
      if (opts.rejectCall) return false;
      calls.push({ kind: "reserve", dimension: "call", amount: count });
      return true;
    },
    reserveTokens: (_id, amount) => {
      calls.push({ kind: "reserve", dimension: "token", amount });
      return true;
    },
    reserveUsd: (_id, amount) => {
      calls.push({ kind: "reserve", dimension: "usd", amount });
      return true;
    },
    settleCalls: (_id, reserved, actual) => {
      calls.push({ kind: "settle", dimension: "call", amount: reserved, actual });
    },
    settleTokens: (_id, reserved, actual) => {
      calls.push({ kind: "settle", dimension: "token", amount: reserved, actual });
    },
    settleUsd: (_id, reserved, actual) => {
      calls.push({ kind: "settle", dimension: "usd", amount: reserved, actual });
    },
    calls,
  };
  return ledger;
}

const EVIDENCE: ConsolidateEvidence[] = [
  { title: "Official notice", snippet: "Support hours changed to 24x7 on 2026-11-01.", url: "https://a.example/notice" },
];

// --- verify: the correction-relationship check -----------------------------

{
  const session = fakeSession({
    text: '{"alreadyCurrent": false, "sameFact": true, "reliable": true, "relation": "correction", "reason": "official notice, same subject"}',
    usage: { input: 400, output: 60, totalTokens: 460 },
  });
  const seams = createConsolidationSeams(session);
  const verdict = await seams.verify({ oldContent: "Support runs weekdays 9-17.", summary: "Support is 24x7.", evidence: EVIDENCE });
  assert(verdict.sameFact === true && verdict.reliable === true, "verify: parses the checker's affirmative verdict");
  assert(verdict.relation === "correction", "verify: parses the relation");
  assert(verdict.reason === "official notice, same subject", "verify: parses the reason");
  assert(seams.usage.calls === 1 && seams.usage.inputTokens === 400 && seams.usage.totalTokens === 460,
    "verify: the check call is accounted in the seam's usage ledger");
}

{
  // A reply that is not JSON refuses the correction (conservative default).
  const session = fakeSession({ text: "I think it is probably fine, maybe." });
  const seams = createConsolidationSeams(session);
  const verdict = await seams.verify({ oldContent: "old", summary: "new", evidence: EVIDENCE });
  assert(verdict.sameFact === false && verdict.reliable === false,
    "verify: unparseable reply refuses (sameFact/reliable false)");
  assert(typeof verdict.reason === "string" && verdict.reason.includes("no JSON"),
    "verify: the refusal reason names the unparseable reply");
}

{
  // JSON wrapped in prose still parses (models often add a sentence).
  const session = fakeSession({ text: 'Here you go: {"alreadyCurrent": false, "sameFact": false, "reliable": true, "relation": "different", "reason": "different subject"} hope that helps' });
  const seams = createConsolidationSeams(session);
  const verdict = await seams.verify({ oldContent: "old", summary: "new", evidence: EVIDENCE });
  assert(verdict.sameFact === false && verdict.relation === "different",
    "verify: JSON embedded in prose is still parsed");
}

// --- verifyFinal: the final-content check -----------------------------------

{
  const session = fakeSession({
    text: '{"supported": true, "preserved": true, "reason": "all facts kept"}',
    usage: { input: 500, output: 40, totalTokens: 540 },
  });
  const seams = createConsolidationSeams(session);
  const verdict = await seams.verifyFinal({ oldContent: "old", finalContent: "merged", correctedContent: "new", evidence: EVIDENCE });
  assert(verdict.supported === true && verdict.preserved === true, "verifyFinal: parses an affirmative verdict");
  assert(seams.usage.calls === 1 && seams.usage.totalTokens === 540,
    "verifyFinal: the check call is accounted in the seam's usage ledger");
}

{
  const session = fakeSession({ text: "" }); // empty stream (e.g. a failed call)
  const seams = createConsolidationSeams(session);
  const verdict = await seams.verifyFinal({ oldContent: "old", finalContent: "merged", correctedContent: "new", evidence: EVIDENCE });
  assert(verdict.supported === false && verdict.preserved === false,
    "verifyFinal: an empty reply withholds the replacement (conservative default)");
}

// --- both checks are metered like summarize ---------------------------------

{
  const session = fakeSession({
    text: '{"sameFact": true, "reliable": true, "relation": "correction"}',
    usage: { input: 300, output: 30, totalTokens: 330 },
  });
  const ledger = recordingLedger({ rejectCall: true });
  const seams = createConsolidationSeams(session, { budget: { sessionId: "s", ledger } });
  let refused = false;
  try {
    await seams.verify({ oldContent: "old", summary: "new", evidence: EVIDENCE });
  } catch (e) {
    refused = isConsolidationBudgetError(e);
  }
  assert(refused, "verify: a budget refusal surfaces as the typed consolidation budget error");

  let refusedFinal = false;
  try {
    await seams.verifyFinal({ oldContent: "old", finalContent: "merged", correctedContent: "new", evidence: EVIDENCE });
  } catch (e) {
    refusedFinal = isConsolidationBudgetError(e);
  }
  assert(refusedFinal, "verifyFinal: a budget refusal surfaces as the typed consolidation budget error");
}

{
  const session = fakeSession({
    text: '{"sameFact": true, "reliable": true, "relation": "correction"}',
    usage: { input: 300, output: 30, totalTokens: 330 },
  });
  const ledger = recordingLedger();
  const seams = createConsolidationSeams(session, { budget: { sessionId: "s", ledger } });
  await seams.verify({ oldContent: "old", summary: "new", evidence: EVIDENCE });
  await seams.verifyFinal({ oldContent: "old", finalContent: "merged", correctedContent: "new", evidence: EVIDENCE });
  const reserves = ledger.calls.filter((c) => c.kind === "reserve" && c.dimension === "call");
  assert(reserves.length === 2, "metering: both check calls reserve against the session budget");
  const settles = ledger.calls.filter((c) => c.kind === "settle" && c.dimension === "call");
  assert(settles.length === 2, "metering: both check calls settle their reservation");
}

console.log("consolidation-correction-seams: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
