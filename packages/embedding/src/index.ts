// ADR-0033: vector semantic arm — local embedding via transformers.js.
// Model: Xenova/multilingual-e5-small (q8), 384-dim, Chinese+English (C-MTEB zh 59.95).
// Lazy pipeline singleton + circuit breaker (n=3 consecutive failures, shared write/read).
// Fail-open everywhere: embedding never blocks a write or a recall.

import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import Module from "node:module";

// Transformers.js loads lazily inside getExtractor(): (a) tsup CJS bundles crash
// when native/ESM deps are statically bundled; (b) fail-open: unresolved package = arm absent.
type TransformersModule = typeof import("@huggingface/transformers");
let transformersPromise: Promise<TransformersModule> | null = null;
let envConfigured = false;

// R71 T1 (ADR-0072): transformers@3.x ships transformers.node.cjs with
// require("onnxruntime-common") as an UNDECLARED external — npm's flat hoisting
// masks it; pnpm's isolated per-package scopes expose it (spike: pnpm-global
// arm failed "Cannot find module 'onnxruntime-common'"). Two moves repair it
// without upstream surgery: (a) we declare onnxruntime-common@1.21.0 ourselves
// (optionalDependencies — matches the onnxruntime-node@1.21.0 exact pin in
// transformers 3.8.x); (b) a scoped _resolveFilename patch — only that
// specifier, only from @huggingface/transformers parents — aliases the miss to
// our copy. The require() entry (transformers.node.cjs) is what the patch can
// reach; the .mjs path uses the ESM resolver which cannot be scoped without
// loader hooks. Patch is process-global but idempotent + single-callsite.
let resolverPatched = false;
function patchOnnxruntimeCommonResolve(): void {
  if (resolverPatched) return;
  resolverPatched = true;
  const selfRequire = createRequire(import.meta.url);
  const M = Module as unknown as { _resolveFilename: Function };
  const orig = M._resolveFilename as (request: string, parent: { filename?: string } | undefined, ...rest: unknown[]) => string;
  M._resolveFilename = function (this: unknown, request: string, parent: { filename?: string } | undefined, ...rest: unknown[]): string {
    // Windows parents use backslashes — normalize before the scope check.
    if (request === "onnxruntime-common" && typeof parent?.filename === "string" && parent.filename.replace(/\\/g, "/").includes("@huggingface/transformers")) {
      try { return orig.call(this, request, parent, ...rest); }
      catch { return selfRequire.resolve("onnxruntime-common"); }
    }
    return orig.call(this, request, parent, ...rest);
  };
}

function loadTransformers(): Promise<TransformersModule> {
  if (!transformersPromise) {
    patchOnnxruntimeCommonResolve();
    const req = createRequire(import.meta.url);
    transformersPromise = Promise.resolve().then(() => req("@huggingface/transformers") as TransformersModule);
  }
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
