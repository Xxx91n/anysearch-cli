// #610: Tavily's page-read arm. A fake client drives the public fetch() seam,
// so these cases pin the request shape, the page/failure split, and the
// retryable flag without any network.

import { FETCH_PAGE_MAX_CHARS } from "../src/fetch-contract";
import {
  TavilyFetchProvider,
  createTavilyFetchProvider,
  type TavilyExtractClient,
} from "../src/providers/tavily-fetch";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

interface ExtractCall {
  urls: string[];
  options: { extractDepth: "basic"; format: "markdown"; timeout: number };
}

function clientOf(
  calls: ExtractCall[],
  reply: (urls: string[]) => unknown,
): TavilyExtractClient {
  return {
    async extract(urls, options) {
      calls.push({ urls: [...urls], options });
      return reply(urls) as Awaited<ReturnType<TavilyExtractClient["extract"]>>;
    },
  };
}

const SIG = new AbortController().signal;

async function main() {
  // ---- happy path: one call, one page, two failures split by retryability --
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, (urls) => ({
      results: [{ url: urls[0], title: "A", rawContent: "body a" }],
      failedResults: [
        { url: urls[1], error: "Failed to fetch url" },
        { url: urls[2], error: "404 Not Found" },
      ],
      responseTime: 12,
    })));
    const envelope = await provider.fetch(
      { urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"], maxCharacters: 100_000 },
      SIG,
    );
    assert(calls.length === 1, "one extract request for the batch");
    assert(calls[0]!.options.extractDepth === "basic" && calls[0]!.options.format === "markdown",
      "asks for basic markdown extraction");
    assert(calls[0]!.options.timeout === 15, "the arm's own deadline stays inside the tool's 20s one");
    assert(envelope.provider === "tavily", "provider id stays tavily");
    assert(provider.maxUrlsPerCall === 5, "we send five at a time, not the upstream's twenty");
    assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "body a", "a body becomes a page");
    assert(envelope.pages[0]!.title === "A", "a title rides the page");
    assert(envelope.failures.length === 2, "both unread URLs become failures");
    const [retryableFailure, finalFailure] = envelope.failures;
    assert(retryableFailure!.retryable === true, "an unrecognised fetch fault is retryable");
    assert(finalFailure!.retryable === false, "a 404 page is final");
    assert(finalFailure!.message?.includes("404") === true, "the upstream reason survives");
  }

  // ---- a bare "not found" is not a gone page (#610) ---------------------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [],
      failedResults: [
        { url: "https://example.com/a", error: "content not found" },
        { url: "https://example.com/report?id=404", error: "failed to fetch url" },
      ],
    })));
    const envelope = await provider.fetch(
      { urls: ["https://example.com/a", "https://example.com/report?id=404"], maxCharacters: 4000 },
      SIG,
    );
    assert(envelope.failures.every((failure) => failure.retryable === true),
      "an extract fault and a 404 inside a query string both stay retryable");
  }

  // ---- an empty body is a retryable page failure, not a silent page --------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, (urls) => ({
      results: [{ url: urls[0], title: "A", rawContent: "   " }],
      failedResults: [],
      responseTime: 3,
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/empty"], maxCharacters: 4000 }, SIG);
    assert(envelope.pages.length === 0 && envelope.failures.length === 1, "an empty body is a failure");
    assert(envelope.failures[0]!.retryable === true, "an empty body may be read by another arm");
    assert(envelope.failures[0]!.errorClass === "unknown", "an empty body is not a protocol fault");
    assert(envelope.failures[0]!.message === "该网址没有返回正文", "the empty body gets the plain message");
  }

  // ---- the reply is clipped to the requested window, never past the hard cap --
  {
    const calls: ExtractCall[] = [];
    const body = "x".repeat(120_000);
    const provider = new TavilyFetchProvider(clientOf(calls, (urls) => ({
      results: [{ url: urls[0], rawContent: body }],
      failedResults: [],
      responseTime: 5,
    })));
    const small = await provider.fetch({ urls: ["https://example.com/long"], maxCharacters: 3000 }, SIG);
    assert(small.pages[0]!.text.length === 3000, "the page is clipped to maxCharacters");
    const capped = await provider.fetch({ urls: ["https://example.com/long"], maxCharacters: 500_000 }, SIG);
    assert(capped.pages[0]!.text.length === FETCH_PAGE_MAX_CHARS, "the hard cap still applies");
  }

  // ---- an upstream identity (www / scheme) maps back to the requested URL ---
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [{ url: "https://www.example.com/a", title: "A", rawContent: "body" }],
      failedResults: [],
      responseTime: 2,
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, SIG);
    assert(envelope.pages.length === 1, "a same-identity echo still fills the requested URL");
    assert(envelope.pages[0]!.url === "https://example.com/a", "the requested spelling is what the page reports");
  }

  // ---- a trailing slash upstream still matches the requested URL ----------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [{ url: "https://example.com/a/", title: "A", rawContent: "body" }],
      failedResults: [],
      responseTime: 2,
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, SIG);
    assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "body",
      "an upstream echo that adds a trailing slash is the same page, not a miss");
    assert(envelope.failures.length === 0, "and no empty-body failure is invented for it");
  }

  // ---- a reply without failedResults is not a malformed reply -------------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [{ url: "https://example.com/a", title: "A", rawContent: "body" }],
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, SIG);
    assert(envelope.pages.length === 1 && envelope.failures.length === 0,
      "an all-success reply without failedResults still yields the page");
  }

  // ---- a trailing slash inside the query string is part of the address ------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, (urls) => ({
      results: urls.map((url) => ({ url, rawContent: "body for " + url })),
      failedResults: [],
      responseTime: 4,
    })));
    const envelope = await provider.fetch(
      { urls: ["https://example.com/s?path=docs/", "https://example.com/s?path=docs"], maxCharacters: 4000 },
      SIG,
    );
    assert(envelope.pages.length === 2, "two addresses that differ only in the query stay two pages");
    const texts = envelope.pages.map((page) => page.text).sort();
    assert(texts[0] !== texts[1], "and they do not collapse onto one body");
  }

  // ---- a per-URL 403 retires the arm, not just the page -------------------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [],
      failedResults: [{ url: "https://example.com/x", error: "403 Forbidden" }],
      responseTime: 6,
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/x"], maxCharacters: 4000 }, SIG);
    assert(envelope.failures[0]!.errorClass === "permanent-auth",
      "a 403 in failedResults is the arm's class, so the tool retires it");
    assert(envelope.failures[0]!.retryable === true, "and the page is still worth another arm");
  }

  // ---- a reply with neither results nor failed reasons is a bad shape -----
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({ failedResults: [] })));
    let threw = false;
    try {
      await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, SIG);
    } catch (error) {
      threw = true;
      const message = error instanceof Error ? error.message : String(error);
      assert(message.includes("malformed"), "a bad shape is labelled malformed");
    }
    assert(threw, "a bad shape throws, so the whole arm is down");
  }

  // ---- an all-failed reply that carries only failedResults is readable ----
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, (urls) => ({
      failedResults: [{ url: urls[0], error: "404 Not Found" }],
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/gone"], maxCharacters: 4000 }, SIG);
    assert(envelope.pages.length === 0, "no results means no pages");
    assert(envelope.failures.length === 1 && envelope.failures[0]!.retryable === false,
      "a reply with only failedResults is not thrown away, and a 404 stays final");
  }

  // ---- a failed result with a trailing slash still carries its reason ------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [],
      failedResults: [{ url: "https://example.com/gone/", error: "404 Not Found" }],
      responseTime: 3,
    })));
    const envelope = await provider.fetch({ urls: ["https://example.com/gone"], maxCharacters: 4000 }, SIG);
    assert(envelope.failures.length === 1 && envelope.failures[0]!.retryable === false,
      "a 404 that comes back with a trailing slash is still final, not \"no body\"");
    assert(envelope.failures[0]!.message?.includes("404") === true, "and its reason survives");
  }

  // ---- the tool's deadline does not throw away what was already fetched ----
  {
    const calls: ExtractCall[] = [];
    const control = new AbortController();
    const provider = new TavilyFetchProvider({
      async extract(urls, options) {
        calls.push({ urls: [...urls], options });
        // 工具那道墙刚好在结果回来的这一瞬间响。
        control.abort(new DOMException("timed out", "TimeoutError"));
        return { results: [{ url: urls[0], title: "A", rawContent: "body a" }], failedResults: [] } as never;
      },
    });
    const envelope = await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, control.signal);
    assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "body a",
      "a deadline that fires after the batch arrived keeps the paid-for page");
  }

  // ---- a caller-side cancellation still surfaces ---------------------------
  {
    const calls: ExtractCall[] = [];
    const control = new AbortController();
    const provider = new TavilyFetchProvider({
      async extract(urls, options) {
        calls.push({ urls: [...urls], options });
        control.abort();
        return { results: [], failedResults: [] } as never;
      },
    });
    let threw = false;
    try {
      await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, control.signal);
    } catch {
      threw = true;
    }
    assert(threw, "a caller-side cancel is not swallowed");
  }

  // ---- a thrown client (quota / auth) surfaces to the tool -----------------
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => {
      throw new Error("TavilyKeylessLimitError: daily_cap_reached");
    }));
    let message = "";
    try {
      await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, SIG);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(message.includes("daily_cap_reached"), "a keyless cap surfaces to the tool, which classifies it");
  }

  // ---- SDK timeout turns into retryable page failures, not a dead arm -----
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => {
      throw new Error("Request timed out after 15000ms");
    }));
    const envelope = await provider.fetch(
      { urls: ["https://example.com/slow1", "https://example.com/slow2"], maxCharacters: 4000 },
      SIG,
    );
    assert(envelope.pages.length === 0 && envelope.failures.length === 2,
      "an SDK timeout yields a page failure for every URL in the batch");
    assert(envelope.failures.every((f) => f.errorClass === "transient" && f.retryable === true && f.armFault !== true && f.timedOut === true),
      "an SDK timeout stays a retryable transient page fault marked timedOut without retiring the arm");
  }

  // ---- ETIMEDOUT / bare ECONNABORTED / HTTP 504 still throw so bad arms retire --
  for (const err of [
    new Error("connect ETIMEDOUT 1.2.3.4:443"),
    new Error("socket hang up ECONNABORTED"),
    Object.assign(new Error("504 Gateway Timeout"), { status: 504 }),
  ]) {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => {
      throw err;
    }));
    let threw = false;
    try {
      await provider.fetch({ urls: ["https://example.com/unreachable"], maxCharacters: 4000 }, SIG);
    } catch {
      threw = true;
    }
    assert(threw, "non-local error surfaces to retire the arm (" + err.message + ")");
  }

  // ---- FETCH_FINAL_PAGE_FAULT covers 410, status [code] 404, DNS and bad schemes -
  {
    const calls: ExtractCall[] = [];
    const provider = new TavilyFetchProvider(clientOf(calls, () => ({
      results: [],
      failedResults: [
        { url: "https://example.com/g1", error: "410 Gone" },
        { url: "https://example.com/g2", error: "upstream returned status 404" },
        { url: "https://example.com/g2b", error: "upstream said status code 404" },
        { url: "https://example.com/g2c", error: "status-code 404" },
        { url: "https://example.com/g2d", error: "status_code: 410" },
        { url: "https://example.com/g3", error: "dial tcp: no such host" },
        { url: "https://example.com/g4", error: "getaddrinfo ENOTFOUND nope.invalid" },
        { url: "https://example.com/g5", error: "unsupported scheme ftp" },
        { url: "https://example.com/g6", error: "invalid url" },
        { url: "https://example.com/r1", error: "content not found" },
        { url: "https://example.com/404-guide", error: "failed to extract /404-guide" },
      ],
    })));
    const envelope = await provider.fetch(
      {
        urls: [
          "https://example.com/g1",
          "https://example.com/g2",
          "https://example.com/g2b",
          "https://example.com/g2c",
          "https://example.com/g2d",
          "https://example.com/g3",
          "https://example.com/g4",
          "https://example.com/g5",
          "https://example.com/g6",
          "https://example.com/r1",
          "https://example.com/404-guide",
        ],
        maxCharacters: 4000,
      },
      SIG,
    );
    const byUrl = new Map(envelope.failures.map((f) => [f.url, f]));
    for (const u of [
      "https://example.com/g1",
      "https://example.com/g2",
      "https://example.com/g2b",
      "https://example.com/g2c",
      "https://example.com/g2d",
      "https://example.com/g3",
      "https://example.com/g4",
      "https://example.com/g5",
      "https://example.com/g6",
    ]) {
      assert(byUrl.get(u)?.retryable === false, "final page fault is not retryable (" + u + ")");
    }
    assert(byUrl.get("https://example.com/r1")?.retryable === true, "content not found stays retryable");
    assert(byUrl.get("https://example.com/404-guide")?.retryable === true, "404 in path stays retryable");
  }

  // ---- factory: a blank key still builds the keyless arm ------------------
  {
    const free = createTavilyFetchProvider("");
    const keyed = createTavilyFetchProvider(" tvly-test ");
    assert(free.id === "tavily" && keyed.id === "tavily", "both factories build the tavily arm");
    assert(free.maxUrlsPerCall === 5 && keyed.maxUrlsPerCall === 5, "both keep the five-URL batch");
  }

  console.log("fetch-tavily.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

await main();
