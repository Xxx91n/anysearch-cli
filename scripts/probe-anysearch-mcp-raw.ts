#!/usr/bin/env node
// R86 T2 batch-2 — P2 raw MCP probe: speaks Streamable HTTP MCP to the
// AnySearch endpoint directly (no provider layer) and prints the RAW
// tools/call text payload so upstream reply-shape anomalies are attributable.
// Values never logged: endpoint is recorded as source-class only; API key
// existence only.
//
//   node --import tsx scripts/probe-anysearch-mcp-raw.ts [--default-endpoint] [--nokey]
//
// Exit 0 = results-shaped reply; 2 = transport/tool failure; 3 = non-results
// text shape (the discriminating case this probe exists for).

const DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
const ARGS = process.argv.slice(2);
const ENDPOINT = ARGS.includes("--default-endpoint") ? DEFAULT_ENDPOINT
  : (process.env.ANYSEARCH_ENDPOINT ?? DEFAULT_ENDPOINT);
const KEY = ARGS.includes("--nokey") ? "" : (process.env.ANYSEARCH_API_KEY ?? "");
const QUERY = process.env.ANS_PROBE_QUERY ?? "cloudflare workers";
const UA = "anysearch-cli-raw-probe/0.1";

function sanitize(s: string): string {
  if (!KEY) return s; // empty KEY would split per-char — guard first
  return s.split(KEY).join("***"); // never echo the key even if upstream reflects it
}

async function post(body: unknown, sessionId: string | null, protocolVersion: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "User-Agent": UA,
  };
  if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;
  if (sessionId) headers["MCP-Session-Id"] = sessionId;
  if (KEY) headers["Authorization"] = "Bearer " + KEY;
  const resp = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = resp.headers.get("mcp-session-id");
  const text = await resp.text();
  return { status: resp.status, sessionId: sid, text };
}

function parseRpc(text: string): any {
  // Streamable HTTP may answer with plain JSON or an SSE stream.
  if (text.trimStart().startsWith("{")) return JSON.parse(text);
  const dataLines = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  for (const d of dataLines) { try { return JSON.parse(d); } catch { /* keep last parseable */ } }
  throw new Error("unparseable response body: " + text.slice(0, 120));
}

const out: Record<string, unknown> = {
  schema: "anysearch/mcp-raw-probe@1",
  endpointSource: ARGS.includes("--default-endpoint") ? "default(forced)" : process.env.ANYSEARCH_ENDPOINT ? "env" : "default",
  keyPresent: !!KEY,
};

try {
  const init = await post({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "anysearch-raw-probe", version: "0.1.0" } },
  }, null, null);
  if (init.status !== 200) { out.ok = false; out.stage = "initialize"; out.httpStatus = init.status; console.log(JSON.stringify(out)); process.exit(2); }
  const initBody = parseRpc(init.text);
  const negotiated = initBody?.result?.protocolVersion ?? "2025-03-26";
  const sessionId = init.sessionId;

  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, negotiated);

  const call = await post({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "search", arguments: { query: QUERY } },
  }, sessionId, negotiated);
  out.httpStatus = call.status;
  if (call.status !== 200) { out.ok = false; out.stage = "tools/call"; out.bodyHead = sanitize(call.text.slice(0, 200)); console.log(JSON.stringify(out)); process.exit(2); }
  const rpc = parseRpc(call.text);
  out.rpcError = rpc.error ? { code: rpc.error.code, messageHead: sanitize(String(rpc.error.message ?? "").slice(0, 200)) } : null;
  const result = rpc.result;
  out.isError = result?.isError ?? null;
  const texts = (result?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => sanitize(String(c.text ?? "")));
  const joined = texts.join("\n---\n");
  out.textHead = joined.slice(0, 600);
  out.textLen = joined.length;
  out.hasResultsHeader = joined.includes("## Search Results");
  out.ok = out.hasResultsHeader && !out.isError;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : out.isError ? 2 : 3);
} catch (e) {
  out.ok = false; out.stage = "exception";
  out.errorName = (e as Error).name; out.errorMessage = sanitize(String((e as Error).message ?? e).slice(0, 300));
  console.log(JSON.stringify(out)); process.exit(2);
}
