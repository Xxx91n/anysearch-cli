// #204 acceptance — MCP execution-result semantics.
//
//   - #356: the remedy sentences live only in PROVIDER_ERROR_HINTS. Every
//     expected hint string here is derived from that table, and the sentences
//     of the classes that have one are checked to be pairwise distinct.
//   - Handler exceptions in search_web / research_web / recall_memory return
//     isError:true with the existing actionable text and no structuredContent.
//   - ans_chat without LLM configuration and a thrown runtime error are errors.
//   - A zero-result search is a success ONLY when an arm answered; an all-arm
//     outage is isError:true and names providersFailed.
//   - A partial failure with results is isError:false and carries
//     providersFailed / providerErrorClasses / providerBuildErrors in BOTH
//     content and structuredContent.
//   - Assertions travel the registered handler seam and, once, the real
//     stateless HTTP transport.
//
// No test framework (repo convention: assert-based, run via `node --import tsx
// --test`). Offline only: no providers, no LLM network.

import { buildServer } from "../src/server.js";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import { registerRecallMemory } from "../src/tools/recall-memory.tool.js";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { registerQueryKnowledge } from "../src/tools/query-knowledge.tool.js";
import { createMcpToolState } from "../src/tool-state.js";
import { credentialFileNotice, PROVIDER_ERROR_HINTS } from "@anysearch-cli/kernel";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope, AttributionReport, ProviderErrorClass } from "@anysearch-cli/retriever";
import { resolveLlmConfig, type SessionStore } from "@anysearch-cli/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { httpStateless } from "./helpers/mcp-harness.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

const fakeSpan = {
  traceId: "t",
  spanId: "s",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

type Handler = (args: unknown, ctx?: { mcpReq?: { signal?: AbortSignal } }) => Promise<any>;

// Empty resolver roots created below, removed in main()'s finally.
const failureRoots: string[] = [];

/**
 * The sentence for one class, read from the table instead of copied here so a
 * reworded hint never needs a test edit (#356). A class without a sentence is
 * a broken fixture, not a silent skip.
 */
function hintFor(cls: ProviderErrorClass): string {
  const sentence = PROVIDER_ERROR_HINTS[cls];
  if (!sentence) throw new Error("PROVIDER_ERROR_HINTS has no sentence for " + cls);
  return sentence;
}

const QUOTA_SENTENCE = hintFor("quota-exhausted");
const TRANSIENT_SENTENCE = hintFor("transient");
const AUTH_SENTENCE = hintFor("permanent-auth");
const FREE_QUOTA_SENTENCE = hintFor("free-quota-exhausted");

function captureHandlers(eng: CompositionResult): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  registerSearchWeb(fakeServer as any, eng);
  registerResearchWeb(fakeServer as any, eng);
  registerRecallMemory(fakeServer as any, eng);
  // #300/greptile P1: the "missing config" case must not depend on the
  // operator's real ~/.ans/config.toml. Point the shared resolver at
  // an empty temp root so only this suite's env decides the outcome.
  const emptyRoot = mkdtempSync(join(tmpdir(), "ans-300-failure-"));
  failureRoots.push(emptyRoot);
  const isolatedState = createMcpToolState({
    resolveLlmConfig: (opts = {}) => resolveLlmConfig({ ...opts, home: emptyRoot, cwd: emptyRoot }),
  });
  registerAnsChat(fakeServer as any, eng, isolatedState);
  registerQueryKnowledge(fakeServer as any, eng);
  return handlers;
}

const okStore = {
  createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
  ensureSession: async () => {},
  append: async () => {},
  searchFts5: async () => [],
  searchMemory: async () => [],
  saveResults: async () => {},
  saveAnchor: async () => {},
  getAnchors: async () => [],
};

function makeEngine(
  search: (q: Query) => Promise<FusedEnvelope>,
  extra: Partial<CompositionResult> = {},
): CompositionResult {
  return {
    retriever: { search },
    store: okStore as unknown as SessionStore,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
    ...extra,
  } as unknown as CompositionResult;
}

function emptyEnvelope(providersQueried: string[]): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: { providersQueried, providersFailed: [], providersCancelled: [], elapsedMs: 1, outcome: "empty" },
  };
}

function allFailedEnvelope(providers: string[]): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: providers,
      providersFailed: [...providers],
      providersCancelled: [],
      providerErrorClasses: { [providers[0]]: "transient", [providers[1] ?? providers[0]]: "permanent-auth" },
      elapsedMs: 1,
      outcome: "failed",
    },
  } as FusedEnvelope;
}

function partialEnvelope(): FusedEnvelope {
  return {
    results: [{ url: "https://example.com/a", title: "A", snippet: "s", source: "exa" } as any],
    answers: [],
    metadata: {
      providersQueried: ["exa", "tavily"],
      providersFailed: ["tavily"],
      providersCancelled: [],
      providerErrorClasses: { tavily: "transient" },
      elapsedMs: 1,
      outcome: "answer",
    },
  } as FusedEnvelope;
}

function quotaAllFailedEnvelope(): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["tavily"],
      providersFailed: ["tavily"],
      providersCancelled: [],
      providerErrorClasses: { tavily: "quota-exhausted" },
      elapsedMs: 1,
      outcome: "failed",
    },
  } as FusedEnvelope;
}

function quotaPartialEnvelope(): FusedEnvelope {
  const env = partialEnvelope();
  env.metadata.providerErrorClasses = { tavily: "quota-exhausted" };
  return env;
}

function freeQuotaAllFailedEnvelope(retryAfterSeconds?: number): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["tavily"],
      providersFailed: ["tavily"],
      providersCancelled: [],
      providerErrorClasses: { tavily: "free-quota-exhausted" },
      ...(retryAfterSeconds !== undefined ? { providerErrorRetryAfterSeconds: { tavily: retryAfterSeconds } } : {}),
      elapsedMs: 1,
      outcome: "failed",
    },
  } as FusedEnvelope;
}

function freeQuotaPartialEnvelope(retryAfterSeconds: number): FusedEnvelope {
  const env = partialEnvelope();
  env.metadata.providerErrorClasses = { tavily: "free-quota-exhausted" };
  env.metadata.providerErrorRetryAfterSeconds = { tavily: retryAfterSeconds };
  return env;
}

function partialCancelledEnvelope(): FusedEnvelope {
  return {
    results: [{ url: "https://example.com/a", title: "A", snippet: "s", source: "exa" } as any],
    answers: [],
    metadata: {
      providersQueried: ["exa", "anysearch"],
      providersFailed: [],
      providersCancelled: ["anysearch"],
      elapsedMs: 1,
      outcome: "answer",
    },
  } as FusedEnvelope;
}

function allCancelledEnvelope(): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["anysearch"],
      providersFailed: [],
      providersCancelled: ["anysearch"],
      elapsedMs: 1,
      outcome: "cancelled",
    },
  } as FusedEnvelope;
}

function abstainEnvelope(): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["exa"],
      providersFailed: [],
      providersCancelled: [],
      elapsedMs: 1,
      outcome: "abstain",
      abstain: { abstain: true, reason: "domain_filter_empty", domain: "docs", preFiltered: 3, postFiltered: 0, gate: "post" },
    },
  } as FusedEnvelope;
}

function mixedFailedCancelledEnvelope(): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["exa", "anysearch"],
      providersFailed: ["exa"],
      providersCancelled: ["anysearch"],
      providerErrorClasses: { exa: "transient" },
      elapsedMs: 1,
      outcome: "cancelled",
    },
  } as FusedEnvelope;
}

function unknownPartialEnvelope(): FusedEnvelope {
  const env = partialEnvelope();
  env.metadata.providerErrorClasses = { tavily: "unknown" };
  return env;
}

const ENV_KEYS = ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY", "ANS_PROJECT_DB"];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

async function main() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  try {
    // ---- 1. Handler exceptions are execution errors (no structuredContent) ----
    {
      const eng = makeEngine(async () => {
        throw new Error("forced retriever failure");
      });
      const h = captureHandlers(eng);

      const sw = await h.search_web({ query: "x" });
      assert(sw?.isError === true, "search_web retriever failure: isError true");
      assert(
        sw?.content?.[0]?.text === "search_web error: forced retriever failure",
        "search_web retriever failure: existing actionable text kept",
      );
      assert(sw?.structuredContent === undefined, "search_web failure: no structuredContent");

      const rw = await h.research_web({ question: "x", depth: "brief" });
      assert(rw?.isError === true, "research_web retriever failure: isError true");
      assert(
        rw?.content?.[0]?.text === "research_web error: forced retriever failure",
        "research_web retriever failure: existing actionable text kept",
      );
      assert(rw?.structuredContent === undefined, "research_web failure: no structuredContent");
    }

    // ---- 2. Store failure in recall_memory is an execution error ----
    {
      const eng = makeEngine(async () => emptyEnvelope([]), {
        store: {
          ...okStore,
          searchMemory: async () => {
            throw new Error("forced store failure");
          },
        } as unknown as SessionStore,
      });
      const rm = await captureHandlers(eng).recall_memory({ query: "x", limit: 3 });
      assert(rm?.isError === true, "recall_memory store failure: isError true");
      assert(
        rm?.content?.[0]?.text === "recall_memory error: forced store failure",
        "recall_memory store failure: existing actionable text kept",
      );
      assert(rm?.structuredContent === undefined, "recall_memory failure: no structuredContent");
    }

    // ---- 3. ans_chat: missing configuration and runtime errors ----
    {
      // Missing config: resolved per call through the shared layered resolver.
      const missing = await captureHandlers(makeEngine(async () => emptyEnvelope([]))).ans_chat({ message: "hi" });
      assert(missing?.isError === true, "ans_chat missing LLM config: isError true");
      // #300: the report names BOTH ways in — env and a config file — so a
      // host that wrote a TOML knows where to look.
      assert(
        String(missing?.content?.[0]?.text) ===
          "ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars, " +
          "or write provider/model in ~/.ans/config.toml (user) or .ans/config.toml (project).",
        "ans_chat missing LLM config: names env and both config files",
      );
      assert(missing?.structuredContent === undefined, "ans_chat missing LLM config: no structuredContent");

      // Runtime error before any network call: baseUrl set without ANS_LLM_API.
      process.env.ANS_LLM_PROVIDER = "openai";
      process.env.ANS_LLM_MODEL = "gpt-5-mini";
      process.env.ANS_LLM_BASE_URL = "http://127.0.0.1:1/v1";
      const thrown = await captureHandlers(makeEngine(async () => emptyEnvelope([]))).ans_chat({ message: "hi" });
      assert(thrown?.isError === true, "ans_chat runtime error: isError true");
      assert(
        String(thrown?.content?.[0]?.text).includes("ANS_LLM_API"),
        "ans_chat runtime error: actionable text names the missing setting",
      );
      assert(thrown?.structuredContent === undefined, "ans_chat runtime error: no structuredContent");
      clearEnv();
    }

    // ---- 4. search_web: all-arm outage is an error, not an empty result ----
    {
      const h = captureHandlers(makeEngine(async () => allFailedEnvelope(["exa", "tavily"])));
      const res = await h.search_web({ query: "x" });
      assert(res?.isError === true, "search_web all providers failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("providersFailed: exa, tavily"), "search_web all providers failed: names providersFailed");
      assert(!text.includes("{"), "search_web all providers failed: error text is not a JSON payload");
      assert(res?.structuredContent === undefined, "search_web all providers failed: no structuredContent");
    }

    // ---- 5. research_web: all-arm outage across rounds is an error ----
    {
      const h = captureHandlers(makeEngine(async () => allFailedEnvelope(["exa", "tavily"])));
      const res = await h.research_web({ question: "x", depth: "brief" });
      assert(res?.isError === true, "research_web all providers failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("providersFailed: exa, tavily"), "research_web all providers failed: names providersFailed");
      assert(res?.structuredContent === undefined, "research_web all providers failed: no structuredContent");
    }

    // ---- 6. Partial failure with results stays a success + metadata ----
    {
      const eng = makeEngine(async () => partialEnvelope(), {
        providerBuildErrors: { exa: "permanent: missing/invalid credential — set the provider's API key env" },
        // #441: the same record the CLI's --json carries.
        credentialSources: { status: "resolved", tavily: "none", exa: "env", anysearch: "none" },
      });
      const h = captureHandlers(eng);
      const res = await h.search_web({ query: "x" });

      assert(res?.isError !== true, "search_web partial failure: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "search_web partial failure: results preserved");
      assert(
        JSON.stringify(doc.providersFailed) === JSON.stringify(["tavily"]),
        "search_web partial failure: content carries providersFailed",
      );
      assert(doc.providerErrorClasses?.tavily === "transient", "search_web partial failure: content carries providerErrorClasses");
      assert(
        typeof doc.providerBuildErrors?.exa === "string",
        "search_web partial failure: content carries providerBuildErrors",
      );
      const sc = res?.structuredContent;
      assert(sc !== undefined, "search_web partial failure: structuredContent present");
      assert(
        JSON.stringify(sc.providersFailed) === JSON.stringify(["tavily"]),
        "search_web partial failure: structuredContent carries providersFailed",
      );
      assert(sc.providerErrorClasses?.tavily === "transient", "search_web partial failure: structuredContent carries providerErrorClasses");
      assert(typeof sc.providerBuildErrors?.exa === "string", "search_web partial failure: structuredContent carries providerBuildErrors");
      assert(sc.outcome === "answer", "search_web partial failure: structuredContent says outcome=answer");
      assert(doc.outcome === "answer", "search_web partial failure: content says outcome=answer");
      assert(sc.credentialSources?.status === "resolved", "search_web partial failure: structuredContent carries credentialSources");
      assert(
        sc.credentialSources?.exa === "env" &&
          sc.credentialSources?.tavily === "none" &&
          sc.credentialSources?.anysearch === "none",
        "search_web partial failure: credential labels are unchanged from the engine, all three arms",
      );
    }

    // ---- 7. research_web: same partial-failure contract ----
    {
      const eng = makeEngine(async () => partialEnvelope(), {
        providerBuildErrors: { exa: "permanent: missing/invalid credential — set the provider's API key env" },
        credentialSources: { status: "resolved", tavily: "none", exa: "env", anysearch: "none" },
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "brief" });
      assert(res?.isError !== true, "research_web partial failure: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "research_web partial failure: results preserved");
      assert(JSON.stringify(doc.providersFailed) === JSON.stringify(["tavily"]), "research_web partial failure: content carries providersFailed");
      assert(doc.providerErrorClasses?.tavily === "transient", "research_web partial failure: content carries providerErrorClasses");
      assert(typeof doc.providerBuildErrors?.exa === "string", "research_web partial failure: content carries providerBuildErrors");
      const sc = res?.structuredContent;
      assert(sc?.providersFailed?.[0] === "tavily", "research_web partial failure: structuredContent carries providersFailed");
      assert(sc?.providerErrorClasses?.tavily === "transient", "research_web partial failure: structuredContent carries providerErrorClasses");
      assert(typeof sc?.providerBuildErrors?.exa === "string", "research_web partial failure: structuredContent carries providerBuildErrors");
      assert(sc?.credentialSources?.status === "resolved", "research_web partial failure: structuredContent carries credentialSources");
      assert(
        sc?.credentialSources?.exa === "env" &&
          sc?.credentialSources?.tavily === "none" &&
          sc?.credentialSources?.anysearch === "none",
        "research_web partial failure: credential labels are unchanged from the engine, all three arms",
      );
    }

    // ---- 7b. A broken credential file rides both halves (#533) ----
    // The hosts split in two: some give the model only `content` (Cursor, the
    // dsh bridge), some only `structuredContent`. A fault that lives in one half
    // is invisible to the other, so this pins both.
    {
      const eng = makeEngine(async () => partialEnvelope(), {
        credentialSources: {
          status: "resolved",
          tavily: "none",
          exa: "none",
          anysearch: "none",
          credentialFileFault: credentialFileNotice({ kind: "not-json" }),
        },
      });
      const h = captureHandlers(eng);
      const search = await h.search_web({ query: "x" });
      const content = JSON.parse(String(search?.content?.[0]?.text));
      assert(content.credentialSources?.credentialFileFault?.kind === "not-json",
        "search_web content names the broken credential file: the text half must carry it");
      assert(search?.structuredContent?.credentialSources?.credentialFileFault?.kind === "not-json",
        "search_web structuredContent carries the same record");

      const research = await h.research_web({ question: "x", depth: "brief" });
      const researchContent = JSON.parse(String(research?.content?.[0]?.text));
      assert(researchContent.credentialSources?.credentialFileFault?.kind === "not-json",
        "research_web content names it too");
      assert(research?.structuredContent?.credentialSources?.credentialFileFault?.kind === "not-json",
        "research_web structuredContent carries it");
      assert(String(content.credentialSources?.credentialFileFault?.notice ?? "").includes("restart ans"),
        "the sentence says what makes the fix take effect");
    }

    // ---- 8. Zero results with an answering arm stays a success ----
    {
      const res = await captureHandlers(makeEngine(async () => emptyEnvelope(["exa"]))).search_web({ query: "x" });
      assert(res?.isError !== true, "search_web zero results with one successful provider: isError is not true");
      assert(!String(res?.content?.[0]?.text).includes("all providers failed"), "search_web zero results: not an outage message");
      // The zero-result outcome a host can act on: `empty`, not a policy claim.
      assert(res?.structuredContent?.outcome === "empty", "search_web zero results: structuredContent says outcome=empty");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.outcome === "empty", "search_web zero results: content says outcome=empty");
      assert(doc.abstain === null, "search_web zero results without a policy: no abstain marker");
    }

    // ---- 8b. Cancelled arms are named, and they never make an outage (#475) ----
    {
      // Partial: one arm answered, the grace window cut the other off. Both
      // channels must name who was asked and who was cut off — a cut-off arm
      // that appears nowhere reads exactly like an arm that was never enabled.
      const partial = await captureHandlers(makeEngine(async () => partialCancelledEnvelope())).search_web({ query: "x" });
      assert(partial?.isError !== true, "partial cancel: isError is not true");
      const pDoc = JSON.parse(String(partial?.content?.[0]?.text));
      assert(JSON.stringify(pDoc.providersQueried) === JSON.stringify(["exa", "anysearch"]), "partial cancel: content names who was asked");
      assert(JSON.stringify(pDoc.providersCancelled) === JSON.stringify(["anysearch"]), "partial cancel: content names the cut-off arm");
      assert(JSON.stringify(partial?.structuredContent?.providersQueried) === JSON.stringify(["exa", "anysearch"]),
        "partial cancel: structuredContent names who was asked");
      assert(JSON.stringify(partial?.structuredContent?.providersCancelled) === JSON.stringify(["anysearch"]),
        "partial cancel: structuredContent names the cut-off arm");
      assert(partial?.structuredContent?.outcome === "answer", "partial cancel: results still win, outcome=answer");
      assert(pDoc.outcome === "answer", "partial cancel: content agrees");
      // A grace-window cutoff is a normal degradation; results in hand mean the
      // call is not interrupted. Widening the flag to "any cancelled arm" fails here.
      assert(partial?.structuredContent?.interrupted === undefined, "partial cancel: results in hand, so not interrupted");

      // Whole pool cut off: providersCancelled === providersQueried is the
      // signal. It stays a success — a cancelled arm did not fail — and there
      // is no new error branch for it.
      const all = await captureHandlers(makeEngine(async () => allCancelledEnvelope())).search_web({ query: "x" });
      assert(all?.isError !== true, "all cancel: isError is not true");
      // Nothing came back. Whoever cut the arm — the caller or the engine's
      // deadline — the task wrapper must not read this as a clean finish.
      assert(all?.structuredContent?.interrupted === true, "all cancel: nothing came back, so the call is interrupted");
      const aDoc = JSON.parse(String(all?.content?.[0]?.text));
      assert(JSON.stringify(aDoc.providersQueried) === JSON.stringify(["anysearch"]), "all cancel: content names the asked arm");
      assert(JSON.stringify(aDoc.providersCancelled) === JSON.stringify(["anysearch"]), "all cancel: content names the cut-off arm");
      assert(!String(all?.content?.[0]?.text).includes("all providers failed"), "all cancel: not reported as an outage");
      // The distinguishing value: nothing answered and an arm was cut off.
      assert(all?.structuredContent?.outcome === "cancelled", "all cancel: structuredContent says outcome=cancelled");
      assert(aDoc.outcome === "cancelled", "all cancel: content says outcome=cancelled");
      assert(aDoc.abstain === null, "all cancel: no abstain marker");

      // A mixed pool is `cancelled` too: one arm fell over, another was cut,
      // and not every queried arm failed. The failure fields ride the success
      // and the two arm lists are unequal — equality is not the signal here.
      const mixed = await captureHandlers(makeEngine(async () => mixedFailedCancelledEnvelope())).search_web({ query: "x" });
      assert(mixed?.isError !== true, "mixed failed+cancel: isError is not true");
      assert(mixed?.structuredContent?.outcome === "cancelled", "mixed failed+cancel: structuredContent says outcome=cancelled");
      assert(mixed?.structuredContent?.interrupted === true, "mixed failed+cancel: nothing came back, so the call is interrupted");
      const mDoc = JSON.parse(String(mixed?.content?.[0]?.text));
      assert(mDoc.outcome === "cancelled", "mixed failed+cancel: content says outcome=cancelled");
      assert(JSON.stringify(mDoc.providersQueried) === JSON.stringify(["exa", "anysearch"]), "mixed failed+cancel: content names who was asked");
      assert(JSON.stringify(mDoc.providersCancelled) === JSON.stringify(["anysearch"]), "mixed failed+cancel: content names the cut-off arm");
      assert(JSON.stringify(mDoc.providersFailed) === JSON.stringify(["exa"]), "mixed failed+cancel: content names the failed arm");
      assert(JSON.stringify(mixed?.structuredContent?.providersFailed) === JSON.stringify(["exa"]), "mixed failed+cancel: structuredContent names the failed arm");
      assert(mixed?.structuredContent?.providerErrorClasses?.exa === "transient", "mixed failed+cancel: structuredContent carries the error class");
      assert(mDoc.abstain === null, "mixed failed+cancel: no abstain marker");
    }

    // ---- 8c. research_web reports the LAST round's arm state, never a union (#475) ----
    {
      let round = 0;
      const eng = makeEngine(async () => {
        round++;
        // Round 1 cut anysearch off; round 2 has no cancellation. A union would
        // keep calling an arm cancelled that has since answered.
        return round === 1 ? partialCancelledEnvelope() : partialEnvelope();
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "standard" });
      assert(round === 2, "research cancel: the fixture ran both rounds");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(JSON.stringify(doc.providersCancelled) === JSON.stringify([]), "research cancel: a later round clears the earlier cancellation");
      assert(JSON.stringify(res?.structuredContent?.providersCancelled) === JSON.stringify([]), "research cancel: structuredContent agrees");
      assert(JSON.stringify(doc.providersQueried) === JSON.stringify(["exa", "tavily"]), "research cancel: the last round's asked arms win");
    }

    // ---- 8d. research_web: a dead last round after a zero-hit arm answered is `empty` ----
    {
      let round = 0;
      const eng = makeEngine(async () => {
        round++;
        // Round 1: an arm answered and brought nothing back (`empty`). Round 2:
        // every arm died. The call brought nothing back but an arm did answer,
        // so it is a successful `empty` — a host that read `failed` here would
        // treat a successful call as an outage.
        return round === 1 ? emptyEnvelope(["exa", "tavily"]) : allFailedEnvelope(["exa", "tavily"]);
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "standard" });
      assert(res?.isError !== true, "research zero-hit then outage: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.outcome === "empty", "research zero-hit then outage: content says outcome=empty (got " + doc.outcome + ")");
      assert(res?.structuredContent?.outcome === "empty", "research zero-hit then outage: structuredContent agrees");
      assert(
        Array.isArray(doc.providersFailed) && doc.providersFailed.includes("exa"),
        "research zero-hit then outage: the dead arms are still named",
      );
    }

    // ---- 8e. research_web: a cut-off last round with merged results is `answer` ----
    {
      let round = 0;
      const eng = makeEngine(async () => {
        round++;
        // Round 1 answered with a result; round 2's only arm was cut off by the
        // engine deadline. The call still returned results, so it is not
        // `cancelled` — the docs table ties that word to "nothing came back".
        return round === 1 ? partialEnvelope() : allCancelledEnvelope();
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "standard" });
      assert(res?.isError !== true, "research result then cancel: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.outcome === "answer", "research result then cancel: content says outcome=answer (got " + doc.outcome + ")");
      assert(res?.structuredContent?.outcome === "answer", "research result then cancel: structuredContent agrees");
      assert(
        JSON.stringify(doc.providersCancelled) === JSON.stringify(["anysearch"]),
        "research result then cancel: the cut-off arm is still named (" + JSON.stringify(doc.providersCancelled) + ")",
      );
      // The last round came back `cancelled`, but merged results make the call
      // `answer`; the flag follows the call verdict, not the round.
      assert(
        res?.structuredContent?.interrupted === undefined,
        "research result then cancel: merged results in hand, so not interrupted",
      );
    }

    // ---- 8f. research_web: every arm cut by the engine deadline is interrupted ----
    {
      const res = await captureHandlers(makeEngine(async () => allCancelledEnvelope())).research_web({
        question: "x",
        depth: "brief",
      });
      assert(res?.isError !== true, "research all cancel: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      // Nothing came back. The round finished with every arm cut, so the call
      // must say it was interrupted rather than read as a clean zero-result run.
      assert(res?.structuredContent?.interrupted === true, "research all cancel: nothing came back, so the call is interrupted");
      assert(doc.outcome === "cancelled", "research all cancel: content says outcome=cancelled");
      assert(res?.structuredContent?.outcome === "cancelled", "research all cancel: structuredContent agrees");
      assert(
        JSON.stringify(doc.providersQueried) === JSON.stringify(["anysearch"]),
        "research all cancel: content names the asked arm",
      );
      assert(
        JSON.stringify(doc.providersCancelled) === JSON.stringify(["anysearch"]),
        "research all cancel: content names the cut-off arm",
      );
      assert(doc.abstain === null, "research all cancel: no abstain marker");
    }

    // ---- 8g. research_web: an abstain marker describes the last round only ----
    {
      let round = 0;
      const eng = makeEngine(async () => {
        round++;
        // Round 1 answered with a result; round 2's gate emptied the pool. The
        // merged result stays in the response, so a non-null marker must not be
        // read as "the whole call is empty".
        return round === 1 ? partialEnvelope() : abstainEnvelope();
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "standard" });
      assert(res?.isError !== true, "research result then abstain: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "research result then abstain: the merged result stays in the response");
      assert(doc.outcome === "answer", "research result then abstain: content says outcome=answer (got " + doc.outcome + ")");
      assert(res?.structuredContent?.outcome === "answer", "research result then abstain: structuredContent agrees");
      assert(res?.structuredContent?.abstain?.gate === "post", "research result then abstain: the marker describes the last round");
      assert(res?.structuredContent?.abstain?.preFiltered === 3, "research result then abstain: the gate count is readable");
      assert(doc.abstain?.abstain === true, "research result then abstain: content carries the same marker");
    }

    // ---- 8h. research_web: a markerless last round does not erase an earlier abstain ----
    {
      let round = 0;
      const eng = makeEngine(async () => {
        round++;
        // Round 1 abstained; round 2 answered with a result. The last round has
        // no marker, so the response has none either — a union or a
        // first-non-null implementation would keep the stale one.
        return round === 1 ? abstainEnvelope() : partialEnvelope();
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "standard" });
      assert(res?.isError !== true, "research abstain then result: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "research abstain then result: the merged result stays in the response");
      assert(doc.outcome === "answer", "research abstain then result: content says outcome=answer (got " + doc.outcome + ")");
      assert(res?.structuredContent?.outcome === "answer", "research abstain then result: structuredContent agrees");
      assert(res?.structuredContent?.abstain === undefined, "research abstain then result: the last round has no marker");
      assert(doc.abstain === null, "research abstain then result: an empty marker does not mean the result set is empty");
    }

    // ---- 8i. A caller abort with results in hand stays `answer` + `interrupted` ----
    {
      const caller = new AbortController();
      caller.abort("caller left");
      const search = await captureHandlers(makeEngine(async () => partialEnvelope())).search_web(
        { query: "x" },
        { mcpReq: { signal: caller.signal } },
      );
      assert(search?.isError !== true, "answer + caller abort: isError is not true");
      const sDoc = JSON.parse(String(search?.content?.[0]?.text));
      assert(sDoc.totalResults === 1, "answer + caller abort: the result is kept");
      assert(sDoc.outcome === "answer", "answer + caller abort: content says outcome=answer");
      assert(search?.structuredContent?.outcome === "answer", "answer + caller abort: structuredContent agrees");
      assert(search?.structuredContent?.interrupted === true, "answer + caller abort: the call says it was interrupted");

      // Round 1 lands a result; the round-2 request aborts the caller mid-search,
      // so round 2 is dropped and the call still holds round 1.
      const researchCaller = new AbortController();
      let researchRound = 0;
      const researchEng = makeEngine(async () => {
        researchRound++;
        if (researchRound === 2) researchCaller.abort("caller left");
        return partialEnvelope();
      });
      const research = await captureHandlers(researchEng).research_web(
        { question: "x", depth: "standard" },
        { mcpReq: { signal: researchCaller.signal } },
      );
      assert(research?.isError !== true, "research answer + caller abort: isError is not true");
      const rDoc = JSON.parse(String(research?.content?.[0]?.text));
      assert(rDoc.totalResults === 1, "research answer + caller abort: the first round's result is kept");
      assert(rDoc.outcome === "answer", "research answer + caller abort: content says outcome=answer");
      assert(research?.structuredContent?.outcome === "answer", "research answer + caller abort: structuredContent agrees");
      assert(research?.structuredContent?.interrupted === true, "research answer + caller abort: the call says it was interrupted");
    }

    // ---- 8j. research_web: a mixed failed+cancelled pool is not an outage ----
    {
      const res = await captureHandlers(makeEngine(async () => mixedFailedCancelledEnvelope())).research_web({
        question: "x",
        depth: "brief",
      });
      assert(res?.isError !== true, "research mixed failed+cancel: isError is not true");
      const text = String(res?.content?.[0]?.text);
      assert(!text.includes("all providers failed"), "research mixed failed+cancel: not reported as an outage");
      const doc = JSON.parse(text);
      assert(doc.outcome === "cancelled", "research mixed failed+cancel: content says outcome=cancelled");
      assert(res?.structuredContent?.outcome === "cancelled", "research mixed failed+cancel: structuredContent agrees");
      assert(res?.structuredContent?.interrupted === true, "research mixed failed+cancel: the call is interrupted");
      assert(
        JSON.stringify(doc.providersFailed) === JSON.stringify(["exa"]),
        "research mixed failed+cancel: the failed arm is named",
      );
      assert(
        JSON.stringify(doc.providersCancelled) === JSON.stringify(["anysearch"]),
        "research mixed failed+cancel: the cut-off arm is named",
      );
      assert(doc.abstain === null, "research mixed failed+cancel: no abstain marker");
    }

    // ---- 9. Abstain keeps its successful policy-result contract ----
    {
      const res = await captureHandlers(makeEngine(async () => abstainEnvelope())).search_web({ query: "x" });
      assert(res?.isError !== true, "abstain: isError is not true");
      assert(res?.structuredContent?.abstain?.abstain === true, "abstain: structured marker preserved");
      assert(res?.structuredContent?.outcome === "abstain", "abstain: structuredContent says outcome=abstain");
      assert(JSON.parse(String(res?.content?.[0]?.text)).outcome === "abstain", "abstain: content says outcome=abstain");
    }

    // ---- 10. query_knowledge none/note stay successful ----
    {
      const eng = makeEngine(async () => emptyEnvelope([]), {
        config: { rag: { adapter: "note" } } as any,
      });
      const res = await captureHandlers(eng).query_knowledge({ query: "x" });
      assert(res?.isError !== true, "query_knowledge adapter=note: isError is not true");
      assert(typeof res?.content?.[0]?.text === "string", "query_knowledge adapter=note: successful empty text result");
    }

    // ---- 11. Real stateless HTTP transport propagates isError ----
    {
      const eng = makeEngine(async () => {
        throw new Error("forced retriever failure");
      });
      const http = await httpStateless(() => buildServer(eng));
      try {
        const res = await http.post({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_web", arguments: { query: "x" } },
        });
        assert(res.status === 200, "http failure call: transport stays 200");
        assert(res.json?.result?.isError === true, "http failure call: isError propagates over the transport");
        assert(
          String(res.json?.result?.content?.[0]?.text).startsWith("search_web error:"),
          "http failure call: actionable text travels with the result",
        );
        assert(res.json?.result?.structuredContent === undefined, "http failure call: no structuredContent");

        // Protocol faults stay JSON-RPC errors — isError is execution-only.
        const unknown = await http.post({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "not_a_tool", arguments: {} },
        });
        assert(unknown.status === 200, "http unknown tool: transport stays 200");
        assert(unknown.json?.error !== undefined, "http unknown tool: stays a JSON-RPC error");
        assert(unknown.json?.result === undefined, "http unknown tool: not converted into a tool result");
      } finally {
        await http.close();
      }
    }

    // ---- 12. Attribution travels in BOTH channels on the success path ----
    // Replaces the ship-gate source-text count in the tool files: this drives
    // the registered handlers and reads the actual payloads.
    {
      const attribution: AttributionReport = {
        schema: "anysearch/attribution-report@1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        claims: [],
        gaps: [],
        supportedCount: 0,
        uncertainCount: 0,
        unsupportedCount: 0,
        judgeEnhanced: false,
      };
      const h = captureHandlers(
        makeEngine(async () => ({ ...partialEnvelope(), attribution }) as FusedEnvelope),
      );

      const sw = await h.search_web({ query: "x" });
      const swDoc = JSON.parse(String(sw?.content?.[0]?.text));
      assert(swDoc.attribution?.schema === attribution.schema, "search_web content JSON carries attribution");
      assert(
        sw?.structuredContent?.attribution?.schema === attribution.schema,
        "search_web structuredContent carries attribution",
      );

      const rw = await h.research_web({ question: "x", depth: "brief" });
      const rwDoc = JSON.parse(String(rw?.content?.[0]?.text));
      assert(Array.isArray(rwDoc.attribution?.claims), "research_web content JSON carries attribution");
      assert(Array.isArray(rw?.structuredContent?.attribution?.claims), "research_web structuredContent carries attribution");
    }

    // ---- 13. An error class travels with its remedy (#294) ----
    // "tavily=quota-exhausted" is a machine tag; the reader cannot tell what
    // the account owner has to do about it. The plain sentence rides beside it.
    {
      const res = await captureHandlers(makeEngine(async () => quotaAllFailedEnvelope())).search_web({ query: "x" });
      assert(res?.isError === true, "quota all-failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("tavily=quota-exhausted"), "quota all-failed: still names the class");
      assert(
        text.includes("tavily: " + QUOTA_SENTENCE),
        "quota all-failed: text carries that class's sentence in full",
      );
      assert(!text.includes("{"), "quota all-failed: text is not a JSON payload");
      assert(res?.structuredContent === undefined, "quota all-failed: no structuredContent");
    }

    // ---- 13b. The free quota's remedy carries the wait the arm reported (#455) ----
    // The sentence has one slot, so a reader must never see `{wait}`; a number
    // the upstream gave replaces it, and a missing one reads as "a moment".
    {
      const res = await captureHandlers(makeEngine(async () => freeQuotaAllFailedEnvelope(3600))).search_web({
        query: "x",
      });
      assert(res?.isError === true, "free quota all-failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("tavily=free-quota-exhausted"), "free quota all-failed: names the new class");
      assert(
        text.includes("tavily: " + FREE_QUOTA_SENTENCE.replace("{wait}", "3600 seconds")),
        "free quota all-failed: the sentence carries the retry-after as a number",
      );
      assert(!text.includes("{"), "free quota all-failed: no unfilled slot reaches the reader");
    }

    {
      const res = await captureHandlers(makeEngine(async () => freeQuotaAllFailedEnvelope())).search_web({
        query: "x",
      });
      const text = String(res?.content?.[0]?.text);
      assert(
        text.includes("tavily: " + FREE_QUOTA_SENTENCE.replace("{wait}", "a moment")),
        "free quota without a wait: the sentence says a moment",
      );
    }

    {
      const res = await captureHandlers(makeEngine(async () => freeQuotaPartialEnvelope(90))).search_web({
        query: "x",
      });
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.providerErrorClasses?.tavily === "free-quota-exhausted", "free quota partial: class tag in content JSON");
      assert(
        doc.providerErrorHints?.tavily === FREE_QUOTA_SENTENCE.replace("{wait}", "90 seconds"),
        "free quota partial: content JSON carries the filled sentence",
      );
      assert(
        res?.structuredContent?.providerErrorHints?.tavily === FREE_QUOTA_SENTENCE.replace("{wait}", "90 seconds"),
        "free quota partial: structuredContent carries the filled sentence",
      );
    }

    // Two failed arms keep their hints apart: each hint reads "id: sentence",
    // so the join separator must not look like part of the sentence. Comparing
    // the whole tail also pins the order and the closing period.
    {
      const res = await captureHandlers(makeEngine(async () => allFailedEnvelope(["tavily", "exa"]))).search_web({
        query: "x",
      });
      const text = String(res?.content?.[0]?.text);
      assert(
        text.endsWith(". tavily: " + TRANSIENT_SENTENCE + " | exa: " + AUTH_SENTENCE + "."),
        "two arms: text ends with one `id: sentence` per arm in providersFailed order",
      );
    }

    {
      const res = await captureHandlers(makeEngine(async () => quotaPartialEnvelope())).search_web({ query: "x" });
      assert(res?.isError !== true, "quota partial: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(
        doc.providerErrorHints?.tavily === QUOTA_SENTENCE,
        "quota partial: content JSON carries exactly that class's sentence",
      );
      assert(
        res?.structuredContent?.providerErrorHints?.tavily === QUOTA_SENTENCE,
        "quota partial: structuredContent carries exactly that class's sentence",
      );
      assert(doc.providerErrorClasses?.tavily === "quota-exhausted", "quota partial: class tag unchanged");
    }

    // `unknown` means nobody classified it, so nothing is invented for it.
    {
      const res = await captureHandlers(makeEngine(async () => unknownPartialEnvelope())).search_web({ query: "x" });
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.providerErrorClasses?.tavily === "unknown", "unknown class: tag preserved");
      assert(doc.providerErrorHints === undefined, "unknown class: no hint invented");
      assert(
        res?.structuredContent?.providerErrorHints === undefined,
        "unknown class: structuredContent carries no hint",
      );
    }

    // ---- 14. Hint sentences are pairwise distinct (#356) ----
    // Reading the expected text from the table cannot catch a wrong entry on
    // its own: if the table changes, the expectation moves with it. This
    // invariant never reads the wording. Every class that has a sentence must
    // own it alone, so copying one class's sentence onto another — the
    // realistic mistake, and the one the acceptance criteria name — collapses
    // two classes into one group and fails here. A mutual swap stays
    // undetected; catching that would mean hard-coding the sentences again.
    {
      const classesBySentence = new Map<string, ProviderErrorClass[]>();
      for (const [cls, sentence] of Object.entries(PROVIDER_ERROR_HINTS) as Array<
        [ProviderErrorClass, string | undefined]
      >) {
        if (!sentence) continue;
        classesBySentence.set(sentence, [...(classesBySentence.get(sentence) ?? []), cls]);
      }
      const shared = [...classesBySentence.values()].filter((classes) => classes.length > 1);
      const detail = shared.map((classes) => classes.join(" + ")).join("; ");
      assert(shared.length === 0, "hint sentences are pairwise distinct (shared by: " + detail + ")");
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    for (const root of failureRoots) rmSync(root, { recursive: true, force: true });
  }

  console.log("--- mcp failure-semantics tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
