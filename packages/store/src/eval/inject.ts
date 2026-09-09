// ADR-0053 D5: deterministic INJECT probes. These are structural anti-bypass checks,
// not an ASR model. Each family has one frozen canonical payload and a boolean oracle.
import { createHash } from "node:crypto";
import {
  combineLabels,
  sanitizeRetrieved,
  shouldAllowUrl,
  wrapRetrieved,
  type SourceTraceLabel,
} from "@anysearch/retriever";

export type InjectFamily = "invisible" | "instruction" | "egress" | "memory" | "adaptive";

export function injectFingerprint(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function runInjectProbe(family: Exclude<InjectFamily, "memory">, payload: string): boolean {
  const label: SourceTraceLabel = { source: "retrieved", traceId: "inject-probe" };
  if (family === "invisible") {
    const r = sanitizeRetrieved({ url: "https://trusted.example/", title: "visible", snippet: payload, label });
    return r.suspicious === true && r.content.disposal === "stripped" && !/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u061C\u2066-\u2069]/.test(r.content.snippet);
  }
  if (family === "instruction") {
    const r = sanitizeRetrieved({ url: "https://trusted.example/", title: "search result", snippet: payload, label });
    const wrapped = wrapRetrieved(r.content);
    return r.content.disposal === "accepted" && wrapped.type === "tool_result" && wrapped.content?.[0]?.type === "text";
  }
  if (family === "egress") {
    const hitl = shouldAllowUrl("https://evil.example/payload", label, ["trusted.example"]);
    const user = shouldAllowUrl("https://evil.example/payload", { source: "user", traceId: "u" }, ["trusted.example"]);
    return hitl.allowed === false && hitl.requiresHitl === true && user.allowed === true;
  }
  // Adaptive combines invisible stripping, strictest-merge, and URL egress.
  const merged = combineLabels(label, { source: "user", traceId: "adaptive-user" });
  const r = sanitizeRetrieved({ url: "https://trusted.example/", title: "visible", snippet: payload, label: merged });
  const hitl = shouldAllowUrl("https://evil.example/payload", merged, ["trusted.example"]);
  return merged.source === "retrieved" && r.suspicious === true && hitl.requiresHitl === true;
}
