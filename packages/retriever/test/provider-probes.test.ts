// 免费面探针：只打不花钱的接口，结论要对得上真上游实测到的回包。
//
// 三条钉子：
//  1. 好 key / 坏 key / 额度满 / 抽风 / 路由没了 / 连不上，各一条；
//  2. 一次真搜索都不跑 —— 服务器记下每个请求，任何一条带 query 就红；
//  3. 结论只落在产品那套错误类里（classifyProviderError），不新造词。
//
// 回包形状照 2026-11-23 的实测抄：Tavily 的 /usage 见
// docs/research/real-baseline-2026-11-22.md，Exa 和 AnySearch 那几种就在下面这些夹具里。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { isProbeProviderId, probeAnySearch, probeExa, probeTavily } from "../src/providers/probes";

interface Recorded {
  method: string;
  path: string;
  body: string;
  authorization?: string;
}

type Handler = (request: Recorded, res: ServerResponse) => void;

/** 本地假端点：记下每个请求（方法、路径、正文、Authorization 头），再按 handler 回话。 */
async function serve(handler: Handler, run: (base: string, requests: Recorded[]) => Promise<void>): Promise<void> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: Recorded = {
        method: req.method ?? "",
        path: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run("http://127.0.0.1:" + port, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

/** 一个已经关掉的端口：连上去只会被拒。 */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// 实测回包：key 有效、套餐用量 1000/1000。
const TAVILY_USAGE_FULL = {
  key: { usage: 1000, limit: null, search_usage: 1000 },
  account: { current_plan: "Researcher", plan_usage: 1000, plan_limit: 1000 },
};
const TAVILY_USAGE_CLEAN = {
  key: { usage: 3, limit: null, search_usage: 3 },
  account: { current_plan: "Researcher", plan_usage: 3, plan_limit: 1000 },
};

test("tavily：好 key 200 就够，用量照实报；套餐满另记一笔 quota", async () => {
  await serve(
    (_request, res) => json(res, 200, TAVILY_USAGE_FULL),
    async (base, requests) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "ok");
      assert.deepEqual(outcome.usage, { plan: "Researcher", used: 1000, limit: 1000 });
      assert.equal(outcome.problem?.class, "quota-exhausted", "额度满了要说出来，别只报绿");
      assert.deepEqual(outcome.undetectable, [], "tavily 有单独用量接口，验得全");
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, "/tavily/usage");
      assert.equal(requests[0]!.method, "GET");
      // #422 的教训：探针漏带 Authorization 会静默跑成匿名。
      assert.equal(requests[0]!.authorization, "Bearer tvly-good");
    },
  );
});

test("tavily：用量没满就不报问题", async () => {
  await serve(
    (_request, res) => json(res, 200, TAVILY_USAGE_CLEAN),
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "ok");
      assert.equal(outcome.problem, undefined);
      assert.equal(outcome.usage?.used, 3);
    },
  );
});

test("tavily：401 是 key 被拒，不是「验不了」", async () => {
  await serve(
    (_request, res) => json(res, 401, { detail: { error: "Unauthorized: missing or invalid API key." } }),
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-bad", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "rejected");
      assert.equal(outcome.problem?.class, "permanent-auth");
      assert.equal(outcome.problem?.status, 401);
    },
  );
});

test("tavily：432（套餐用尽）说明 key 是好的，只是查不了", async () => {
  await serve(
    (_request, res) => json(res, 432, { detail: { error: "This request exceeds your plan's set usage limit." } }),
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "ok", "432 不是 key 的问题");
      assert.equal(outcome.problem?.class, "quota-exhausted");
    },
  );
});

test("tavily：5xx 只能算没验成，别把上游抽风说成 key 坏了", async () => {
  await serve(
    (_request, res) => json(res, 503, { detail: { error: "service unavailable" } }),
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "unverified");
      assert.equal(outcome.problem?.class, "transient");
    },
  );
});

test("tavily：连不上就是连不上，原始报错不进结论", async () => {
  const port = await closedPort();
  const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: "http://127.0.0.1:" + port + "/tavily" });
  assert.equal(outcome.auth, "unverified");
  assert.equal(outcome.problem?.class, "unreachable");
});

test("exa：空体 400 是正面回答 —— 认证过了，才轮到参数校验", async () => {
  await serve(
    (_request, res) => json(res, 400, { error: "Invalid request body", tag: "INVALID_REQUEST_BODY", detail: 'expected string at "query"' }),
    async (base, requests) => {
      const outcome = await probeExa({ apiKey: "exa-good", endpoint: base + "/exa" });
      assert.equal(outcome.auth, "ok");
      assert.equal(outcome.problem, undefined);
      assert.deepEqual(outcome.undetectable, ["quota"], "exa 没有单独的用量接口");
      assert.equal(requests[0]!.body, "{}", "空体才是免费面：不发 query");
      assert.equal(requests[0]!.path, "/exa/search");
    },
  );
});

test("exa：401 是 key 被拒", async () => {
  await serve(
    (_request, res) => json(res, 401, { error: "Invalid API key", tag: "INVALID_API_KEY" }),
    async (base) => {
      const outcome = await probeExa({ apiKey: "exa-bad", endpoint: base + "/exa" });
      assert.equal(outcome.auth, "rejected");
      assert.equal(outcome.problem?.status, 401);
    },
  );
});

test("exa：402 不敢说 key 被拒（不带 key 也是 402）", async () => {
  await serve(
    (_request, res) => json(res, 402, { error: "Payment required" }),
    async (base) => {
      const outcome = await probeExa({ apiKey: "exa-maybe", endpoint: base + "/exa" });
      assert.equal(outcome.auth, "unverified", "402 分不清是 key 还是付款方式");
      assert.equal(outcome.problem?.status, 402);
    },
  );
});

// ── anysearch：initialize + tools/list + 空参数 tools/call ──────────────

interface McpScript {
  tools?: unknown[];
  callText: string;
}

function mcpServer(script: McpScript, request: Recorded, res: ServerResponse): void {
  const payload = JSON.parse(request.body || "{}") as { id?: number; method?: string };
  if (payload.method === "initialize") {
    json(res, 200, {
      jsonrpc: "2.0",
      id: payload.id,
      result: { protocolVersion: "2025-11-25", serverInfo: { name: "anysearch-mcp-server", version: "1.0.0" } },
    });
    return;
  }
  if (payload.method === "notifications/initialized") {
    res.writeHead(202).end();
    return;
  }
  if (payload.method === "tools/list") {
    json(res, 200, { jsonrpc: "2.0", id: payload.id, result: { tools: script.tools ?? [] } });
    return;
  }
  if (payload.method === "tools/call") {
    json(res, 200, {
      jsonrpc: "2.0",
      id: payload.id,
      result: { isError: true, content: [{ type: "text", text: script.callText }] },
    });
    return;
  }
  res.writeHead(400).end();
}

const ANYSEARCH_TOOLS = [
  { name: "search", inputSchema: { properties: { query: { type: "string" }, max_results: { type: "number" } }, required: ["query"] } },
  { name: "batch_search", inputSchema: { properties: { queries: {} } } },
  { name: "extract", inputSchema: { properties: { urls: {} } } },
  { name: "get_sub_domains", inputSchema: { properties: {} } },
  { name: "score", inputSchema: { properties: {} } },
];

test("anysearch：坏 key 也能验 —— 空参数 tools/call 回 invalid_api_key", async () => {
  await serve(
    (request, res) => mcpServer({ tools: ANYSEARCH_TOOLS, callText: '{"error":"invalid_api_key"}' }, request, res),
    async (base, requests) => {
      const outcome = await probeAnySearch({ apiKey: "ans-bad", endpoint: base + "/mcp" });
      assert.equal(outcome.auth, "rejected");
      assert.deepEqual(outcome.undetectable, ["quota"]);
      // 认证结论来自空参数 tools/call（#442），不是 /health 那种坏 key 也 200 的面。
      const call = requests.find((request) => request.body.includes('"tools/call"'));
      assert.ok(call, "要发一次 tools/call");
      assert.deepEqual(JSON.parse(call.body).params.arguments, {}, "参数必须是空的");
    },
  );
});

test("anysearch：好 key 回「query is required」，那就是认证过了", async () => {
  await serve(
    (request, res) => mcpServer({ tools: ANYSEARCH_TOOLS, callText: "query is required" }, request, res),
    async (base, requests) => {
      const outcome = await probeAnySearch({ apiKey: "ans-good", endpoint: base + "/mcp" });
      assert.equal(outcome.auth, "ok");
      assert.equal(outcome.problem, undefined);
      assert.deepEqual(outcome.tools, { count: 5, searchTool: true, queryArg: true, protocolVersion: "2025-11-25" });
      assert.equal(requests[0]!.authorization, "Bearer ans-good");
    },
  );
});

test("anysearch：search 工具改名了（auth 还是好的）也算失败", async () => {
  await serve(
    (request, res) => mcpServer({ tools: [{ name: "web_search", inputSchema: { properties: { q: {} } } }], callText: "query is required" }, request, res),
    async (base) => {
      const outcome = await probeAnySearch({ apiKey: "ans-good", endpoint: base + "/mcp" });
      assert.equal(outcome.auth, "ok");
      assert.equal(outcome.problem?.class, "permanent-protocol", "入口契约变了，绿勾会盖住它");
      assert.equal(outcome.tools?.searchTool, false);
    },
  );
});

test("anysearch：initialize 就 503，只能算没验成", async () => {
  await serve(
    (_request, res) => json(res, 503, { error: "upstream down" }),
    async (base) => {
      const outcome = await probeAnySearch({ apiKey: "ans-good", endpoint: base + "/mcp" });
      assert.equal(outcome.auth, "unverified");
      assert.equal(outcome.problem?.class, "transient");
    },
  );
});

test("anysearch：老 env 值以 /v1/search 结尾，探针打的是 /mcp（跟适配器的垫片一致）", async () => {
  await serve(
    (request, res) => mcpServer({ tools: ANYSEARCH_TOOLS, callText: "query is required" }, request, res),
    async (base, requests) => {
      const outcome = await probeAnySearch({ apiKey: "ans-good", endpoint: base + "/v1/search" });
      assert.equal(outcome.auth, "ok");
      assert.ok(requests.every((request) => request.path === "/mcp"), "不该打 REST 那个尾巴：" + requests[0]?.path);
    },
  );
});

test("三家一起跑：一次真搜索都不发（钉子）", async () => {
  await serve(
    (request, res) => {
      if (request.path === "/tavily/usage") return json(res, 200, TAVILY_USAGE_CLEAN);
      if (request.path === "/exa/search") return json(res, 400, { tag: "INVALID_REQUEST_BODY", error: "Invalid request body" });
      return mcpServer({ tools: ANYSEARCH_TOOLS, callText: "query is required" }, request, res);
    },
    async (base, requests) => {
      const [tavily, exa, anysearch] = await Promise.all([
        probeTavily({ apiKey: "k", endpoint: base + "/tavily" }),
        probeExa({ apiKey: "k", endpoint: base + "/exa" }),
        probeAnySearch({ apiKey: "k", endpoint: base + "/mcp" }),
      ]);
      assert.equal(tavily.auth, "ok");
      assert.equal(exa.auth, "ok");
      assert.equal(anysearch.auth, "ok");

      for (const request of requests) {
        // 带 query 的正文就是真搜索：免费面一律空体 / 空参数。
        const parsed = JSON.parse(request.body || "{}") as {
          query?: unknown;
          arguments?: Record<string, unknown>;
          params?: { arguments?: Record<string, unknown> };
        };
        assert.equal(parsed.query, undefined, "正文里出现了 query：" + request.path);
        assert.equal(parsed.arguments?.query, undefined, "参数里出现了 query：" + request.path);
        assert.equal(parsed.params?.arguments?.query, undefined, "tools/call 里出现了 query：" + request.path);
        // 只打三家的免费面，别的一概不碰。
        assert.ok(
          [request.path === "/tavily/usage", request.path === "/exa/search", request.path === "/mcp"].some(Boolean),
          "打了免费面以外的地方：" + request.path,
        );
      }
    },
  );
});

test("tavily：5xx 正文里带 unauthorized 也不算 key 被拒", async () => {
  // 网关和 CDN 的错误页里带一句 unauthorized 很常见，那时候 key 是好的。
  await serve(
    (_request, res) => json(res, 502, { error: "unauthorized: upstream gateway" }),
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "unverified", "5xx 不能判成 key 坏了");
      assert.equal(outcome.problem?.class, "transient");
    },
  );
});

test("探针：回了响应头再断在半路，算连不上，不把异常抛出去", async () => {
  // 10 秒超时管的是整条请求，不止等响应头：服务器先回 200 再卡住不回正文、
  // 或者读到一半断，异常必须在探针里变成结论，不能一路抛到 doctor / auth set。
  await serve(
    (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"account":');
      res.destroy();
    },
    async (base) => {
      const outcome = await probeTavily({ apiKey: "tvly-good", endpoint: base + "/tavily" });
      assert.equal(outcome.auth, "unverified");
      assert.equal(outcome.problem?.class, "unreachable");
    },
  );
});

test("isProbeProviderId：没登记的 provider 不猜", async () => {
  assert.equal(isProbeProviderId("tavily"), true);
  assert.equal(isProbeProviderId("exa"), true);
  assert.equal(isProbeProviderId("anysearch"), true);
  assert.equal(isProbeProviderId("google"), false);
});

test("exa：200 正文里带 unauthorized 也不判 key 被拒", async () => {
  // 免费面上这条请求本来就不该成功；2xx 说明入口变了，正文里出现什么词都不改变这一点。
  await serve(
    (_request, res) => json(res, 200, { error: "unauthorized" }),
    async (base) => {
      const outcome = await probeExa({ apiKey: "exa-good", endpoint: base + "/exa" });
      assert.equal(outcome.auth, "unverified");
      assert.equal(outcome.problem?.class, "permanent-protocol");
    },
  );
});
