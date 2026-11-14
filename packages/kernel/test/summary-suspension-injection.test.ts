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
import { MemoryPipeline, readSummarySourcesForWrite, collectRecallSourceRefs, injectedSummaryAnchorIds, summaryAnchorsToInherit, RECALL_SOURCE_SCAN_FROM, SOURCE_SCAN_FROM_INDEX, distillGap, snapshotMessages } from "../src/memory-pipeline";
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

  // P7: a summary body with its own blank line is still ONE block. Splitting the
  // tail on a blank-line separator (the first implementation) read its second
  // paragraph as foreign text and refused to strip, leaving the stale fact in
  // the prompt.
  // Suspended on purpose: an unsuspended one would be stripped and immediately
  // re-appended, so the text would look unchanged and prove nothing.
  await store.saveAnchor(sessionId, "rolling_summary", {
    summary: "MULTI-PARA-263 first paragraph." + BLANK_LINE + "MULTI-PARA-263 second paragraph.",
    sources: [{ kind: "material", id: 999999 }],
  });
  const multiHistory = [{
    role: "user",
    content: [{
      type: "text",
      text: "my question" + BLANK_LINE + "[Session Memory] MULTI-PARA-263 first paragraph."
        + BLANK_LINE + "MULTI-PARA-263 second paragraph.",
    }],
  }];
  const multiRuntime = pipelineFor(store, sessionId);
  const multiTurn = promptText(await multiRuntime.inject(multiHistory));
  const multiCount = multiTurn.split("MULTI-PARA-263 first paragraph.").length - 1;
  assert(multiCount === 0,
    "P7: a multi-paragraph summary is stripped as one block, not left behind (found " + multiCount + ")");
  assert(multiTurn.includes("my question"), "P7: the user's own text survives");

  // P8: a user or assistant sentence that MENTIONS the tag is not a pipeline
  // block. Provenance is the exact injected string, so quoting the tag keeps the
  // text — deleting by tag prefix would answer an incomplete question.
  const quoted = "How does" + " the [Session Memory] tag work" + " in this tool?";
  const quotedHistory = [{ role: "user", content: [{ type: "text", text: quoted }] }];
  const quotedTurn = promptText(await multiRuntime.inject(quotedHistory));
  assert(quotedTurn.includes(quoted),
    "P8: a user question that merely mentions the tag is NOT deleted");
  const assistantHistory = [
    { role: "user", content: [{ type: "text", text: "explain the tags" }] },
    { role: "assistant", content: [{ type: "text", text: "The [Session Memory] block holds a summary." }] },
    { role: "user", content: [{ type: "text", text: "thanks" }] },
  ];
  const assistantTurn = (await multiRuntime.inject(assistantHistory as any)).map((m: any) => readMessageText(m)?.text ?? "");
  assert(assistantTurn.some((t) => t.includes("The [Session Memory] block holds a summary.")),
    "P8: an assistant reply that mentions the tag is NOT deleted");

  // P9: two summary versions where one is a PREFIX of the other. Stripping the
  // short one first would cut that prefix out of the long one, so the long one
  // could never match and the stale line would survive. Longest-first removal
  // is what makes this case work.
  //
  // A separate session on purpose: the anchors above were rewritten by the
  // earlier blocks, so this needs its own two anchors whose texts really are
  // short and "short + more".
  const p9Session = "session-p9";
  await store.ensureSession(p9Session, "acme");
  const shortText = "OLD-HOURS-263 weekdays 9-17";
  const longText = shortText + BLANK_LINE + "OLD-HOURS-263 second line";
  // BOTH versions use the SAME anchor type, so both injected blocks start with
  // `[Session Memory] ` and differ only by their body. An earlier version of this
  // case put them under different tags, which made the strings differ at the
  // first character — a short prefix could never cut a longer block, so the case
  // passed even without the longest-first ordering and proved nothing.
  await store.saveAnchor(p9Session, "rolling_summary", {
    summary: shortText,
    sources: [{ kind: "material", id: 999999 }],
  });
  // A second anchor of the same type: `saveAnchor` is append-only, so both rows
  // exist and both are known blocks. The older one is the superseded version, the
  // newer one extends it.
  await store.saveAnchor(p9Session, "rolling_summary", {
    summary: longText,
    sources: [{ kind: "material", id: 999999 }],
  });
  const prefixHistory = [{
    role: "user",
    content: [{
      type: "text",
      text: "my question" + BLANK_LINE + "[Session Memory] " + shortText
        + BLANK_LINE + "[Session Memory] " + longText,
    }],
  }];
  const prefixRuntime = pipelineFor(store, p9Session);
  const prefixTurn = promptText(await prefixRuntime.inject(prefixHistory));
  assert(!prefixTurn.includes("OLD-HOURS-263 weekdays 9-17"),
    "P9: neither the short block nor the long block that extends it survives");
  assert(!prefixTurn.includes("OLD-HOURS-263 second line"),
    "P9: the longer block's tail is removed with it, not left behind");
  assert(prefixTurn.includes("my question"), "P9: the user's own text survives");

  // P10: a suspension read that THROWS is not the same as "nothing suspended".
  // The state is unknown, so the two summary slots are skipped for this turn —
  // guessing "nothing is suspended" would put a replaced fact back in the
  // prompt, which is the failure this ticket exists to stop.
  const throwingStore = Object.create(store) as SqliteSessionStore;
  Object.defineProperty(throwingStore, "suspendedSummaryAnchorIds", {
    value: () => { throw new Error("suspension read failed"); },
  });
  const unknownRuntime = new MemoryPipeline({
    store: throwingStore as any,
    retriever,
    domain,
    model: { id: "test" } as any,
    streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
    sessionId,
  });
  const unknownPrompt = promptText(await unknownRuntime.inject([userTurn("what are the support hours?")]));
  assert(!unknownPrompt.includes("[Session Memory]"),
    "P10: an unreadable suspension list skips the summary slot instead of injecting it");
  assert(!unknownPrompt.includes("[Research Recall]"),
    "P10: the recall slot is skipped for the same reason");
  assert(unknownPrompt.includes("what are the support hours?"),
    "P10: the turn itself still runs — only the two summary slots are skipped");

  // A store that simply has no suspension tracking keeps the old behaviour:
  // no seam means "this store predates the feature", not "the read failed".
  const plainStore = Object.create(store) as SqliteSessionStore;
  Object.defineProperty(plainStore, "suspendedSummaryAnchorIds", { value: undefined });
  const plainRuntime = new MemoryPipeline({
    store: plainStore as any,
    retriever,
    domain,
    model: { id: "test" } as any,
    streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
    sessionId,
  });
  const plainPrompt = promptText(await plainRuntime.inject([userTurn("legacy store turn")]));
  assert(plainPrompt.includes("[Research Recall]") && plainPrompt.includes("UNRELATED-RECALL-263"),
    "P10: a store WITHOUT the seam still injects (absence is not a failed read)");

  // P11: the l2 recall anchor records only hits that actually made it into the
  // capped block. A hit whose text was truncated away is NOT a dependency —
  // recording it would let a later correction to that row suspend a recall
  // block it never fed, and with no rebuild yet that silently removes valid
  // recall text.
  //
  // Built over a private store so the huge hit cannot disturb the fixtures above.
  //
  // The recall ORDER is pinned by a stand-in rather than by the real store's
  // ranking. Real fusion order depends on bm25 length normalisation, freshness
  // and the optional embedding arm, so asserting "big came first" would be a
  // test of the ranker (unstable) rather than of the text budget (what this case
  // is about). The stand-in returns [big, other] every time.
  {
    const l2Store = new SqliteSessionStore(join(dir, "l2.db"));
    const l2Session = "session-l2";
    await l2Store.createSession("acme");
    await l2Store.ensureSession(l2Session, "acme");
    // The FIRST hit alone exceeds the whole budget (3012 chars vs the 1500
    // injection cap), so it is truncated to fit and the second hit can never be
    // included. The budget IS the injection cap (RECALL_INJECT_MAX_CHARS): text
    // past it is never rendered, so a hit living only there must not be recorded
    // as a source.
    const bigText = "BIGFIRST263 " + "y".repeat(3000);
    const otherText = "OTHER263 is a second recalled row";
    const big = (await l2Store.adjudicateMemory(l2Session, [
      { url: "https://l2.example/big", title: "big row", snippet: bigText, source: "tavily", evidence: 0.9, entity: "b-big" },
    ]))[0]!.insertedId!;
    const other = (await l2Store.adjudicateMemory(l2Session, [
      { url: "https://l2.example/other", title: "other row", snippet: otherText, source: "tavily", evidence: 0.9, entity: "b-other" },
    ]))[0]!.insertedId!;

    // Fixed order: big first, then other. `searchMemoryMulti` is what the L2
    // path calls when the store has it, so both entry points are pinned.
    const pinnedHits = () => [
      { rowid: big, sessionId: l2Session, role: "material", content: bigText, rank: -1 },
      { rowid: other, sessionId: l2Session, role: "material", content: otherText, rank: -2 },
    ];
    const l2Runtime = new MemoryPipeline({
      store: {
        ...(l2Store as any),
        getAnchors: (sid: string) => (l2Store as any).getAnchors(sid),
        saveAnchor: (sid: string, type: string, payload: any) => (l2Store as any).saveAnchor(sid, type, payload),
        searchMemoryMulti: async () => pinnedHits(),
        searchMemory: async () => pinnedHits(),
      } as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: l2Session,
      llmRewriteFn: undefined,
    });
    const searchTurn = [{
      role: "assistant",
      content: [{ type: "toolCall", name: "search", arguments: { query: "BIGFIRST263" } }],
    }, { role: "user", content: [{ type: "text", text: "follow up" }] }];
    await l2Runtime.consolidate(searchTurn as any, 200_000, true);
    await l2Runtime.flush();
    const l2Anchors = (await l2Store.getAnchors(l2Session)).filter((a) => a.anchorType === "l2_recall");
    assert(l2Anchors.length === 1, "P11 fixture: one l2_recall anchor was written (got " + l2Anchors.length + ")");
    const payload = l2Anchors[0]!.payload as any;
    const raw = l2Store as any;
    const recorded = raw.db
      .prepare("SELECT source_id FROM summary_sources WHERE anchor_id = ? ORDER BY source_id")
      .all(l2Anchors[0]!.id) as Array<{ source_id: number }>;
    const ids = recorded.map((r) => r.source_id);
    assert(String(payload.hits).includes("BIGFIRST263"),
      "P11: the first hit fills the block");
    assert(!String(payload.hits).includes("OTHER263"),
      "P11: the second hit's text was NOT included (its text is absent)");
    assert(ids.includes(big), "P11: the hit that fills the block is recorded as its source");
    assert(!ids.includes(other),
      "P11: a hit whose text was truncated away is NOT recorded (got " + JSON.stringify(ids) + ")");
    const storedHits = String(payload.hits);
    assert(storedHits.startsWith("BIGFIRST263"),
      "P11: the stored block starts with the hit whose source was recorded");
    l2Store.close();
  }

  // P21: a hit that lands in the 1500-2000 range is NOT a source.
  //
  // The write side used to budget 2000 while injection renders 1500, so a hit
  // whose text starts past 1500 was recorded as a dependency but never shown in
  // any `[Research Recall]` block. A later correction of that row would then
  // suspend the whole recall anchor — removing valid text it never fed.
  //
  // First hit is 1600 chars (fits under the old 2000, truncated to 1500 now),
  // second hit is short but starts past the cap either way. The assertion is that
  // the SECOND hit is not recorded, which is the range the two budgets disagreed
  // about.
  {
    const p21Store = new SqliteSessionStore(join(dir, "p21.db"));
    const p21Session = "session-p21";
    await p21Store.createSession("acme");
    await p21Store.ensureSession(p21Session, "acme");
    const firstText = "FIRST263 " + "z".repeat(1600);
    const secondText = "SECOND263 short second hit";
    const first = (await p21Store.adjudicateMemory(p21Session, [
      { url: "https://p21.example/first", title: "first", snippet: firstText, source: "tavily", evidence: 0.9, entity: "p21-first" },
    ]))[0]!.insertedId!;
    const second = (await p21Store.adjudicateMemory(p21Session, [
      { url: "https://p21.example/second", title: "second", snippet: secondText, source: "tavily", evidence: 0.9, entity: "p21-second" },
    ]))[0]!.insertedId!;
    const pinned = () => [
      { rowid: first, sessionId: p21Session, role: "material", content: firstText, rank: -1 },
      { rowid: second, sessionId: p21Session, role: "material", content: secondText, rank: -2 },
    ];
    const p21Runtime = new MemoryPipeline({
      store: {
        ...(p21Store as any),
        getAnchors: (sid: string) => (p21Store as any).getAnchors(sid),
        saveAnchor: (sid: string, type: string, payload: any) => (p21Store as any).saveAnchor(sid, type, payload),
        searchMemoryMulti: async () => pinned(),
        searchMemory: async () => pinned(),
      } as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: p21Session,
    });
    const turn = [{
      role: "assistant",
      content: [{ type: "toolCall", name: "search", arguments: { query: "FIRST263" } }],
    }, { role: "user", content: [{ type: "text", text: "follow up" }] }];
    await p21Runtime.consolidate(turn as any, 200_000, true);
    await p21Runtime.flush();
    const anchors = (await p21Store.getAnchors(p21Session)).filter((a) => a.anchorType === "l2_recall");
    assert(anchors.length === 1, "P21 fixture: one l2_recall anchor was written (got " + anchors.length + ")");
    const stored = String((anchors[0]!.payload as any).hits);
    const recorded = ((p21Store as any).db
      .prepare("SELECT source_id FROM summary_sources WHERE anchor_id = ? ORDER BY source_id")
      .all(anchors[0]!.id) as Array<{ source_id: number }>).map((r) => r.source_id);
    // The stored block never contained the second hit: it starts past the cap.
    assert(!stored.includes("SECOND263"),
      "P21: the second hit's text is not in the stored block");
    assert(recorded.includes(first), "P21: the hit that fills the block is recorded (got " + JSON.stringify(recorded) + ")");
    assert(!recorded.includes(second),
      "P21: a hit that would only appear past the injection cap is NOT recorded as a source (got " + JSON.stringify(recorded) + ")");
    // And the stored block is within the injection cap, so what is recorded is
    // exactly what injection can render.
    assert(stored.length <= 1500, "P21: the stored block fits the injection cap (got " + stored.length + ")");
    p21Store.close();
  }

  // P12: removing a summary from a message with INTERLEAVED text and images
  // must not reorder the other blocks. Rewriting every text block into the first
  // one turned "caption A, image A, caption B, image B" into "caption A,
  // caption B, image A, image B" — a model could pair B's caption with A's image.
  {
    const p12Store = new SqliteSessionStore(join(dir, "p12.db"));
    const p12Session = "session-p12";
    await p12Store.createSession("acme");
    await p12Store.ensureSession(p12Session, "acme");
    const staleText = "P12-STALE-263 the summary to remove";
    await p12Store.saveAnchor(p12Session, "rolling_summary", {
      summary: staleText,
      sources: [{ kind: "material", id: 999999 }],
    });
    const p12Runtime = new MemoryPipeline({
      store: p12Store as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: p12Session,
    });
    // The summary block sits at the END of the LAST text block, as inject writes
    // it; two image blocks sit between the two text blocks.
    const blocks = [
      { type: "text", text: "caption A" },
      { type: "image", data: "imgA" },
      { type: "text", text: "caption B" + BLANK_LINE + "[Session Memory] " + staleText },
      { type: "image", data: "imgB" },
    ];
    const history = [{ role: "user", content: blocks }];
    const out = (await p12Runtime.inject(history as any))[0].content as any[];
    const shape = out.map((b: any) => b.type + ":" + (b.type === "text" ? b.text : b.data));
    assert(shape.length === 4, "P12: every block is still present (got " + JSON.stringify(shape) + ")");
    assert(shape[0] === "text:caption A", "P12: the first text block keeps its own text");
    assert(shape[1] === "image:imgA", "P12: image A stays right after caption A");
    assert(shape[2] === "text:caption B",
      "P12: the second text block keeps its own text, with the summary removed (got " + JSON.stringify(shape[2]) + ")");
    assert(shape[3] === "image:imgB", "P12: image B stays after caption B");
    assert(!JSON.stringify(shape).includes("P12-STALE-263"),
      "P12: the suspended summary's text is gone from the prompt");
    p12Store.close();
  }

  // P13: a summary whose sources could not be READ must not be written.
  //
  // The summarizer itself is `generateSummaryWithUsage`, a real SDK import that
  // the repo's own tests document as un-mockable (see the note in
  // memory-pipeline.test.ts), so the write path cannot be driven end-to-end here.
  // What IS testable — and what the guard is — is the decision function the write
  // path calls: it must distinguish "no provenance feature" (write as before)
  // from "the read failed" (write nothing), because storing a summary with
  // unknown dependencies makes it immune to suspension.
  {
    // 1. A store WITHOUT the seams: absence is not failure.
    const plain = readSummarySourcesForWrite(
      { getAnchors: async () => [] },
      { gapUrls: ["https://x.example/1"], previousAnchorId: 7 },
    );
    assert(plain.ok === true && plain.sources.length === 0,
      "P13: a store without provenance seams writes the summary with no recorded sources (old behaviour)");

    // 2. A seam that THROWS: the write must be skipped.
    const throwing = readSummarySourcesForWrite(
      { resolveSummarySources: () => { throw new Error("source lookup failed"); } },
      { gapUrls: ["https://x.example/1"], previousAnchorId: 7 },
    );
    assert(throwing.ok === false,
      "P13: a failed source read reports not-ok, so the caller skips the write");

    // 3. A failing inheritance read is just as fatal: half a dependency list
    //    would leave the inherited facts unsuspendable.
    const inheritThrows = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [{ kind: "material", id: 5 }],
        summarySourcesForAnchor: () => { throw new Error("inherit failed"); },
      },
      { gapUrls: ["https://x.example/1"], previousAnchorId: 7 },
    );
    assert(inheritThrows.ok === false,
      "P13: a failed inheritance read also skips the write (partial deps are not accepted)");

    // 3b. TWO anchors inherited: a reused history can carry both the previous
    // rolling summary and a `[Research Recall]` block, and the summarizer reads
    // both. Dropping the recall anchor's sources would leave facts from that
    // block unsuspendable.
    const twoAnchors = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [],
        summarySourcesForAnchor: (id: number) => [{ kind: "material", id: id * 10 }],
      },
      { gapUrls: [], previousAnchorIds: [1, 2] },
    );
    const twoIds = twoAnchors.ok ? twoAnchors.sources.map((r) => r.id) : [];
    assert(twoAnchors.ok === true && twoIds.includes(10) && twoIds.includes(20),
      "P13: sources from BOTH inherited anchors are kept (got " + JSON.stringify(twoIds) + ")");
    // A failing read on the second anchor is still fatal: half the list is not
    // an acceptable dependency set.
    const secondFails = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [],
        summarySourcesForAnchor: (id: number) => {
          if (id === 2) throw new Error("second anchor unreadable");
          return [{ kind: "material", id: id * 10 }];
        },
      },
      { gapUrls: [], previousAnchorIds: [1, 2] },
    );
    assert(secondFails.ok === false,
      "P13: a failure on any inherited anchor skips the write (partial deps are not accepted)");

    // 3c. A recall anchor is inherited ONLY when the history actually carries
    // that block. Two failure shapes the reviewer named:
    //   - no recall block at all, but a newest l2_recall anchor exists on the
    //     store: inheriting it would record a dependency the summary never read,
    //     and a later correction would suspend an unrelated summary.
    //   - the history carries an OLDER recall block than the newest anchor:
    //     inheriting only the newest misses what was actually read.
    // The gate is the block's presence, which is what the caller passes in.

    // Shape 1: the write helper is given no recall anchor because the history has
    // no block. Asserted at the helper boundary: an empty inherit list records
    // nothing.
    const noBlock = readSummarySourcesForWrite(
      { resolveSummarySources: () => [], summarySourcesForAnchor: () => [{ kind: "material", id: 77 }] },
      { gapUrls: [], previousAnchorIds: [] },
    );
    assert(noBlock.ok === true && noBlock.sources.length === 0,
      "P13: with no inherited anchor the helper records nothing (got " +
      (noBlock.ok ? noBlock.sources.length : "not-ok") + ")");

    // Shape 2: the anchor that IS inherited is the one named, not "whatever is
    // newest". Passing the block's own anchor id gets that anchor's sources.
    const namedAnchor = readSummarySourcesForWrite(
      { resolveSummarySources: () => [], summarySourcesForAnchor: (id: number) => [{ kind: "material", id: id }] },
      { gapUrls: [], previousAnchorIds: [42] },
    );
    assert(namedAnchor.ok === true && namedAnchor.sources.some((r) => r.id === 42),
      "P13: the inherited anchor is the one the caller named, not the newest by default");

    // 3d. The GATE itself: only a block that the history REALLY carries, and
    // that belongs to a stored anchor, is inherited. Matching is per anchor by
    // its rendered block, which is what closes both reviewer cases:
    //   - the newest anchor with NO block in the history: not inherited;
    //   - an OLDER anchor whose block IS in the history: inherited, even though
    //     a newer anchor exists.
    const anchor = (id: number, anchorType: string, payload: any) => ({ id, anchorType, payload });
    const withOlderBlock = injectedSummaryAnchorIds(
      [userTurn("q" + BLANK_LINE + "[Research Recall] learned facts")],
      [
        anchor(1, "l2_recall", { hits: "learned facts" }),
        anchor(2, "l2_recall", { hits: "newer facts the history never carried" }),
      ],
    );
    assert(withOlderBlock.length === 1 && withOlderBlock[0] === 1,
      "P13: the anchor whose block the history carries is inherited (got " + JSON.stringify(withOlderBlock) + ")");
    assert(!withOlderBlock.includes(2),
      "P13: the newest anchor with NO block in the history is NOT inherited");
    assert(injectedSummaryAnchorIds([userTurn("no blocks here")], [anchor(1, "l2_recall", { hits: "x" })]).length === 0,
      "P13: a plain message inherits nothing");
    assert(injectedSummaryAnchorIds([userTurn("what does [Research Recall] mean?")], [anchor(1, "l2_recall", { hits: "x" })]).length === 0,
      "P13: merely MENTIONING the tag is not a block");
    assert(injectedSummaryAnchorIds([], [anchor(1, "l2_recall", { hits: "x" })]).length === 0,
      "P13: an empty history inherits nothing");
    // A block that matches no stored anchor (another session's history) inherits
    // nothing: its sources are unknowable, and inventing them would suspend an
    // unrelated summary later.
    assert(injectedSummaryAnchorIds(
      [userTurn("q" + BLANK_LINE + "[Research Recall] foreign block")],
      [anchor(1, "l2_recall", { hits: "x" })],
    ).length === 0,
      "P13: a block belonging to no stored anchor inherits nothing");

    // 3f. The WIRING, not just the matcher: the id list the call site passes to
    // the write. This is the level CodeRabbit's round-13 finding lived at — the
    // matcher was right while the call site still said "newest anchor wins", and
    // a test that only drives the matcher could not see the difference.
    const wiringAnchors = [
      anchor(10, "rolling_summary", { summary: "older summary" }),
      anchor(11, "l2_recall", { hits: "block the history carries" }),
      anchor(12, "l2_recall", { hits: "newest anchor the history never saw" }),
    ];
    const wiring = summaryAnchorsToInherit(
      [userTurn("q" + BLANK_LINE + "[Research Recall] block the history carries")],
      wiringAnchors,
      10,
    );
    assert(wiring.includes(10), "P13: the previous summary anchor is inherited (got " + JSON.stringify(wiring) + ")");
    assert(wiring.includes(11), "P13: the recall anchor whose block the history carries is inherited");
    assert(!wiring.includes(12),
      "P13: the NEWEST recall anchor is NOT inherited when the history does not carry its block");
    // With no previous summary and no block, nothing is inherited — the case
    // where inheriting the newest anchor would suspend an unrelated summary.
    assert(summaryAnchorsToInherit([userTurn("no blocks")], wiringAnchors, undefined).length === 0,
      "P13: no previous summary and no block inherits nothing");
    // Ids are deduplicated and junk is dropped.
    const dup = summaryAnchorsToInherit(
      [userTurn("q" + BLANK_LINE + "[Research Recall] block the history carries")],
      [anchor(11, "l2_recall", { hits: "block the history carries" })],
      11,
    );
    assert(dup.length === 1 && dup[0] === 11, "P13: an anchor named twice is inherited once (got " + JSON.stringify(dup) + ")");

    // 3g. A block is matched WHOLE, to its end boundary. One summary's text can be
    // the prefix of another's, and a plain `includes` would then match BOTH: the
    // history carries only the longer block, but the shorter anchor looks
    // present, so the new summary inherits a dependency it never read.
    const prefixAnchors = [
      anchor(20, "l2_recall", { hits: "shared wording" }),
      anchor(21, "l2_recall", { hits: "shared wording plus more" }),
    ];
    const longOnly = summaryAnchorsToInherit(
      [userTurn("q" + BLANK_LINE + "[Research Recall] shared wording plus more")],
      prefixAnchors,
      undefined,
    );
    assert(longOnly.includes(21), "P13: the anchor whose block is really present is inherited (got " + JSON.stringify(longOnly) + ")");
    assert(!longOnly.includes(20),
      "P13: the shorter anchor whose text is only a PREFIX of the carried block is NOT inherited");
    // The reverse: the history carries the SHORT block alone, so only the short
    // anchor is a dependency.
    const shortOnly = summaryAnchorsToInherit(
      [userTurn("q" + BLANK_LINE + "[Research Recall] shared wording")],
      prefixAnchors,
      undefined,
    );
    assert(shortOnly.includes(20) && !shortOnly.includes(21),
      "P13: a carried short block does not pull in the longer anchor (got " + JSON.stringify(shortOnly) + ")");
    // A block followed by the pipeline's own separator (another block) still
    // counts: that is the shape inject() writes.
    const followed = summaryAnchorsToInherit(
      [userTurn("q" + BLANK_LINE + "[Research Recall] shared wording" + BLANK_LINE + "[Session Memory] next block")],
      prefixAnchors,
      undefined,
    );
    assert(followed.includes(20),
      "P13: a block followed by another injected block still counts (got " + JSON.stringify(followed) + ")");

    // 3h. A read with a usable row id survives the gapReads filter even when its
    // URL is empty. `saveResults` archives such a result, so dropping it here
    // would lose the dependency entirely and the summary would be stored as
    // valid.
    let readsWithEmptyUrl: Array<{ url: string; rowId?: number | null }> = [];
    readSummarySourcesForWrite(
      {
        resolveSummarySourcesFromReads: (rs: Array<{ url: string; rowId?: number | null }>) => {
          readsWithEmptyUrl = rs;
          return [{ kind: "material", id: 42 }];
        },
      },
      { gapUrls: [], gapReads: [{ url: "", rowId: 42 }, { url: "", rowId: null }, { url: "", rowId: 0 }] },
    );
    assert(readsWithEmptyUrl.length === 1 && readsWithEmptyUrl[0]!.rowId === 42,
      "P13: an id-only read reaches the resolver instead of being filtered out (got " + JSON.stringify(readsWithEmptyUrl) + ")");

    // 3e. The exact read form wins over the URL form: a read that carries its
    // archive row resolves to that row only, so an older version of the same URL
    // is not attributed to a summary that read the newer one.
    let readsSeen: Array<{ url: string; rowId?: number | null }> = [];
    const exact = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [{ kind: "material", id: 111 }],
        resolveSummarySourcesFromReads: (reads2: Array<{ url: string; rowId?: number | null }>) => {
          readsSeen = reads2;
          return [{ kind: "material", id: 222 }];
        },
      },
      { gapUrls: ["https://x.example/1"], gapReads: [{ url: "https://x.example/1", rowId: 222 }] },
    );
    const exactIds = exact.ok ? exact.sources.map((r) => r.id) : [];
    assert(exact.ok === true && exactIds.includes(222) && !exactIds.includes(111),
      "P13: the read's row id decides the dependency, not the URL lookup (got " + JSON.stringify(exactIds) + ")");
    assert(readsSeen.length === 1 && readsSeen[0]!.rowId === 222,
      "P13: the row id reaches the store seam unchanged");
    const blankReads = exact.ok
      ? readSummarySourcesForWrite(
        {
          resolveSummarySources: () => [{ kind: "material", id: 111 }],
          resolveSummarySourcesFromReads: () => [],
        },
        { gapUrls: ["https://x.example/1"], gapReads: [{ url: "" }] },
      )
      : { ok: false as const, sources: [] };
    assert(blankReads.ok === true && blankReads.sources.some((r) => r.id === 111),
      "P13: with no usable read, the URL form still resolves (stores that predate the annotation)");

    // 4. The happy path merges both parts and dedupes nothing it should not.
    const happy = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [{ kind: "material", id: 5 }],
        summarySourcesForAnchor: () => [{ kind: "knowledge", id: 3 }],
      },
      { gapUrls: ["https://x.example/1"], previousAnchorId: 7 },
    );
    assert(happy.ok === true && happy.sources.length === 2,
      "P13: the new gap's sources and the inherited ones both travel (got " + (happy.ok ? happy.sources.length : "not-ok") + ")");
    // Blank/absent URLs must not reach the resolver as empty strings.
    let seenUrls: string[] = [];
    const filtered = readSummarySourcesForWrite(
      { resolveSummarySources: (urls: string[]) => { seenUrls = urls; return []; } },
      { gapUrls: ["https://x.example/1", "", null, undefined] },
    );
    assert(filtered.ok === true && seenUrls.length === 1 && seenUrls[0] === "https://x.example/1",
      "P13: blank and missing URLs are filtered before the resolver sees them (got " + JSON.stringify(seenUrls) + ")");
  }

  // P14: a skipped summary must NOT advance the consolidation state.
  //
  // The guard lives inside fireCompress, but the state is persisted OUTSIDE it
  // (see consolidate()). A `return` inside fireCompress alone would still let
  // `lastSummaryMsgCount` move to the current message count, so the next turn's
  // distillGap would skip the very search results this turn never compressed —
  // and the later summary would state those facts with no recorded source.
  //
  // Driven here through the real consolidate() with a store whose source read
  // throws: the summarizer itself is a real SDK import (un-mockable, see
  // memory-pipeline.test.ts), so no anchor is written either way — but the
  // STATE is what this assertion reads, and that is exactly the observable this
  // guard changes.
  {
    const p14Store = new SqliteSessionStore(join(dir, "p14.db"));
    const p14Session = "session-p14";
    await p14Store.createSession("acme");
    await p14Store.ensureSession(p14Session, "acme");
    const throwing = Object.create(p14Store) as SqliteSessionStore;
    Object.defineProperty(throwing, "resolveSummarySources", {
      value: () => { throw new Error("source lookup failed"); },
    });
    const p14Runtime = new MemoryPipeline({
      store: throwing as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: p14Session,
      models: { getModel: () => ({ id: "stub" }) } as any,
    });
    const longTurn = [
      { role: "user", content: [{ type: "text", text: "go investigate" }] },
      { role: "assistant", content: [{ type: "toolCall", name: "search", arguments: { query: "p14 query" } }] },
      { role: "toolResult", name: "search", content: [{ type: "text", text: "{}" }] },
      { role: "assistant", content: [{ type: "text", text: "first look" }] },
      { role: "user", content: [{ type: "text", text: "keep going" }] },
    ];
    const before = p14Runtime.getConsolidationState();
    await p14Runtime.consolidate(longTurn as any, 200_000, true);
    await p14Runtime.flush();
    const after = p14Runtime.getConsolidationState();
    assert(after.lastSummaryMsgCount === before.lastSummaryMsgCount,
      "P14: lastSummaryMsgCount did not advance after a skipped summary write (before=" +
      before.lastSummaryMsgCount + " after=" + after.lastSummaryMsgCount + ")");
    // And the persisted state agrees with the in-memory one.
    const stateAnchors = (await p14Store.getAnchors(p14Session)).filter((a) => a.anchorType === "consolidation_state");
    const persistedCount = stateAnchors.length === 0
      ? 0
      : Number((stateAnchors[stateAnchors.length - 1]!.payload as any)?.lastSummaryMsgCount ?? 0);
    assert(persistedCount === 0,
      "P14: no advanced consolidation state was persisted either (got " + persistedCount + ")");
    p14Store.close();
  }

  // P15: the summary block is NOT necessarily in the last text block. A caller
  // can append its own text block after the injected one — then the stale
  // summary sits in an EARLIER block while the last block holds new user text.
  // Removing from the joined text and writing it into the last block moved the
  // user's own words there and left the stale summary in place.
  {
    const p15Store = new SqliteSessionStore(join(dir, "p15.db"));
    const p15Session = "session-p15";
    await p15Store.createSession("acme");
    await p15Store.ensureSession(p15Session, "acme");
    const stale = "P15-STALE-263 old conclusion";
    await p15Store.saveAnchor(p15Session, "rolling_summary", {
      summary: stale,
      sources: [{ kind: "material", id: 999999 }],
    });
    const p15Runtime = new MemoryPipeline({
      store: p15Store as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: p15Session,
    });
    const blocks = [
      { type: "text", text: "my question" + BLANK_LINE + "[Session Memory] " + stale },
      { type: "image", data: "img1" },
      { type: "text", text: "a later note the caller appended" },
    ];
    const history = [{ role: "user", content: blocks }];
    const out = (await p15Runtime.inject(history as any))[0].content as any[];
    const texts = out.filter((b: any) => b.type === "text").map((b: any) => b.text);
    assert(!JSON.stringify(out).includes("P15-STALE-263"),
      "P15: the stale summary is gone even though it was NOT in the last text block");
    assert(texts[0] === "my question",
      "P15: the first block keeps only the user's question (got " + JSON.stringify(texts[0]) + ")");
    assert(texts[1] === "a later note the caller appended",
      "P15: the later note stays in its own block, not merged into the first");
    assert(out.length === 3 && out[1].type === "image",
      "P15: the image block keeps its position");
  }

  // P16: an anchor read that THROWS must still clear the blocks the SAME runtime
  // wrote earlier. Otherwise a caller reusing a previous inject() output keeps a
  // summary a correction may already have suspended.
  //
  // The memory is per runtime, so this takes one runtime through: inject (which
  // records the block), then make getAnchors fail, then inject the earlier
  // output back. A fresh runtime could not know those blocks existed — that is
  // the honest limit of the recovery, and why the check reads
  // `injectedSummaryBlocks` rather than re-deriving blocks from the store.
  {
    const p16Store = new SqliteSessionStore(join(dir, "p16.db"));
    const p16Session = "session-p16";
    await p16Store.createSession("acme");
    await p16Store.ensureSession(p16Session, "acme");
    const p16Material = await seedMaterial(p16Store, p16Session, "https://p16.example/one", "P16 material text", "p16");
    await p16Store.saveAnchor(p16Session, "rolling_summary", {
      summary: "P16-BLOCK-263",
      sources: [{ kind: "material", id: p16Material }],
    });

    // One runtime, but with a `getAnchors` we can break on demand.
    let anchorReadsFail = false;
    const flaky = Object.create(p16Store) as SqliteSessionStore;
    Object.defineProperty(flaky, "getAnchors", {
      value: async function (this: unknown, sid: string) {
        if (anchorReadsFail) throw new Error("anchor read failed");
        return (p16Store as any).getAnchors(sid);
      },
    });
    const p16Runtime = new MemoryPipeline({
      store: flaky as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: p16Session,
    });
    const firstOut = await p16Runtime.inject([userTurn("turn one")]);
    assert(promptText(firstOut).includes("P16-BLOCK-263"),
      "P16 fixture: the first turn injected the summary");
    // Now the anchor read starts failing and the caller hands back that output.
    anchorReadsFail = true;
    const out = promptText(await p16Runtime.inject(firstOut));
    assert(!out.includes("P16-BLOCK-263"),
      "P16: a failed anchor read clears the block this runtime wrote (unknown state injects nothing stale)");
    assert(out.includes("turn one"), "P16: the user's own text survives");
    p16Store.close();
  }

  // P17: a `recall_memory` result the summarizer saw becomes a dependency too.
  // distillGap only reads `search` results, but the summarizer gets the full
  // message list, so a recall hit can end up in the summary body. A recall hit
  // has no URL, so it can only be bound through its row id.
  {
    const hitsFrom = (rowids: Array<number | string | null>) => [{
      role: "toolResult",
      name: "recall_memory",
      content: [{ type: "text", text: JSON.stringify({
        query: "q",
        internal: rowids.map((rowid, i) => ({ role: "(semantic)", content: "c" + i, rank: i, sessionId: "s", rowid })),
      }) }],
    }];
    const refs = collectRecallSourceRefs(hitsFrom([5, -7, 5, 0, "x", null]), 0);
    assert(refs.length === 2,
      "P17: only valid, distinct rowids count (got " + JSON.stringify(refs) + ")");
    assert(refs.some((r) => r.kind === "material" && r.id === 5),
      "P17: a positive rowid is an archive material");
    assert(refs.some((r) => r.kind === "knowledge" && r.id === 7),
      "P17: a negative rowid is a knowledge row (absolute id)");

    // A search result is NOT a recall result: its material comes from the URL
    // path, so it must not be double-counted here.
    const searchOnly = [{
      role: "toolResult",
      name: "search",
      content: [{ type: "text", text: JSON.stringify({ results: [{ url: "https://x.example/1" }] }) }],
    }];
    assert(collectRecallSourceRefs(searchOnly, 0).length === 0,
      "P17: a search result contributes nothing here (it is bound by URL)");
    // Malformed payloads never throw into the turn.
    assert(collectRecallSourceRefs([{ role: "toolResult", name: "recall_memory", content: [{ type: "text", text: "not json" }] }], 0).length === 0,
      "P17: an unparseable recall payload yields no refs, not an exception");
    // Only messages from fromIdx onward are read.
    const twoTurns = [...hitsFrom([9]), ...hitsFrom([11])];
    assert(collectRecallSourceRefs(twoTurns, 1).every((r) => r.id === 11),
      "P17: the fromIdx window is respected (only the newer turn counts)");

    // The WIRING, not just the helper: the summarizer reads the whole message
    // list, so the scan must start at 0. A window of `messages.length` (which is
    // what `summaryRequest.msgCountAtTrigger` carries) yields an empty slice and
    // silently records nothing while the summary still uses those hits.
    assert(RECALL_SOURCE_SCAN_FROM === 0,
      "P17: the recall scan starts at the beginning of the message list (got " + RECALL_SOURCE_SCAN_FROM + ")");
    const allMessages = [...hitsFrom([9]), ...hitsFrom([11])];
    assert(collectRecallSourceRefs(allMessages, allMessages.length).length === 0,
      "P17: a window of messages.length is empty — which is exactly why that value cannot be used here");
    assert(collectRecallSourceRefs(allMessages, RECALL_SOURCE_SCAN_FROM).length === 2,
      "P17: the real scan window sees every recall hit the summarizer could read");
  }

  // P18: the dependency scan covers what the SUMMARIZER reads, not just this
  // turn's gap.
  //
  // Overlapping compressions: turn one reads search result X and advances
  // `lastSummaryMsgCount` while its summary is still being generated; turn two
  // starts before that write lands, so its `summaryRequest.gap` covers only Y.
  // The generator still receives messages holding BOTH X and Y. Recording only
  // the gap would leave the newest summary without X's dependency, and a later
  // correction of X would suspend the first summary while the newer one kept
  // being injected.
  {
    // The scan is what feeds `gapUrls`, so exercise it directly: the gap for
    // turn two covers only Y, while the full scan covers X and Y.
    const turnOne = [{
      role: "toolResult",
      name: "search",
      content: [{ type: "text", text: JSON.stringify({ results: [{ url: "https://x263.example/one", title: "x", snippet: "X fact" }] }) }],
    }];
    const turnTwo = [{
      role: "toolResult",
      name: "search",
      content: [{ type: "text", text: JSON.stringify({ results: [{ url: "https://x263.example/two", title: "y", snippet: "Y fact" }] }) }],
    }];
    const allMessages = [...turnOne, ...turnTwo];
    const gapOnly = distillGap(allMessages, turnOne.length);
    const fullScan = distillGap(allMessages, 0);
    const gapUrls = gapOnly.results.map((r: any) => r.url);
    const scanUrls = fullScan.results.map((r: any) => r.url);
    assert(gapUrls.length === 1 && gapUrls[0].includes("two"),
      "P18 fixture: the turn-two gap covers only its own result");
    assert(scanUrls.includes("https://x263.example/one") && scanUrls.includes("https://x263.example/two"),
      "P18: the full scan covers both results, which is what the summarizer reads");
    // The wiring must use the full scan: gap-only URLs would drop X. Pinned as a
    // constant so the CALL SITE's value is asserted, not just the helper's.
    assert(!gapUrls.includes("https://x263.example/one"),
      "P18: a gap-only scan would have dropped the earlier result — exactly the bug");
    assert(SOURCE_SCAN_FROM_INDEX === 0,
      "P18: the write path scans from the beginning of the message list (got " + SOURCE_SCAN_FROM_INDEX + ")");

    // P19: the scan and the model call must see the SAME membership. An append
    // to the caller's live array between them would put a fact in the summary
    // that the sources never covered, so the write path takes a copy first.
    const live = [userTurn("first")];
    const snap = snapshotMessages(live);
    assert(snap !== live, "P19: snapshotMessages returns a DIFFERENT array (not the caller's live one)");
    live.push(userTurn("appended later"));
    assert(snap.length === 1,
      "P19: appending to the caller's array after the snapshot does not change the snapshot (got " + snap.length + ")");
    assert(snap[0] === live[0],
      "P19: the snapshot holds the same message references (shallow, contents untouched)");
    const fromWiring = distillGap(allMessages, SOURCE_SCAN_FROM_INDEX);
    assert(fromWiring.results.map((r: any) => r.url).includes("https://x263.example/one"),
      "P18: the scan window used by the write path keeps the earlier result's URL");
    // And the sources the write would receive therefore include both rows.
    const both = readSummarySourcesForWrite(
      { resolveSummarySources: (urls: string[]) => urls.map((u, i) => ({ kind: "material", id: 100 + i })) },
      { gapUrls: scanUrls },
    );
    assert(both.ok === true && both.sources.length === 2,
      "P18: the write receives a source for each result the summarizer read (got " +
      (both.ok ? both.sources.length : "not-ok") + ")");

    // P20: the row id the search path stamped on a result survives distillation,
    // so the summary's dependency can name the VERSION it read. Without it a URL
    // with a retired older row and a live newer one records both, and the
    // write-time currency check suspends a summary built entirely from the live
    // one.
    const stamped = [{
      role: "toolResult",
      name: "search",
      content: [{ type: "text", text: JSON.stringify({
        query: "q",
        results: [
          { url: "https://x263.example/stamped", title: "t", snippet: "s", source: "tavily", archiveRowId: 4242 },
          { url: "https://x263.example/plain", title: "t2", snippet: "s2", source: "tavily" },
        ],
      }) }],
    }];
    const distilled = distillGap(stamped, 0);
    assert(distilled.results[0]!.archiveRowId === 4242,
      "P20: the archive row id travels with the distilled result (got " + String(distilled.results[0]!.archiveRowId) + ")");
    assert(distilled.results[1]!.archiveRowId === undefined,
      "P20: a result with no recorded row stays without an id (the URL bridge covers it)");
    // A junk annotation must not become an id (id 0 or a float would resolve to
    // no row and silently drop the dependency).
    const junk = distillGap([{
      role: "toolResult",
      name: "search",
      content: [{ type: "text", text: JSON.stringify({
        query: "q",
        results: [
          { url: "https://x263.example/zero", title: "t", snippet: "s", source: "tavily", archiveRowId: 0 },
          { url: "https://x263.example/float", title: "t", snippet: "s", source: "tavily", archiveRowId: 1.5 },
        ],
      }) }],
    }], 0);
    assert(junk.results.every((r) => r.archiveRowId === undefined),
      "P20: a non-positive or fractional row id is dropped, not recorded");
    // And the write path prefers the ids over the URLs.
    const byRead = readSummarySourcesForWrite(
      {
        resolveSummarySources: () => [{ kind: "material", id: 999 }],
        resolveSummarySourcesFromReads: (reads2: Array<{ url: string; rowId?: number | null }>) =>
          reads2.map((r: { url: string; rowId?: number | null }) => ({ kind: "material" as const, id: r.rowId ?? 777 })),
      },
      { gapUrls: distilled.results.map((r) => r.url), gapReads: distilled.results.map((r) => ({ url: r.url, rowId: r.archiveRowId ?? null })) },
    );
    const byReadIds = byRead.ok ? byRead.sources.map((r) => r.id) : [];
    assert(byRead.ok === true && byReadIds.includes(4242) && !byReadIds.includes(999),
      "P20: the write resolves the reads by id, not by URL (got " + JSON.stringify(byReadIds) + ")");
  }

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
