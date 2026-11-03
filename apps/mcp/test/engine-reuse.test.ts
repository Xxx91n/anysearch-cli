// #112 acceptance — MCP engine reuse is per-CONNECTION, never per-request.
//
// Design(#40, decision #91): the HTTP entry builds ONE composition at startup;
// the stateless contract only requires a fresh protocol-level McpServer +
// transport per request. Four proofs below:
//
//   A. HTTP: the per-request factory runs once per request but always receives
//      the SAME engine reference the entry built — no hidden re-composition.
//   B. buildServer(engine) composes nothing: with a cold HOME and a DB path
//      under a non-existent directory, the injected-engine path creates neither
//      the directory nor the sqlite file (=> no new better-sqlite3 connections).
//   C. Statelessness survives the shared engine: concurrent requests with
//      different clientInfo keep isolated client_id values and no request-scoped
//      sessionId lands on the composition.
//   D. The identity seam itself: an initialize payload names the client, every
//      other method carries nothing (no state is invented between requests).
//
// Seam: real buildServer()/createHttpApp() with a mock engine (offline, no LLM).
// No test framework (repo convention).

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { mapMcpClientId } from "@anysearch-cli/store";
import { buildServer } from "../src/server.js";
import { createHttpApp, extractClientInfoName } from "../src/http-app.js";
import { runWithMcpIdentity } from "../src/mcp-context.js";
import { observeTool } from "../src/tools/observation.js";
import { createMockEngine } from "./helpers/mock-engine.js";

let passed = 0;
let failed = 0;
/**
 * Minimal assertion helper (repo convention: no test framework).
 *
 * Counts a pass or prints the failure, so the process exit code can gate CI.
 *
 * @param cond Condition that must hold.
 * @param msg Failure description printed when the condition does not hold.
 */
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

// ---------------------------------------------------------------------------
// A. HTTP: one engine reference across N requests
// ---------------------------------------------------------------------------
const engine = createMockEngine();
const seen: CompositionResult[] = [];
const app = createHttpApp({
  engine,
  version: "0.0.0-test",
  serverFactory: (eng) => {
    seen.push(eng);
    return buildServer(eng);
  },
});

const httpServer = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => httpServer.once("listening", () => resolve()));
const base = "http://127.0.0.1:" + (httpServer.address() as AddressInfo).port;

/**
 * Posts a JSON-RPC payload to the app under test and parses the JSON response.
 *
 * @param body JSON-RPC request body.
 * @returns HTTP status plus the decoded JSON body.
 */
async function post(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const REQUEST_COUNT = 8;
for (let i = 0; i < REQUEST_COUNT; i++) {
  const r = await post({ jsonrpc: "2.0", id: i + 1, method: "tools/list", params: {} });
  assert(r.status === 200, "A: tools/list request " + (i + 1) + " returns 200");
  assert(
    Array.isArray(r.json?.result?.tools) && r.json.result.tools.length === 5,
    "A: tools/list request " + (i + 1) + " still serves the 5 tools",
  );
}
assert(
  seen.length === REQUEST_COUNT,
  "A: per-request factory runs once per request (" + seen.length + "/" + REQUEST_COUNT + ")",
);
assert(
  seen.every((eng) => eng === engine),
  "A: every request received the startup engine reference (never a rebuilt one)",
);

// C (HTTP half): two concurrent requests over the shared engine stay isolated.
const [c1, c2] = await Promise.all([
  post({ jsonrpc: "2.0", id: 101, method: "tools/list", params: {} }),
  post({ jsonrpc: "2.0", id: 102, method: "tools/list", params: {} }),
]);
assert(c1.status === 200 && c2.status === 200, "C: concurrent requests both return 200");
assert(
  c1.json?.result?.tools?.length === c2.json?.result?.tools?.length,
  "C: concurrent requests see an identical tool surface",
);

// Drop keep-alive sockets so the test process exits promptly.
httpServer.closeAllConnections();
await new Promise<void>((resolve) => httpServer.close(() => resolve()));

// ---------------------------------------------------------------------------
// B. buildServer(engine) never composes (no DB dir, no DB file, no connections)
// ---------------------------------------------------------------------------
const coldHome = mkdtempSync(join(tmpdir(), "ans-mcp-reuse-"));
const coldDbPath = join(coldHome, "nested", "missing", "anysearch.db");
const savedDbPath = process.env.ANS_DB_PATH;
const savedUserProfile = process.env.USERPROFILE;
const savedHome = process.env.HOME;
process.env.ANS_DB_PATH = coldDbPath;
process.env.USERPROFILE = coldHome;
process.env.HOME = coldHome;
try {
  buildServer(createMockEngine());
  assert(
    !existsSync(join(coldHome, "nested")),
    "B: injected engine must not create the DB directory",
  );
  assert(!existsSync(coldDbPath), "B: injected engine must not open/create the DB file");
} finally {
  if (savedDbPath === undefined) delete process.env.ANS_DB_PATH;
  else process.env.ANS_DB_PATH = savedDbPath;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  rmSync(coldHome, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// C. Statelessness on a shared engine: identity isolated, sessionId never set
// ---------------------------------------------------------------------------
const recordEngine = createMockEngine();
const records: any[] = [];
const span: any = {
  traceId: "reuse-trace",
  spanId: "reuse-span",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(span),
  finish: () => {},
};
(recordEngine as any).observation = {
  recordOperation: async (o: any, cb: any) => {
    records.push(o);
    return cb(span);
  },
};

await Promise.all([
  runWithMcpIdentity({ clientInfoName: "claude-ai" }, () =>
    observeTool(recordEngine, "search_web", () => "first"),
  ),
  runWithMcpIdentity({ clientInfoName: "codex-mcp-client" }, () =>
    observeTool(recordEngine, "search_web", () => "second"),
  ),
]);

const clientIds = records.map((r) => r.clientId).sort();
assert(records.length === 2, "C: one observation record per concurrent request");
assert(
  clientIds.includes(mapMcpClientId("claude-ai")) &&
    clientIds.includes(mapMcpClientId("codex-mcp-client")),
  "C: each request keeps its own client_id (no cross-request bleed)",
);
assert(
  mapMcpClientId("claude-ai") !== mapMcpClientId("codex-mcp-client"),
  "C: the two identities really are distinct",
);
assert(
  records.every((r) => r.sessionId === undefined),
  "C: sessionId stays omitted on the MCP path (stateless protocol)",
);

// ---------------------------------------------------------------------------
// D. Identity seam: per-request clientInfo parsing (no session inheritance)
//
// Stateless HTTP means identity is NEVER carried across requests, so this only
// pins what the current payload yields: an initialize payload names the client,
// any other method carries nothing and falls back to the default MCP client id.
// ---------------------------------------------------------------------------
assert(
  extractClientInfoName({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "claude-ai", version: "1.0.0" } },
  }) === "claude-ai",
  "D: initialize payload yields its clientInfo name",
);
assert(
  extractClientInfoName({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_web" } }) ===
    undefined,
  "D: tools/call carries no identity of its own (stateless, no inherited clientInfo)",
);
assert(
  extractClientInfoName({ method: "initialize", params: { clientInfo: {} } }) === undefined,
  "D: initialize without a client name yields undefined, not an empty id",
);
assert(
  extractClientInfoName({ method: "initialize", params: { clientInfo: { name: 42 } } }) === undefined,
  "D: a non-string client name is ignored",
);
assert(extractClientInfoName(undefined) === undefined, "D: a missing body yields undefined");

console.log("--- mcp engine-reuse tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
