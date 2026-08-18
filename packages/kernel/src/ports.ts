// Kernel ports: dependency inversion interfaces.
// Seam 3 from atomcode-kernel-split-architecture research.
// Kernel only imports these interfaces; CLI composition root injects implementations.

import type { FusedEnvelope, SearchRequest } from "@anysearch/retriever";
import type { SessionStore, Message } from "@anysearch/store";

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
export interface DomainConfigPort {
  toolWhitelist: string[];
  ragAdapter: string;
}