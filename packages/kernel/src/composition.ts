// Composition Root: createEngine factory.
// ADR-0008 D7: lifted from apps/cli/src/composition.ts to packages/kernel.
// Both apps/cli and apps/mcp import from @anysearch-cli/kernel.
// ADR-0006 decision 3A: pure function, no state, domain-aware provider filtering.
// ADR-0006 decision 1A: returns RetrieverPort, not concrete RetroaererdEngine.
// ADR-0006 decision 4A: loads domain from domains/<name>.toml convention directory.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch-cli/retriever/providers";
import type { SearchProvider } from "@anysearch-cli/retriever";
import { RetroaererdEngine } from "./engine";
import type { RetrieverPort, DomainConfigPort, SessionStorePort } from "./ports";
import {
  defaultDomainsDirs,
  loadDomainByNameIn,
  SqliteObservationStore,
  SqliteSessionStore,
  readActiveCalibrationBundle,
  createDomainReloader,
  domainTomlPath,
  resolvePolicyFromSchema,
} from "@anysearch-cli/store";
import * as path from "node:path";
import type { AttributionCalibration } from "./calibrate";

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
  observation: SqliteObservationStore;
  // ADR-0051 D1: exposed so cross-round merged attribution can reuse the same
  // immutable active head instead of silently falling back to the legacy floor.
  calibration?: AttributionCalibration;
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

// ADR-0051 D1: attribution calibration lives on disk as a revision-root head
// pointer; only the composition root resolves it. Env override mirrors
// scripts/attribution-calibrate.mjs; default joins the ~/.anysearch dir convention.
export function resolveAttributionRevisionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT && env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT.trim();
  if (explicit) return path.resolve(explicit);
  const home = env.USERPROFILE || env.HOME || ".";
  return path.join(home, ".anysearch", "attribution-gold-revisions");
}

// Fail-open: missing/corrupt head or bundle yields undefined and the engine
// stays on the legacy 0.6 floor (ADR-0050 D5 degraded path).
export function resolveActiveAttributionCalibration(
  env: NodeJS.ProcessEnv = process.env,
): AttributionCalibration | undefined {
  try {
    const active = readActiveCalibrationBundle(resolveAttributionRevisionRoot(env));
    if (!active) return undefined;
    return Object.freeze({
      params: Object.freeze({ ...active.bundle.params }),
      thresholds: Object.freeze({ ...active.bundle.thresholds }),
    });
  } catch (error) {
    // Fail-open stays, but a thrown fault (I/O, parse) is unexpected - surface
    // it instead of silently decaying to the legacy floor with no trace.
    // stderr only: MCP servers must keep stdout protocol-pure (ADR-0020 D1.1).
    process.stderr.write("[anysearch] attribution calibration load failed: " + String(error && (error as Error).message || error) + "\n");
    return undefined;
  }
}

export function createEngine(domain?: string, opts?: { dbPath?: string; attributionCalibration?: AttributionCalibration; domainsDirs?: string[] }): CompositionResult {
  let providers: SearchProvider[] = [];
  let config: DomainConfigPort | undefined;
  let sourceWeights: Record<string, number> | undefined;
  // ADR-0062 D2 (T2): request-time domain URL policy resolver — wired only when
  // the domain schema loads. The lazy-mtime reloader refreshes the schema when
  // the TOML changes; resolvePolicyFromSchema runs on every search() call so
  // TOML edits and ANS_URL_ALLOWLIST/DENYLIST env overrides take effect without
  // restart. No cached policy snapshot lives inside the retriever.
  let urlPolicy: (() => { allow: readonly string[]; deny: readonly string[]; policyVersion: string }) | undefined;

  if (domain) {
    try {
      // ADR-0061 B1: resolution chain — caller-supplied domains dirs (builtin package
      // dir etc.) then the ANS_DOMAINS_DIR/CWD defaults. Missing domain stays
      // fail-open full-fanout; schema errors keep today's semantics.
      const dirs = opts?.domainsDirs ?? defaultDomainsDirs();
      const schema = loadDomainByNameIn(domain, dirs);
      config = schema as DomainConfigPort;
      const enabled = schema.sources.enabled;
      sourceWeights = schema.sources.weights;
      providers = enabled
        .map((id) => PROVIDER_FACTORIES[id]?.())
        .filter((p): p is SearchProvider => p !== undefined);
      // ADR-0062 D2: resolve the TOML path through the same chain the loader used
      // (env -> CWD -> caller-supplied dirs), then hand the engine a reloader that
      // keeps last-known-good on a bad reload (plugin server reuses this pattern).
      const tomlPath = domainTomlPath(process.cwd(), domain, dirs);
      const reload = createDomainReloader(tomlPath);
      let liveSchema = schema;
      urlPolicy = () => {
        const reloaded = reload();
        if (reloaded) liveSchema = reloaded;
        return resolvePolicyFromSchema(liveSchema);
      };
    } catch (e) {
      // ADR-0045 D2: configuration errors fail fast — an invalid sources.weights must not be
      // swallowed by the fail-open full-fanout fallback (which exists for missing domains/keys).
      if (e instanceof Error && e.message.includes("sources.weights")) throw e;
      providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
    }
  } else {
    providers = Object.values(PROVIDER_FACTORIES).map((f) => f()).filter((p): p is SearchProvider => p !== undefined);
  }

  // ADR-0051 D1: explicit override wins; otherwise resolve the active head on disk.
  const attributionCalibration = opts?.attributionCalibration ?? resolveActiveAttributionCalibration();
  const engineOpts: ConstructorParameters<typeof RetroaererdEngine>[1] = {
    ...(sourceWeights ? { sourceWeights } : {}),
    ...(attributionCalibration ? { attributionCalibration } : {}),
    // ADR-0062 D2: domain-name rides with the resolver for audit attributes.
    ...(urlPolicy ? { urlPolicy, domainName: domain } : {}),
  };
  const retriever: RetrieverPort = new RetroaererdEngine(
    providers,
    Object.keys(engineOpts).length ? engineOpts : undefined,
  );
  // ponytail: share one SessionStore across CLI + MCP. In-memory DB by default;
  // opts.dbPath enables durable store for maintenance commands (ADR-0037).
  const dbPath = opts?.dbPath ?? ":memory:";
  const store = new SqliteSessionStore(dbPath);
  const observation = new SqliteObservationStore(dbPath);
  return { retriever, config, store, observation, calibration: attributionCalibration };
}
