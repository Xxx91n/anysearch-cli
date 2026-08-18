// ans search: run a retrieval query through the Retroaererd Engine.
// Composition root: registers providers + runs engine.search with RRF fusion.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch/retriever/providers";
import type { SearchProvider } from "@anysearch/retriever";
import { RetroaererdEngine } from "@anysearch/kernel";
import type { Mode } from "@anysearch/retriever";

export async function runSearch(args: string[]): Promise<number> {
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // Parse optional --mode flag (default: fast).
  let mode: Mode = "fast";
  const modeIdx = args.indexOf("--mode");
  if (modeIdx >= 0 && args[modeIdx + 1]) {
    const m = args[modeIdx + 1];
    if (m === "fast" || m === "index" || m === "deep" || m === "answer") {
      mode = m;
    }
  }
  const queryClean = args.filter(a => !a.startsWith("--mode") && a !== mode).join(" ").trim();

  // Composition root: register providers + create engine.
  const engine = new RetroaererdEngine();
  const providers: SearchProvider[] = [
    new TavilyProvider(),
    new ExaProvider(),
    new AnySearchProvider(),
  ];
  for (const p of providers) {
    engine.registerProvider(p);
  }

  console.log("ans search: " + JSON.stringify({ query: queryClean, mode }));
  console.log("---");

  try {
    const envelope = await engine.search({ query: queryClean, mode, maxResults: 10 });

    // Render results.
    for (let i = 0; i < envelope.results.length; i++) {
      const r = envelope.results[i];
      console.log((i + 1) + ". [" + r.source + "] " + r.title);
      console.log("   " + r.url);
      if (r.snippet) {
        const snip = r.snippet.length > 200 ? r.snippet.slice(0, 200) + "..." : r.snippet;
        console.log("   " + snip);
      }
      console.log("");
    }

    // Metadata.
    console.log("---");
    console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
    if (envelope.metadata.providersFailed.length > 0) {
      console.log("Providers failed: " + envelope.metadata.providersFailed.join(", "));
    }
    console.log("Results: " + envelope.results.length);
    console.log("Elapsed: " + envelope.metadata.elapsedMs + "ms");

    return envelope.results.length > 0 ? 0 : 1;
  } catch (e: any) {
    console.error("ans search error: " + e.message);
    return 1;
  }
}
