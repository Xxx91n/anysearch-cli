// ADR-0033: vector semantic arm — local embedding via transformers.js.
// Model: Xenova/multilingual-e5-small (q8), 384-dim, Chinese+English (C-MTEB zh 59.95).
// Lazy pipeline singleton + circuit breaker (n=3 consecutive failures, shared write/read).
// Fail-open everywhere: embedding never blocks a write or a recall.

import { join } from "node:path";
import { homedir } from "node:os";

// Transformers.js loads via dynamic import inside getExtractor(): (a) tsup CJS bundles crash
// when native/ESM deps are statically bundled; (b) fail-open: unresolved package = arm absent.
type TransformersModule = typeof import("@huggingface/transformers");
let transformersPromise: Promise<TransformersModule> | null = null;
let envConfigured = false;
function loadTransformers(): Promise<TransformersModule> {
  if (!transformersPromise) transformersPromise = import("@huggingface/transformers");
  return transformersPromise;
}
function configureEnv(mod: TransformersModule): void {
  if (envConfigured) return;
  mod.env.cacheDir = process.env.ANYSEARCH_MODEL_CACHE ?? join(homedir(), ".anysearch", "models");
  envConfigured = true;
}

export type EmbedRole = "query" | "passage";

export const EMBEDDING_MODEL_ID = "Xenova/multilingual-e5-small";
const CB_THRESHOLD = 3;

type ExtractorFn = (input: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<unknown> | null = null;
let testExtractor: ExtractorFn | null = null; // test seam (__setExtractorForTest)
let consecutiveFailures = 0;
let circuitOpen = false;
let loads = 0;
let embeds = 0;
let failures = 0;

export interface EmbeddingTelemetry {
  loads: number;
  embeds: number;
  failures: number;
  circuitOpen: boolean;
}

export function embeddingTelemetry(): EmbeddingTelemetry {
  return { loads, embeds, failures, circuitOpen };
}

async function getExtractor(): Promise<ExtractorFn> {
  if (testExtractor) return testExtractor;
  if (!extractorPromise) {
    loads++;
    extractorPromise = loadTransformers().then((mod) => {
      configureEnv(mod);
      return mod.pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "q8" });
    });
  }
  return (await extractorPromise) as unknown as ExtractorFn;
}

// embedText returns a normalized 384-dim vector, or null when unavailable
// (circuit open / model load failure / empty input). Role adds the e5 prefix.
export async function embedText(text: string, role: EmbedRole): Promise<Float32Array | null> {
  if (circuitOpen) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const ext = await getExtractor();
    const prefixed = (role === "query" ? "query: " : "passage: ") + trimmed;
    const out = await ext(prefixed, { pooling: "mean", normalize: true });
    consecutiveFailures = 0;
    embeds++;
    return new Float32Array(out.data);
  } catch {
    failures++;
    consecutiveFailures++;
    extractorPromise = null; // never cache a rejected pipeline promise
    if (consecutiveFailures >= CB_THRESHOLD) circuitOpen = true;
    return null;
  }
}

// Cosine similarity over Float32Array vectors (embeddings are L2-normalized, so this is a dot product).
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

// ponytail: test-only hooks. Not part of the public contract.
export function __setExtractorForTest(fn: ExtractorFn | null): void {
  testExtractor = fn;
}
export function __resetEmbeddingState(): void {
  testExtractor = null;
  extractorPromise = null;
  transformersPromise = null;
  consecutiveFailures = 0;
  circuitOpen = false;
  loads = 0;
  embeds = 0;
  failures = 0;
}
