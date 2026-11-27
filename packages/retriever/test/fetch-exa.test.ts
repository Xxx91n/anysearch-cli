// #608: Exa's page-read arm. Paid `/contents` is driven through a fake client;
// the free `web_fetch_exa` transport through a stubbed global fetch.
// Only external behavior is pinned: the request shape, the reply parsing, and
// the page/failure split.

import {
  ExaFetchProvider,
  createExaFetchProvider,
  parseExaFetchReply,
  type ExaContentsClient,
} from "../src/providers/exa-fetch";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

interface RpcBody { id?: number | string; params?: { name?: unknown; arguments?: { maxCharacters?: unknown } } }
interface FetchCall { url: string; body: RpcBody; signal?: AbortSignal | null }
interface PaidCall {
  urls: string[];
  options: { text?: { maxCharacters?: number }; filterEmptyResults?: boolean };
  requestOptions?: { signal?: AbortSignal };
}

function installFetch(reply: string) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(init.body) as RpcBody : {},
      signal: init?.signal,
    });
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: (init?.body ? JSON.parse(init.body) as RpcBody : {}).id,
      result: { content: [{ type: "text", text: reply }] },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

async function main() {
  // ---- free-arm reply parsing: two documents + one error line -------------
  const reply = [
    "# First page",
    "URL: https://example.com/a",
    "",
    "body a line 1",
    "body a line 2",
    "# Second page",
    "URL: https://example.com/b",
    "",
    "body b",
    "Error fetching https://example.com/c: CRAWL_UNKNOWN_ERROR",
  ].join("\n");
  {
    const reading = parseExaFetchReply(reply, [
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    assert(reading.pages.length === 2, "parse: two documents become two pages");
    assert(reading.pages[0]!.title === "First page" && reading.pages[0]!.text === "body a line 1\nbody a line 2",
      "parse: first title and body are kept");
    assert(reading.pages[1]!.url === "https://example.com/b" && reading.pages[1]!.text === "body b",
      "parse: second document is delimited by its own header");
    assert(reading.failures.length === 1 && reading.failures[0]!.url === "https://example.com/c",
      "parse: an Error fetching line becomes a failure");
    assert(reading.failures[0]!.errorClass === "unknown", "parse: an unclassified crawl error stays unknown");
    assert(reading.failures[0]!.retryable === true, "parse: an unknown crawl error can be retried on another arm");
    assert(reading.failures[0]!.message === "CRAWL_UNKNOWN_ERROR", "parse: the upstream error text is kept");
  }

  // ---- body text that looks like a header or an error is preserved --------
  {
    const tricky = [
      "# Page",
      "URL: https://example.com/page",
      "",
      "URL: https://example.com/inside",
      "Error fetching https://example.com/inside: not an upstream error",
      "# Next",
      "URL: https://example.com/next",
      "",
      "next body",
    ].join("\n");
    const reading = parseExaFetchReply(tricky, ["https://example.com/page", "https://example.com/next"]);
    assert(reading.pages.length === 2, "parse: only a heading plus URL starts a document");
    assert(reading.pages[0]!.text.includes("URL: https://example.com/inside") &&
      reading.pages[0]!.text.includes("Error fetching https://example.com/inside: not an upstream error"),
      "parse: body URL and error-looking lines are not deleted");
  }

  // ---- a heading-shaped line inside a body does not split the page --------
  {
    const text = [
      "# Page",
      "URL: https://example.com/page",
      "",
      "intro",
      "# Install",
      "URL: https://example.com/install",
      "install body",
    ].join("\n");
    const reading = parseExaFetchReply(text, ["https://example.com/page"]);
    assert(reading.pages.length === 1, "parse: a body heading is not a second document");
    assert(reading.pages[0]!.text.includes("# Install") && reading.pages[0]!.text.includes("install body"),
      "parse: the body keeps its heading-shaped tail");
  }

  // ---- a lone error line for another URL is not page text ----------------
  {
    const reading = parseExaFetchReply("Error fetching https://example.com/redirected: CRAWL_TIMEOUT",
      ["https://example.com/requested"]);
    assert(reading.pages.length === 0, "parse: a non-matching error line is not stored as a page");
    assert(reading.failures.length === 1, "parse: the requested URL is still a failure");
  }

  // ---- a requested URL inside another page's body does not split it ------
  {
    const text = [
      "# A",
      "URL: https://example.com/a",
      "",
      "a intro",
      "# Install",
      "URL: https://example.com/b",
      "install notes",
      "",
      "# B",
      "URL: https://example.com/b",
      "",
      "b body",
    ].join("\n");
    const reading = parseExaFetchReply(text, ["https://example.com/a", "https://example.com/b"]);
    assert(reading.pages.length === 2, "parse: both requested pages exist");
    assert(reading.pages[0]!.text.includes("install notes"),
      "parse: a requested URL in another body does not cut that body");
    assert(reading.pages[1]!.text === "b body", "parse: the real B document wins");
  }

  // ---- a redirected document does not bleed into its neighbour ----------
  {
    const text = [
      "# A",
      "URL: https://example.com/a",
      "",
      "a body",
      "",
      "# B",
      "URL: https://example.com/b",
      "",
      "b body",
      "",
      "# C",
      "URL: https://example.com/c",
      "",
      "c body",
    ].join("\n");
    const reading = parseExaFetchReply(text, ["https://example.com/a", "https://example.com/c"]);
    assert(reading.pages.length === 2, "parse: requested pages only");
    assert(reading.pages[0]!.text === "a body" && reading.pages[1]!.text === "c body",
      "parse: a non-requested document does not leak into its neighbour");
  }

  // ---- a free-arm single doc does not hide the requested URL's error --------
  {
    const reading = parseExaFetchReply([
      "# Other", "URL: https://example.com/other", "other body",
      "Error fetching https://example.com/a: CRAWL_NOT_FOUND",
    ].join("\n"), ["https://example.com/a"]);
    assert(reading.pages.length === 0 && reading.failures[0]!.message === "CRAWL_NOT_FOUND",
      "free: a same-host other document does not become the requested page when its error line exists");
  }

  // ---- a free-arm single document on another host is not the requested page --
  {
    const reading = parseExaFetchReply([
      "# Other", "URL: https://evil.example/x", "wrong body",
    ].join("\n"), ["https://example.com/a"]);
    assert(reading.pages.length === 0 && reading.failures.length === 1,
      "free: a single cross-host document is not mapped to the requested URL");
  }

  // ---- a plain-text single-URL reply becomes a page only with enough body --
  {
    const plain = parseExaFetchReply(["line one", "line two", "line three"].join("\n"), ["https://example.com/a"]);
    assert(plain.pages.length === 1 && plain.pages[0]!.text.includes("line three"),
      "free: a three-line plain-text reply can be the requested page");
    const unrelated = parseExaFetchReply([
      "Error fetching https://other.example/x: CRAWL_TIMEOUT",
      "Error fetching https://another.example/y: CRAWL_NOT_FOUND",
      "Error fetching https://third.example/z: CRAWL_FORBIDDEN",
    ].join("\n"), ["https://example.com/a"]);
    assert(unrelated.pages.length === 0,
      "free: unrelated error lines alone do not fabricate a page");
  }

  // ---- an all-failure reply keeps every upstream reason ------------------
  {
    const text = [
      "Error fetching https://example.com/a: CRAWL_UNKNOWN_ERROR",
      "Error fetching https://example.com/b: CRAWL_TIMEOUT",
    ].join("\n");
    const reading = parseExaFetchReply(text, ["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
    assert(reading.failures.length === 3, "parse: every requested URL is reported");
    assert(reading.failures[0]!.message === "CRAWL_UNKNOWN_ERROR" && reading.failures[1]!.message === "CRAWL_TIMEOUT",
      "parse: the upstream reasons are not replaced by a generic sentence");
    assert(reading.failures[0]!.retryable === true, "parse: an unknown crawl error is retryable");
  }

  // ---- an explicit not-found code is final, not retryable ----------------
  {
    const reading = parseExaFetchReply("Error fetching https://example.com/x: CRAWL_NOT_FOUND",
      ["https://example.com/x"]);
    assert(reading.failures[0]!.retryable === false, "parse: CRAWL_NOT_FOUND is final");
  }

  // ---- an unsupported format is page-level: another arm may read it -------
  {
    const reading = parseExaFetchReply("Error fetching https://example.com/x: CRAWL_UNSUPPORTED_CONTENT",
      ["https://example.com/x"]);
    assert(reading.failures[0]!.retryable === true,
      "parse: CRAWL_UNSUPPORTED_CONTENT is retryable, so the next arm gets the URL");
  }

  // ---- an access fault is this arm, not the page (#610) ------------------
  {
    const reading = parseExaFetchReply("Error fetching https://example.com/x: CRAWL_FORBIDDEN",
      ["https://example.com/x"]);
    assert(reading.failures[0]!.errorClass === "permanent-auth",
      "parse: CRAWL_FORBIDDEN is an arm-level auth fault");
    assert(reading.failures[0]!.retryable === true,
      "parse: the tool retires the arm and hands the page on");
    // IPv6 / proxy egress gets turned away as ACCESS_DENIED rather than FORBIDDEN.
    const denied = parseExaFetchReply("Error fetching https://example.com/y: CRAWL_ACCESS_DENIED",
      ["https://example.com/y"]);
    assert(denied.failures[0]!.errorClass === "permanent-auth",
      "parse: CRAWL_ACCESS_DENIED takes the same arm-level branch");
    assert(denied.failures[0]!.retryable === true,
      "parse: a denied page is still worth another arm");
  }

  // ---- the free arm matches documents by the same identity as mapReading ---
  {
    const text = [
      "# A",
      "URL: https://example.com/a/",
      "body a",
      "",
      "# B",
      "URL: https://example.com/b",
      "body b",
    ].join("
");
    const reading = parseExaFetchReply(text, ["https://example.com/a", "https://example.com/b"]);
    const urls = reading.pages.map((page) => page.url).sort();
    assert(urls.length === 2, "a document whose URL came back with a trailing slash is still matched");
    assert(urls[0] === "https://example.com/a" && urls[1] === "https://example.com/b",
      "and it reports the requested spelling, not the upstream one");
  }

  // ---- the upstream reason reaches the model scrubbed and bounded --------
  {
    const reading = parseExaFetchReply(
      "Error fetching https://example.com/x: CRAWL_UNKNOWN_ERROR api_key=as_sk_live_abcdefghijklmnop " + "z".repeat(400),
      ["https://example.com/x"],
    );
    const shown = reading.failures[0]!.message ?? "";
    assert(!shown.includes("as_sk_live_abcdefghijklmnop"), "parse: the reason is redacted before it is shown");
    assert(shown.length <= 200, "parse: the reason is capped at 200 characters");
  }

  // ---- free arm requests the full text, one tools/call for the batch ------
  {
    const stub = installFetch(reply);
    try {
      const provider = new ExaFetchProvider();
      const envelope = await provider.fetch(
        { urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"], maxCharacters: 100_000 },
        new AbortController().signal,
      );
      assert(stub.calls.length === 1, "free: one upstream call for the whole batch");
      assert(stub.calls[0]!.body?.params?.name === "web_fetch_exa", "free: calls web_fetch_exa");
      const requestedChars = stub.calls[0]!.body?.params?.arguments?.maxCharacters;
      assert(requestedChars === 100_000, "free: asks for the page with the adapter cap");
      assert(envelope.provider === "exa", "free: provider id stays exa");
      assert(envelope.pages.length === 2 && envelope.failures.length === 1, "free: pages and failures are split");
    } finally {
      stub.restore();
    }
  }

  // ---- paid arm: a bad shape says malformed, so the class is protocol ------
  {
    const client = {
      async getContents() { return { results: "not an array" }; },
    } as unknown as ExaContentsClient;
    try {
      await new ExaFetchProvider(client).fetch(
        { urls: ["https://example.com/a"], maxCharacters: 100_000 },
        new AbortController().signal,
      );
      assert(false, "paid: a non-array results shape throws");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.includes("malformed"), "paid: a non-array results shape is labelled malformed");
    }
  }

  // ---- paid arm: text, empty body, and a URL that did not come back --------
  {
    const calls: PaidCall[] = [];
    const client: ExaContentsClient = {
      async getContents(urls, options, requestOptions) {
        calls.push({ urls, options, requestOptions });
        return {
          results: [
            { url: "https://example.com/a", title: "A", text: "full body a" },
            { url: "https://example.com/b", title: "B", text: "" },
          ],
        };
      },
    };
    const provider = new ExaFetchProvider(client);
    const envelope = await provider.fetch(
      { urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"], maxCharacters: 100_000 },
      new AbortController().signal,
    );
    assert(calls.length === 1, "paid: one contents call for the batch");
    assert(calls[0]!.options.text?.maxCharacters === 100_000, "paid: asks for the full body");
    assert(calls[0]!.options.filterEmptyResults === false, "paid: keeps empty results visible");
    assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "full body a", "paid: text becomes a page");
    assert(envelope.failures.length === 2, "paid: empty and missing URLs become failures");
    assert(envelope.failures.every((failure) => failure.retryable === true),
      "paid: both are page-level failures another arm may retry");
    assert(envelope.failures.every((failure) => failure.errorClass === "unknown"),
      "paid: an empty page is not a protocol failure");
  }

  // ---- paid arm: a redirect still maps to the one requested URL -----------
  {
    const client: ExaContentsClient = {
      async getContents() {
        return { results: [{ url: "https://example.com/start?page=2", title: "Landing", text: "redirect body" }] };
      },
    };
    const provider = new ExaFetchProvider(client);
    const envelope = await provider.fetch({ urls: ["https://example.com/start?page=2"], maxCharacters: 4000 }, new AbortController().signal);
    assert(envelope.pages.length === 1 && envelope.pages[0]!.url === "https://example.com/start?page=2",
      "paid: a same-path, same-query redirect maps to the requested URL");
    assert(envelope.pages[0]!.text === "redirect body", "paid: the redirect body is kept");
  }

  // ---- paid arm: a cross-host landing page is not stored as the requested URL --
  {
    const client: ExaContentsClient = {
      async getContents() {
        return { results: [{ url: "https://evil.example/landing", title: "Other", text: "wrong body" }] };
      },
    };
    const provider = new ExaFetchProvider(client);
    const envelope = await provider.fetch({ urls: ["https://example.com/start?page=2"], maxCharacters: 4000 }, new AbortController().signal);
    assert(envelope.pages.length === 0 && envelope.failures.length === 1,
      "paid: a cross-host redirect does not become the requested page");
  }

  // ---- paid arm: a same-host landing on another path is a soft 404 ---------
  {
    const client: ExaContentsClient = {
      async getContents() {
        return { results: [{ url: "https://example.com/home", title: "Home", text: "soft 404" }] };
      },
    };
    const provider = new ExaFetchProvider(client);
    const envelope = await provider.fetch({ urls: ["https://example.com/start?page=2"], maxCharacters: 4000 }, new AbortController().signal);
    assert(envelope.pages.length === 0 && envelope.failures.length === 1,
      "paid: a same-host different-path landing is not the requested page");
  }

  // ---- paid arm: a malformed reply is a protocol failure, not an empty page --
  {
    const client: ExaContentsClient = {
      async getContents() {
        return {};
      },
    };
    const provider = new ExaFetchProvider(client);
    let threw = false;
    try {
      await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, new AbortController().signal);
    } catch {
      threw = true;
    }
    assert(threw, "paid: a missing results array surfaces as a protocol failure");
  }

  // ---- paid arm: a thrown call fails the arm, not one page ----------------
  {
    const client: ExaContentsClient = {
      async getContents() {
        throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
      },
    };
    const provider = new ExaFetchProvider(client);
    let threw = false;
    try {
      await provider.fetch({ urls: ["https://example.com/a"], maxCharacters: 4000 }, new AbortController().signal);
    } catch {
      threw = true;
    }
    assert(threw, "paid: a thrown contents call surfaces to the tool");
  }

  // ---- factory split mirrors search --------------------------------------
  {
    const free = createExaFetchProvider("");
    const paid = createExaFetchProvider(" key ");
    assert(free.maxUrlsPerCall === 5 && paid.maxUrlsPerCall === 5, "factory: both arms use the tool cap");
  }

  console.log("fetch-exa.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

await main();
