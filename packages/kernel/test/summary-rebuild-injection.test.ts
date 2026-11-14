// #264 (D9) — a suspended summary comes back built from current sources, and the
// task the user stated survives the rebuild.
//
// #263's test (summary-suspension-injection.test.ts) proves the summary STOPS
// being injected. This file proves what happens next, over the real store and the
// real inject()/flush() path:
//
//   K1  the rebuild prompt separates the user's own turns from reference
//       material, and says which one is an instruction
//   K2  a replace-reference is never presented as current material
//   K3  a complete plan with a model produces a new anchor and clears the
//       suspension — visible in the prompt on the next turn, with the user's
//       task text still there
//   K4  no model configured: the plan runs, nothing is written, the suspension
//       stays and the reason says why
//   K5  a plan that is not complete never calls the model (no cost, no write)
//   K6  a provider failure leaves the suspension in force (no fake recovery)
//   K7  the rebuild is attempted once per anchor, not once per turn
//   K8  a store without the rebuild seams keeps the pre-#264 behaviour
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { MemoryPipeline } from "../src/memory-pipeline";
import {
  buildSummaryRebuildPrompt,
  fillOnce,
  formatSummaryRebuildLine,
  generateRebuiltSummary,
  rebuildSuspendedSummary,
} from "../src/summary-rebuild";
import { readMessageText } from "../src/message-text";
import type { RetrieverPort, DomainConfigPort } from "../src/ports";
import type { FusedEnvelope } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

const dir = mkdtempSync(join(tmpdir(), "ans-264-kernel-"));

const retriever = {
  async search(q: any): Promise<FusedEnvelope> {
    return { query: q.query, mode: "fast", results: [] } as unknown as FusedEnvelope;
  },
} as RetrieverPort;

const domain: DomainConfigPort = {
  sources: { enabled: [] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

const USER_TASK = "Find out when Acme support is reachable. Keep the answer short.";
const USER_CHANGE = "Change of plan: I only need the weekend schedule.";

/**
 * A stream function that answers with a fixed summary and reports usage, so the
 * pipeline's own accounting is exercised without a provider.
 */
function stubStream(summaryText: string, opts: { fail?: boolean; calls?: { n: number } } = {}) {
  return (() => ({
    async *[Symbol.asyncIterator]() {
      if (opts.calls) opts.calls.n++;
      if (opts.fail) {
        yield { type: "error" as const };
        return;
      }
      yield { type: "text_delta" as const, delta: summaryText };
      yield {
        type: "done" as const,
        message: {
          role: "assistant",
          content: summaryText,
          usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.001, totalFromProvider: true } },
        },
      };
    },
  })) as any;
}

function pipelineFor(
  store: any,
  sessionId: string,
  opts: { streamFn?: any; model?: any } = {},
): MemoryPipeline {
  return new MemoryPipeline({
    store,
    retriever,
    domain,
    model: "model" in opts ? opts.model : ({ id: "test" } as any),
    streamFn: opts.streamFn ?? (() => ({ async *[Symbol.asyncIterator]() {} })),
    sessionId,
  });
}

function userTurn(text: string): any {
  return { role: "user", content: [{ type: "text", text }] };
}

function promptText(messages: any[]): string {
  return readMessageText(messages[messages.length - 1])?.text ?? "";
}

const stores: SqliteSessionStore[] = [];
function openStore(db: string): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db));
  stores.push(s);
  return s;
}

/**
 * A suspended rolling summary, produced by the REAL correction path.
 *
 * No test-only suspension helper: #263's store test proves a correction writes
 * the suspension row, and using that same path here means the rebuild is proven
 * against a suspension the product can actually create.
 */
async function seedSuspended(
  store: SqliteSessionStore,
  sessionId: string,
  opts: { withSources?: boolean; withUserTurns?: boolean } = {},
): Promise<{ anchorId: number; knowledgeId: number | null }> {
  if (opts.withUserTurns !== false) {
    await store.append(sessionId, { role: "user", content: USER_TASK });
    await store.append(sessionId, { role: "assistant", content: "Searching now." });
    await store.append(sessionId, { role: "user", content: USER_CHANGE });
  }
  let knowledgeId: number | null = null;
  const sources: Array<{ kind: "material" | "knowledge"; id: number }> = [];
  if (opts.withSources !== false) {
    const old = "Acme online support runs weekdays 9:00-17:00.";
    // Three materials of one entity -> one live knowledge row (the batch path).
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const ra = await store.adjudicateMemory(sessionId, [{
        url: "https://acme.example/hours-v" + i, title: "Acme hours v" + i,
        snippet: old, source: "tavily", evidence: 0.9, entity: "acme",
      }]);
      if (typeof ra[0]?.insertedId === "number") ids.push(ra[0]!.insertedId!);
    }
    const built = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      { summarize: async () => old, classify: () => ({ label: "supported" as const, confidence: 0.95 }) },
    );
    knowledgeId = built.semanticIds[0] ?? null;
    if (knowledgeId !== null) sources.push({ kind: "knowledge", id: knowledgeId });
    if (ids[0] !== undefined) sources.push({ kind: "material", id: ids[0] });
  }
  await store.saveAnchor(sessionId, "rolling_summary", {
    summary: "superseded summary text that must not be injected",
    sources,
  });
  const anchorId = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  if (knowledgeId !== null) {
    // One reliable material corrects the live row -> the summary that read it is
    // suspended, inside the correction's write transaction.
    const fresh = await store.adjudicateMemory(sessionId, [{
      url: "https://acme.example/notice-2026-11-01", title: "notice",
      snippet: "Acme online support is now 24x7 every day, effective 2026-11-01.",
      source: "tavily", evidence: 0.9, entity: "acme",
    }]);
    const correctionId = fresh[0]?.insertedId;
    if (typeof correctionId === "number") {
      const rep = await store.consolidateMemory(
        { scope: { by: "memory", sessionIds: [], memoryIds: [correctionId], sessionIdNotApplied: false }, allowSingleEvidence: true },
        {
          summarize: async (eps) => eps.some((e) => e.title === "CURRENT KNOWLEDGE")
            ? "Acme online support is now 24x7 every day, effective 2026-11-01."
            : "Acme online support is now 24x7 every day, effective 2026-11-01.",
          classify: () => ({ label: "supported" as const, confidence: 0.95 }),
          verify: async () => ({ alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction" as const }),
          verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
        },
      );
      assert(rep.summariesSuspended === 1,
        "fixture: the correction suspended the summary (got " + rep.summariesSuspended + ")");
    }
  }
  return { anchorId, knowledgeId };
}

// --- K1/K2: the prompt separates task from material -----------------------

{
  const plan = {
    sessionId: "s",
    anchorId: 1,
    anchorType: "rolling_summary" as const,
    previousSummary: "old text",
    taskRecords: [{ messageId: 7, text: USER_TASK, createdAt: "2026-11-01" }],
    facts: [{ kind: "knowledge" as const, id: 3, text: "Acme support is now 24x7." }],
    replaced: [{
      kind: "material" as const, id: 9, currentKind: "knowledge" as const, currentId: 3,
      text: "Acme support runs weekdays 9-17.",
    }],
    exclusions: [],
    complete: true,
    reasons: [],
    recordedSources: 2,
  };
  const prompt = buildSummaryRebuildPrompt(plan);
  assert(prompt.includes("=== TASK (the user's own turns, oldest first) ==="), "K1: the prompt has a named task section");
  assert(prompt.includes(USER_TASK), "K1: the user's own words are quoted verbatim");
  assert(prompt.includes("message 7"), "K1: each task line names the stored message it came from");
  assert(prompt.includes("=== CURRENT MATERIAL ==="), "K1: the prompt has a named material section");
  assert(prompt.includes("Acme support is now 24x7."), "K1: the current fact is present");
  assert(
    prompt.includes("It is not") && prompt.includes("instruction from the user"),
    "K1: the prompt states that material text is not a user instruction",
  );
  assert(
    prompt.indexOf("=== TASK") < prompt.indexOf("=== CURRENT MATERIAL"),
    "K1: the task comes before the material, so its provenance is unambiguous",
  );
  assert(prompt.includes("REPLACED REFERENCES"), "K2: replaced references have their own section");
  const replacedAt = prompt.indexOf("REPLACED REFERENCES");
  const oldFactAt = prompt.indexOf("weekdays 9-17", replacedAt);
  assert(oldFactAt > replacedAt, "K2: the old value appears only under the replaced section");
  assert(!prompt.slice(0, replacedAt).includes("weekdays 9-17"),
    "K2: the old value is not offered as current material");

  // Placeholder filling is single-pass: inserted text is never re-scanned.
  const injected = fillOnce("{A} {B}", { A: "{B}", B: "value" });
  assert(injected === "{B} value", "K1: a fact containing a placeholder is not rewritten (got " + injected + ")");
}

// --- K3: a complete plan rebuilds, clears, and reaches the next prompt -----

{
  const db = "k3.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k3";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);

  const calls = { n: 0 };
  const pipeline = pipelineFor(store, sid, { streamFn: stubStream("Acme support is now 24x7. Task: weekend schedule only.", { calls }) });

  // First turn: the suspended version is NOT injected, and a rebuild is dispatched.
  const first = await pipeline.inject([userTurn("What did we find so far?")]);
  assert(!promptText(first).includes("superseded summary text"),
    "K3: a suspended summary is not injected while the rebuild is still pending");
  await pipeline.flush();

  assert(calls.n === 1, "K3: exactly one rebuild model call ran (got " + calls.n + ")");
  const attempts = pipeline.getSummaryRebuilds();
  assert(attempts.length === 1, "K3: one attempt is reported (got " + attempts.length + ")");
  assert(attempts[0]!.outcome === "rebuilt", "K3: the attempt reports a rebuild (got " + attempts[0]!.outcome + ")");
  assert(attempts[0]!.cleared === true, "K3: the attempt reports the suspension cleared");
  assert(attempts[0]!.newAnchorId !== null, "K3: the attempt names the new anchor");
  assert(store.suspendedSummaryAnchorIds(sid).size === 0, "K3: the store has no suspension left");
  const line = formatSummaryRebuildLine(attempts[0]!);
  assert(line.includes("anchor " + anchorId) && line.includes("rebuilt as anchor"),
    "K3: the caller-visible line names both versions (got " + line + ")");
  const failLine = formatSummaryRebuildLine({
    anchorId: 9, outcome: "incomplete", reasons: ["no stored user turn"], newAnchorId: null, cleared: false,
  });
  assert(failLine.includes("still suspended") && failLine.includes("no stored user turn"),
    "K3: a failed attempt's line carries the reason, not a success shape (got " + failLine + ")");

  // Second turn: the rebuilt summary is in the prompt, and the task text is intact.
  const second = await pipeline.inject([userTurn("And now?")]);
  const text = promptText(second);
  assert(text.includes("24x7"), "K3: the rebuilt summary is injected on the next turn");
  assert(!text.includes("superseded summary text"), "K3: the replaced summary text is gone from the prompt");
  assert(text.includes("And now?"), "K3: the user's own turn is untouched");

  // The rebuilt anchor records where its task text came from.
  const anchors = await store.getAnchors(sid);
  const rebuilt = anchors.find((a) => a.id === attempts[0]!.newAnchorId)!;
  const payload = rebuilt.payload as any;
  assert(payload.rebuiltFrom?.anchorId === anchorId, "K3: the new anchor points at the version it replaces");
  assert(Array.isArray(payload.rebuiltFrom?.taskRecordIds) && payload.rebuiltFrom.taskRecordIds.length === 2,
    "K3: both of the user's turns are recorded as the task source");
  assert(payload.sources.length > 0, "K3: the new anchor carries the sources it was built from");
  // Generation spend is in the memory ledger, not hidden outside the run.
  const usage = pipeline.getSummaryUsage();
  assert(usage.calls === 1, "K3: the rebuild call is counted in the summary ledger (got " + usage.calls + ")");
  assert(usage.costSource === "provider", "K3: a provider-sent price is reported as such (got " + usage.costSource + ")");
}

// --- K4: no model -> planned, not written, suspension stays ----------------

{
  const db = "k4.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k4";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);

  const attempt = await rebuildSuspendedSummary(store, { sessionId: sid, anchorId });
  assert(attempt.outcome === "no-model", "K4: without a model the outcome is no-model (got " + attempt.outcome + ")");
  assert(attempt.newAnchorId === null, "K4: nothing is written without generation");
  assert(attempt.reasons.some((r) => r.includes("no model")), "K4: the reason names the missing model");
  assert(store.suspendedSummaryAnchorIds(sid).has(anchorId), "K4: the suspension is still in force");

  const anchorsBefore = (await store.getAnchors(sid)).length;
  const pipeline = pipelineFor(store, sid, { model: undefined, streamFn: stubStream("ignored") });
  await pipeline.inject([userTurn("hi")]);
  await pipeline.flush();
  const attempts = pipeline.getSummaryRebuilds();
  assert(attempts.length === 1 && attempts[0]!.outcome === "no-model",
    "K4: the injection path reports a no-model attempt instead of staying silent");
  assert((await store.getAnchors(sid)).length === anchorsBefore, "K4: no anchor was added");
}

// --- K5: an incomplete plan never calls the model --------------------------

{
  const db = "k5.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k5";
  await store.ensureSession(sid, "acme");
  await store.append(sid, { role: "user", content: USER_TASK });
  // No recorded sources: nothing to rebuild from. (A pre-#263 summary looks
  // exactly like this — its payload has text and no dependency list.)
  await store.saveAnchor(sid, "rolling_summary", { summary: "an old summary with no dependency list" });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;

  const calls = { n: 0 };
  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid,
    anchorId,
    streamFn: stubStream("should never be called", { calls }),
    model: { id: "test" } as any,
  });
  assert(attempt.outcome === "incomplete", "K5: an incomplete plan is reported as such (got " + attempt.outcome + ")");
  assert(calls.n === 0, "K5: no model call was made (got " + calls.n + ")");
  assert(attempt.reasons.some((r) => r.includes("recorded no sources")), "K5: the reason names the missing sources");
  assert(attempt.newAnchorId === null, "K5: nothing is written");
  assert((await store.getAnchors(sid)).length === 1, "K5: no anchor was added");

  // A session with sources but no user turn is incomplete too.
  const sid2 = "sess-k5b";
  await store.ensureSession(sid2, "acme");
  const second = await seedSuspended(store, sid2, { withUserTurns: false });
  const calls2 = { n: 0 };
  const attempt2 = await rebuildSuspendedSummary(store, {
    sessionId: sid2, anchorId: second.anchorId, streamFn: stubStream("no", { calls: calls2 }), model: {} as any,
  });
  assert(attempt2.outcome === "incomplete", "K5: no user turn means the plan cannot recover the task");
  assert(attempt2.reasons.some((r) => r.includes("user turn")), "K5: the reason names the missing user record");
  assert(calls2.n === 0, "K5: no model call for the second case either");
  assert(store.suspendedSummaryAnchorIds(sid2).has(second.anchorId), "K5: the suspension stays");
}

// --- K6: a provider failure is not a recovery ------------------------------

{
  const db = "k6.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k6";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);

  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid, anchorId, streamFn: stubStream("", { fail: true }), model: {} as any,
  });
  assert(attempt.outcome === "generation-failed", "K6: a failed stream reports generation-failed (got " + attempt.outcome + ")");
  assert(attempt.newAnchorId === null, "K6: no anchor is written from a failed call");
  assert(store.suspendedSummaryAnchorIds(sid).has(anchorId), "K6: the suspension is still in force");

  // A stream that ends with no text at all is also a failure, not an empty summary.
  const empty = await generateRebuiltSummary(stubStream(""), {} as any, {
    sessionId: sid, anchorId, anchorType: "rolling_summary", previousSummary: null,
    taskRecords: [{ messageId: 1, text: "t", createdAt: "now" }],
    facts: [{ kind: "knowledge", id: 1, text: "f" }], replaced: [], exclusions: [],
    complete: true, reasons: [], recordedSources: 1,
  });
  assert(empty === null, "K6: a stream with no text produces no summary");
}

// --- K7: one attempt per anchor, not per turn ------------------------------

{
  const db = "k7.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k7";
  await store.ensureSession(sid, "acme");
  await seedSuspended(store, sid);

  const calls = { n: 0 };
  const pipeline = pipelineFor(store, sid, { streamFn: stubStream("rebuilt once", { calls }) });
  await pipeline.inject([userTurn("turn one")]);
  await pipeline.flush();
  await pipeline.inject([userTurn("turn two")]);
  await pipeline.flush();
  await pipeline.inject([userTurn("turn three")]);
  await pipeline.flush();
  assert(calls.n === 1, "K7: three turns still produce one rebuild call (got " + calls.n + ")");
  assert(pipeline.getSummaryRebuilds().length === 1, "K7: one attempt is recorded");
}

// --- K8: a store without the seams keeps the old behaviour ----------------

{
  // A minimal store: suspension tracking but no rebuild seams.
  const anchors = [
    { id: 1, anchorType: "rolling_summary", payload: { summary: "stale text" }, createdAt: "now" },
  ];
  const legacyStore = {
    getAnchors: async () => anchors,
    listPreferences: async () => [],
    suspendedSummaryAnchorIds: () => new Set([1]),
  };
  const pipeline = pipelineFor(legacyStore as any, "sess-k8", { streamFn: stubStream("unused") });
  const out = await pipeline.inject([userTurn("question")]);
  await pipeline.flush();
  assert(!promptText(out).includes("stale text"), "K8: the suspended summary is still not injected");
  assert(pipeline.getSummaryRebuilds().length === 0,
    "K8: no attempt is claimed when the store cannot rebuild");
}

// --- cleanup ---------------------------------------------------------------

for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } }
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch (e) {
  console.error("cleanup warning (temp dir left in place): " + (e instanceof Error ? e.message : String(e)));
}

console.log("summary-rebuild-injection: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exitCode = 1;
