// Kernel ports: dependency inversion interfaces.
// Seam 3 from atomcode-kernel-split-architecture research.
// Kernel only imports these interfaces; CLI composition root injects implementations.

import type { FusedEnvelope, SearchRequest, SourceTraceLabel } from "@anysearch-cli/retriever";
import type { SessionStore, Message, BudgetConfig } from "@anysearch-cli/store";
export type { T0PreferenceRow, T0PreferenceInput } from "@anysearch-cli/store";

export type Budget = {
  tokenCap?: number;
  usdCap?: number;
  timeLimitMs?: number;
};

// per-call observation sink. The engine emits the dual audit
// events retrieval.domain_filter.pre/post (plus the anysearch.outcome dimension)
// into the caller's active span. Structural subset of pi-telemetry TelemetrySpan
// (addEvent/setAttributes); absent = audit events are not recorded, envelope
// markers still set. Kernel stays free of a pi-telemetry dependency.
export interface RetrievalObservationSink {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setAttributes?(attributes: Record<string, unknown>): void;
}

export type Query = SearchRequest & {
  budget?: Budget;
  providers?: string[]; // restrict to subset of registered providers
  // caller-side recordOperation span for the domain-filter audit events.
  span?: RetrievalObservationSink;
  // T2 #177: per-search session id supplied by the composition path that owns a
  // session (PiAgentRuntime threads the wired CLI anchor / MCP minted handle
  // here). The engine opens its Budget Ledger reserve→settle and Sufficiency
  // Anchor gates only when both the port and a session id are present; a bare
  // `search` call without a session keeps both gates closed (unchanged).
  sessionId?: string;
};

// RetrieverPort: the kernel calls this to search.
export interface RetrieverPort {
  search(q: Query): Promise<FusedEnvelope>;
}

// SessionStorePort: re-export from store package (thin alias).
export type SessionStorePort = SessionStore;

// ToolPort: a tool the agent can call.
export interface ToolPort {
  name: string;
  description: string;
  execute(args: unknown): Promise<unknown>;
}

// DomainConfigPort: provides the active domain tool whitelist.
// decision 4C: full 5-layer interface matching DomainSchema.
// Consumers read only what they need; current consumers use sources + hooks.
export interface DomainConfigPort {
  // optional per-provider weight Record (user preference overlay).
  sources: { enabled: string[]; weights?: Record<string, number> };
  prompts: { name: string; content: string }[];
  // Design: skills.toolRequires is a declarative skill→required-tool-names map —
  // pi-agent-core Skill is a pure prompt carrier, so tool needs cannot be derived
  // from the skill itself (#90); optional — when absent, tool filtering stays
  // hooks.toolWhitelist-only.
  skills: { active: string[]; toolRequires?: Record<string, string[]> };
  hooks: { toolWhitelist: string[] };
  rag: { adapter: string; config?: Record<string, unknown> };
  // #187: optional domain budget declaration. Runtime consumers read the caps
  // and the output reserve from here; an absent section means unmetered.
  budget?: BudgetConfig;
  // compaction config for independent summary model.
  // mirror store CompactionConfig shape — single type defined in
  // packages/store/src/domain-schema.ts; referenced here to avoid drift.
  compaction?: {
    model?: string;
    sufficiencyMaxRerounds?: number;
    lowWatermark?: number | { fraction: number };
    reuseCap?: number;
  };
}

// BudgetLedgerPort: per-call reserve-then-settle interface.
// decision 2A: defined as port (one implementation now, two = real seam).
export interface BudgetLedgerPort {
  reserveCalls(sessionId: string, count: number): boolean;
  settleCalls(sessionId: string, reservedCount: number, actualCount: number): void;
  // token dimension reserve-then-settle.
  reserveTokens(sessionId: string, amount: number): boolean;
  settleTokens(sessionId: string, reservedAmount: number, actualAmount: number): void;
  // USD dimension reserve-then-settle.
  reserveUsd(sessionId: string, amount: number): boolean;
  settleUsd(sessionId: string, reservedAmount: number, actualAmount: number): void;
}

// ResumeAnchorsPort: engine-side sufficiency checkpoint writer (#48).
// Design: sufficiency anchoring crosses into the engine as an injected port, not a
// store import — kernel stays pure (BudgetLedgerPort pattern, T7 decision #93).
// One conditional append-only "sufficiency" anchor attempt per search that clears
// the provider/budget checks, written after computeSufficiency and before the
// envelope returns; needs both this port and sessionId, early throws write nothing,
// and the store may skip secret-matching payloads. Anchors are a recovery gain
// layer: write failures fail open (named stderr line, retrieval never blocked).
// Read-side design is settled in #186 (T8): the kernel memory pipeline reads the
// last anchor on resume and injects a Recovery Digest once (#189). The engine
// itself still only writes.
export interface ResumeAnchorsPort {
  saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void>;
}

/** One adapter's injection payload for a single turn. */
export interface RagRetrievalResult {
  /** Text appended after a blank line to a user message's text channel. */
  block: string;
  /**
   * Provenance for the injected text: recalled rows are `memory` (a tier below
   * `user` per content-trust TRUST_ORDER), the operator-authored note is `system`.
   */
  label: SourceTraceLabel;
  /** Number of recalled rows folded into `block`; 0 for a static note. */
  hitCount: number;
}

/**
 * Domain-scoped retrieval over private/internal data (#35, decision #90).
 *
 * One adapter is selected by `DomainConfigPort.rag.adapter`: `none` skips,
 * `note` keeps the legacy `config.note` injection, `fts` recalls from the
 * existing FTS5 memory surface (`SessionStore.searchMemory`) — zero new index,
 * zero embedding dependency.
 *
 * Injection point: `MemoryPipeline.inject` Stage-1. Following #131, static
 * operator text (`note`) targets the first USER message while query-driven
 * adapters (`fts`) target the latest one; the write is shape-preserving (string
 * or content-block alike).
 */
export interface RagAdapterPort {
  /** Adapter id, matching the `[rag] adapter` value that selected it. */
  readonly id: string;
  /**
   * Resolve `query` into an injectable payload.
   *
   * @param query - Caller text, normally the latest user turn's pre-injection
   *   text (query-driven adapters); adapters may truncate it.
   * @param limit - Max hits to fold into the block.
   * @returns The payload, or null meaning "nothing to inject this turn".
   *   Thrown faults are fail-open at the registry (no injection, named stderr),
   *   so implementations may throw without breaking the agent loop.
   */
  retrieve(query: string, limit?: number): Promise<RagRetrievalResult | null>;
}
