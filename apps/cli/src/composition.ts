// Composition Root: createEngine factory.
// ADR-0006 decision 3A: pure function, no state, domain-aware provider filtering.
// ADR-0006 decision 1A: returns RetrieverPort, not concrete RetroaererdEngine.
// ADR-0006 decision 4A: loads domain from domains/<name>.toml convention directory.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch/retriever/providers";
import type { SearchProvider } from "@anysearch/retriever";
import { RetroaererdEngine } from "@anysearch/kernel";
import type { RetrieverPort, DomainConfigPort } from "@anysearch/kernel";
import { loadDomainByName } from "@anysearch/store";

// Map provider ids to constructors.
const PROVIDER_FACTORIES: Record<string, () => SearchProvider> = {
  tavily: () => new TavilyProvider(),
  exa: () => new ExaProvider(),
  anysearch: () => new AnySearchProvider(),
};

export interface CompositionResult {
  retriever: RetrieverPort;
  config?: DomainConfigPort;
}

// createEngine: build configured engine.
// If domain is provided, loads TOML + filters providers by sources.enabled.
// If domain is omitted, all providers are registered (full fanout).
export function createEngine(domain?: string): CompositionResult {
  let providers: SearchProvider[] = [];
  let config: DomainConfigPort | undefined;

  if (domain) {
    try {
      const schema = loadDomainByName(domain);
      config = schema as DomainConfigPort;
      // Filter providers by domain sources.enabled.
      const enabled = schema.sources.enabled;
      providers = enabled
        .map((id) => PROVIDER_FACTORIES[id]?.())
        .filter((p): p is SearchProvider => p !== undefined);
    } catch {
      // Domain not found -- fall back to all providers.
      providers = Object.values(PROVIDER_FACTORIES).map((f) => f());
    }
  } else {
    providers = Object.values(PROVIDER_FACTORIES).map((f) => f());
  }

  const retriever: RetrieverPort = new RetroaererdEngine(providers);
  return { retriever, config };
}
