// ADR-0045 D1/D2 (r118 impl): Fusion Governance Contract layer L1 — committed registration payload.
// L0 = rrf.ts pure primitive (governance-free); L2 = MemoryFusion (store session-store.ts) and
// WebFusion (kernel engine.ts) instances with zero data sharing; L3 = top-k consumption contract
// (FusionProvenance in contract.ts). Behavior-conserving round: no algorithm swap, no weight change.
//
// Single-consumer discipline (ADR-0044-adjacent): every registered leaf is consumed by exactly one
// decision point — see the per-field comments; mutation tests prove no dead registrations.

import { createHash } from "node:crypto";

export const FUSION_REGISTRY_SCHEMA = "anysearch/fusion-registry@1";

// ADR-0045 D3 score_kind atom: a fused score is a rank_fusion signal only — never a confidence,
// threshold/abstain, or cross-query-comparable value (Azure hybrid / Weaviate research conclusion).
export const SCORE_KIND = "rank_fusion";

export const FUSION_REGISTRY = Object.freeze({
  schema: FUSION_REGISTRY_SCHEMA,
  // Read-only, deprecate-only enum (D2). Switch governed by D5; never flipped in a governance round.
  algorithm: Object.freeze({ memory: "weighted-rrf", web: "rrf" }),
  // Three historically-collapsed 60s, split into separately registered keys (D2):
  // k_fusion.memory consumed by session-store.ts:searchMemory + fts5.ts:searchMemoryMultiQuery
  // (one MemoryFusion decision point); k_fusion.web consumed by engine.ts:search (WebFusion).
  k_fusion: Object.freeze({ memory: 60, web: 60 }),
  // Consumed by: standalone rrf primitive probes (retriever tests) — was the implicit k default.
  rank_window: 60,
  // Consumed by: packages/store src/eval/runner.ts ROR_WINDOW (RoR ablation window).
  ror_window: 60,
  // weights.memory consumed by session-store.ts + fts5.ts (single MemoryFusion decision point);
  // weights.web consumed by engine.ts (D4 equal weight = null model; sources.weights overlay is
  // user preference, not evidence).
  weights: Object.freeze({
    memory: Object.freeze({ fts: 1.0, entity: 0.5, vector: 0.5, relation: 0.5, semantic: 0.5 }),
    web: Object.freeze({ exa: 1.0, tavily: 1.0, anysearch: 1.0 }),
  }),
  // Consumed by: fts5.ts + session-store.ts conditional activation — an absent arm adds no list
  // (never zero-filled). Item-level annotation stays in natural score order (D3).
  armAbsentSemantics: "conditional-activation-absent-arm-adds-no-list",
});

// Closed sets for fail-fast config validation (domain-schema sources.weights, unknown arm labels).
export const REGISTERED_WEB_PROVIDERS: readonly string[] = Object.keys(FUSION_REGISTRY.weights.web);
export const REGISTERED_MEMORY_ARMS: readonly string[] = Object.keys(FUSION_REGISTRY.weights.memory);

// Canonical JSON with sorted keys so the pin hash is order-stable.
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v)!;
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

// Full 64-hex SHA-256 over the canonical payload (registrationHash-style pinning, ADR-0044 D2).
// The pinned expected value lives in packages/retriever/test/fusion-registry.test.ts — this
// function is the computation side of the drift pair, not a credential.
export function fusionRegistryHash(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload ?? FUSION_REGISTRY), "utf8").digest("hex");
}

// Fail-fast registry weight lookup: an unknown arm label is a configuration error, not a default.
export function registryWeight(instance: "memory" | "web", label: string): number {
  const table = (FUSION_REGISTRY.weights as unknown as Record<string, Record<string, number>>)[instance];
  const w = table[label];
  if (typeof w !== "number") {
    throw new Error("fusion-registry: no registered " + instance + " weight for " + JSON.stringify(label));
  }
  return w;
}

// D3 provenance-missing pair validator: throws unless p carries the full six-field common shape.
export function assertFusionProvenance(p: unknown): void {
  const bad = (m: string): never => { throw new Error("fusion provenance invalid: " + m); };
  if (!p || typeof p !== "object") bad("not an object");
  const o = p as Record<string, unknown>;
  if (o.instance !== "memory" && o.instance !== "web") bad("instance must be memory|web");
  if (o.scoreKind !== SCORE_KIND) bad("scoreKind must be " + SCORE_KIND + " (bare fused score is not confidence)");
  const labels = o.labels, lists = o.lists, weights = o.weights, fusedIds = o.fusedIds;
  if (!Array.isArray(labels) || !Array.isArray(lists) || !Array.isArray(weights) || !Array.isArray(fusedIds)) {
    bad("labels/lists/weights/fusedIds must all be arrays");
  }
  const labelsA = labels as unknown[], listsA = lists as unknown[], weightsA = weights as unknown[];
  if (listsA.length !== labelsA.length || weightsA.length !== labelsA.length) {
    bad("labels/lists/weights must be parallel (got " + labelsA.length + "/" + listsA.length + "/" + weightsA.length + ")");
  }
}
