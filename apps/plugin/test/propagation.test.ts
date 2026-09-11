// ADR-0056 D-003/T8/T9: Hook+Server wire-format golden case.
//
// Two layers:
// (a) buildPropagationHeaders / parseAndValidateHeaders round-trip + edge cases.
//     All assertions are inlined (no for-loop) so the grep call count matches
//     the PASS count exactly; the audit's grep-based counting methodology now
//     lines up with the report's number.
// (b) W3C 3.2.2 invalid traceparent MUST be discarded (fresh trace_id generated).
// (c) session_id absent/empty -> "" (MCP path / never-throw).
// (d) build/parse mutual consistency: every build() result is parseable back to
//     the same trace_id + session_id.
//
// The store-side SELECT-back evidence is covered by packages/store/test/
// session-id-propagation.test.ts; this file focuses on the wire format itself
// and its rejection semantics. End-to-end (hook->server->store->SELECT) is
// covered by apps/plugin/test/golden.test.ts.

import { buildPropagationHeaders, parseAndValidateHeaders, newTraceIdHex, newSpanIdHex, HEADER_TRACEPARENT, HEADER_SESSION_ID } from "../src/hooks/propagation.js";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label); }
}

async function main() {
  // --- constants ---
  check("HEADER_TRACEPARENT = traceparent", HEADER_TRACEPARENT === "traceparent");
  check("HEADER_SESSION_ID = x-anysearch-session-id", HEADER_SESSION_ID === "x-anysearch-session-id");

  // --- build happy path ---
  const sessionId = "abcdef0123456789abcdef0123456789";
  const traceId = newTraceIdHex();
  const spanId = newSpanIdHex();
  const headers = buildPropagationHeaders({ sessionId, traceId, spanId });
  check("build: traceparent format 00-<32hex>-<16hex>-01", headers.traceparent === "00-" + traceId + "-" + spanId + "-01");
  check("build: x-anysearch-session-id propagated", headers["x-anysearch-session-id"] === sessionId);
  check("build: trace_id in traceparent is 32 hex", /^[0-9a-f]{32}$/.test(headers.traceparent.split("-")[1]!));
  check("build: span_id in traceparent is 16 hex", /^[0-9a-f]{16}$/.test(headers.traceparent.split("-")[2]!));

  // --- parse happy path ---
  const parsed = parseAndValidateHeaders({
    headers: {
      traceparent: headers.traceparent,
      "x-anysearch-session-id": headers["x-anysearch-session-id"],
    },
  });
  check("parse: trace_id recovered", parsed.traceId === traceId);
  check("parse: span_id recovered", parsed.spanId === spanId);
  check("parse: session_id recovered", parsed.sessionId === sessionId);
  check("parse: traceparentValid true", parsed.traceparentValid === true);

  // --- W3C 3.2.2 invalid traceparent MUST be discarded (inlined, one per case) ---
  const tpEmpty = parseAndValidateHeaders({
    headers: { traceparent: "", "x-anysearch-session-id": "kept" },
  });
  check("invalid (empty) -> traceparentValid false", tpEmpty.traceparentValid === false);
  check("invalid (empty) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpEmpty.traceId));
  check("invalid (empty) -> session_id preserved", tpEmpty.sessionId === "kept");

  const tpGarbage = parseAndValidateHeaders({
    headers: { traceparent: "garbage", "x-anysearch-session-id": "kept" },
  });
  check("invalid (non-w3c) -> traceparentValid false", tpGarbage.traceparentValid === false);
  check("invalid (non-w3c) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpGarbage.traceId));
  check("invalid (non-w3c) -> session_id preserved", tpGarbage.sessionId === "kept");

  const tpShort = parseAndValidateHeaders({
    headers: { traceparent: "00-deadbeef-1234-01", "x-anysearch-session-id": "kept" },
  });
  check("invalid (short trace_id) -> traceparentValid false", tpShort.traceparentValid === false);
  check("invalid (short trace_id) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpShort.traceId));
  check("invalid (short trace_id) -> session_id preserved", tpShort.sessionId === "kept");

  const tpNonHex = parseAndValidateHeaders({
    headers: { traceparent: "00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-1234567890abcdef-01", "x-anysearch-session-id": "kept" },
  });
  check("invalid (non-hex chars) -> traceparentValid false", tpNonHex.traceparentValid === false);
  check("invalid (non-hex chars) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpNonHex.traceId));
  check("invalid (non-hex chars) -> session_id preserved", tpNonHex.sessionId === "kept");

  const tpWrongVer = parseAndValidateHeaders({
    headers: { traceparent: "01-1234567890abcdef1234567890abcdef-1234567890abcdef-01", "x-anysearch-session-id": "kept" },
  });
  check("invalid (wrong version) -> traceparentValid false", tpWrongVer.traceparentValid === false);
  check("invalid (wrong version) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpWrongVer.traceId));
  check("invalid (wrong version) -> session_id preserved", tpWrongVer.sessionId === "kept");

  const tpMissingFlags = parseAndValidateHeaders({
    headers: { traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef", "x-anysearch-session-id": "kept" },
  });
  check("invalid (missing flags) -> traceparentValid false", tpMissingFlags.traceparentValid === false);
  check("invalid (missing flags) -> fresh 32-hex trace_id", /^[0-9a-f]{32}$/.test(tpMissingFlags.traceId));
  check("invalid (missing flags) -> session_id preserved", tpMissingFlags.sessionId === "kept");

  // --- missing traceparent -> fresh trace_id, empty session_id ---
  const empty = parseAndValidateHeaders({ headers: {} });
  check("no headers -> traceparentValid false", empty.traceparentValid === false);
  check("no headers -> fresh trace_id", /^[0-9a-f]{32}$/.test(empty.traceId));
  check("no headers -> session_id empty", empty.sessionId === "");

  // --- empty session_id header is treated as "" (MCP path parity) ---
  const emptySession = parseAndValidateHeaders({
    headers: { traceparent: "00-" + traceId + "-" + spanId + "-01", "x-anysearch-session-id": "" },
  });
  check("empty x-anysearch-session-id -> session_id ''", emptySession.sessionId === "");
  check("empty x-anysearch-session-id -> traceparentValid true", emptySession.traceparentValid === true);

  // --- build with empty sessionId -> header is omitted ---
  const noSession = buildPropagationHeaders({ sessionId: "", traceId, spanId });
  check("build: empty sessionId omits x-anysearch-session-id", !("x-anysearch-session-id" in noSession));
  check("build: traceparent still present", noSession.traceparent.length > 0);

  // --- generate helpers produce 32-hex / 16-hex ---
  const freshTrace = newTraceIdHex();
  const freshSpan = newSpanIdHex();
  check("newTraceIdHex -> 32-hex", /^[0-9a-f]{32}$/.test(freshTrace));
  check("newSpanIdHex -> 16-hex", /^[0-9a-f]{16}$/.test(freshSpan));

  // --- mutual consistency: every build() is parseable back to same values ---
  const t1 = newTraceIdHex();
  const s1 = newSpanIdHex();
  const sid1 = "abcdef1234567890abcdef1234567890";
  const built = buildPropagationHeaders({ sessionId: sid1, traceId: t1, spanId: s1 });
  const reparsed = parseAndValidateHeaders({
    headers: { traceparent: built.traceparent, "x-anysearch-session-id": built["x-anysearch-session-id"]! },
  });
  check("round-trip: trace_id preserved", reparsed.traceId === t1);
  check("round-trip: span_id preserved", reparsed.spanId === s1);
  check("round-trip: session_id preserved", reparsed.sessionId === sid1);
  check("round-trip: traceparentValid true", reparsed.traceparentValid === true);

  console.log("\npropagation tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("propagation test threw:", e);
  process.exit(1);
});