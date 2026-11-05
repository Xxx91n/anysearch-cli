// Engine sufficiency anchor tests (#48, T7 decision #93 — issue #106).
// A search that clears the provider/budget checks and has both the anchors port
// and sessionId attempts one append-only "sufficiency" resume_anchor write after
// computeSufficiency; it is an attempt, not a guaranteed row — a write failure
// fails open with a named stderr line and the store skips secret-matching payloads.
// Cases below also assert the inert path when sessionId is absent.

import { RetroaererdEngine } from "../src/engine";
import { createEngine } from "../src/composition";
import { SqliteSessionStore, BudgetLedger } from "@anysearch-cli/store";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, FusedEnvelope } from "@anysearch-cli/retriever";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function mockProvider(id: string, urls: string[]): SearchProvider {
  return {
    id,
    modes: ["fast", "index", "deep", "answer"],
    async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url,
        title: id + " result " + i,
        snippet: "snippet " + i,
        source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 10 };
    },
  };
}

async function main() {
  const store = new SqliteSessionStore(":memory:");
  const session = await store.createSession("test-domain");

  // 1. One sufficiency anchor for a qualified search, with the replay payload fields.
  const engine1 = new RetroaererdEngine(
    [
      mockProvider("tavily", ["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
      mockProvider("exa", ["https://example.com/b", "https://other.org/d", "https://third.net/e"]),
    ],
    {
      sessionId: session.id,
      anchors: { saveAnchor: (sid, type, payload) => store.saveAnchor(sid, type, payload) },
    },
  );
  const r1: FusedEnvelope = await engine1.search({ query: "anchor me", mode: "fast" });
  const anchors1 = (await store.getAnchors(session.id)).filter((a) => a.anchorType === "sufficiency");
  assert(anchors1.length === 1, "1: exactly one sufficiency anchor after one search");
  const p1 = anchors1[0].payload as Record<string, unknown>;
  assert(typeof p1.retrievalTraceId === "string" && p1.retrievalTraceId.length > 0, "1: retrievalTraceId present");
  assert(p1.query === "anchor me", "1: query echoed");
  assert(p1.mode === "fast", "1: mode echoed");
  assert(typeof (p1.mvs as Record<string, unknown>).verdict === "string", "1: MVSS verdict present");
  assert((p1.mvs as { verdict?: unknown }).verdict === r1.metadata?.sufficiency?.verdict, "1: anchor verdict matches envelope verdict");
  const perProvider = p1.perProvider as Array<Record<string, unknown>>;
  assert(Array.isArray(perProvider) && perProvider.length === 2, "1: perProvider covers both providers");
  assert(perProvider.every((pp) => typeof pp.id === "string" && Array.isArray(pp.results)), "1: perProvider entries carry id + results");
  assert(Array.isArray(p1.providersFailed) && (p1.providersFailed as string[]).length === 0, "1: providersFailed recorded");
  assert(Array.isArray(p1.providersCancelled), "1: providersCancelled recorded");
  assert(typeof p1.uniqueResults === "number" && (p1.uniqueResults as number) > 0, "1: uniqueResults counted");
  assert(Array.isArray(p1.uniqueDomains) && (p1.uniqueDomains as string[]).length >= 2, "1: uniqueDomains counted");

  // 2. Append-only: a second search adds a second sufficiency row (no UPSERT).
  await engine1.search({ query: "anchor me again", mode: "fast" });
  const anchors2 = (await store.getAnchors(session.id)).filter((a) => a.anchorType === "sufficiency");
  assert(anchors2.length === 2, "2: second search appends a second anchor");
  assert((anchors2[0].payload as Record<string, unknown>).query === "anchor me"
    && (anchors2[1].payload as Record<string, unknown>).query === "anchor me again", "2: both rows retained with their own payloads");

  // 3. Fail-open: a rejecting port never blocks the envelope, stderr names the fault.
  const failing = new RetroaererdEngine(
    [mockProvider("solo", ["https://solo.com/x"])],
    {
      sessionId: session.id,
      anchors: { saveAnchor: () => Promise.reject(new Error("disk on fire")) },
    },
  );
  const stderrLines: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string) => { stderrLines.push(chunk); return true; };
  let r3: FusedEnvelope | undefined;
  try {
    r3 = await failing.search({ query: "fail open", mode: "fast" });
  } finally {
    (process.stderr as { write: (chunk: string) => boolean }).write = origWrite;
  }
  assert(r3 !== undefined && r3.results.length > 0, "3: envelope returned despite anchor write failure");
  assert(stderrLines.some((l) => l.includes("[anysearch] sufficiency anchor write failed:") && l.includes("disk on fire")), "3: named stderr line emitted");

  // 4. No write without a sessionId (port alone is inert) — mirrors the ledger gate.
  const engine4 = new RetroaererdEngine(
    [mockProvider("anon", ["https://anon.com/y"])],
    { anchors: { saveAnchor: (sid) => store.saveAnchor(sid, "sufficiency", {}) } },
  );
  await engine4.search({ query: "no session", mode: "fast" });
  const anchors4 = (await store.getAnchors(session.id)).filter((a) => a.anchorType === "sufficiency");
  assert(anchors4.length === 2, "4: no anchor written without sessionId");

  // 5. Composition root: the injected ledger and anchors share the store's
  //    connection, and a session-scoped search lands the sufficiency anchor and
  //    the budget settle in that store (search-to-store coverage — the gap the
  //    old comment deferred to sessionId wiring, T2 #177).
  //    An empty-sources domain keeps createEngine from building real providers
  //    (they are keyless-capable and would hit the network); the mock arm below
  //    is the only fanout member.
  const domainsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-177-"));
  fs.writeFileSync(path.join(domainsDir, "mockonly.toml"), [
    'name = "mockonly"',
    '[skills]',
    'active = []',
    '[sources]',
    'enabled = []',
    '[rag]',
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
  const eng = createEngine("mockonly", {
    domainsDirs: [domainsDir],
    // explicit caps make the settle observable; the default is unlimited.
    budgetCaps: { tokenCap: 1_000_000, usdCap: 10, timeLimitMs: 60_000, callCap: 100 },
  });
  // register a deterministic arm so the search reaches the engine.
  assert(eng.config !== undefined, "5: mockonly domain loaded (no real-provider fallback)");
  (eng.retriever as unknown as { registerProvider: (p: SearchProvider) => void })
    .registerProvider(mockProvider("composition", ["https://comp.example/x"]));
  const port = (eng.retriever as unknown as { anchors?: { saveAnchor?: unknown } }).anchors;
  assert(port !== undefined && typeof port.saveAnchor === "function", "5: createEngine injects the anchors port");
  const compSession = await eng.store.createSession("composition-domain");
  await eng.retriever.search({ query: "composition anchor", mode: "fast", sessionId: compSession.id });
  const compAnchors = (await eng.store.getAnchors(compSession.id)).filter((a) => a.anchorType === "sufficiency");
  assert(compAnchors.length === 1, "5: createEngine search writes one sufficiency anchor to its own store");
  assert((compAnchors[0].payload as Record<string, unknown>).query === "composition anchor", "5: the anchor carries this search's query");
  // the ledger handed to the engine is the store's connection: its budget row
  // is readable through that same store.
  const compLedger = new BudgetLedger((eng.store as unknown as { db: any }).db);
  const compBalance = compLedger.getBalance(compSession.id);
  assert(compBalance !== null && compBalance.billableCalls === 1 && compBalance.reservedCalls === 0, "5: composition ledger settled the per-call budget on the same connection");

  // 6. Per-call reserve→settle end-to-end: within cap passes, over cap is
  //    rejected by the ledger's existing semantics (no non-negative change).
  const budgetSession = await store.createSession("budget-domain");
  const ledger = new BudgetLedger((store as unknown as { db: any }).db);
  ledger.initBudget(budgetSession.id, { tokenCap: 1_000_000, usdCap: 10, timeLimitMs: 60_000, callCap: 2 });
  const budgetEngine = new RetroaererdEngine(
    [
      mockProvider("one", ["https://one.example/a"]),
      mockProvider("two", ["https://two.example/b"]),
    ],
    { sessionId: budgetSession.id, ledger },
  );
  await budgetEngine.search({ query: "within budget", mode: "fast" });
  const afterFirst = ledger.getBalance(budgetSession.id)!;
  assert(afterFirst.billableCalls === 2 && afterFirst.reservedCalls === 0, "6: reserve→settle records the actual provider count");
  let overCapError = "";
  try {
    await budgetEngine.search({ query: "over budget", mode: "fast" });
  } catch (e) {
    overCapError = String(e instanceof Error ? e.message : e);
  }
  assert(overCapError.includes("Budget exceeded"), "6: a search over the per-call cap is rejected");
  const afterSecond = ledger.getBalance(budgetSession.id)!;
  assert(afterSecond.billableCalls === 2 && afterSecond.reservedCalls === 0, "6: the rejected reserve leaves the balance intact");

  // 7. Composition root + explicit caps: the adapter's lazy row and the engine's
  //    gate work together on the production-shaped path (createEngine + Query.sessionId).
  const tight = createEngine("mockonly", {
    domainsDirs: [domainsDir],
    budgetCaps: { tokenCap: 1_000_000, usdCap: 10, timeLimitMs: 60_000, callCap: 1 },
  });
  (tight.retriever as unknown as { registerProvider: (p: SearchProvider) => void })
    .registerProvider(mockProvider("tight", ["https://tight.example/x"]));
  const tightSession = await tight.store.createSession("tight-domain");
  await tight.retriever.search({ query: "first", mode: "fast", sessionId: tightSession.id });
  let tightError = "";
  try {
    await tight.retriever.search({ query: "second", mode: "fast", sessionId: tightSession.id });
  } catch (e) {
    tightError = String(e instanceof Error ? e.message : e);
  }
  assert(tightError.includes("Budget exceeded"), "7: composition caps reject the second search");
  const tightLedger = new BudgetLedger((tight.store as unknown as { db: any }).db);
  const tightBalance = tightLedger.getBalance(tightSession.id)!;
  assert(tightBalance.billableCalls === 1 && tightBalance.reservedCalls === 0, "7: one settled call, no leaked reservation");

  fs.rmSync(domainsDir, { recursive: true, force: true });

  console.log("--- engine sufficiency anchor tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
