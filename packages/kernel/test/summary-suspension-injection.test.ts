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
import { MemoryPipeline, readSummarySourcesForWrite, collectRecallSourceRefs } from "../src/memory-pipeline";
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
  {
    const l2Store = new SqliteSessionStore(join(dir, "l2.db"));
    const l2Session = "session-l2";
    await l2Store.createSession("acme");
    await l2Store.ensureSession(l2Session, "acme");
    // The FIRST hit alone exceeds the whole budget (3012 chars vs 2000), so it
    // is truncated to fit and the second hit can never be included. Fusion
    // order puts the big one first because it is the only match for the query.
    const bigText = "BIGFIRST263 " + "y".repeat(3000);
    const otherText = "BIGFIRST263 OTHER263 filler text here";
    const big = (await l2Store.adjudicateMemory(l2Session, [
      { url: "https://l2.example/big", title: "BIGFIRST263", snippet: bigText, source: "tavily", evidence: 0.9, entity: "b-big" },
    ]))[0]!.insertedId!;
    const other = (await l2Store.adjudicateMemory(l2Session, [
      { url: "https://l2.example/other", title: "OTHER263", snippet: otherText, source: "tavily", evidence: 0.9, entity: "b-other" },
    ]))[0]!.insertedId!;
    // The query reaches BOTH rows: the store's fusion returns `big` first (it
    // owns the unique term) and `other` as a second candidate. Stating that here
    // is what makes the exclusion assertion below meaningful — `other` must
    // really be in the returned list for "it was not recorded" to test anything.
    const l2Runtime = new MemoryPipeline({
      store: l2Store as any,
      retriever,
      domain,
      model: { id: "test" } as any,
      streamFn: (() => ({ async *[Symbol.asyncIterator]() {} })) as any,
      sessionId: l2Session,
      llmRewriteFn: undefined,
    });
    // Both rows mention the term, so the KEYWORD lane reaches both — no reliance
    // on the optional embedding arm (which is absent when the package or model is
    // unavailable, a state the source itself calls legitimate).
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
    // Provenance of the fixture: the second row really WAS returned by recall,
    // so excluding it below is not vacuous.
    const returned = await l2Store.searchMemory("BIGFIRST263", 5);
    const returnedIds = returned.map((h: any) => Math.abs(Number(h.rowid)));
    assert(returnedIds.includes(other),
      "P11 fixture: the second row is among the recalled hits (got " + JSON.stringify(returnedIds) + ")");
    assert(returnedIds[0] === big,
      "P11 fixture: the big row is first in fusion order, so it owns the text budget");
    assert(String(payload.hits).includes("BIGFIRST263"),
      "P11 fixture: the big hit is the one that fills the block");
    assert(!String(payload.hits).includes("OTHER263"),
      "P11 fixture: the second hit's text was NOT included (its text is absent)");
    assert(ids.includes(big), "P11: the hit that fills the block is recorded as its source");
    assert(!ids.includes(other),
      "P11: a hit whose text was truncated away is NOT recorded (got " + JSON.stringify(ids) + ")");
    const storedHits = String(payload.hits);
    assert(storedHits.startsWith("BIGFIRST263"),
      "P11: the stored block starts with the hit whose source was recorded");
    assert(storedHits.length === 2000,
      "P11: the top hit alone exceeded the budget, so the stored text is the capped block (len=" + storedHits.length + ")");
    l2Store.close();
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
