// Kernel ports: dependency inversion interfaces.
// Seam 3 from atomcode-kernel-split-architecture research.
// Kernel only imports these interfaces; CLI composition root injects implementations.

import type { FusedEnvelope, SearchRequest } from "@anysearch/retriever";
import type { SessionStore, Message } from "@anysearch/store";
export type { T0PreferenceRow, T0PreferenceInput } from "@anysearch/store";

export type Budget = {
  tokenCap?: number;
  usdCap?: number;
  timeLimitMs?: number;
};

export type Query = SearchRequest & {
  budget?: Budget;
  providers?: string[]; // restrict to subset of registered providers
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
// ADR-0006 decision 4C: full 5-layer interface matching DomainSchema.
// Consumers read only what they need; current consumers use sources + hooks.
export interface DomainConfigPort {
  // ADR-0045 D2: optional per-provider weight Record (user preference overlay, ADR-0045 D4).
  sources: { enabled: string[]; weights?: Record<string, number> };
  prompts: { name: string; content: string }[];
  skills: { active: string[] };
  hooks: { toolWhitelist: string[] };
  rag: { adapter: string; config?: Record<string, unknown> };
  // ADR-0012 D7: compaction config for independent summary model.
  // ADR-0021 D1: mirror store CompactionConfig shape — single type defined in
  // packages/store/src/domain-schema.ts; referenced here to avoid drift.
  compaction?: {
    model?: string;
    sufficiencyMaxRerounds?: number;
    lowWatermark?: number | { fraction: number };
    reuseCap?: number;
  };
}

// BudgetLedgerPort: per-call reserve-then-settle interface.
// ADR-0006 decision 2A: defined as port (one implementation now, two = real seam).
export interface BudgetLedgerPort {
  reserveCalls(sessionId: string, count: number): boolean;
  settleCalls(sessionId: string, reservedCount: number, actualCount: number): void;
  // ADR-0007 D5: token dimension reserve-then-settle.
  reserveTokens(sessionId: string, amount: number): boolean;
  settleTokens(sessionId: string, reservedAmount: number, actualAmount: number): void;
  // ADR-0007 D5: USD dimension reserve-then-settle.
  reserveUsd(sessionId: string, amount: number): boolean;
  settleUsd(sessionId: string, reservedAmount: number, actualAmount: number): void;
}
