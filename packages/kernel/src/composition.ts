// Composition Root: createEngine factory.
// ADR-0008 D7: lifted from apps/cli/src/composition.ts to packages/kernel.
// Both apps/cli and apps/mcp import from @anysearch/kernel.
// ADR-0006 decision 3A: pure function, no state, domain-aware provider filtering.
// ADR-0006 decision 1A: returns RetrieverPort, not concrete RetroaererdEngine.
// ADR-0006 decision 4A: loads domain from domains/<name>.toml convention directory.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch/retriever/providers";
import type { SearchProvider } from "@anysearch/retriever";
import { RetroaererdEngine } from "./engine";
import type { RetrieverPort, DomainConfigPort, SessionStorePort } from "./ports";
import { loadDomainByName, SqliteSessionStore } from "@anysearch/store";
import * as path from "node:path";

// Map provider ids to constructors.
// ponytail: wrap in try/catch — providers without API keys are skipped, not crashed.
const PROVIDER_FACTORIES: Record<string, () => SearchProvider | undefined> = {
  tavily: () => { try { return new TavilyProvider(); } catch { return undefined; } },
  exa: () => { try { return new ExaProvider(); } catch { return undefined; } },
  anysearch: () => { try { return new AnySearchProvider(); } catch { return undefined; } },
};

export interface CompositionResult {
  retriever: RetrieverPort;
  config?: DomainConfigPort;
  store: SessionStorePort;
}

// createEngine: build configured engine.
// If domain is provided, loads TOML + filters providers by sources.enabled.
// If domain is omitted, all providers are registered (full fanout, skipping those without API keys).
// ADR-0037 D5/D6: persistent DB path for maintenance commands (consolidate / forget / backfill).
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db (global dir convention from t0-projection).
// Kernel does not read env elsewhere, but path resolution is composition-root I/O (pits: keep it here).
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ANS_DB_PATH && env.ANS_DB_PATH.trim();
  if (explicit) return explicit;
  const home = env.USERPROFILE || env.HOME || ".";
  return path.join(home, ".anysearch", "anysearch.db");
}

export function createEngine(domain?: string, opts?: { dbPath?: string }): CompositionResult {
  let providers: SearchProvider[] = [];
  let config: DomainConfigPort | undefined;
  let sourceWeights: Record<string, number> | undefined;

  if (domain) {
    try {
      const schema = loadDomainByName(domain);
      config = schema as DomainConfigPort;
      const enabled = schema.sources.enabled;
      sourceWeights = schema.sources.weights;
      providers = enabled
        .map((id) => PROVIDER_FACTORIES[id]?.())
        .filter((p): p is SearchProvider => p !== undefined);
    } catch (e) {
      // ADR-0045 D2: configuration errors fail fast — an invalid sources.weights must not be
      // swallowed by the fail-open full-fanout fallback (which exists for missing domains/keys).
      if (e instanceof Error && e.message.includes("sources.weights")) throw e;
      providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
    }
  } else {
    providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
  }

  const retriever: RetrieverPort = new RetroaererdEngine(providers, sourceWeights ? { sourceWeights } : undefined);
  // ponytail: share one SessionStore across CLI + MCP. In-memory DB by default;
  // opts.dbPath enables durable store for maintenance commands (ADR-0037).
  const store = new SqliteSessionStore(opts?.dbPath ?? ":memory:");
  return { retriever, config, store };
}
