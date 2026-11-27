// #608: the runtime hands `fetch` to the model and the generic tool_call hook
// leaves fetch URLs to the tool itself.
//
// Two seams: the model-visible tool list (registration) and the hook (no
// regex/HITL scan for a tool named fetch). The admission decisions are pinned
// separately in fetch-tool.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FetchProvider, FusedEnvelope } from "@anysearch-cli/retriever";
import { Type } from "@sinclair/typebox";
import { fetchTrustPrompt, PiAgentRuntime } from "../src/pi-runtime";
import type { DomainConfigPort, RetrieverPort } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

interface ScriptedContext {
  messages?: Array<{ role?: string; toolsAdded?: Array<{ name?: string }>; content?: unknown }>;
  tools?: Array<{ name?: string }>;
}

function toolNames(context: ScriptedContext): string[] {
  const system = (context.messages ?? []).find((message) => message?.role === "system");
  if (Array.isArray(system?.toolsAdded)) return system.toolsAdded.map((tool) => tool.name ?? "");
  return (context.tools ?? []).map((tool) => tool.name ?? "");
}

interface ScriptedReply {
  content: unknown[];
  [key: string]: unknown;
}

function assistantMessage(content: unknown[], stopReason: string, totalTokens = 200): ScriptedReply {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    usage: {
      input: Math.max(0, totalTokens - 10),
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamOf(message: ScriptedReply) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  };
}

function scriptedProvider(decide: (context: ScriptedContext) => ScriptedReply) {
  const calls: Array<{ tools: string[] }> = [];
  const fn = (_model: unknown, context: ScriptedContext) => {
    calls.push({ tools: toolNames(context) });
    return streamOf(decide(context));
  };
  return { fn, calls };
}

async function drain(run: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of run) events.push(event);
  return events;
}

const model = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const searchEnvelope: FusedEnvelope = {
  results: [{ url: "https://example.com/page", title: "Page", snippet: "snippet", source: "exa" }],
  answers: [],
  metadata: {
    providersQueried: ["exa"],
    providersFailed: [],
    providersCancelled: [],
    elapsedMs: 1,
    outcome: "answer",
  },
};

async function main() {
  // ---- the user-facing TOFU text names the URLs and the domain -----------
  {
    const prompt = fetchTrustPrompt({
      domain: "docs.example.com",
      urls: ["https://docs.example.com/guide", "https://docs.example.com/\u001b[31mred"],
    });
    assert(prompt.includes("https://docs.example.com/guide"), "the prompt shows the full URL");
    assert(prompt.includes("信任 docs.example.com 这个网站"), "the prompt names the domain");
    assert(!prompt.includes("\u001b"), "the prompt strips terminal control characters");
  }

  // ---- registration: store + providers make fetch model-visible ----------
  {
    const workDir = mkdtempSync(join(tmpdir(), "ans-fetch-runtime-"));
    const store = new SqliteSessionStore(join(workDir, "test.db"));
    try {
      const session = await store.createSession("chat");
      const retriever: RetrieverPort = { async search() { return searchEnvelope; } };
      const fetchProvider: FetchProvider = {
        id: "exa",
        maxUrlsPerCall: 100,
        async fetch() {
          return { provider: "exa", pages: [], failures: [] };
        },
      };
      const domain: DomainConfigPort = {
        sources: { enabled: ["exa"] },
        prompts: [],
        skills: { active: ["search"] },
        hooks: { toolWhitelist: ["search", "fetch"] },
        rag: { adapter: "none" },
      };
      const provider = scriptedProvider(() => assistantMessage([{ type: "text", text: "hello" }], "stop"));
      const runtime = new PiAgentRuntime({
        retriever,
        domain,
        model,
        streamFn: provider.fn,
        store,
        sessionId: session.id,
        fetchProviders: [fetchProvider],
      });
      const events = await drain(runtime.run("hello"));
      const tools = provider.calls[0]?.tools ?? [];
      assert(tools.includes("search") && tools.includes("fetch"),
        "the model sees fetch next to search when both halves are wired (got " + JSON.stringify(tools) + ")");
      assert(events.some((event) => (event as { type?: string }).type === "done"),
        "the scripted run completes");
      store.close();
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ---- registration: a domain whitelist without fetch wins -----------------
  {
    const workDir = mkdtempSync(join(tmpdir(), "ans-fetch-runtime-domain-"));
    const store = new SqliteSessionStore(join(workDir, "test.db"));
    try {
      const session = await store.createSession("chat");
      const retriever: RetrieverPort = { async search() { return searchEnvelope; } };
      const fetchProvider: FetchProvider = {
        id: "exa",
        maxUrlsPerCall: 5,
        async fetch() { return { provider: "exa", pages: [], failures: [] }; },
      };
      const domain: DomainConfigPort = {
        sources: { enabled: ["exa"] },
        prompts: [],
        skills: { active: ["search"] },
        hooks: { toolWhitelist: ["search"] },
        rag: { adapter: "none" },
      };
      const provider = scriptedProvider(() => assistantMessage([{ type: "text", text: "hello" }], "stop"));
      const runtime = new PiAgentRuntime({
        retriever,
        domain,
        model,
        streamFn: provider.fn,
        store,
        sessionId: session.id,
        fetchProviders: [fetchProvider],
      });
      await drain(runtime.run("hello"));
      const tools = provider.calls[0]?.tools ?? [];
      assert(!tools.includes("fetch"), "a domain whitelist without fetch keeps it out");
      store.close();
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ---- user message: a pasted URL becomes a ticket only when fetch registers --
  {
    const workDir = mkdtempSync(join(tmpdir(), "ans-fetch-runtime-user-"));
    const store = new SqliteSessionStore(join(workDir, "test.db"));
    try {
      const session = await store.createSession("chat");
      const retriever: RetrieverPort = { async search() { return searchEnvelope; } };
      const fetchProvider: FetchProvider = {
        id: "exa",
        maxUrlsPerCall: 5,
        async fetch() { return { provider: "exa", pages: [], failures: [] }; },
      };
      const domain: DomainConfigPort = {
        sources: { enabled: ["exa"] },
        prompts: [],
        skills: { active: ["search"] },
        hooks: { toolWhitelist: ["search", "fetch"] },
        rag: { adapter: "none" },
      };
      const provider = scriptedProvider(() => assistantMessage([{ type: "text", text: "ok" }], "stop"));
      const runtime = new PiAgentRuntime({
        retriever, domain, model, streamFn: provider.fn, store, sessionId: session.id, fetchProviders: [fetchProvider],
      });
      await drain(runtime.run("读 https://example.com/page"));
      assert(store.hasFetchTicket(session.id, "user", "example.com/page"),
        "a pasted URL becomes a user ticket when fetch registers");

      const noFetch = new PiAgentRuntime({
        retriever, domain, model, streamFn: provider.fn, store, sessionId: session.id,
      });
      await drain(noFetch.run("读 https://example.com/other"));
      assert(!store.hasFetchTicket(session.id, "user", "example.com/other"),
        "no user ticket is written when fetch does not register");
      store.close();
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ---- #612: without interactive, a supplied trust prompt is never wired ----
  {
    const workDir = mkdtempSync(join(tmpdir(), "ans-fetch-runtime-trust-"));
    const store = new SqliteSessionStore(join(workDir, "test.db"));
    try {
      const session = await store.createSession("chat");
      const retriever: RetrieverPort = { async search() { return searchEnvelope; } };
      const fetchProvider: FetchProvider = {
        id: "exa",
        maxUrlsPerCall: 5,
        async fetch() { return { provider: "exa", pages: [], failures: [] }; },
      };
      const domain: DomainConfigPort = {
        sources: { enabled: ["exa"] },
        prompts: [],
        skills: { active: ["search"] },
        hooks: { toolWhitelist: ["search", "fetch"] },
        rag: { adapter: "none" },
      };
      let asked = 0;
      let seen = "";
      let turn = 0;
      const provider = scriptedProvider((context) => {
        turn++;
        if (turn === 1) {
          return assistantMessage([{
            type: "toolCall",
            id: "f1",
            name: "fetch",
            arguments: {
              handles: ["https://docs.trust.example/guide"],
              requestTrustFor: "trust.example",
            },
          }], "toolUse");
        }
        seen = JSON.stringify(context.messages ?? []);
        return assistantMessage([{ type: "text", text: "ok" }], "stop");
      });
      const runtime = new PiAgentRuntime({
        retriever, domain, model, streamFn: provider.fn, store, sessionId: session.id,
        fetchProviders: [fetchProvider],
        interactive: false,
        confirmFetchTrust: async () => { asked++; return true; },
      });
      await drain(runtime.run("read the docs"));
      assert(asked === 0, "a non-interactive runtime never reaches the trust prompt");
      assert(!store.hasFetchTicket(session.id, "tofu", "trust.example"),
        "a non-interactive trust request writes no ticket");
      assert(seen.includes("非交互模式"), "the model reads the non-interactive refusal");
      store.close();
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ---- hook: a host tool named fetch keeps the generic URL scan -------------
  {
    let executed = 0;
    const customFetch: AgentTool = {
      name: "fetch",
      label: "Fetch",
      description: "probe fetch",
      parameters: Type.Object({ url: Type.String() }),
      execute: async () => {
        executed++;
        return { content: [{ type: "text", text: "FETCH-EXECUTED" }], details: {} };
      },
    };
    type ProbeDomain = DomainConfigPort & {
      sources: DomainConfigPort["sources"] & { urlAllowlist?: string[]; urlDenylist?: string[] };
    };
    const domain: ProbeDomain = {
      sources: { enabled: ["exa"], urlAllowlist: ["allowed.example"], urlDenylist: [] },
      prompts: [],
      skills: { active: ["search"] },
      hooks: { toolWhitelist: ["search", "fetch"] },
      rag: { adapter: "none" },
    };
    let turn = 0;
    const provider = scriptedProvider(() => {
      turn++;
      if (turn === 1) {
        return assistantMessage([{
          type: "toolCall",
          id: "f1",
          name: "fetch",
          arguments: { url: "https://evil.example/secret" },
        }], "toolUse");
      }
      return assistantMessage([{ type: "text", text: "answered" }], "stop");
    });
    const runtime = new PiAgentRuntime({
      retriever: { async search() { return searchEnvelope; } },
      domain,
      model,
      streamFn: provider.fn,
      tools: [customFetch],
    });
    const events = await drain(runtime.run("read this page"));
    assert(executed === 0, "a host tool named fetch is still URL-scanned without the built-in tool");
    assert(/URL rejected by trust boundary|Blocked retrieved-derived URL/.test(JSON.stringify(events)),
      "the generic trust boundary blocks the non-allowlisted URL");
  }

  console.log("fetch-runtime.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
