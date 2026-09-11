// ADR-0056 D-002/D-003: W3C TraceContext + x-anysearch-session-id propagation.
// Both build (hook outbound) and parse (server inbound) live here so the wire
// format is one source of truth and stays dependency-free from @anysearch/store
// (the hook bundle esbuild config forbids the store import path because of
// native deps; see ADR-0055 audit M4 for the rationale).
//
// Wire format:
//   traceparent           : "00-" + <32-hex trace_id> + "-" + <16-hex span_id> + "-01"
//   x-anysearch-session-id: non-empty string (session anchor; never passed to upstream backends)
//
// W3C 3.2.2 says: invalid traceparent MUST be discarded by the receiver; we
// honor that and self-generate a fresh trace_id on parse failure (fallback).
// session_id absence or empty string is treated as "" (MCP path; ADR-0056 D-009).
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const HEADER_TRACEPARENT = "traceparent";
export const HEADER_SESSION_ID = "x-anysearch-session-id";

// W3C TraceContext Level 2 version-00 fixed field.
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export interface PropagationHeaders {
  traceparent: string;
  "x-anysearch-session-id"?: string;
}

// generateTraceIdHex / generateSpanIdHex mirror the observation.ts helpers but
// are duplicated here to keep this module dependency-free. Both produce the
// hex-length shape W3C requires.
export function newTraceIdHex(): string {
  return randomUUID().replace(/-/g, "");
}

export function newSpanIdHex(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// buildPropagationHeaders: hook outbound side. traceId is generated per hook
// process invocation; sessionId is whatever the host stdin supplied (may be "").
export function buildPropagationHeaders(opts: {
  traceId?: string;
  spanId?: string;
  sessionId?: string;
}): PropagationHeaders {
  const traceId = opts.traceId && /^[0-9a-f]{32}$/.test(opts.traceId) ? opts.traceId : newTraceIdHex();
  const spanId = opts.spanId && /^[0-9a-f]{16}$/.test(opts.spanId) ? opts.spanId : newSpanIdHex();
  const out: PropagationHeaders = {
    traceparent: "00-" + traceId + "-" + spanId + "-01",
  };
  if (typeof opts.sessionId === "string" && opts.sessionId.length > 0) {
    out["x-anysearch-session-id"] = opts.sessionId;
  }
  return out;
}

export interface ParsedPropagation {
  traceId: string;     // W3C 32-hex (validated or fallback random)
  spanId: string;      // W3C 16-hex (validated or fallback random)
  sessionId: string;   // "" if absent or empty
  traceparentValid: boolean;
}

// parseAndValidateHeaders: server inbound side. Per W3C 3.2.2, invalid
// traceparent MUST be discarded; we keep the operation observable by marking
// traceparentValid=false and generating a fresh trace_id (OPA-style
// "make the violation visible").
export function parseAndValidateHeaders(req: Pick<IncomingMessage, "headers">): ParsedPropagation {
  const headers = req.headers || {};
  const rawTp = headerString(headers[HEADER_TRACEPARENT]);
  const tpMatch = rawTp ? TRACEPARENT_RE.exec(rawTp) : null;
  const traceId = tpMatch ? tpMatch[1]! : newTraceIdHex();
  const spanId = tpMatch ? tpMatch[2]! : newSpanIdHex();
  const sessionId = headerString(headers[HEADER_SESSION_ID]) ?? "";
  return { traceId, spanId, sessionId, traceparentValid: !!tpMatch };
}

function headerString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  if (typeof v === "string") return v;
  return undefined;
}
