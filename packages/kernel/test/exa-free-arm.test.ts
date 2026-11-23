// #500: exa 的免费额度臂在装配这一层的行为。
//
// 两条钉子：
//   1. 没配 key 时这一臂真的建起来、真的打 Exa 的 MCP 免费端点，回包变成结果；
//      credentialSources 记 none，providerBuildErrors 保持空。
//   2. 那个端点回 429 时不是静默的 0 条：分类是 transient，retry-after 的秒数
//      落进 providerErrorRetryAfterSeconds，让提示句能说「等几秒」。
// fetch 用 stub 顶着，整个用例零外部网络。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEngine, type CompositionResult } from "../src/composition";
import { resolveSearchCredentials } from "@anysearch-cli/store";

const SCRUB = ["TAVILY_API_KEY", "EXA_API_KEY", "ANYSEARCH_API_KEY", "ANYSEARCH_ENDPOINT"];

type FetchCall = { url: string; authorization?: string; body: any; signal?: AbortSignal | null };

/** An engine whose only arm is exa, with every key channel blanked. */
async function withFreeArm(
  reply: (call: FetchCall) => Response,
  run: (ctx: { engine: CompositionResult; calls: FetchCall[] }) => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of SCRUB) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const home = mkdtempSync(join(tmpdir(), "ans-500-home-"));
  const domains = mkdtempSync(join(tmpdir(), "ans-500-domains-"));
  const calls: FetchCall[] = [];
  const origFetch = globalThis.fetch;
  try {
    writeFileSync(join(domains, "free.toml"), [
      'name = "free"',
      '[sources]',
      'enabled = ["exa"]',
      '[rag]',
      'adapter = "none"',
      "",
    ].join("\n"), "utf8");

    globalThis.fetch = (async (input: any, init?: any) => {
      const headers = init?.headers ?? {};
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const call: FetchCall = {
        url: String(input),
        authorization: headers.Authorization ?? headers.authorization,
        body,
        signal: init?.signal,
      };
      calls.push(call);
      return reply(call);
    }) as typeof fetch;

    const env: NodeJS.ProcessEnv = { USERPROFILE: home, HOME: home };
    const engine = createEngine("free", {
      dbPath: ":memory:",
      domainsDirs: [domains],
      env,
      searchCredentials: (e) => resolveSearchCredentials(e),
    });
    try {
      await run({ engine, calls });
    } finally {
      (engine.store as { close?: () => void }).close?.();
      engine.observation.close();
    }
  } finally {
    globalThis.fetch = origFetch;
    rmSync(domains, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    for (const key of SCRUB) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function sseReply(id: unknown, text: string): Response {
  const frame = "event: message\ndata: " + JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }] },
  }) + "\n\n";
  return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("no key: the exa arm builds, queries the free endpoint, and its reply lands", async () => {
  await withFreeArm(
    (call) => sseReply(call.body.id, [
      "Title: From the free quota",
      "URL: https://example.com/free",
      "Published: N/A",
      "Author: N/A",
      "Highlights:",
      "no credential was sent",
    ].join("\n")),
    async ({ engine, calls }) => {
      const envelope = await engine.retriever.search({ query: "cloudflare workers", mode: "fast" });

      assert.equal(calls.length, 1, "one arm, one request (" + calls.length + ")");
      assert.equal(calls[0]?.url, "https://mcp.exa.ai/mcp", "the keyless arm talks to the MCP free endpoint");
      assert.equal(calls[0]?.body?.params?.name, "web_search_exa", "it calls the free search tool");
      assert.equal(calls[0]?.authorization, undefined, "no credential rides the free request");
      assert.equal(
        JSON.stringify(calls[0]?.body?.params?.arguments),
        JSON.stringify({ query: "cloudflare workers", numResults: 10 }),
        "arguments are query plus numResults only",
      );

      assert.deepEqual(envelope.metadata.providersQueried, ["exa"], "exa is queried, not absent");
      assert.deepEqual(envelope.metadata.providersFailed, [], "the arm answered");
      assert.equal(envelope.results[0]?.url, "example.com/free", "the free reply reaches the envelope");
      assert.equal(envelope.results[0]?.title, "From the free quota", "title survives normalization");
      assert.equal(engine.providerBuildErrors.exa, undefined, "the build record stays empty");
      assert.equal(
        engine.credentialSources?.status === "resolved" ? engine.credentialSources.exa : "unset",
        "none",
        "no key is still reported as none, not as a build failure",
      );
    },
  );
});

test("429 from the free endpoint: transient, retry-after recorded, no silent zero", async () => {
  await withFreeArm(
    () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "You've hit Exa's free MCP rate limit." },
    }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } }),
    async ({ engine }) => {
      const envelope = await engine.retriever.search({ query: "cloudflare workers", mode: "fast" });

      assert.deepEqual(envelope.metadata.providersFailed, ["exa"], "the arm is named as failed");
      assert.equal(envelope.metadata.providerErrorClasses?.exa, "transient", "429 is transient, not an empty answer");
      assert.equal(envelope.metadata.providerErrorRetryAfterSeconds?.exa, 1, "retry-after lands on the envelope");
      assert.equal(envelope.results.length, 0, "no results and no silent zero-answer claim");
      assert.equal(engine.providerBuildErrors.exa, undefined, "this is a runtime failure, not a build failure");
    },
  );
});
