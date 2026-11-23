// 真搜探针：没配 key 的那条路——Exa 自己的 MCP 免费额度端点。
// 只在 test:online 下跑；离线套件不碰网络。
// 用 createExaProvider("") 拿免费额度臂：显式空串就是「没有 key」，不会借环境里的
// EXA_API_KEY（在线车道可能给别的探针配了 key）。

import { createExaProvider } from "../../src/providers/exa";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const provider = createExaProvider("");
  assert(provider.modes.join(",") === "fast,index,deep", "the probe drives the free-quota arm, not the REST one");
  const env = await provider.search({ query: "cloudflare workers", mode: "fast", maxResults: 3 }, AbortSignal.timeout(30000));
  assert(env.provider === "exa", "provider id");
  assert(env.results.length >= 1, "live web_search_exa returns >=1 result");
  assert(typeof env.results[0]?.url === "string" && env.results[0].url.startsWith("http"), "result url shape");
  assert(typeof env.results[0]?.title === "string" && env.results[0].title.length > 0, "result title shape");
  assert(typeof env.results[0]?.snippet === "string", "result snippet shape");
  assert(env.elapsedMs > 0, "elapsedMs positive");
  console.log("--- exa free-quota live probe: " + passed + " passed, " + failed + " failed (" + env.results.length + " results, " + env.elapsedMs + "ms) ---");
  if (failed > 0) process.exit(1);
}

await main();
