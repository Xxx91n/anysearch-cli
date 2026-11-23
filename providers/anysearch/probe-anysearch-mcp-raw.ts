#!/usr/bin/env node
// batch-2 — P2 raw MCP probe: speaks Streamable HTTP MCP to the
// AnySearch endpoint directly (no provider layer) and prints the tools/call text payload
// — credential-shaped values masked — so upstream reply-shape anomalies are attributable.
// Values never logged: endpoint is recorded as source-class only; API key existence only.
//
// node providers/anysearch/probe-anysearch-mcp-raw.ts [--default-endpoint] [--nokey] [--protocol-version <v>]
//   ANS_PROBE_PROTOCOL_VERSION=<v> is the env form of the flag.
//
// Exit 0 = results-shaped reply; 2 = transport/tool failure (HTTP, JSON-RPC error) or bad
// arguments; 3 = non-results text shape (the discriminating case this probe exists for).

import { readFileSync, writeSync } from "node:fs";

const DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
const SCHEMA = "anysearch/mcp-raw-probe@1";
// version literals are pinned to the workspace package version —
// the probe speaks as the CLI client; a hand-maintained literal would drift on
// every release. Single read at module load; failure is fatal by design (the
// probe must never misreport which build it ran).
const PROBE_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const ARGS = process.argv.slice(2);

// Protocol version: a hand-maintained literal — the probe must keep answering when the
// adapter is broken, so it never loads it (DEFAULT_ENDPOINT is a literal for that reason).
const DEFAULT_PROTOCOL_VERSION = "2025-11-25";
const PROTOCOL_FLAG = "--protocol-version";
const PROTOCOL_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// The probe's only product is its output, and a piped console.log is asynchronous while
// process.exit() does not wait for it to drain — so every exit writes synchronously first.
function emit(body: string, exitCode: number): never {
  try {
    writeSync(1, body + "\n");
  } catch {
    // stdout closed early (`| head -1`): nowhere left to report, but the exit code stands.
  }
  process.exit(exitCode);
}

function refuseArgs(message: string): never {
  emit(JSON.stringify({ schema: SCHEMA, ok: false, stage: "args", errorMessage: sanitize(message).slice(0, 300) }), 2);
}

function protocolVersionValue(raw: string | undefined, source: string): string | undefined {
  const value = raw?.trim();
  // "not given": the flag branch refuses it, the env branch falls back to the default.
  if (!value) return undefined;
  if (!PROTOCOL_VERSION_SHAPE.test(value)) refuseArgs(source + " must be a YYYY-MM-DD version, got: " + value);
  return value;
}

let FORCE_DEFAULT_ENDPOINT = false;
let NO_KEY = false;
let PROTOCOL_ARG_VALUE: string | undefined;
const seen = new Set<string>();
for (let i = 0; i < ARGS.length; i += 1) {
  const token = ARGS[i];
  if (token === "--default-endpoint" || token === "--nokey") {
    if (seen.has(token)) refuseArgs(token + " given twice");
    seen.add(token);
    if (token === "--default-endpoint") FORCE_DEFAULT_ENDPOINT = true;
    else NO_KEY = true;
    continue;
  }
  if (token === PROTOCOL_FLAG || token.startsWith(PROTOCOL_FLAG + "=")) {
    if (seen.has(PROTOCOL_FLAG)) refuseArgs(PROTOCOL_FLAG + " given twice");
    seen.add(PROTOCOL_FLAG);
    const spaced = token === PROTOCOL_FLAG;
    const raw = spaced ? ARGS[i + 1] : token.slice(PROTOCOL_FLAG.length + 1);
    if (spaced) i += 1;
    // A next token that starts with "-" is another flag, not a value: say "needs a value"
    // rather than reporting the flag itself as a malformed version. The "=" form has no
    // such ambiguity, so its value goes straight to the shape check.
    const value = spaced && raw?.startsWith("-") ? undefined : protocolVersionValue(raw, PROTOCOL_FLAG);
    if (!value) refuseArgs(PROTOCOL_FLAG + " needs a value, e.g. " + PROTOCOL_FLAG + " " + DEFAULT_PROTOCOL_VERSION);
    PROTOCOL_ARG_VALUE = value;
    continue;
  }
  refuseArgs("unrecognized argument: " + token);
}
const PROTOCOL_VERSION = PROTOCOL_ARG_VALUE
  || protocolVersionValue(process.env.ANS_PROBE_PROTOCOL_VERSION, "ANS_PROBE_PROTOCOL_VERSION")
  || DEFAULT_PROTOCOL_VERSION;

const ENDPOINT = FORCE_DEFAULT_ENDPOINT ? DEFAULT_ENDPOINT
  : (process.env.ANYSEARCH_ENDPOINT || DEFAULT_ENDPOINT); // POSIX: empty env ≡ unset
const KEY = NO_KEY ? "" : (process.env.ANYSEARCH_API_KEY || ""); // POSIX: empty env ≡ unset
// Which endpoint the run used, as a class; the value itself is never printed.
let ENDPOINT_SOURCE = "default";
if (process.env.ANYSEARCH_ENDPOINT) ENDPOINT_SOURCE = "env";
if (FORCE_DEFAULT_ENDPOINT) ENDPOINT_SOURCE = "default(forced)";
const QUERY = process.env.ANS_PROBE_QUERY || "cloudflare workers"; // POSIX: empty env ≡ unset
const UA = "anysearch-cli-raw-probe/" + PROBE_VERSION;

// Anything the probe prints goes through this. An argument or an upstream reply that
// carries the key or the endpoint must not come back out verbatim — the README says the
// output gets pasted into issues. process.env is read directly because the argument loop
// runs before KEY/ENDPOINT exist. Placeholders match probe-anysearch-provider.ts scrub().
function sanitize(s: string): string {
  let t = s;
  const ep = process.env.ANYSEARCH_ENDPOINT;
  if (ep) t = t.split(ep).join("<endpoint>"); // guards first: empty values would split per-character
  const key = process.env.ANYSEARCH_API_KEY;
  if (key) t = t.split(key).join("<key>");
  // Upstream can hand back a credential we never configured — the anonymous arm gets a key
  // issued inside the reply body — so the shapes go too, prefixes and colon forms included.
  return t
    .replace(/([A-Za-z0-9_-]*(?:api[_-]?key|password)["']?\s*[:=]\s*)["']?[^\s&"',}]+["']?/gi, "$1<key>")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer <key>");
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

type JsonRpcReply = {
  id?: number | string;
  result?: { protocolVersion?: string; isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  error?: { code?: number; message?: string } | null;
};

function parseRpc(text: string, expectedId: number): JsonRpcReply {
  // Streamable HTTP may answer with plain JSON or an SSE stream, and a stream can
  // carry other messages ahead of the reply. Id matching follows the adapter: JSON
  // compares as strings, SSE strictly and takes the last match.
  const json = text.trimStart().startsWith("{");
  const candidates = json
    ? [text]
    : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  let parseable = 0;
  let match: JsonRpcReply | undefined;
  for (const raw of candidates) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    parseable += 1;
    if (typeof parsed !== "object" || parsed === null) continue;
    const reply = parsed as JsonRpcReply;
    const sameId = json ? String(reply.id) === String(expectedId) : reply.id === expectedId;
    if (!sameId) continue;
    match = reply;
    if (json) break; // one body, one reply; an SSE stream keeps the last match like the adapter
  }
  if (match) return match;
  throw new Error(
    (parseable ? "no JSON-RPC reply for id " + expectedId + " in: " : "unparseable response body: ") + text.slice(0, 120),
  );
}

const out: Record<string, unknown> = {
  schema: SCHEMA,
  endpointSource: ENDPOINT_SOURCE,
  keyPresent: !!KEY,
  protocolVersionRequested: PROTOCOL_VERSION,
  // Present on every run that gets past argument checking: null means initialize never got
  // far enough to ask, or upstream stayed silent.
  protocolVersion: null,
};

try {
  const init = await post({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "anysearch-raw-probe", version: PROBE_VERSION } },
  }, null, null);
  if (init.status !== 200) { out.ok = false; out.stage = "initialize"; out.httpStatus = init.status; emit(JSON.stringify(out), 2); }
  const initBody = parseRpc(init.text, 1);
  // The header takes only a shape-valid version: a newline in a header value makes fetch
  // throw, which would read as transport failure. The report keeps upstream's raw answer.
  const rawVersion = initBody?.result?.protocolVersion;
  const upstreamVersion = typeof rawVersion === "string" && rawVersion.length > 0 ? rawVersion : null;
  const negotiated = upstreamVersion !== null && PROTOCOL_VERSION_SHAPE.test(upstreamVersion) ? upstreamVersion : PROTOCOL_VERSION;
  out.protocolVersion = upstreamVersion === null ? null : sanitize(upstreamVersion).slice(0, 64);
  const sessionId = init.sessionId;

  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, negotiated);

  const call = await post({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "search", arguments: { query: QUERY } },
  }, sessionId, negotiated);
  out.httpStatus = call.status;
  // Cap the input before sanitizing: the redaction regex backtracks quadratically
  // on long alphanumeric text, and an error page can be hundreds of KB. The
  // output is only the first 200 chars, so 4000 is ample.
  if (call.status !== 200) { out.ok = false; out.stage = "tools/call"; out.bodyHead = sanitize(call.text.slice(0, 4000)).slice(0, 200); emit(JSON.stringify(out), 2); }
  const rpc = parseRpc(call.text, 2);
  out.rpcError = rpc.error ? { code: rpc.error.code, messageHead: sanitize(String(rpc.error.message ?? "").slice(0, 4000)).slice(0, 200) } : null;
  // A JSON-RPC error is a tool failure (exit 2), not a reply-shape anomaly (3):
  // the adapter throws on the same reply and classifies it, so reporting it as
  // drift would send the reader looking at the payload instead of the error.
  if (rpc.error) out.stage = "tools/call";
  const result = rpc.result;
  out.isError = result?.isError ?? null;
  const texts = (result?.content ?? []).filter((c) => c?.type === "text").map((c) => sanitize(String(c.text ?? "")));
  const joined = texts.join("\n---\n");
  out.textHead = joined.slice(0, 600);
  out.textLen = joined.length;
  out.hasResultsHeader = joined.includes("## Search Results");
  out.ok = out.hasResultsHeader && !out.isError;
  // tool failure (HTTP handled above, or JSON-RPC error) vs reply-shape drift
  let exitCode = 3;
  if (out.ok) exitCode = 0;
  else if (out.isError === true || rpc.error) exitCode = 2;
  emit(JSON.stringify(out, null, 2), exitCode);
} catch (e) {
  out.ok = false; out.stage = "exception";
  out.errorName = (e as Error).name; out.errorMessage = sanitize(String((e as Error).message ?? e).slice(0, 4000)).slice(0, 300);
  emit(JSON.stringify(out), 2);
}
