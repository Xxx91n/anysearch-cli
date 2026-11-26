// The page-read contract.
//
// Search answers "what pages exist"; this asks for the text of pages that were
// already admitted. The tool decides who may read; an adapter only turns a URL
// list into pages and says which URLs failed.

import type { ProviderErrorClass } from "./contract";

/** Upstream page-text cap. A longer page is stored truncated. */
export const FETCH_PAGE_MAX_CHARS = 100_000;

export function isPageReadArmKey(key: string): boolean {
  return key.endsWith(":fetch");
}

/** The search-facing subset of providerBuildErrors: page-read arms are not search arms. */
export function searchBuildErrors(errors: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([id]) => !isPageReadArmKey(id)));
}

/** What one adapter may receive in one upstream request. */
export interface FetchRequest {
  /** Full URLs (scheme included), already admitted by the tool. */
  urls: string[];
  /**
   * Per-URL text budget, capped by FETCH_PAGE_MAX_CHARS. A batch of five URLs
   * asks for five times this much. Text beyond the cap is lost before it
   * reaches the archive; the model's copy is cut again.
   */
  maxCharacters: number;
}

export interface FetchPage {
  /**
   * The requested URL. When a single-URL request follows a redirect, this is
   * the requested address; the landing URL is not exposed.
   */
  url: string;
  title?: string;
  text: string;
}

export interface FetchFailure {
  url: string;
  errorClass: ProviderErrorClass;
  message?: string;
  /**
   * False means retrying elsewhere cannot help (404/410/invalid URL). True or
   * omitted means "this page, not this arm": an empty body or a format the arm
   * cannot read, and the tool may hand that URL to the next provider.
   */
  retryable?: boolean;
}

export interface FetchEnvelope {
  provider: string;
  pages: FetchPage[];
  failures: FetchFailure[];
}

export interface FetchProvider {
  readonly id: string;
  /** Maximum URLs this arm accepts in one upstream request. */
  readonly maxUrlsPerCall: number;
  fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchEnvelope>;
}
