// ADR-0063 (R62 T3) / R62 D-002 / ADR-0064 (R63 T2): @anysearch-cli/embedding is an
// OPTIONAL PEER (peerDependencies + peerDependenciesMeta.optional; R62's
// optionalDependencies form migrated in R63 T2 — npm auto-install of a heavy
// optional runtime is the bomb regression). The vector arm is a capability, not
// a requirement. When the package is absent from the install closure (peer not
// installed), the arm is absent: embedText ≡ null, telemetry all-zero +
// absent:true — a legal FTS-only state, never a throw.
// ADR-0033 D4/D5 fail-open semantics are preserved end-to-end.
// R63 T1: consolidate dedup degrades to jaccard-only (decideOp null-cos branch,
// THETA_JAC=0.80) when this arm is absent — see packages/store/src/consolidate.ts.
//
// cosineSimilarity is pure math — inlined here (dot product over L2-normalized
// vectors) so scoring never statically depends on the optional package.

import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type EmbeddingModule = typeof import("@anysearch-cli/embedding");

let modPromise: Promise<EmbeddingModule | null> | undefined;
let forced: EmbeddingModule | null | undefined; // test seam (__setEmbeddingModuleForTest)

function loadEmbedding(): Promise<EmbeddingModule | null> {
  if (forced !== undefined) return Promise.resolve(forced);
  if (!modPromise) {
    modPromise = (async () => {
      try {
        return await import("@anysearch-cli/embedding");
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | undefined)?.code;
        // R71 T1 (ADR-0072): only a NOT-FOUND falls through to sibling-root
        // probing — a present-but-broken package stays absent (fail-open),
        // never masked by a stray copy elsewhere on disk.
        if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
          return await importEmbeddingFallback();
        }
        return null;
      }
    })();
  }
  return modPromise;
}

// R71 T1 (ADR-0072): sibling-root fallback for isolated global layouts.
// pnpm add -g installs each top-level package in its own
// <prefix>/global/v11/<hash>/node_modules tree — the embedding package exists
// on disk but is unreachable by bare-specifier resolution from the cli's tree
// (npm's flat shared node_modules resolves it; npm arm green in the spike
// transcript). When the plain import misses, anchor at the invoked entry
// (argv[1] — the bin shim target preserves the install-layout path) and at
// this module, then walk ancestors: each level tries a normal require-resolve
// (covers ancestor node_modules, incl. npm flat layouts) followed by a scan of
// child */node_modules roots (covers pnpm's sibling hash dirs).
function embeddingAnchorFiles(): string[] {
  const files: string[] = [];
  if (process.argv[1]) files.push(resolvePath(process.argv[1]));
  try { files.push(fileURLToPath(import.meta.url)); } catch { /* CJS bundle: import.meta empty */ }
  try { if (typeof __filename !== "undefined") files.push(__filename); } catch { /* ESM: no __filename */ }
  return files;
}

function resolveEmbeddingFrom(dir: string): string | undefined {
  try { return createRequire(join(dir, "__anchor__.cjs")).resolve("@anysearch-cli/embedding"); }
  catch { return undefined; }
}

function childDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

async function importEmbeddingFallback(anchors: string[] = embeddingAnchorFiles()): Promise<EmbeddingModule | null> {
  for (const anchor of anchors) {
    for (let dir = dirname(anchor), prev = ""; dir !== prev && dir.length > 0; prev = dir, dir = dirname(dir)) {
      const direct = resolveEmbeddingFrom(dir);
      if (direct) return (await import(pathToFileURL(direct).href)) as EmbeddingModule;
      for (const child of childDirNames(dir)) {
        const sib = resolveEmbeddingFrom(join(dir, child, "node_modules"));
        if (sib) return (await import(pathToFileURL(sib).href)) as EmbeddingModule;
      }
    }
  }
  return null;
}

// Same contract as @anysearch-cli/embedding's embedText: null when the arm cannot
// produce a vector (package absent, transformers missing, circuit open, or
// empty input). Callers already degrade on null — this wrapper only adds the
// package-absence branch.
export async function embedText(text: string, role: "query" | "passage"): Promise<Float32Array | null> {
  const m = await loadEmbedding();
  if (!m) return null;
  return m.embedText(text, role);
}

// Model id for memory_embeddings.model — only resolved after embedText
// produced a vector, so the module is known-present here.
export async function embeddingModelId(): Promise<string> {
  const m = await loadEmbedding();
  return m?.EMBEDDING_MODEL_ID ?? "unavailable";
}

export interface ArmTelemetry {
  loads: number;
  embeds: number;
  failures: number;
  circuitOpen: boolean;
  // ADR-0063 (R62 T3): absent distinguishes "package not installed" from
  // "installed but quiet" — both report zero counters otherwise.
  absent: boolean;
}

export async function armTelemetry(): Promise<ArmTelemetry> {
  const m = await loadEmbedding();
  if (!m) return { loads: 0, embeds: 0, failures: 0, circuitOpen: false, absent: true };
  return { ...m.embeddingTelemetry(), absent: false };
}

// Dot product over L2-normalized vectors (= cosine for normalized inputs).
// Mirrors @anysearch-cli/embedding's cosineSimilarity exactly — inlined so callers
// never import the optional package for pure math.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

// ponytail: test-only seam — force the module absent (null) or present (module
// object), or restore real probing ("auto"). Mirrors __setExtractorForTest.
export function __setEmbeddingModuleForTest(m: EmbeddingModule | null | "auto"): void {
  forced = m === "auto" ? undefined : m;
  modPromise = undefined;
}

// ponytail: test-only seam — resolve the sibling-root fallback against explicit
// anchor files (synthetic global layouts) instead of argv[1]/self.
export function __importEmbeddingFallbackForTest(anchors: string[]): Promise<EmbeddingModule | null> {
  return importEmbeddingFallback(anchors);
}
