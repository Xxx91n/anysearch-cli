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
  previousSummaryFitsPrompt,
  rebuildSuspendedSummary,
  PREVIOUS_SUMMARY_PROMPT_MAX_CHARS,
  SUMMARY_INJECT_MAX_CHARS,
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
    // Three writes of one entity key -> one live knowledge row (the batch path).
    // The earlier rows are closed by supersede, so only the last stays current.
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
    // Only the LAST material of an entity key stays live: writing the next one of
    // the same key closes the previous (temporal supersede). Citing an earlier id
    // would pin a row the store already retired, which the rebuild then refuses.
    const survivor = ids[ids.length - 1];
    if (survivor !== undefined) sources.push({ kind: "material", id: survivor });
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

  // The suspended version's own text is offered as context, clearly marked as
  // not evidence, so a fact no source recorded but no correction touched is not
  // silently dropped (D8).
  assert(prompt.includes("=== PREVIOUS SUMMARY (suspended; not evidence) ==="),
    "K2: the previous summary has its own section");
  assert(prompt.includes("old text"), "K2: the previous summary text is present");
  assert(prompt.includes("Do not treat it as evidence"),
    "K2: the prompt says the previous summary is not evidence");

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
  // The answer restates the current knowledge row and keeps the user's task,
  // which is what a working rebuild actually produces.
  const rebuiltText =
    "Acme online support is now 24x7 every day, effective 2026-11-01. " +
    "Task: weekend schedule only.";
  const pipeline = pipelineFor(store, sid, { streamFn: stubStream(rebuiltText, { calls }) });

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
  // Two STORED turns (message ids) plus the live turn of this run, whose id is 0
  // because the runtime has not persisted it yet. All three must be quoted: the
  // live one carries this turn's change, the stored ones carry the original ask.
  assert(Array.isArray(payload.rebuiltFrom?.taskRecordIds) && payload.rebuiltFrom.taskRecordIds.length === 3,
    "K3: both stored turns and this run's live turn are recorded (got " +
      (payload.rebuiltFrom?.taskRecordIds?.length ?? "none") + ")");
  assert(payload.rebuiltFrom.taskRecordIds.slice(0, 2).every((id: number) => id > 0),
    "K3: the stored turns keep their message ids");
  assert(payload.rebuiltFrom.taskRecordIds[2] === 0,
    "K3: the live turn is recorded with id 0 (not stored yet) rather than a fake id");
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
  assert(empty.text === "", "K6: a stream with no text produces no summary text");
}

// --- K9: the api key reaches the generation call -----------------------------
//
// Without it, a key configured outside ANS_LLM_API_KEY fails auth and EVERY
// rebuild reports generation-failed for a reason the caller cannot see.
{
  const db = "k9.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k9";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);

  let seenOptions: any = null;
  const capturingStream = ((_model: any, _ctx: any, options: any) => {
    seenOptions = options;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta" as const, delta: "Acme online support is now 24x7 every day, effective 2026-11-01." };
        yield { type: "done" as const, message: { role: "assistant", content: "", usage: { input: 5, output: 5, totalTokens: 10 } } };
      },
    };
  }) as any;

  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid, anchorId, streamFn: capturingStream, model: {} as any, apiKey: "sk-test-key",
  });
  assert(seenOptions?.apiKey === "sk-test-key", "K9: the generation call carries the api key");
  assert(attempt.outcome === "rebuilt", "K9: the call with a key succeeds (got " + attempt.outcome + ")");
}

// --- K10: an over-long suspended summary is refused, not truncated ----------
//
// The previous version is carried into the prompt as context (so a fact no source
// recorded but no correction touched survives). When it does not fit the prompt
// budget, the attempt is INCOMPLETE: cutting it and reporting a full rebuild is
// exactly what the ticket forbids.
{
  const db = "k10.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k10";
  await store.ensureSession(sid, "acme");
  await store.append(sid, { role: "user", content: USER_TASK });
  const ra = await store.adjudicateMemory(sid, [{
    url: "https://acme.example/long", title: "long", snippet: "Acme support runs weekdays 9-17.",
    source: "tavily", evidence: 0.9, entity: "acme",
  }]);
  const materialId = ra[0]?.insertedId ?? 1;
  await store.saveAnchor(sid, "rolling_summary", {
    summary: "x".repeat(PREVIOUS_SUMMARY_PROMPT_MAX_CHARS + 1),
    sources: [{ kind: "material", id: materialId }],
  });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  const before = (await store.getAnchors(sid)).length;

  const calls = { n: 0 };
  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid, anchorId, streamFn: stubStream("anything", { calls }), model: {} as any,
  });
  assert(attempt.outcome === "incomplete",
    "K10: an over-long suspended summary leaves the plan incomplete (got " + attempt.outcome + ")");
  assert(attempt.reasons.some((r) => r.includes("prompt budget")),
    "K10: the reason names the prompt budget");
  assert(calls.n === 0, "K10: no model call is spent on a rebuild that cannot fit");
  assert(attempt.newAnchorId === null && (await store.getAnchors(sid)).length === before,
    "K10: nothing is written");

  // A version that fits is carried over and used.
  assert(previousSummaryFitsPrompt("short summary"), "K10: a short previous summary fits");
  assert(!previousSummaryFitsPrompt("x".repeat(PREVIOUS_SUMMARY_PROMPT_MAX_CHARS + 1)),
    "K10: an over-long one does not fit");
}

// --- K11: a summary that was never suspended is not rebuilt on a guess ------
//
// `suspendedSummaryAnchorIds` throwing sets `suspensionUnknown`, which means the
// summary is only ASSUMED suspended. Rebuilding on that assumption would spend a
// model call and add an anchor for a summary that may be perfectly current.
{
  const db = "k11.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k11";
  await store.ensureSession(sid, "acme");
  await store.append(sid, { role: "user", content: USER_TASK });
  const ra = await store.adjudicateMemory(sid, [{
    url: "https://acme.example/x", title: "x", snippet: "Acme support runs weekdays 9-17.", source: "tavily", evidence: 0.9, entity: "acme",
  }]);
  const materialId = ra[0]?.insertedId ?? 1;
  await store.saveAnchor(sid, "rolling_summary", {
    summary: "a perfectly current summary", sources: [{ kind: "material", id: materialId }],
  });
  const before = (await store.getAnchors(sid)).length;
  const calls = { n: 0 };

  // Same real store, but its suspension read throws — the "state is unknown" path.
  const broken = Object.create(store) as any;
  broken.suspendedSummaryAnchorIds = () => { throw new Error("suspension read failed"); };
  const pipeline = pipelineFor(broken, sid, { streamFn: stubStream("should not run", { calls }) });
  const out = await pipeline.inject([userTurn("question")]);
  await pipeline.flush();
  assert(!promptText(out).includes("a perfectly current summary"),
    "K11: an unknown suspension state still suppresses the block");
  assert(calls.n === 0, "K11: no rebuild is attempted on a guess (got " + calls.n + " model calls)");
  assert(pipeline.getSummaryRebuilds().length === 0, "K11: no attempt is claimed");
  assert((await store.getAnchors(sid)).length === before, "K11: no anchor was added");
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

// --- K12: a clear with nothing to clear is reported as current, not as failure --
//
// The summary that was written IS current and injectable; only the clearing act
// did not happen (another writer had already cleared the row). Calling that
// "still suspended" hides a working summary, and calling it "rebuilt" claims a
// clear that did not happen here.
{
  const db = "k12.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k12";
  await store.ensureSession(sid, "acme");
  await store.append(sid, { role: "user", content: USER_TASK });
  const ra = await store.adjudicateMemory(sid, [{
    url: "https://acme.example/k12", title: "k12", snippet: "Acme support runs weekdays 9-17.",
    source: "tavily", evidence: 0.9, entity: "acme",
  }]);
  const materialId = ra[0]?.insertedId ?? 1;
  await store.saveAnchor(sid, "rolling_summary", {
    summary: "Acme support runs weekdays 9-17.", sources: [{ kind: "material", id: materialId }],
  });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;

  // Never suspended in this fixture, so there is no open row to clear.
  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid,
    anchorId,
    streamFn: stubStream("Acme support runs weekdays 9-17, Monday through Friday."),
    model: {} as any,
  });
  assert(attempt.outcome === "already-current",
    "K12: a written, current version reports already-current (got " + attempt.outcome + ")");
  assert(attempt.cleared === false, "K12: cleared stays false — this call did not clear anything");
  assert(attempt.newAnchorId !== null, "K12: the new anchor is named");
  const line = formatSummaryRebuildLine(attempt);
  assert(line.includes("is current and injectable") && !line.includes("still suspended"),
    "K12: the line says the version is current, not that it is still suspended (got " + line + ")");
}

// --- K13: a suspended recall snippet is explained, not silently absent ------
//
// l2_recall is not rebuilt (a recall snippet belongs to the query that produced
// it). Leaving it out with no word reads as "this session never recalled
// anything"; the ticket requires a limit be stated instead of hidden.
{
  const db = "k13.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k13";
  await store.ensureSession(sid, "acme");
  await store.append(sid, { role: "user", content: USER_TASK });

  // A live knowledge row built from three materials, plus a recall block that
  // read one of them. The real correction then suspends BOTH: the rolling
  // summary (rebuilt) and the recall block (reported, never rebuilt).
  const old = "Acme online support runs weekdays 9:00-17:00.";
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const ra = await store.adjudicateMemory(sid, [{
      url: "https://acme.example/k13-v" + i, title: "k13 v" + i, snippet: old,
      source: "tavily", evidence: 0.9, entity: "acme-k13",
    }]);
    if (typeof ra[0]?.insertedId === "number") ids.push(ra[0]!.insertedId!);
  }
  const built = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
    { summarize: async () => old, classify: () => ({ label: "supported" as const, confidence: 0.95 }) },
  );
  const knowledgeId = built.semanticIds[0]!;
  await store.saveAnchor(sid, "l2_recall", {
    query: "acme hours", hits: old, sources: [{ kind: "knowledge", id: knowledgeId }],
  });
  const recallAnchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "l2_recall").pop()!.id;

  const fresh = await store.adjudicateMemory(sid, [{
    url: "https://acme.example/k13-notice", title: "notice",
    snippet: "Acme online support is now 24x7 every day, effective 2026-11-01.",
    source: "tavily", evidence: 0.9, entity: "acme-k13",
  }]);
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [fresh[0]!.insertedId!], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async () => "Acme online support is now 24x7 every day, effective 2026-11-01.",
      classify: () => ({ label: "supported" as const, confidence: 0.95 }),
      verify: async () => ({ alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction" as const }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "K13 fixture: the correction landed (update=" + rep.update + ")");
  assert(store.suspendedSummaryAnchorIds(sid).has(recallAnchorId),
    "K13 fixture: the recall block is suspended by the correction");

  const calls = { n: 0 };
  const pipeline = pipelineFor(store, sid, { streamFn: stubStream("should not run", { calls }) });
  await pipeline.inject([userTurn("question")]);
  await pipeline.flush();

  const attempts = pipeline.getSummaryRebuilds().filter((a) => a.anchorId === recallAnchorId);
  assert(attempts.length === 1,
    "K13: the suspended recall anchor is reported (got " + attempts.length + " entries)");
  assert(attempts[0]!.outcome === "incomplete",
    "K13: it is reported as not rebuilt, not as a recovery (got " + attempts[0]!.outcome + ")");
  assert(attempts[0]!.reasons.some((r) => r.includes("research-recall snippet")),
    "K13: the reason says why a recall snippet is not rebuilt");
  assert(attempts[0]!.newAnchorId === null, "K13: no anchor is written for a recall snippet");
}

// --- K14: a cut-off answer is not a summary --------------------------------
//
// pi-ai reports output truncation on the `done` event as `reason: "length"`, not
// as an `error`. Treating it as success committed half an answer and cleared the
// suspension — the replaced fact would then come back as a "rebuilt" summary.
{
  const lengthStream = (() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "text_delta" as const, delta: "Acme support is now 24x7 but the hours" };
      yield {
        type: "done" as const,
        reason: "length",
        message: { role: "assistant", content: "", usage: { input: 10, output: 5, totalTokens: 15 } },
      };
    },
  })) as any;

  const out = await generateRebuiltSummary(lengthStream, {} as any, {
    sessionId: "s", anchorId: 1, anchorType: "rolling_summary", previousSummary: null,
    taskRecords: [{ messageId: 1, text: "t", createdAt: "now" }],
    facts: [{ kind: "knowledge", id: 1, text: "f" }], replaced: [], exclusions: [],
    complete: true, reasons: [], recordedSources: 1,
  });
  assert(out.text === "", "K14: a `length` stop yields no summary text");
  assert(out.truncated === true, "K14: the result says it was truncated");
  assert(!!out.usage, "K14: the call's usage is still reported (it was billed)");

  // A normal stop is fine.
  const okStream = (() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "text_delta" as const, delta: "a complete summary" };
      yield { type: "done" as const, reason: "stop", message: { role: "assistant", content: "" } };
    },
  })) as any;
  const ok = await generateRebuiltSummary(okStream, {} as any, {
    sessionId: "s", anchorId: 1, anchorType: "rolling_summary", previousSummary: null,
    taskRecords: [{ messageId: 1, text: "t", createdAt: "now" }],
    facts: [{ kind: "knowledge", id: 1, text: "f" }], replaced: [], exclusions: [],
    complete: true, reasons: [], recordedSources: 1,
  });
  assert(ok.text === "a complete summary" && ok.truncated !== true,
    "K14: a `stop` reason produces a usable summary");

  // A stream that just ends, with no terminal event at all, is a fragment.
  const unterminated = (() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "text_delta" as const, delta: "half an answer" };
    },
  })) as any;
  const frag = await generateRebuiltSummary(unterminated, {} as any, {
    sessionId: "s", anchorId: 1, anchorType: "rolling_summary", previousSummary: null,
    taskRecords: [{ messageId: 1, text: "t", createdAt: "now" }],
    facts: [{ kind: "knowledge", id: 1, text: "f" }], replaced: [], exclusions: [],
    complete: true, reasons: [], recordedSources: 1,
  });
  assert(frag.text === "" && frag.truncated === true,
    "K14: a stream with no terminal event is treated as truncated");
}

// --- K15: an answer longer than the injection slot is refused --------------
//
// `inject` renders only the first SUMMARY_INJECT_MAX_CHARS. A longer summary would
// be reported as rebuilt while its tail — possibly the user's latest change —
// never reached the model.
{
  const db = "k15.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k15";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);
  const before = (await store.getAnchors(sid)).length;

  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid,
    anchorId,
    streamFn: stubStream("Acme support is now 24x7. " + "x".repeat(SUMMARY_INJECT_MAX_CHARS)),
    model: {} as any,
  });
  assert(attempt.outcome === "generation-failed",
    "K15: an over-long answer is refused (got " + attempt.outcome + ")");
  assert(attempt.reasons.some((r) => r.includes("injection limit")),
    "K15: the reason names the injection limit");
  assert(attempt.newAnchorId === null, "K15: nothing is written");
  assert((await store.getAnchors(sid)).length === before, "K15: no anchor was added");
  assert(store.suspendedSummaryAnchorIds(sid).has(anchorId), "K15: the suspension stays");
}

// --- K16: a newer summary written during the rebuild is not replaced -------
//
// The store refuses the write; the kernel must report it as a refusal (not a
// success and not a crash), and the newer version must stay the newest.
{
  const db = "k16.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "sess-k16";
  await store.ensureSession(sid, "acme");
  const { anchorId } = await seedSuspended(store, sid);

  // A normal compression lands a newer summary before the rebuild commits.
  await store.saveAnchor(sid, "rolling_summary", {
    summary: "a newer summary written during the rebuild", sources: [],
  });
  const newerId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;

  const attempt = await rebuildSuspendedSummary(store, {
    sessionId: sid, anchorId, streamFn: stubStream("a rebuild of the older version"), model: {} as any,
  });
  assert(attempt.outcome === "rejected-write",
    "K16: the write is reported as refused (got " + attempt.outcome + ")");
  assert(attempt.newAnchorId === null, "K16: nothing is inserted");
  assert(attempt.reasons.some((r) => r.includes("newer summary")),
    "K16: the reason explains why");
  const anchors = await store.getAnchors(sid);
  const newest = anchors.filter((a) => a.anchorType === "rolling_summary").pop()!;
  assert(newest.id === newerId, "K16: the newer summary stays the newest");
  assert((newest.payload as any).summary.includes("newer summary written during"),
    "K16: its text is unchanged");
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
