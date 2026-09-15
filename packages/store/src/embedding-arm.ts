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

type EmbeddingModule = typeof import("@anysearch-cli/embedding");

let modPromise: Promise<EmbeddingModule | null> | undefined;
let forced: EmbeddingModule | null | undefined; // test seam (__setEmbeddingModuleForTest)

function loadEmbedding(): Promise<EmbeddingModule | null> {
  if (forced !== undefined) return Promise.resolve(forced);
  if (!modPromise) {
    modPromise = import("@anysearch-cli/embedding").then(
      (m) => m,
      () => null, // package absent — arm absent, fail-open
    );
  }
  return modPromise;
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
