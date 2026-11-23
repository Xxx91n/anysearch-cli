// 三条手工探针的凭据接线（#506 / spec #497 第 1 节）。
//
// 缝在最高处：跑的是用户实际执行的那三个脚本（plain `node <文件>`，不是 tsx），
// 打的是本地桩，所以不需要活 key，也不碰真上游。断言的全是外部行为：
//
//  1. 三档 keySource（env / user / none）和请求上的 Authorization 对得上；
//     key 只在 ~/.ans/credentials.json 里时也必须带 Authorization —— 这是 #422 的教训。
//  2. --nokey 是显式匿名臂：env 和文件里都有 key，也不发头。
//  3. 凭据文件坏了 → credentialWarning，不是「没配 key」。
//  4. key 的值不出现在 stdout / stderr / 台账里。
//  5. anysearch 的 endpoint 只认 ANYSEARCH_ENDPOINT：凭据文件里塞的 endpoint 不改变请求地址。
//  6. probe schema 升到 @2；退出码语义没变（tavily 没 key 仍然退 2）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const KEY = "probe-test-key-0123456789";
const RAW = "providers/anysearch/probe-anysearch-mcp-raw.ts";
const PROVIDER = "providers/anysearch/probe-anysearch-provider.ts";
const TAVILY = "providers/tavily/probe-tavily-domains.mjs";

/** 子进程不许继承宿主机的真 key / 真地址：这几家的开关一出现就删掉，新增开关不用回来补名单。 */
const SCRUBBED_ENV_PREFIX = /^(?:ANYSEARCH_|TAVILY_|EXA_|PROBE_|ANS_PROBE_)/;

interface Recorded {
  path: string;
  body: string;
  authorization?: string;
}

/**
 * 本地桩：一个服务器同时当两用——`/search` 按臂回 Tavily 的 JSON，
 * 其余路径回 JSON-RPC（initialize / notifications / tools/call）。
 * Tavily 的臂靠请求正文分：prefer 回域外，父域查询回它自己的子域。
 */
async function withStub(run: (base: string, requests: Recorded[]) => Promise<void>): Promise<void> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path: req.url ?? "",
        body,
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      });
      const send = (status: number, payload: unknown, contentType = "application/json") => {
        res.writeHead(status, { "content-type": contentType });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };
      if ((req.url ?? "").startsWith("/search")) {
        const payload = JSON.parse(body || "{}") as { include_domains?: string[]; include_domains_mode?: string };
        const allow = payload.include_domains ?? [];
        let urls: string[];
        if (allow[0] === "cloudflare.com") urls = ["https://developers.cloudflare.com/a"];
        else if (allow[0] === "developers.cloudflare.com") urls = ["https://developers.cloudflare.com/b"];
        else if (payload.include_domains_mode === "prefer") urls = ["https://outside.example/x"];
        else urls = ["https://pnpm.io/a"];
        send(200, { results: urls.map((url, i) => ({ title: "t" + i, url, content: "c" })) });
        return;
      }
      const message = JSON.parse(body) as { id?: number; method?: string };
      if (message.method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      if (message.method === "initialize") {
        send(200, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25" } });
        return;
      }
      if (message.method === "tools/call") {
        send(200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "## Search Results (1 results, 12ms)\n### 1. Example\n- **URL**: https://example.com/a\nsnippet" }],
          },
        });
        return;
      }
      send(200, { jsonrpc: "2.0", id: message.id, result: {} });
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

/** 一个只有本用例会读的临时 HOME；凭据文件放在 `~/.ans/credentials.json`。 */
function makeHome(label: string, credentials?: string): string {
  const home = mkdtempSync(join(tmpdir(), "ans506-" + label + "-"));
  mkdirSync(join(home, ".ans"), { recursive: true });
  if (credentials !== undefined) writeFileSync(join(home, ".ans", "credentials.json"), credentials, "utf8");
  return home;
}

function bindingsFile(provider: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ bindings: [{ provider, apiKey: KEY, ...extra }] }, null, 2);
}

function probeEnv(home: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  for (const name of Object.keys(env)) if (SCRUBBED_ENV_PREFIX.test(name)) delete env[name];
  return { ...env, ...extra };
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProbe(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, script), ...args], { cwd: REPO_ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** 探针的 stdout 是一份（可能缩进的）JSON；取最后那一份。 */
function readJson(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const line = text.split("\n").filter((l) => l.trim().startsWith("{")).pop();
    assert.ok(line, "探针没有打印 JSON：" + stdout);
    return JSON.parse(line) as Record<string, unknown>;
  }
}

function assertNoKey(result: RunResult, what: string): void {
  assert.ok(!result.stdout.includes(KEY), what + " 的 stdout 里出现了 key 的值");
  assert.ok(!result.stderr.includes(KEY), what + " 的 stderr 里出现了 key 的值");
}

function anySearchEndpoint(base: string): string {
  return base + "/mcp";
}

// ── anysearch raw 探针 ───────────────────────────────────────────────────

test("anysearch raw：三档 keySource 和 Authorization 对得上", async () => {
  await withStub(async (base, requests) => {
    const endpoint = anySearchEndpoint(base);

    const fromEnv = await runProbe(RAW, [], probeEnv(makeHome("raw-env"), { ANYSEARCH_ENDPOINT: endpoint, ANYSEARCH_API_KEY: KEY }));
    const envOut = readJson(fromEnv.stdout);
    assert.equal(envOut["schema"], "anysearch/mcp-raw-probe@2");
    assert.equal(envOut["keySource"], "env");
    assert.equal(fromEnv.code, 0, "桩回的是结果形状：" + fromEnv.stdout + fromEnv.stderr);
    assertNoKey(fromEnv, "raw/env");
    assert.equal(requests.at(-1)?.authorization, "Bearer " + KEY, "env 里的 key 必须上请求头");

    const fromFile = await runProbe(RAW, [], probeEnv(makeHome("raw-user", bindingsFile("anysearch")), { ANYSEARCH_ENDPOINT: endpoint }));
    const userOut = readJson(fromFile.stdout);
    assert.equal(userOut["keySource"], "user", "user 指用户凭据文件");
    assert.equal(fromFile.code, 0, "key 只在凭据文件里也要跑通：" + fromFile.stdout + fromFile.stderr);
    assertNoKey(fromFile, "raw/user");
    assert.equal(
      requests.at(-1)?.authorization,
      "Bearer " + KEY,
      "#422：key 只在凭据文件里时以前会静默跑成匿名",
    );

    const none = await runProbe(RAW, [], probeEnv(makeHome("raw-none"), { ANYSEARCH_ENDPOINT: endpoint }));
    const noneOut = readJson(none.stdout);
    assert.equal(noneOut["keySource"], "none");
    assert.equal(requests.at(-1)?.authorization, undefined, "没 key 就不发 Authorization");
    assertNoKey(none, "raw/none");
  });
});

test("anysearch raw：--nokey 压掉两处的 key，文件坏了带 credentialWarning", async () => {
  await withStub(async (base, requests) => {
    const endpoint = anySearchEndpoint(base);

    const both = makeHome("raw-nokey", bindingsFile("anysearch"));
    const noKey = await runProbe(RAW, ["--nokey"], probeEnv(both, { ANYSEARCH_ENDPOINT: endpoint, ANYSEARCH_API_KEY: KEY }));
    const noKeyOut = readJson(noKey.stdout);
    assert.equal(noKeyOut["keySource"], "none", "--nokey 是显式匿名臂");
    assert.equal(requests.at(-1)?.authorization, undefined, "--nokey 时即使 env 和文件里都有 key 也不发头");
    assertNoKey(noKey, "raw/nokey");

    const broken = await runProbe(RAW, [], probeEnv(makeHome("raw-broken", "{ not json"), { ANYSEARCH_ENDPOINT: endpoint }));
    const brokenOut = readJson(broken.stdout);
    assert.equal(brokenOut["keySource"], "none");
    assert.match(String(brokenOut["credentialWarning"]), /credentials\.json/, "坏文件要说出是哪个文件");
    assertNoKey(broken, "raw/broken");
  });
});

test("anysearch raw：凭据文件里的 endpoint 不算数，只认 ANYSEARCH_ENDPOINT", async () => {
  await withStub(async (base, requests) => {
    const home = makeHome(
      "raw-endpoint",
      bindingsFile("anysearch", { endpoint: "https://stored.example/mcp" }),
    );
    const result = await runProbe(RAW, [], probeEnv(home, { ANYSEARCH_ENDPOINT: anySearchEndpoint(base) }));
    const out = readJson(result.stdout);
    assert.equal(out["endpointSource"], "env");
    assert.ok(requests.length > 0, "请求必须落到 ANYSEARCH_ENDPOINT 指的桩上，而不是文件里那个地址");
    assertNoKey(result, "raw/endpoint");
  });
});

// ── anysearch provider 探针 ──────────────────────────────────────────────

test("anysearch provider：解析出的 key 显式传进适配器，输出 keySource", async () => {
  await withStub(async (base, requests) => {
    const endpoint = anySearchEndpoint(base);

    const fromEnv = await runProbe(PROVIDER, [], probeEnv(makeHome("prov-env"), { ANYSEARCH_ENDPOINT: endpoint, ANYSEARCH_API_KEY: KEY }));
    const envOut = readJson(fromEnv.stdout);
    assert.equal(envOut["schema"], "anysearch/provider-probe@2");
    assert.equal(envOut["keySource"], "env");
    assert.equal(envOut["results"], 1, "适配器必须真的拿到结果：" + fromEnv.stdout + fromEnv.stderr);
    assert.equal(fromEnv.code, 0, "exit 0 是「这条臂活着」");
    assertNoKey(fromEnv, "provider/env");
    assert.equal(requests.at(-1)?.authorization, "Bearer " + KEY);

    const fromFile = await runProbe(PROVIDER, [], probeEnv(makeHome("prov-user", bindingsFile("anysearch")), { ANYSEARCH_ENDPOINT: endpoint }));
    const userOut = readJson(fromFile.stdout);
    assert.equal(userOut["keySource"], "user");
    assert.equal(fromFile.code, 0, "key 只存在凭据文件里也要活着：" + fromFile.stdout + fromFile.stderr);
    assertNoKey(fromFile, "provider/user");
    assert.equal(
      requests.at(-1)?.authorization,
      "Bearer " + KEY,
      "适配器不能回读 process.env 兜底：解析出的 key 要显式传进去",
    );

    const none = await runProbe(PROVIDER, [], probeEnv(makeHome("prov-none"), { ANYSEARCH_ENDPOINT: endpoint }));
    const noneOut = readJson(none.stdout);
    assert.equal(noneOut["keySource"], "none");
    assert.equal(requests.at(-1)?.authorization, undefined);
    assertNoKey(none, "provider/none");
  });
});

test("anysearch provider：--nokey 匿名，文件坏了带 credentialWarning", async () => {
  await withStub(async (base, requests) => {
    const endpoint = anySearchEndpoint(base);

    const both = makeHome("prov-nokey", bindingsFile("anysearch"));
    const noKey = await runProbe(PROVIDER, ["--nokey"], probeEnv(both, { ANYSEARCH_ENDPOINT: endpoint, ANYSEARCH_API_KEY: KEY }));
    const noKeyOut = readJson(noKey.stdout);
    assert.equal(noKeyOut["keySource"], "none");
    assert.equal(requests.at(-1)?.authorization, undefined, "--nokey 时不发任何 Authorization");
    assertNoKey(noKey, "provider/nokey");

    const broken = await runProbe(PROVIDER, [], probeEnv(makeHome("prov-broken", "{ not json"), { ANYSEARCH_ENDPOINT: endpoint }));
    const brokenOut = readJson(broken.stdout);
    assert.equal(brokenOut["keySource"], "none");
    assert.match(String(brokenOut["credentialWarning"]), /credentials\.json/);
    assertNoKey(broken, "provider/broken");
  });
});

// ── tavily 探针 ──────────────────────────────────────────────────────────

function readLedger(dir: string): Record<string, unknown> {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1, "一跑一份台账");
  return JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as Record<string, unknown>;
}

function ledgerDir(): string {
  return mkdtempSync(join(tmpdir(), "ans506-ledger-"));
}

test("tavily：三档 keySource，凭据文件里的 key 也会上请求头", async () => {
  await withStub(async (base, requests) => {
    const fromEnvDir = ledgerDir();
    const fromEnv = await runProbe(TAVILY, [], probeEnv(makeHome("tvly-env"), {
      PROBE_TAVILY_ENDPOINT: base,
      PROBE_TAVILY_OUT_DIR: fromEnvDir,
      TAVILY_API_KEY: KEY,
    }));
    const envLedger = readLedger(fromEnvDir);
    assert.equal(envLedger["schema"], "anysearch/tavily-domain-probe@2");
    assert.equal(envLedger["keySource"], "env");
    assert.equal(fromEnv.code, 0, "B 臂证成了就退 0：" + fromEnv.stdout + fromEnv.stderr);
    assert.ok(requests.length >= 5, "A/B/C 三臂共 5 次调用");
    for (const request of requests) {
      assert.equal(request.authorization, "Bearer " + KEY, "每一次调用都要带 key");
      assert.ok(!request.path.startsWith("http"), "地址由 PROBE_TAVILY_ENDPOINT 决定");
    }
    assertNoKey(fromEnv, "tavily/env");

    requests.length = 0;
    const fromFileDir = ledgerDir();
    const fromFile = await runProbe(TAVILY, [], probeEnv(makeHome("tvly-user", bindingsFile("tavily")), {
      PROBE_TAVILY_ENDPOINT: base,
      PROBE_TAVILY_OUT_DIR: fromFileDir,
    }));
    const userLedger = readLedger(fromFileDir);
    assert.equal(userLedger["keySource"], "user");
    assert.equal(fromFile.code, 0, "key 只存在凭据文件里时以前会整轮 SKIPPED 退 2：" + fromFile.stdout + fromFile.stderr);
    assert.ok(requests.length >= 5, "凭据文件那一跑也要真的调用");
    for (const request of requests) {
      assert.equal(request.authorization, "Bearer " + KEY, "凭据文件里的 key 也要上每一次调用（#422 要钉的就是这个）");
    }
    assertNoKey(fromFile, "tavily/user");
  });
});

test("tavily：两处都没 key 退 2，文件坏了带 credentialWarning", async () => {
  await withStub(async (base, requests) => {
    const noneDir = ledgerDir();
    const none = await runProbe(TAVILY, [], probeEnv(makeHome("tvly-none"), {
      PROBE_TAVILY_ENDPOINT: base,
      PROBE_TAVILY_OUT_DIR: noneDir,
    }));
    const noneLedger = readLedger(noneDir);
    assert.equal(noneLedger["keySource"], "none");
    assert.equal(none.code, 2, "没有 key 是「这一跑没有结论」，不是通过");
    assert.equal(requests.length, 0, "没 key 一个请求都不发");
    assert.ok((noneLedger["arms"] as Array<{ status: string }>).every((arm) => arm.status === "SKIPPED"));

    const brokenDir = ledgerDir();
    const broken = await runProbe(TAVILY, [], probeEnv(makeHome("tvly-broken", "{ not json"), {
      PROBE_TAVILY_ENDPOINT: base,
      PROBE_TAVILY_OUT_DIR: brokenDir,
    }));
    const brokenLedger = readLedger(brokenDir);
    assert.equal(brokenLedger["keySource"], "none");
    assert.match(String(brokenLedger["credentialWarning"]), /credentials\.json/, "坏文件要进台账");
    assert.match(broken.stderr, /credentialWarning/, "也别只在台账里说");
    assertNoKey(broken, "tavily/broken");
  });
});
