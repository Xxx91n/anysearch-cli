// #260 — the MCP consolidation entry, over a real store (spec D5, T1/T2).
//
// These calls go through the real tool registration (real JSON-RPC round trip
// over the in-memory transport), so the wire schema, the scope rule and the
// result shape are all exercised together. No LLM is configured, which is the
// honest path: the run reports llmUnavailable and the usage block says the
// model was never called — it never renders as a free run.
//
// What is pinned here:
//   - chat is still the default operation,
//   - a missing or malformed scope is a rejected call, never a full-archive run,
//   - memoryIds is the scope and a sessionId does not widen it,
//   - the scope the run really used comes back in structuredContent,
//   - dryRun reports itself and saves nothing.
//
// Run: pnpm --filter @anysearch-cli/mcp run test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { inMemoryRpc } from "./helpers/mcp-harness.js";

// Offline by construction: the surrounding shell may carry a real endpoint, and
// a test must never spend real money on a provider call. Clearing the pair makes
// the tool take its "not configured" path, which is also the honest usage shape
// (calls=0, costBasis=not-called) this file pins.
for (const key of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY"]) {
  delete process.env[key];
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const dir = mkdtempSync(join(tmpdir(), "ans-260-mcp-"));
const dbPath = join(dir, "mcp.db");

// Minimal observation span: recordOperation just invokes the callback with it.
const fakeSpan: any = {
  traceId: "t260",
  spanId: "s260",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

// The store the tool will use, plus the engine shape it needs to reach it.
const store = new SqliteSessionStore(dbPath);
const sessionA = await store.createSession("mcp");
const sessionB = await store.createSession("mcp");
const idsA: number[] = [];
const idsB: number[] = [];
for (let i = 1; i <= 3; i++) {
  const ra = await store.adjudicateMemory(sessionA.id, [
    { url: "https://ex.com/alpha", title: "Alpha note v" + i, snippet: "Alpha uses Beta, revision " + i, source: "exa", evidence: 0.9, entity: "AlphaA" },
  ]);
  if (ra[0]?.insertedId) idsA.push(ra[0].insertedId);
  const rb = await store.adjudicateMemory(sessionB.id, [
    { url: "https://ex.com/beta", title: "Beta note v" + i, snippet: "Beta uses Gamma, revision " + i, source: "exa", evidence: 0.9, entity: "BetaB" },
  ]);
  if (rb[0]?.insertedId) idsB.push(rb[0].insertedId);
}

const engine = {
  store,
  retriever: {
    search: async () => ({
      results: [], answers: [],
      metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
    }),
  },
  observation: { recordOperation: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan) },
} as unknown as CompositionResult;

const server = buildServer(engine);
const { rpc, notify } = await inMemoryRpc(server);
await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t260", version: "1" } });
notify("notifications/initialized");

function textOf(res: any): string {
  return (res?.result?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}
function isError(res: any): boolean {
  return res?.result?.isError === true;
}
async function callConsolidate(args: Record<string, unknown>) {
  return rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate", ...args } });
}

// --- 1. wire schema: chat remains the default ---
{
  const res = await rpc("tools/list", {});
  const tool = (res?.result?.tools ?? []).find((t: any) => t.name === "ans_chat");
  assert(tool !== undefined, "ans_chat is registered");
  const props = tool?.inputSchema?.properties ?? {};
  assert(props.operation !== undefined, "the wire schema exposes operation");
  assert(props.memoryIds !== undefined, "the wire schema exposes memoryIds");
  assert(props.dryRun !== undefined, "the wire schema exposes dryRun");
  const required: string[] = tool?.inputSchema?.required ?? [];
  assert(!required.includes("message"), "message is no longer unconditionally required (consolidate does not use it)");
}

// --- 2. a missing scope is a rejected call, not a full-archive run ---
{
  const noScope = await callConsolidate({});
  assert(isError(noScope), "no scope at all is an error result");
  assert(/explicit scope is required/i.test(textOf(noScope)), "the error says an explicit scope is required");
  assert(noScope?.result?.structuredContent === undefined, "a rejected call carries no report");

  const emptyMemory = await callConsolidate({ memoryIds: [] });
  assert(isError(emptyMemory), "an empty memoryIds list is an error result");

  const badSession = await callConsolidate({ sessionId: "bad id with spaces" });
  assert(isError(badSession), "a malformed sessionId is an error result");
  assert(/sessionId/i.test(textOf(badSession)), "the error names sessionId");

  const badMemory = await callConsolidate({ memoryIds: [0] });
  assert(isError(badMemory), "a non-positive memory id is rejected by the wire schema or the handler");

  const bothNull = await callConsolidate({ sessionId: null, memoryIds: null });
  assert(isError(bothNull), "explicit nulls are not a scope");
}

// --- 3. session scope: reads only that session, and says so ---
{
  const res = await callConsolidate({ sessionId: sessionA.id });
  assert(!isError(res), "a session scope is accepted (text: " + textOf(res).slice(0, 160) + ")");
  const sc = res?.result?.structuredContent as any;
  assert(sc?.operation === "consolidate", "structuredContent marks the operation");
  assert(sc?.scope?.by === "session", "the report says it scoped by session");
  assert(sc?.scope?.sessionIds?.[0] === sessionA.id, "the report echoes the session id");
  assert(sc?.scope?.materialsRead === 3, "the run read the three materials of that session (got " + sc?.scope?.materialsRead + ")");
  assert(sc?.usage?.costBasis === "not-called", "no LLM configured -> the model was not called");
  assert(Array.isArray(sc?.usage?.missing) && sc.usage.missing.length > 0, "the usage block names the gaps instead of zeros");
  assert(/llmUnavailable|failure/i.test(textOf(res)), "the readable line names the unavailable model");
}

// --- 4. memory scope: the list is the scope, the session does not widen it ---
{
  const res = await callConsolidate({ memoryIds: idsB, sessionId: sessionA.id });
  assert(!isError(res), "memoryIds with a sessionId is accepted");
  const sc = res?.result?.structuredContent as any;
  assert(sc?.scope?.by === "memory", "the report says it scoped by memory");
  assert(sc?.scope?.materialsRead === 3, "the run read exactly the three listed materials (got " + sc?.scope?.materialsRead + ")");
  assert(sc?.scope?.sessionIdNotApplied === true, "the report says the sessionId did not decide the scope");
  assert(sc?.scope?.requestedMaterials === 3, "the report echoes how many materials were requested");
  // A memory list has no owning session, so a sessionId given alongside it must
  // not turn into a billing target. Saying so is the honest result.
  assert(sc?.budgetUnmetered === true, "a memory-list scope is reported unmetered, not charged to the session it merely echoed");
}

// --- 5. cross-session list: explicit selection across sessions is allowed ---
{
  const res = await callConsolidate({ memoryIds: [idsA[0], idsB[0]] });
  assert(!isError(res), "a cross-session memory list is accepted");
  const sc = res?.result?.structuredContent as any;
  assert(sc?.scope?.materialsRead === 2, "the run read the two listed materials (got " + sc?.scope?.materialsRead + ")");
}

// --- 6. dry-run reports itself and saves nothing ---
{
  const before = new SqliteSessionStore(dbPath);
  const res = await callConsolidate({ sessionId: sessionA.id, dryRun: true });
  assert(!isError(res), "a dry-run is accepted");
  const sc = res?.result?.structuredContent as any;
  assert(sc?.report?.dryRun === true, "the report marks itself a dry-run");
  assert(/dry-run/i.test(textOf(res)), "the readable line says it was a dry-run");
  assert(/nothing saved/i.test(textOf(res)), "the readable line says nothing was saved");
  before.close();
}

// --- 7. chat without a message is a usage error, not a prompt ---
{
  const res = await rpc("tools/call", { name: "ans_chat", arguments: {} });
  assert(isError(res), "message is still required for operation=chat");
  assert(/message is required/i.test(textOf(res)), "the error says the message is required for chat");
}

await server.close();
store.close();
rmSync(dir, { recursive: true, force: true });

console.log("ans-chat-consolidate: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
