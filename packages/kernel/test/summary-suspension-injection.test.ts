// #263 — a suspended summary stops reaching the model.
//
// The store test proves the bookkeeping (dependency rows + suspension rows).
// This file proves the part the ticket actually asks for: the PROMPT a turn
// builds no longer carries the summary a correction made stale, while an
// unrelated summary still arrives. It reads the same `inject()` output the
// runtime hands to the model, over the REAL store, so the assertion is about
// prompt content and not about a status field.
//
// Every suspension here comes from the REAL correction path (a single reliable
// material correcting a live knowledge row, with the checker seams fixed). No
// test-only suspension helper: that would prove the injection reads a set, not
// that a correction puts the summary in it.
//
// Covered:
//   P1  a live summary is injected as before (the baseline the ticket keeps)
//   P2  after the correction, the summary that read the replaced fact is NOT
//       injected, and nothing is put in its place
//   P3  an unrelated summary in the same session keeps being injected
//   P4  the suspension is read per turn, so a correction landing between two
//       turns is honoured by the SAME runtime on the next turn
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { MemoryPipeline } from "../src/memory-pipeline";
import { readMessageText } from "../src/message-text";
import type { RetrieverPort, DomainConfigPort } from "../src/ports";
import type { FusedEnvelope } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;

// The separator injected blocks are appended after (see MemoryPipeline.inject).
const BLANK_LINE = String.fromCharCode(10, 10);
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const dir = mkdtempSync(join(tmpdir(), "ans-263-prompt-"));

// Retrieval is not what this file tests: the injection under test is the
// anchor block, so the retriever returns an empty envelope.
const retriever = {
  async search(q: any): Promise<FusedEnvelope> {
    return { query: q.query, mode: "fast", results: [] } as unknown as FusedEnvelope;
  },
} as RetrieverPort;

// `adapter: "none"` injects no RAG material, so the only text that can appear is
// the L1/L2 anchor block — exactly what this file is about.
const domain: DomainConfigPort = {
  sources: { enabled: [] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

function pipelineFor(store: SqliteSessionStore, sessionId: string): MemoryPipeline {
  return new MemoryPipeline({
    store: store as any,
    retriever,
    domain,
    model: { id: "test" } as any,
    streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
    sessionId,
  });
}

// A user turn in the shape pi-agent-core really produces (content blocks).
function userTurn(text: string): any {
  return { role: "user", content: [{ type: "text", text }] };
}

function promptText(messages: any[]): string {
  return readMessageText(messages[messages.length - 1])?.text ?? "";
}

const SUPPORTED = () => ({ label: "supported" as const, confidence: 0.95 });
const CORRECTION = {
  alreadyCurrent: false, sameFact: true, reliable: true,
  relation: "correction" as const,
  reason: "an official notice with an effective date replaces the same service-hours fact",
};

async function seedMaterial(
  store: SqliteSessionStore, sessionId: string, url: string, snippet: string, entity: string,
): Promise<number> {
  const ra = await store.adjudicateMemory(sessionId, [{ url, title: url, snippet, source: "tavily", evidence: 0.9, entity }]);
  const id = ra[0]?.insertedId;
  if (typeof id !== "number") throw new Error("seed failed for " + url);
  return id;
}

async function main() {
  const store = new SqliteSessionStore(join(dir, "prompt.db"));
  const sessionId = "session-prompt";
  await store.createSession("acme");
  await store.ensureSession(sessionId, "acme");

  const OWN_FACT = "Acme support runs weekdays 9-17. The support email is help@acme.com.";
  const CORRECTED_FACT = "Acme support is now 24x7 every day, effective 2026-11-01.";
  const UNRELATED = "Beta ships its catalog on the first Monday of each month.";

  // One knowledge row built from three materials of the same entity.
  const ownMaterials: number[] = [];
  for (let i = 1; i <= 3; i++) {
    ownMaterials.push(await seedMaterial(store, sessionId, "https://acme.example/m" + i, OWN_FACT, "acme"));
  }
  const built = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ownMaterials], sessionIdNotApplied: false } },
    { summarize: async () => OWN_FACT, classify: SUPPORTED },
  );
  assert(built.add === 1 && typeof built.semanticIds[0] === "number", "fixture: one knowledge row exists");
  const knowledgeId = built.semanticIds[0]!;

  const unrelatedMaterial = await seedMaterial(store, sessionId, "https://beta.example/catalog", UNRELATED, "beta");

  // Two summaries in ONE session: the first reads the knowledge row, the second
  // reads unrelated material. Only the first must ever be suspended.
  await store.saveAnchor(sessionId, "rolling_summary", {
    summary: "STALE-CONCLUSION-263: support runs weekdays 9-17",
    sources: [{ kind: "knowledge", id: knowledgeId }],
  });
  await store.saveAnchor(sessionId, "l2_recall", {
    hits: "UNRELATED-RECALL-263: Beta ships its catalog on the first Monday",
    sources: [{ kind: "material", id: unrelatedMaterial }],
  });

  // P1 baseline.
  const livePrompt = promptText(await pipelineFor(store, sessionId).inject([userTurn("what are the support hours?")]));
  assert(livePrompt.includes("[Session Memory]"), "P1: the live summary block is injected as before");
  assert(livePrompt.includes("STALE-CONCLUSION-263"), "P1: the summary text reaches the prompt");
  assert(livePrompt.includes("[Research Recall]") && livePrompt.includes("UNRELATED-RECALL-263"),
    "P1: the unrelated recall block is injected as before");
  assert(livePrompt.includes("what are the support hours?"), "P1: the user's own question survives");

  // P4 fixture: ONE runtime is built here, before the correction, and used
  // again afterwards. A runtime created after the correction would pass even if
  // the suspension set were cached at construction, so it cannot prove "read per
  // turn" on its own.
  const longLived = pipelineFor(store, sessionId);
  const beforeCorrection = promptText(await longLived.inject([userTurn("before correction")]));
  assert(beforeCorrection.includes("[Session Memory]") && beforeCorrection.includes("STALE-CONCLUSION-263"),
    "P4 fixture: the long-lived runtime injects the summary before the correction");
  // Keep the array this call returned: a caller may hand it straight back.
  const reusedHistory = await longLived.inject([userTurn("before correction")]);

  // The real correction: one reliable material replaces the live knowledge row.
  const correctionMaterial = await seedMaterial(store, sessionId, "https://acme.example/notice-2026", CORRECTED_FACT, "acme");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: any[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE")
          ? "Acme support is 24x7 every day from 2026-11-01. The support email help@acme.com is unchanged."
          : CORRECTED_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "fixture: the correction landed (update=" + rep.update + ")");
  assert(rep.summariesSuspended === 1, "fixture: exactly the one dependent summary was suspended");

  // P2: the stale summary is gone from the prompt, with nothing in its place.
  const afterPrompt = promptText(await pipelineFor(store, sessionId).inject([userTurn("what are the support hours?")]));
  assert(!afterPrompt.includes("[Session Memory]"), "P2: the suspended summary block is NOT injected");
  assert(!afterPrompt.includes("STALE-CONCLUSION-263"), "P2: its text never reaches the prompt");
  assert(!afterPrompt.includes("suspended"), "P2: no placeholder is injected in its place");
  assert(afterPrompt.includes("what are the support hours?"), "P2: the user's own question is still preserved");

  // P3: the unrelated block is untouched.
  assert(afterPrompt.includes("[Research Recall]") && afterPrompt.includes("UNRELATED-RECALL-263"),
    "P3: an unrelated summary keeps being injected");
  // Its text is still stored: the block being absent is a decision, not data loss.
  const recallAnchor = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "l2_recall").pop()!;
  assert(String((recallAnchor.payload as any).hits).includes("UNRELATED-RECALL-263"),
    "P3: the unrelated summary text is still recorded");
  const staleAnchor = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "rolling_summary").pop()!;
  assert(String((staleAnchor.payload as any).summary).includes("STALE-CONCLUSION-263"),
    "P2: the suspended summary's original text is still stored (readable, just not injected)");

  // P4: one runtime sees the change on its next turn. No rebuild, no restart.
  // P4: the SAME runtime that injected the summary before the correction must
  // stop injecting it on its next turn. This is what proves the suspension set
  // is read per turn instead of being cached when the pipeline was built.
  const turnOne = promptText(await longLived.inject([userTurn("turn one")]));
  assert(!turnOne.includes("STALE-CONCLUSION-263"),
    "P4: the same runtime that injected it before now omits the suspended summary");
  assert(!turnOne.includes("[Session Memory]"), "P4: no summary block is appended on that turn");
  assert(turnOne.includes("turn one"), "P4: the user's own text is preserved");

  // P5: a caller that hands back the array a previous inject() returned still
  // carries the old block in its text. Appending nothing is not enough — the
  // stale text has to leave the prompt, or the replaced fact reaches the model.
  const reusedTurn = promptText(await longLived.inject(reusedHistory));
  assert(!reusedTurn.includes("STALE-CONCLUSION-263"),
    "P5: a REUSED history loses the stale summary block instead of keeping it");
  assert(!reusedTurn.includes("[Session Memory]"), "P5: no [Session Memory] block survives in the reused history");
  assert(reusedTurn.includes("before correction"),
    "P5: the user's own words survive the strip");
  // The unrelated block is still live, so the reused history must still carry it.
  assert(reusedTurn.includes("[Research Recall]") && reusedTurn.includes("UNRELATED-RECALL-263"),
    "P5: only the suspended block is stripped; the still-valid recall block remains");

  // P6: stripping is limited to the summary slots. A message whose text is the
  // user's own words plus an injected RAG block keeps both.
  const mixedHistory = [{
    role: "user",
    content: [
      { type: "text", text: "my own question" },
      { type: "text", text: BLANK_LINE + "[RAG Context] operator note" },
    ],
  }];
  const mixed = promptText(await longLived.inject(mixedHistory));
  assert(mixed.includes("my own question"), "P6: the user's text is untouched");
  assert(mixed.includes("[RAG Context] operator note"), "P6: a foreign injected block is NOT stripped");

  store.close();
}

main()
  .catch((e) => {
    console.error("FAIL (exception): " + (e instanceof Error ? (e.stack ?? e.message) : String(e)));
    failed++;
  })
  .finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (e) {
      console.error("cleanup warning (temp dir left in place): " + (e instanceof Error ? e.message : String(e)));
    }
    console.log("summary-suspension-injection: " + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exitCode = 1;
  });
