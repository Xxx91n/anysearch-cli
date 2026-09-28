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

import { readFileSync } from "node:fs";

const DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
// R88 T4 / F-6: version literals are pinned to the workspace package version —
// the probe speaks as the CLI client; a hand-maintained literal would drift on
// every release. Single read at module load; failure is fatal by design (the
// probe must never misreport which build it ran).
const PROBE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const ARGS = process.argv.slice(2);
const ENDPOINT = ARGS.includes("--default-endpoint") ? DEFAULT_ENDPOINT
  : (process.env.ANYSEARCH_ENDPOINT || DEFAULT_ENDPOINT); // POSIX: empty env ≡ unset
const KEY = ARGS.includes("--nokey") ? "" : (process.env.ANYSEARCH_API_KEY || ""); // POSIX: empty env ≡ unset
const QUERY = process.env.ANS_PROBE_QUERY || "cloudflare workers"; // POSIX: empty env ≡ unset
const UA = "anysearch-cli-raw-probe/" + PROBE_VERSION;

function sanitize(s: string): string {
  // R88 T4 / F-6: symmetric masking — the env-provided endpoint may carry an
  // internal hostname, so it is masked like the key. Placeholders match
  // probe-anysearch-provider.ts scrub() (<endpoint>/<key>) so redaction reads
  // identically across both probes. Guards first: empty values would split
  // per-character.
  let t = s;
  const ep = process.env.ANYSEARCH_ENDPOINT;
  if (ep) t = t.split(ep).join("<endpoint>");
  if (KEY) t = t.split(KEY).join("<key>"); // never echo the key even if upstream reflects it
  return t;
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
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "anysearch-raw-probe", version: PROBE_VERSION } },
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
