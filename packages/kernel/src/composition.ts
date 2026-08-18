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
export function createEngine(domain?: string): CompositionResult {
  let providers: SearchProvider[] = [];
  let config: DomainConfigPort | undefined;

  if (domain) {
    try {
      const schema = loadDomainByName(domain);
      config = schema as DomainConfigPort;
      const enabled = schema.sources.enabled;
      providers = enabled
        .map((id) => PROVIDER_FACTORIES[id]?.())
        .filter((p): p is SearchProvider => p !== undefined);
    } catch {
      providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
    }
  } else {
    providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
  }

  const retriever: RetrieverPort = new RetroaererdEngine(providers);
  // ponytail: share one SessionStore across CLI + MCP. In-memory DB for MVP.
  const store = new SqliteSessionStore(":memory:");
  return { retriever, config, store };
}
