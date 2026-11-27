// Exa's page-read arm.
//
// With a key: exa-js `getContents` on the paid REST endpoint.
// Without one: a free-quota `web_fetch_exa` MCP call per batch.
// Upstream gets at most 100k characters per URL; the model's copy is cut again.

import Exa from "exa-js";
import { classifyProviderError, type ProviderErrorClass } from "../contract";
import { FETCH_PAGE_MAX_CHARS, type FetchEnvelope, type FetchFailure, type FetchPage, type FetchProvider, type FetchRequest } from "../fetch-contract";
import { hostsSameSite } from "../content-trust";
import { normalizeUrlIdentity, parseWebUrl } from "../url-identity";
import { callExaMcpTool } from "./exa-free-arm";
import { PROVIDER_FACTS } from "./provider-facts";

export interface ExaContentsOptions {
  text: { maxCharacters: number };
  filterEmptyResults: boolean;
}

export interface ExaContentsResult {
  url?: unknown;
  title?: unknown;
  text?: unknown;
}

/** The one exa-js call this adapter needs; a test passes its own object. */
export interface ExaContentsClient {
  getContents(
    urls: string[],
    options: ExaContentsOptions,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<{ results?: ExaContentsResult[] }>;
}

interface Reading {
  pages: FetchPage[];
  failures: FetchFailure[];
}

/** This page came back without text. */
const NO_BODY_MESSAGE = "该网址没有返回正文";

/** Turn pages and a failure rule into the requested order. */
function mapReading(
  requested: string[],
  pages: FetchPage[],
  failureFor: (url: string) => FetchFailure,
): Reading {
  const byIdentity = new Map(pages.map((page) => [normalizeUrlIdentity(page.url), page]));
  const outPages: FetchPage[] = [];
  const failures: FetchFailure[] = [];
  for (const url of requested) {
    const page = byIdentity.get(normalizeUrlIdentity(url));
    if (page) {
      outPages.push({ ...page, url });
      continue;
    }
    failures.push(failureFor(url));
  }
  return { pages: outPages, failures };
}

function readingEnvelope(provider: string, reading: Reading): FetchEnvelope {
  return { provider, pages: reading.pages, failures: reading.failures };
}

function samePath(a: URL, b: URL): boolean {
  return a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
}

function pageFailure(url: string, message: string): FetchFailure {
  return { url, errorClass: "unknown", message, retryable: true };
}

/**
 * Turn one batch reply into pages and failures against the requested list.
 * A URL with text is a page; an empty or missing one is a page-level failure.
 */
function matchPaidReading(
  requested: string[],
  results: ExaContentsResult[],
): Reading {
  const byIdentity = new Map<string, { url: string; title: string; text: string }>();
  for (const result of results) {
    const url = typeof result?.url === "string" ? result.url.trim() : "";
    if (!url) continue;
    const identity = normalizeUrlIdentity(url);
    const text = typeof result?.text === "string" ? result.text : "";
    const title = typeof result?.title === "string" ? result.title.trim() : "";
    if (!text.trim()) continue;
    byIdentity.set(identity, { url, title, text });
  }

  const pages: FetchPage[] = [...byIdentity.values()].map((hit) => ({
    url: hit.url,
    text: hit.text,
    ...(hit.title ? { title: hit.title } : {}),
  }));
  // Exa returns the landing page URL after a redirect; with one requested URL
  // and one non-empty result the mapping is unambiguous.
  if (requested.length === 1 && results.length === 1 && pages.length === 1) {
    const wanted = normalizeUrlIdentity(requested[0]!);
    const returned = normalizeUrlIdentity(pages[0]!.url);
    if (returned !== wanted) {
      const wantedUrl = parseWebUrl(requested[0]!);
      const returnedUrl = parseWebUrl(pages[0]!.url);
      if (!wantedUrl || !returnedUrl
          || !hostsSameSite(wantedUrl.hostname, returnedUrl.hostname)
          || !samePath(wantedUrl, returnedUrl)) {
        pages.length = 0; // a cross-host or unparseable landing page is not the requested text
      } else {
        pages[0] = { ...pages[0]!, url: requested[0]! };
      }
    }
  }
  return mapReading(requested, pages, (url) =>
    pageFailure(url, NO_BODY_MESSAGE));
}

function failureFromMessage(url: string, message: string): FetchFailure {
  const classified: ProviderErrorClass = classifyProviderError(message);
  return {
    url,
    errorClass: classified,
    message: message.trim().slice(0, 300) || undefined,
    // Only an explicit "this page cannot exist" code is final. Everything else,
    // including CRAWL_UNKNOWN_ERROR, is worth trying on another arm.
    retryable: !/CRAWL_(?:NOT_FOUND|INVALID_URL|UNSUPPORTED_CONTENT|ACCESS_DENIED|FORBIDDEN|BAD_REQUEST)\b/i.test(message),
  };
}

/**
 * The free arm returns one text block for the whole batch:
 *
 *     # Page title
 *     URL: https://example.com/page
 *
 *     body...
 *
 * A failed URL is an `Error fetching <url>: CODE` line after the documents.
 * A requested URL keeps its last `#` + `URL:` occurrence; any other such
 * heading starts a document only when the previous line is blank. A body line
 * that looks the same is kept. Only the last document's trailing error lines
 * are removed; errors after earlier documents stay in their body.
 */
export function parseExaFetchReply(text: string, requested: string[]): Reading {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const requestedSet = new Set(requested.map(normalizeUrlIdentity));

  const rawStarts: Array<{ heading: number; urlLine: number; url: string; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#\s+/.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]!.trim()) j++;
    const match = j < lines.length ? /^URL:\s*(\S+)\s*$/.exec(lines[j]!) : null;
    if (!match) continue;
    rawStarts.push({
      heading: i,
      urlLine: j,
      url: match[1]!,
      title: lines[i]!.replace(/^#\s+/, "").trim(),
    });
  }
  // Same requested URL: keep the last occurrence. Any other `#` heading
  // starts a document only when the preceding line is blank.
  const lastRequested = new Map<string, number>();
  rawStarts.forEach((start, index) => {
    const identity = normalizeUrlIdentity(start.url);
    if (requestedSet.has(identity)) lastRequested.set(identity, index);
  });
  const boundaries = rawStarts.filter((start, index) => {
    const identity = normalizeUrlIdentity(start.url);
    if (requestedSet.has(identity)) return lastRequested.get(identity) === index;
    return start.heading === 0 || !lines[start.heading - 1]!.trim();
  });
  const docs = boundaries.map((start, index) => {
    const next = boundaries[index + 1];
    return {
      url: start.url,
      title: start.title,
      bodyFrom: start.urlLine + 1,
      end: next ? next.heading : lines.length,
    };
  });

  const errorByUrl = new Map<string, string>();
  const takeTrailingErrors = (from: number, end: number): number => {
    let cut = end;
    let i = end - 1;
    while (i >= from) {
      const line = lines[i]!;
      if (!line.trim()) { i--; continue; }
      const match = /^\s*Error fetching\s+(\S+):\s*(.*)$/i.exec(line);
      if (!match) break;
      const identity = normalizeUrlIdentity(match[1]!);
      if (!requestedSet.has(identity)) break;
      errorByUrl.set(identity, match[2] ?? "");
      cut = i;
      i--;
    }
    return cut;
  };

  const last = docs[docs.length - 1];
  if (last) last.end = takeTrailingErrors(last.bodyFrom, last.end);
  else takeTrailingErrors(0, lines.length);

  const pages: FetchPage[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const identity = normalizeUrlIdentity(doc.url);
    if (!requestedSet.has(identity) || seen.has(identity)) continue;
    seen.add(identity);
    const body = lines.slice(doc.bodyFrom, doc.end).join("\n").trim();
    if (!body) continue;
    pages.push({ url: doc.url, text: body, ...(doc.title ? { title: doc.title } : {}) });
  }

  // A single URL may redirect to a landing page; one document is enough to
  // map it, even with a short preface before the heading.
  if (requested.length === 1 && pages.length === 0 && errorByUrl.size === 0) {
    const redirect = docs.length === 1 ? docs[0] : undefined;
    if (redirect) {
      const wanted = parseWebUrl(requested[0]!);
      const got = parseWebUrl(redirect.url);
      if (wanted && got && hostsSameSite(wanted.hostname, got.hostname) && samePath(wanted, got)) {
        const body = lines.slice(redirect.bodyFrom, redirect.end).join("\n").trim();
        if (body) {
          pages.push({ url: requested[0]!, text: body, ...(redirect.title ? { title: redirect.title } : {}) });
        }
      }
    } else if (docs.length === 0) {
      const bodyLines = lines.slice(0, takeTrailingErrors(0, lines.length));
      const onlyErrors = bodyLines.every((line) => !line.trim() || /^\s*Error fetching\s/i.test(line));
      const body = bodyLines.join("\n").trim();
      if (body && !onlyErrors) pages.push({ url: requested[0]!, text: body });
    }
  }

  return mapReading(requested, pages, (url) => {
    const error = errorByUrl.get(normalizeUrlIdentity(url));
    return error !== undefined ? failureFromMessage(url, error) : pageFailure(url, NO_BODY_MESSAGE);
  });
}

export class ExaFetchProvider implements FetchProvider {
  readonly id = PROVIDER_FACTS.exa.id;
  readonly maxUrlsPerCall = PROVIDER_FACTS.exa.fetchMaxUrlsPerCall;
  private readonly paid?: ExaContentsClient;

  constructor(paid?: ExaContentsClient) {
    this.paid = paid;
  }

  async fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchEnvelope> {
    const maxCharacters = Math.min(FETCH_PAGE_MAX_CHARS, Math.max(1, req.maxCharacters));
    if (this.paid) return this.fetchPaid(req, maxCharacters, signal);
    return this.fetchFree(req, maxCharacters, signal);
  }

  private async fetchPaid(req: FetchRequest, maxCharacters: number, signal: AbortSignal): Promise<FetchEnvelope> {
    const response = await this.paid!.getContents(
      req.urls,
      {
        text: { maxCharacters },
        // Keep empty pages visible as failures instead of silently dropping
        // them, which would make "the page had no text" look like "not asked".
        filterEmptyResults: false,
      },
      { signal },
    );
    if (!Array.isArray(response?.results)) {
      throw new Error("Exa contents: malformed response.results is not an array");
    }
    const reading = matchPaidReading(req.urls, response.results);
    return readingEnvelope(this.id, reading);
  }

  private async fetchFree(req: FetchRequest, maxCharacters: number, signal: AbortSignal): Promise<FetchEnvelope> {
    const text = await callExaMcpTool(
      "web_fetch_exa",
      { urls: req.urls, maxCharacters },
      signal,
    );
    const reading = parseExaFetchReply(text, req.urls);
    return readingEnvelope(this.id, reading);
  }
}

/**
 * The factory mirrors `createExaProvider`: only the value handed in decides the
 * arm. It never reads EXA_API_KEY itself — the composition root resolved that
 * once and passes the value in.
 */
export function createExaFetchProvider(apiKey?: string): FetchProvider {
  const key = apiKey?.trim();
  if (!key) return new ExaFetchProvider();
  const client = new Exa(key);
  return new ExaFetchProvider({
    getContents: (urls, options, requestOptions) => client.getContents(urls, options, requestOptions),
  });
}
