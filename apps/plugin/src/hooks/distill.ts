// PostToolUse distillation: JSON structured summary + FTS5 auto-index.
// ADR-0009 Q6: structured summary for host agent context + project index write.
// Distillation = extract key info, compress, prepare for indexing.

import { isAnsTool, type HookInput, type HookDecision } from "./core.js";

interface DistillResult {
  distilled: string;
  shouldIndex: boolean;
  entries: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
    contentHash: string;
  }>;
}

// Hash function for content dedup (ADR-0009 D4: content-hash dedup).
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

export function distillOutput(input: HookInput): DistillResult {
  if (!isAnsTool(input.toolName)) {
    return { distilled: "", shouldIndex: false, entries: [] };
  }

  const output = input.toolOutput;
  if (!output) return { distilled: "", shouldIndex: false, entries: [] };

  // Extract results from MCP tool output (search_web/research_web format).
  const text = typeof output === "string" ? output : JSON.stringify(output);
  let parsed: { results?: Array<{ title: string; url: string; snippet: string; source: string }> } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON output: distill to first 500 chars.
    return {
      distilled: text.slice(0, 500),
      shouldIndex: false,
      entries: [],
    };
  }

  const results = parsed?.results || [];
  const entries = results.map(r => ({
    title: r.title || "",
    url: r.url || "",
    snippet: (r.snippet || "").slice(0, 500),
    source: r.source || "unknown",
    contentHash: simpleHash(r.url + r.title + r.snippet),
  }));

  // Structured summary: concise JSON for host agent context window economy.
  const distilled = JSON.stringify({
    tool: input.toolName,
    query: input.toolInput?.query || "",
    resultCount: results.length,
    topResults: entries.slice(0, 3).map(e => ({ title: e.title, url: e.url })),
  });

  return {
    distilled,
    shouldIndex: entries.length > 0,
    entries,
  };
}

export function makePostToolUseDecision(input: HookInput): HookDecision {
  const { distilled, shouldIndex, entries } = distillOutput(input);
  return {
    distilledOutput: distilled,
    shouldIndex,
    indexEntries: entries,
  };
}
