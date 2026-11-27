// #608: the fetch tool's external behavior. Real temporary SQLite store, fake
// fetch providers, no network. Pins the four gates, the two stop streaks, the
// page budget, run-level reuse, budget accounting, and full-body storage.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { FetchEnvelope, FetchProvider, FetchRequest, FusedEnvelope } from "@anysearch-cli/retriever";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createFetchTool, type FetchStorePort } from "../src/fetch-tool";
import { createSearchTool } from "../src/pi-runtime";
import type { RetrieverPort } from "../src/ports";
import type { BudgetLedgerPort } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

class FakeProvider implements FetchProvider {
  readonly id: string;
  readonly maxUrlsPerCall: number;
  readonly calls: string[][] = [];
  constructor(
    private readonly handler: (urls: string[]) => FetchEnvelope | Promise<FetchEnvelope>,
    id = "exa",
    maxUrlsPerCall = 100,
  ) {
    this.id = id;
    this.maxUrlsPerCall = maxUrlsPerCall;
  }
  async fetch(req: FetchRequest): Promise<FetchEnvelope> {
    this.calls.push(req.urls);
    return this.handler(req.urls);
  }
}

function pageEnvelope(urls: string[], text = "body"): FetchEnvelope {
  return {
    provider: "exa",
    pages: urls.map((url) => ({ url, title: "T " + url, text })),
    failures: [],
  };
}

type ToolResult = AgentToolResult;

interface OuterEnvelope {
  snippet: string;
  disposal: "accepted" | "stripped" | "skipped";
}

interface EnvelopeBody {
  pages: Array<{ text: string; truncated: boolean; trust: string; finalUrlKnown: boolean }>;
  failures: Array<{ url: string; errorClass: string }>;
  skipped: Array<{ url: string; reason: string }>;
  rejected: Array<{ handle: string; reason: string }>;
  pagesRead: number;
  pagesRemaining: number;
  notice?: string;
}

function rawText(result: ToolResult): string {
  return result.content.map((part) => part.type === "text" ? part.text : "").join("");
}

function outerEnvelope(result: ToolResult): OuterEnvelope {
  return JSON.parse(rawText(result)) as OuterEnvelope;
}

function envelope(result: ToolResult): EnvelopeBody {
  // The tool's own output: the outer content-trust envelope carries the
  // result JSON in `snippet`, the same shape the search tool returns.
  return JSON.parse(outerEnvelope(result).snippet) as EnvelopeBody;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-fetch-tool-"));
  const store = new SqliteSessionStore(join(workDir, "test.db"));
  try {
    const session = await store.createSession("chat");
    // The real store implements every optional #608 seam; the cast only names
    // that fact for the tool's narrower port.
    const fetchStore = store as unknown as FetchStorePort;

    const makeTool = (provider: FetchProvider, allow: string[] = [], deny: string[] = [], ledger?: BudgetLedgerPort) =>
      createFetchTool({
        store: fetchStore,
        sessionId: session.id,
        providers: [provider],
        policy: () => ({ allow, deny }),
        ...(ledger ? { ledger, budgetId: session.id } : {}),
      });

    const tickets = async (kind: "search" | "user", values: string[]) =>
      store.saveFetchTickets(session.id, kind, values);

    // ---- 1. search handle + user ticket -> full body stored, copy truncated --
    {
      // The real search tool is what issues the m: handle and its ticket.
      const searchEnvelope: FusedEnvelope = {
        results: [{
          url: "https://example.com/search-hit",
          title: "Search hit",
          snippet: "snippet",
          source: "exa",
        }],
        answers: [],
        metadata: {
          providersQueried: ["exa"],
          providersFailed: [],
          providersCancelled: [],
          elapsedMs: 1,
          outcome: "answer",
        },
      };
      const retriever: RetrieverPort = { async search() { return searchEnvelope; } };
      const searchTool = createSearchTool(retriever, undefined, undefined, { store, sessionId: session.id }, true);
      const searchResult = await searchTool.execute("s1", { query: "a page" });
      const searchEnvelopeOut = JSON.parse(rawText(searchResult)) as { snippet: string };
      const searchBody = JSON.parse(searchEnvelopeOut.snippet) as {
        results: Array<{ handle: string; archiveRowId: number }>;
      };
      const rowId = searchBody.results[0]!.archiveRowId;
      const handle = searchBody.results[0]!.handle;
      assert(handle === "m:" + rowId, "a search result carries its m: handle");
      assert(store.hasFetchTicket(session.id, "search", String(rowId)), "the search result also wrote its ticket");

      await tickets("user", ["example.com/user-pasted"]);

      const full = "x".repeat(6000);
      const provider = new FakeProvider(() => pageEnvelope(
        ["https://example.com/search-hit", "https://example.com/user-pasted"], full,
      ));
      const tool = makeTool(provider);
      assert(tool.name === "fetch", "tool is named fetch");
      assert(tool.executionMode === "sequential", "fetch executes sequentially");

      const result = await tool.execute("t1", {
        handles: [handle, "https://example.com/user-pasted"],
        maxCharacters: 100,
      });
      const body = envelope(result);
      assert(provider.calls.length === 1, "two handles go upstream in one batch");
      assert(body.pages.length === 2, "both handles return a page");
      assert(body.pages.every((p) => p.text.length === 100 && p.truncated === true),
        "the model copy is truncated to maxCharacters");
      assert(body.pages.every((p) => p.trust === "untrusted_web" && p.finalUrlKnown === false),
        "pages are untrusted and the final URL is unknown");
      assert(body.pagesRead === 2 && body.pagesRemaining === 8, "two new pages count against the 10-page budget");

      const stored = store.dbQuery<{ content: string; fetched: number }>(
        "SELECT content, fetched FROM retrieval_results WHERE session_id = ? AND url = 'example.com/search-hit'",
        session.id,
      )[0]!;
      assert(stored.content.length === 6000, "the archive keeps the full body");
      assert(stored.fetched === 1, "a fetched page sets fetched = 1");

      // Same URL in this run: no second upstream request, same pages.
      const again = await tool.execute("t2", {
        handles: [handle, "https://example.com/user-pasted"],
        maxCharacters: 100,
      });
      const againBody = envelope(again);
      assert(provider.calls.length === 1, "a reused URL does not call upstream again");
      assert(againBody.pages.length === 2, "a reused URL still returns its page");
      assert(againBody.pagesRead === 2, "reuse does not count another page");

      const zero = envelope(await tool.execute("t3", { handles: [handle], maxCharacters: 0 }));
      assert(zero.pages[0]!.text.length === 4000,
        "maxCharacters 0 falls back to the default instead of one character");
      const half = envelope(await tool.execute("t3b", { handles: [handle], maxCharacters: 0.5 }));
      assert(half.pages[0]!.text.length === 4000,
        "a fractional maxCharacters below 1 falls back to the default");
    }

    // ---- 2. forged / cross-session / invented handles are rejected in-band ---
    {
      const other = await store.createSession("chat");
      const otherIds = await store.saveResultsWithIds(other.id, [
        { url: "https://example.com/other-session", title: "Other", snippet: "s", source: "exa" },
      ]);
      const otherRow = otherIds[0] as number;
      const provider = new FakeProvider(() => pageEnvelope(["https://example.com/should-not-run"]));

      // Each refused batch gets its own tool: two denied batches in a row are
      // the soft-stop case, tested separately below.
      const cross = await makeTool(provider).execute("t3", { handles: ["m:" + otherRow] });
      assert(rawText(cross).includes("不在本会话"), "a cross-session m: handle is rejected");
      const invented = await makeTool(provider).execute("t4", { handles: ["https://example.com/invented"] });
      assert(rawText(invented).includes("不在本会话的搜索结果或用户消息里"),
        "a model-written URL is rejected with the next-step copy");
      const malformed = await makeTool(provider).execute("t5", { handles: ["m:abc"] });
      assert(rawText(malformed).includes("既不是 m:<行号>"), "a malformed m: handle is rejected");
      assert(provider.calls.length === 0, "no rejected handle reaches a provider");
    }

    // ---- 2b. a shared page body keeps working through a search handle ------
    {
      const owner = await store.createSession("chat");
      const ownerPage = await store.savePage(owner.id, {
        url: "https://example.com/shared-body",
        content: "SHARED BODY",
      });
      const sharedEnvelope: FusedEnvelope = {
        results: [{
          url: "https://example.com/shared-body",
          title: "Shared",
          snippet: "snippet",
          source: "exa",
        }],
        answers: [],
        metadata: {
          providersQueried: ["exa"],
          providersFailed: [],
          providersCancelled: [],
          elapsedMs: 1,
          outcome: "answer",
        },
      };
      const searchTool = createSearchTool(
        { async search() { return sharedEnvelope; } },
        undefined,
        undefined,
        { store, sessionId: session.id },
        true,
      );
      const searchResult = await searchTool.execute("s2", { query: "shared" });
      const searchOut = JSON.parse(rawText(searchResult)) as { snippet: string };
      const searchBody = JSON.parse(searchOut.snippet) as {
        results: Array<{ handle: string; archiveRowId: number }>;
      };
      assert(searchBody.results[0]!.archiveRowId === ownerPage.id,
        "a search attaches to the shared page-body row");
      const provider = new FakeProvider((urls) => pageEnvelope(urls, "SHARED BODY"));
      const result = await makeTool(provider).execute("t5b", {
        handles: [searchBody.results[0]!.handle],
      });
      const body = envelope(result);
      assert(provider.calls.length === 1 && body.pages.length === 1,
        "a session's own search ticket can read a shared body row");
      assert(body.pages[0]!.text.includes("SHARED BODY"),
        "the shared body reaches the model");
    }

    // ---- 2c. archived rows cannot be resurrected through an old handle ----
    {
      const ids = await store.saveResultsWithIds(session.id, [
        { url: "https://example.com/archived", title: "Archived", snippet: "s", source: "exa" },
      ]);
      const rowId = ids[0] as number;
      await tickets("search", [String(rowId)]);
      store.dbQuery("UPDATE retrieval_results SET archived = 1 WHERE id = ? RETURNING id", rowId);
      const provider = new FakeProvider(() => pageEnvelope(["https://example.com/archived"]));
      const result = await makeTool(provider).execute("t5c", { handles: ["m:" + rowId] });
      assert(rawText(result).includes("重新搜一次"), "an archived row turns its old handle stale");
      assert(provider.calls.length === 0, "an archived row is not fetched");
    }

    // ---- 2d. a user-typed http URL keeps its scheme on the wire ------------
    {
      await tickets("user", ["example.com/http-only", "http:example.com/http-only"]);
      const provider = new FakeProvider((urls) => pageEnvelope(urls, "http body"));
      const result = await makeTool(provider).execute("t5d", {
        handles: ["http://example.com/http-only"],
      });
      assert(envelope(result).pages.length === 1, "an http-only user URL is readable");
      assert(provider.calls[0]?.[0] === "http://example.com/http-only",
        "the user's explicit http scheme is preserved");
    }

    // ---- 2e. an https ticket cannot be downgraded to http by the model ------
    {
      await tickets("user", ["example.com/https-only"]);
      const provider = new FakeProvider((urls) => pageEnvelope(urls, "https body"));
      const result = await makeTool(provider).execute("t5e", {
        handles: ["http://example.com/https-only"],
      });
      assert(envelope(result).pages.length === 1, "an https ticket is readable");
      assert(provider.calls[0]?.[0] === "https://example.com/https-only",
        "the model cannot rewrite an https ticket to http");
    }

    // ---- 2f. an empty body is retryable, not cached forever ---------------
    {
      await tickets("user", ["example.com/retry-empty"]);
      let calls = 0;
      const provider = new FakeProvider((urls) => {
        calls++;
        return calls === 1
          ? { provider: "exa", pages: [], failures: urls.map((url) => ({ url, errorClass: "unknown", message: "empty body", retryable: true })) }
          : pageEnvelope(urls, "second try");
      });
      const tool = makeTool(provider);
      const first = await tool.execute("t5f", { handles: ["https://example.com/retry-empty"] });
      assert(first.isError === true, "the first empty read is a failure");
      const second = await tool.execute("t5g", { handles: ["https://example.com/retry-empty"] });
      assert(envelope(second).pages.length === 1 && provider.calls.length === 2,
        "a retryable empty body is not cached");
    }

    // ---- 2g2. a sanitized title also marks the envelope stripped -----------
    {
      await tickets("user", ["example.com/title"]);
      const provider = new FakeProvider((urls) => ({
        provider: "exa",
        pages: urls.map((url) => ({ url, title: "Title\u200BHere", text: "body" })),
        failures: [],
      }));
      const result = await makeTool(provider).execute("t5i", { handles: ["https://example.com/title"] });
      assert(outerEnvelope(result).disposal === "stripped", "a sanitized title is reported as stripped");
      assert(!rawText(result).includes("\u200B"), "the model never sees the raw title");
    }

    // ---- 2g. invisible characters mark the envelope stripped --------------
    {
      await tickets("user", ["example.com/invisible"]);
      const provider = new FakeProvider((urls) => pageEnvelope(urls, "hello\u200Bworld"));
      const result = await makeTool(provider).execute("t5h", { handles: ["https://example.com/invisible"] });
      assert(outerEnvelope(result).disposal === "stripped",
        "a sanitized page body is reported as stripped");
    }

    // ---- 3. address / deny / allowlist / credential gates + partial success --
    {
      await tickets("user", [
        "blocked.example/page",
        "other.example/page",
        "allowed.example/secret?token=abc",
        "127.0.0.1/private",
        "allowed.example/ok",
        "allowed.example/page?token=sk-live-abcdefghijklmnop",
      ]);
      const provider = new FakeProvider((urls) => pageEnvelope(urls, "ok body"));
      const gatedTool = () => makeTool(provider, ["allowed.example"], ["blocked.example"]);

      const denied = await gatedTool().execute("t6", { handles: ["https://blocked.example/page"] });
      assert(rawText(denied).includes("禁止列表"), "deny wins and is reported");
      const outside = await gatedTool().execute("t7", { handles: ["https://other.example/page"] });
      assert(rawText(outside).includes("白名单"), "a host outside the allowlist is reported");
      const secret = await gatedTool().execute("t8", { handles: ["https://allowed.example/secret?token=abc"] });
      assert(rawText(secret).includes("疑似密钥"), "a credential-shaped URL never goes upstream");
      const local = await gatedTool().execute("t9", { handles: ["http://127.0.0.1/private"] });
      assert(rawText(local).includes("只接受公网"), "a private address is rejected");
      assert(provider.calls.length === 0, "no refused URL reaches a provider");

      const partial = await gatedTool().execute("t10", {
        handles: ["https://allowed.example/ok", "https://blocked.example/page"],
      });
      const body = envelope(partial);
      assert(body.pages.length === 1, "a mixed batch allows its good handle");
      assert(body.rejected.length === 1 && body.rejected[0].reason === "denied",
        "the bad handle is reported in the same result");
      assert(partial.isError !== true, "partial success is not a tool error");

      const withSecret = await gatedTool().execute("t10b", {
        handles: ["https://allowed.example/ok", "https://allowed.example/page?token=sk-live-abcdefghijklmnop"],
      });
      assert(rawText(withSecret).includes("疑似密钥"), "a credential URL is refused in a mixed batch");
      assert(!rawText(withSecret).includes("sk-live-abcdefghijklmnop"),
        "a refused credential URL is redacted in the tool result");
    }

    // ---- 4. page budget: 10 pages per question ------------------------------
    {
      const urls = Array.from({ length: 11 }, (_, i) => "allowed.example/p" + i);
      await tickets("user", urls);
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "page body"));
      const tool = makeTool(provider, ["allowed.example"]);

      await tool.execute("t11", { handles: urls.slice(0, 5).map((url) => "https://" + url) });
      const second = await tool.execute("t12", { handles: urls.slice(5, 10).map((url) => "https://" + url) });
      assert(envelope(second).pagesRead === 10, "ten pages fill the budget");
      const third = await tool.execute("t13", { handles: ["https://" + urls[10]!] });
      const thirdBody = envelope(third);
      assert(thirdBody.pages.length === 0, "the eleventh page is not fetched");
      assert(thirdBody.skipped.length === 1 && thirdBody.skipped[0].reason === "page_budget",
        "the over-budget URL is reported as skipped");
      assert(provider.calls.length === 2, "only the in-budget batches call upstream");
      const stillQuota = await tool.execute("t13b", { handles: ["https://" + urls[10]!] });
      assert(rawText(stillQuota).includes("读页到上限"),
        "a page-budget block does not advance the empty streak");
      const quotaAgain = await tool.execute("t13c", { handles: ["https://" + urls[10]!] });
      assert(rawText(quotaAgain).includes("读页到上限"),
        "a second page-budget block is still quota, not a soft stop");
    }

    // ---- 5. two empty batches soft-stop fetch ------------------------------
    {
      const urls = ["allowed.example/e1", "allowed.example/e2", "allowed.example/e3"];
      await tickets("user", urls);
      const provider = new FakeProvider((batch) => ({
        provider: "exa",
        pages: [],
        failures: batch.map((url) => ({ url, errorClass: "permanent-protocol", message: "no body" })),
      }));
      const tool = makeTool(provider, ["allowed.example"]);
      const first = await tool.execute("t14", { handles: ["https://allowed.example/e1"] });
      const firstBody = envelope(first);
      assert(firstBody.failures.length === 1 && first.isError === true, "a failed page is a tool error");
      await tool.execute("t15", { handles: ["https://allowed.example/e2"] });
      const stopped = await tool.execute("t16", { handles: ["https://allowed.example/e3"] });
      assert(rawText(stopped).includes("连续两次没拿到新内容"), "the third call is soft-stopped");
      assert(provider.calls.length === 2, "a soft-stopped call does not reach upstream");
    }

    // ---- 6. two fully rejected batches soft-stop fetch ---------------------
    {
      await tickets("user", ["blocked.example/1", "blocked.example/2", "blocked.example/3"]);
      const provider = new FakeProvider(() => pageEnvelope(["https://blocked.example/1"]));
      const tool = makeTool(provider, [], ["blocked.example"]);
      await tool.execute("t17", { handles: ["https://blocked.example/1"] });
      const second = await tool.execute("t18", { handles: ["https://blocked.example/2"] });
      assert(rawText(second).includes("禁止列表"), "the stopped batch still names why each URL was refused");
      assert(rawText(second).includes("连续两次整批网址都没被放行"), "the second fully rejected batch stops reads");
      const third = await tool.execute("t19", { handles: ["https://blocked.example/3"] });
      assert(rawText(third).includes("连续两次整批网址都没被放行"), "later calls stay stopped");
      assert(provider.calls.length === 0, "no rejected batch reaches upstream");
    }

    // ---- 6b. no fetch source is a wiring state, not an empty read ----------
    {
      await tickets("user", ["allowed.example/n1", "allowed.example/n2", "allowed.example/n3"]);
      const tool = createFetchTool({
        store: fetchStore,
        sessionId: session.id,
        providers: [],
        policy: () => ({ allow: ["allowed.example"], deny: [] }),
      });
      const first = await tool.execute("t19b", { handles: ["https://allowed.example/n1"] });
      await tool.execute("t19c", { handles: ["https://allowed.example/n2"] });
      const third = await tool.execute("t19d", { handles: ["https://allowed.example/n3"] });
      assert(rawText(first).includes("没有可用的抓取信息源"), "an empty source list says so");
      assert(rawText(third).includes("没有可用的抓取信息源"),
        "a missing fetch source does not advance the empty streak");
    }

    // ---- 7. budget: reserve before the request, settle after ----------------
    {
      await tickets("user", ["allowed.example/b1", "allowed.example/b2"]);
      const settlements: Array<[number, number]> = [];
      const ledger: BudgetLedgerPort & { reserve: boolean } = {
        reserve: false,
        reserveCalls: () => ledger.reserve,
        settleCalls: (_id: string, reserved: number, actual: number) => { settlements.push([reserved, actual]); },
        reserveTokens: () => true, settleTokens: () => {},
        reserveUsd: () => true, settleUsd: () => {},
      };
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "budget body"));
      const tool = makeTool(provider, ["allowed.example"], [], ledger);

      const rejected = await tool.execute("t20", { handles: ["https://allowed.example/b1"] });
      assert(rawText(rejected).includes("抓页额度用完了"), "a rejected call reserve is an in-band Chinese message");
      assert(provider.calls.length === 0, "a rejected budget never sends a request");

      ledger.reserve = true;
      await tool.execute("t21", { handles: ["https://allowed.example/b2"] });
      assert(provider.calls.length === 1, "a granted reserve sends the request");
      assert(settlements.length === 1 && settlements[0]![0] === 1 && settlements[0]![1] === 1,
        "one upstream request reserves and settles one call");
    }

    // ---- 7b. a later chunk's budget stop keeps the pages already read -------
    {
      await tickets("user", ["allowed.example/c1", "allowed.example/c2"]);
      let reserveCount = 0;
      const ledger: BudgetLedgerPort = {
        reserveCalls: () => reserveCount++ === 0,
        settleCalls: () => {},
        reserveTokens: () => true, settleTokens: () => {},
        reserveUsd: () => true, settleUsd: () => {},
      };
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "first chunk body"), "exa", 1);
      const tool = makeTool(provider, ["allowed.example"], [], ledger);
      const result = await tool.execute("t24", {
        handles: ["https://allowed.example/c1", "https://allowed.example/c2"],
      });
      const body = envelope(result);
      assert(provider.calls.length === 1, "the first chunk is read before the budget runs out");
      assert(body.pages.length === 1, "a budget stop later in the call keeps the page already read");
      assert(body.skipped.length === 1 && body.skipped[0]!.reason === "call_budget",
        "the unread URL is reported as skipped for the call budget");
      assert(body.notice?.includes("抓页额度用完了") === true, "the result still says the call budget ran out");
      assert(!result.isError, "a partial budget stop is not a whole-call error");
    }

    // ---- 7c. a broken ledger fails open, not as an exhausted budget ---------
    {
      await tickets("user", ["allowed.example/l1"]);
      const ledger: BudgetLedgerPort = {
        reserveCalls: () => { throw new Error("ledger unavailable"); },
        settleCalls: () => {},
        reserveTokens: () => true, settleTokens: () => {},
        reserveUsd: () => true, settleUsd: () => {},
      };
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "ledger body"));
      const tool = makeTool(provider, ["allowed.example"], [], ledger);
      const result = await tool.execute("t24b", { handles: ["https://allowed.example/l1"] });
      assert(envelope(result).pages.length === 1, "a ledger fault still runs the read");
      assert(!rawText(result).includes("抓页额度用完了"), "a ledger fault is not reported as an exhausted budget");
    }

    // ---- 7d. a thrown provider moves the whole batch to the next arm --------
    {
      await tickets("user", ["allowed.example/f1", "allowed.example/f2"]);
      const broken = new FakeProvider(() => { throw new Error("arm down"); }, "broken", 1);
      const good = new FakeProvider((batch) => pageEnvelope(batch, "second arm"), "good", 1);
      const tool = createFetchTool({
        store: fetchStore,
        sessionId: session.id,
        providers: [broken, good],
        policy: () => ({ allow: ["allowed.example"], deny: [] }),
      });
      const result = await tool.execute("t24c", {
        handles: ["https://allowed.example/f1", "https://allowed.example/f2"],
      });
      assert(broken.calls.length === 1, "a thrown arm is not retried for its next chunk");
      assert(good.calls.length === 2 && envelope(result).pages.length === 2,
        "the next arm reads both URLs");
    }

    // ---- 7d2. a zero maxUrlsPerCall does not loop forever -------------------
    {
      await tickets("user", ["allowed.example/z1", "allowed.example/z2"]);
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "zero cap"), "exa", 0);
      const tool = makeTool(provider, ["allowed.example"]);
      const result = await tool.execute("t24c2", {
        handles: ["https://allowed.example/z1", "https://allowed.example/z2"],
      });
      assert(provider.calls.length === 2 && envelope(result).pages.length === 2,
        "a zero provider cap is treated as one URL per call");
    }

    // ---- 7e. a cache-only batch does not trip the empty streak --------------
    {
      await tickets("user", ["allowed.example/cached"]);
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "cached body"));
      const tool = makeTool(provider, ["allowed.example"]);
      await tool.execute("t24d", { handles: ["https://allowed.example/cached"] });
      const again = await tool.execute("t24e", { handles: ["https://allowed.example/cached"] });
      const third = await tool.execute("t24f", { handles: ["https://allowed.example/cached"] });
      assert(envelope(again).pages.length === 1 && envelope(third).pages.length === 1,
        "a cached page is returned on every call");
      assert(!rawText(third).includes("连续两次没拿到新内容"),
        "cache-only reads do not advance the empty streak");
    }

    // ---- 7f. cache + a rejected URL still advances the empty streak --------
    {
      await tickets("user", ["allowed.example/cache-plus"]);
      const provider = new FakeProvider((batch) => pageEnvelope(batch, "cached"));
      const tool = makeTool(provider, ["allowed.example"]);
      await tool.execute("t24g", { handles: ["https://allowed.example/cache-plus"] });
      await tool.execute("t24h", {
        handles: ["https://allowed.example/cache-plus", "https://allowed.example/invented"],
      });
      await tool.execute("t24i", {
        handles: ["https://allowed.example/cache-plus", "https://allowed.example/invented"],
      });
      const stopped = await tool.execute("t24j", { handles: ["https://allowed.example/cache-plus"] });
      assert(rawText(stopped).includes("连续两次没拿到新内容"),
        "cache plus a rejected URL still trips the empty-batch stop");
    }

    // ---- 7g. upstream down does not count as an empty batch ---------------
    {
      await tickets("user", ["allowed.example/down"]);
      const provider = new FakeProvider(() => { throw new Error("provider down"); }, "down", 5);
      const tool = makeTool(provider, ["allowed.example"]);
      await tool.execute("t24k", { handles: ["https://allowed.example/down"] });
      await tool.execute("t24l", { handles: ["https://allowed.example/down"] });
      const third = await tool.execute("t24m", { handles: ["https://allowed.example/down"] });
      const text = rawText(third);
      assert(text.includes("没有回包"), "an upstream outage names the provider, not empty content");
      assert(!text.includes("连续两次没拿到新内容"),
        "an upstream outage does not trip the empty-batch stop");
    }

    // ---- 8. parameter errors are ordinary tool errors ----------------------
    {
      const provider = new FakeProvider(() => pageEnvelope([]));
      const tool = makeTool(provider);
      const empty = await tool.execute("t22", { handles: [] });
      assert(rawText(empty).includes("1–5 个"), "an empty handle list is rejected");
      const tooMany = await tool.execute("t23", {
        handles: Array.from({ length: 6 }, (_, i) => "allowed.example/x" + i),
      });
      assert(rawText(tooMany).includes("1–5 个"), "more than five handles is rejected");
      assert(provider.calls.length === 0, "invalid parameters never reach upstream");
    }

    store.close();
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }

  console.log("fetch-tool.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
