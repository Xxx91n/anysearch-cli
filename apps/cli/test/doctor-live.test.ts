// #442 / #416：`ans doctor --live` 是对外的那一条腿——它验证的是「联网」这件事，
// 所以这里钉的也只有两件：
//  1. 默认模式一次网络都不发（加了 key 也不发）—— CI 的 install-smoke 跑的就是默认模式；
//  2. --live 时三家的 auth 结论都从免费面的真回包里来，且 JSON 带 undetectable。
//
// 假端点全部在 127.0.0.1 上，真上游一次都不碰：--live 只打免费面这条纪律，先由
// provider-probes.test.ts 钉住（没有一条带 query），这里钉 doctor 的编排。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../src/commands/doctor.js";
import type { DiagJson } from "../src/diagnostics.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "ANS_DB_PATH",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "ANYSEARCH_API_KEY",
  "ANYSEARCH_ENDPOINT",
  "ANS_LLM_API_KEY",
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
];

type Entry = { name: string; state: string; mode: string; detail?: string; undetectable?: string[] };

interface Run {
  code: number;
  text: string;
  payload: DiagJson;
  entries: Entry[];
}

type Doctor = (args: string[], options?: Parameters<typeof runDoctor>[1]) => Promise<Run>;

/** 一个临时家目录 + 三把环境里的 key；用例只管怎么调 doctor。 */
async function withSandbox(run: (doctor: Doctor) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-live-"));
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    for (const [key, value] of Object.entries({
      TAVILY_API_KEY: "tvly-doctor-live",
      EXA_API_KEY: "exa-doctor-live",
      ANYSEARCH_API_KEY: "ans-doctor-live",
      ANYSEARCH_ENDPOINT: undefined,
      ANS_LLM_API_KEY: undefined,
      ANS_LLM_PROVIDER: undefined,
      ANS_LLM_MODEL: undefined,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run(async (args, options = {}) => {
      const lines: string[] = [];
      const code = await runDoctor(args, { ...options, stdout: (line) => lines.push(line) });
      const text = lines.join("\n");
      const payload = args.includes("--json")
        ? (JSON.parse(text) as DiagJson)
        : ({ layers: [] } as unknown as DiagJson);
      return {
        code,
        text,
        payload,
        entries: (payload.layers ?? []).flatMap((layer) => layer.entries as Entry[]),
      };
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function sourceRows(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.name.startsWith("搜索源 "));
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
}

/** anysearch 的免费面：initialize / tools/list / 空参数 tools/call，三步都在这儿。 */
function mcpScript(body: string, res: ServerResponse, script: { tools?: unknown; callText: string }): void {
  const payload = JSON.parse(body || "{}") as { id?: number; method?: string };
  if (payload.method === "initialize") {
    json(res, 200, { jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-11-25" } });
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
  json(res, 400, { error: "unknown method " + String(payload.method) });
}

const ANYSEARCH_TOOLS = [
  { name: "search", inputSchema: { properties: { query: { type: "string" } } } },
  { name: "extract", inputSchema: { properties: { urls: {} } } },
];

/** 三家的免费面都回「好 key」的答案。 */
function goodSurface(path: string, body: string, res: ServerResponse): boolean {
  if (path === "/tavily/usage") {
    json(res, 200, { account: { current_plan: "Researcher", plan_usage: 3, plan_limit: 1000 } });
    return true;
  }
  if (path === "/exa/search") {
    json(res, 400, { tag: "INVALID_REQUEST_BODY", error: "Invalid request body" });
    return true;
  }
  if (path === "/mcp") {
    mcpScript(body, res, { tools: ANYSEARCH_TOOLS, callText: "query is required" });
    return true;
  }
  return false;
}

async function serveFreeSurface(
  handler: (path: string, body: string, res: ServerResponse) => void,
  run: (base: string, paths: string[]) => Promise<void>,
): Promise<void> {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "";
      const body = Buffer.concat(chunks).toString("utf8");
      paths.push(path);
      handler(path, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run("http://127.0.0.1:" + port, paths);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("ans doctor：默认模式一次网络都不发，key 在也不发", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: unknown) => {
    calls.push(String(input));
    throw new Error("默认模式不该联网：" + String(input));
  }) as typeof fetch;
  try {
    await withSandbox(async (doctor) => {
      const run = await doctor(["--json"]);
      assert.deepEqual(calls, [], "默认模式发了网络请求");
      const rows = sourceRows(run.entries);
      assert.equal(rows.length, 3, "三家各一行");
      for (const row of rows) {
        assert.equal(row.mode, "offline");
        assert.equal(row.state, "ready");
        assert.match(row.detail ?? "", /auth 没验/, "「OK」不能读成「key 验过了」：" + row.name);
      }
      assert.equal(run.code, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ans doctor --live：三家各给一个 auth 结论，全从免费面来", async () => {
  await serveFreeSurface(
    (path, body, res) => {
      if (!goodSurface(path, body, res)) json(res, 404, { error: "no such route " + path });
    },
    async (base) => {
      await withSandbox(async (doctor) => {
        const run = await doctor(["--json", "--live"], {
          endpoints: { tavily: base + "/tavily", exa: base + "/exa", anysearch: base + "/mcp" },
        });
        const rows = sourceRows(run.entries);
        assert.equal(rows.length, 3);
        for (const row of rows) {
          assert.equal(row.mode, "live", "验过了就要标实测：" + row.name);
          assert.equal(row.state, "ready", row.name + "：" + row.detail);
          assert.match(row.detail ?? "", /auth 通过/);
          assert.match(row.detail ?? "", /key 来自环境变量/);
        }
        const anysearch = rows.find((row) => row.name === "搜索源 anysearch");
        assert.match(anysearch!.detail ?? "", /tools\/list/, "anysearch 顺手报了入口契约");
        // 额度只有 tavily 验得了，另两家必须说出来（#416 的 undetectable）。
        for (const name of ["搜索源 exa", "搜索源 anysearch"]) {
          const row = rows.find((entry) => entry.name === name)!;
          assert.deepEqual(row.undetectable, ["quota"], name + " 没标验不到什么");
        }
        assert.deepEqual(rows.find((row) => row.name === "搜索源 tavily")!.undetectable, undefined);
        assert.equal(run.code, 0);
      });
    },
  );
});

test("ans doctor --live：坏 key 报失败，退出码 1", async () => {
  await serveFreeSurface(
    (path, body, res) => {
      if (path === "/tavily/usage") return json(res, 401, { detail: { error: "Unauthorized" } });
      if (path === "/exa/search") return json(res, 401, { tag: "INVALID_API_KEY", error: "Invalid API key" });
      // anysearch 的坏 key 藏在 200 的 isError 里：握手和 tools/list 都正常，只有 tools/call 说话。
      mcpScript(body, res, { tools: ANYSEARCH_TOOLS, callText: "invalid_api_key" });
    },
    async (base) => {
      await withSandbox(async (doctor) => {
        const run = await doctor(["--json", "--live"], {
          endpoints: { tavily: base + "/tavily", exa: base + "/exa", anysearch: base + "/mcp" },
        });
        const rows = sourceRows(run.entries);
        assert.equal(rows.length, 3);
        for (const row of rows) {
          assert.equal(row.state, "failed", row.name + "：" + row.detail);
          assert.match(row.detail ?? "", /不认这把 key/);
        }
        assert.equal(run.code, 1, "真被拒了就该退 1");
      });
    },
  );
});

test("ans doctor --live：上游抽风只算未检查，别把 key 说成坏的", async () => {
  await serveFreeSurface(
    (path, _body, res) => json(res, 503, { error: "down: " + path }),
    async (base) => {
      await withSandbox(async (doctor) => {
        const run = await doctor(["--json", "--live"], {
          endpoints: { tavily: base + "/tavily", exa: base + "/exa", anysearch: base + "/mcp" },
        });
        for (const row of sourceRows(run.entries)) {
          assert.equal(row.state, "unchecked", row.name + "：" + row.detail);
          assert.match(row.detail ?? "", /抽风/);
        }
        assert.equal(run.code, 0, "5xx 不是失败");
      });
    },
  );
});

test("ans doctor --live：没 key 的源不探，还是「未配置」", async () => {
  await serveFreeSurface(
    (path, body, res) => {
      if (!goodSurface(path, body, res)) json(res, 404, { error: "no such route " + path });
    },
    async (base) => {
      await withSandbox(async (doctor) => {
        delete process.env.EXA_API_KEY;
        const run = await doctor(["--json", "--live"], {
          endpoints: { tavily: base + "/tavily", exa: base + "/exa", anysearch: base + "/mcp" },
        });
        const exa = sourceRows(run.entries).find((row) => row.name === "搜索源 exa")!;
        assert.equal(exa.state, "unconfigured");
        assert.equal(exa.mode, "offline", "没 key 就没有可验的东西");
      });
    },
  );
});

test("ans doctor --live：文字输出里那几行标着「实测」", async () => {
  await serveFreeSurface(
    (path, body, res) => {
      if (!goodSurface(path, body, res)) json(res, 404, { error: "no such route " + path });
    },
    async (base) => {
      await withSandbox(async (doctor) => {
        const run = await doctor(["--live"], {
          endpoints: { tavily: base + "/tavily", exa: base + "/exa", anysearch: base + "/mcp" },
        });
        const line = run.text.split("\n").find((each) => each.includes("搜索源 tavily"));
        assert.ok(line, "文字输出里要有那一行");
        assert.match(line, /（实测）/);
        assert.match(line, /auth 通过/);
      });
    },
  );
});
