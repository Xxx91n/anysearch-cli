import { AnySearchProvider } from "../../packages/retriever/src/providers/anysearch";

async function main() {
  const p = new AnySearchProvider(undefined, "https://api.anysearch.com/mcp");
  try {
    const env = await p.search({ query: "AAPL real-time stock price", mode: "fast" }, new AbortController().signal);
    console.log("OFF results:", env.results.length, env.results[0]?.url ?? "");
  } catch (e) { console.log("OFF THREW:", String(e).slice(0, 300)); }
  try {
    const env2 = await p.search({ query: "AAPL real-time stock price", mode: "fast", vertical: { domain: "finance", subDomain: "quote", params: { type: "stock", symbol: "AAPL" } } }, new AbortController().signal);
    console.log("ON results:", env2.results.length, env2.results[0]?.url ?? "", "marked:", env2.results.filter(r => r.extra?.vertical).length);
  } catch (e) { console.log("ON THREW:", String(e).slice(0, 300)); }
}
main();
