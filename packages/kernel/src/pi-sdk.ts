// One loader for the pi-coding-agent ESM entry.
//
// Loading it costs several seconds of module evaluation, and every command that
// never starts a run — `ans --help`, `ans auth`, `ans skill list`, ... — must
// not pay that. Both users of the package (the agent run and the memory
// pipeline's summarizer) therefore go through this single memoised loader
// instead of a static import, which the bundler would otherwise inline into the
// CLI/MCP startup chunk (#258).
type PiCodingAgent = typeof import("@earendil-works/pi-coding-agent");

let loadPromise: Promise<PiCodingAgent> | null = null;

export async function loadPiCodingAgent(): Promise<PiCodingAgent> {
  // Memoised per process, so a long-lived MCP host loads it once. A failed load
  // is not cached: a transient fault must be retryable.
  if (!loadPromise) {
    loadPromise = import("@earendil-works/pi-coding-agent").catch((e) => {
      loadPromise = null;
      throw e;
    });
  }
  return loadPromise;
}
