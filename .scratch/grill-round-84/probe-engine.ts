import { AnySearchProvider } from "../../packages/retriever/src/providers/anysearch";
import { RetroaererdEngine } from "../../packages/kernel/src/engine";

async function main() {
  const p = new AnySearchProvider(undefined, "https://api.anysearch.com/mcp");
  const eng = new RetroaererdEngine([p]);
  const t0 = Date.now();
  try {
    const env = await eng.search({ query: "AAPL real-time stock price", mode: "fast", maxResults: 10, providers: ["anysearch"] });
    console.log("engine n:", env.results.length, "ms:", Date.now() - t0, "failed:", env.metadata?.providersFailed, "cancelled:", env.metadata?.providersCancelled, "labels:", env.metadata?.fusion?.labels);
    for (const r of env.results.slice(0, 3)) console.log("  ", r.url.slice(0, 90));
  } catch (e) { console.log("THREW:", String(e).slice(0, 300)); }
}
main();
