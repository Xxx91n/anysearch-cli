// ans search: run a retrieval query through the Retroaererd Engine.
// ADR-0006 decision 3A: uses createEngine() factory, not inline wiring.

import type { Mode } from "@anysearch-cli/retriever";
import { canonicalizeVertical } from "@anysearch-cli/retriever";
import { createPersistentEngine } from "../db";

import { searchExitCode, formatAbstainLine } from "./search-abstain";

export async function runSearch(args: string[]): Promise<number> {
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // Parse optional --mode flag (default: fast).
  let mode: Mode = "fast";
  const isJson = args.includes("--json");
  // ADR-0062 D3 (T3): --fail-on-abstain promotes abstain to exit 3.
  const failOnAbstain = args.includes("--fail-on-abstain");
  const modeIdx = args.indexOf("--mode");
  if (modeIdx >= 0 && args[modeIdx + 1]) {
    const m = args[modeIdx + 1];
    if (m === "fast" || m === "index" || m === "deep" || m === "answer") {
      mode = m;
    }
  }
  // R83 T1 / ADR-0084 D-003: query-level vertical flags — whole-replace over
  // the domain TOML sources.vertical default (no deep-merge).
  //   --vertical-domain X --vertical-sub-domain Y --vertical-params '{"k":"v"}'
  const flagVal = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // R84 T1 / A-02 (ADR-0085 draft): malformed vertical input is fail-fast —
  // reject-with-error at every entry boundary (aligned with the MCP schema
  // rejection direction). A present flag with no value, a value that is
  // another --flag, or an empty string are all malformed, never silently
  // dropped.
  const flagSeen = (name: string): boolean => args.includes(name);
  const verticalDomain = flagVal("--vertical-domain");
  const verticalSubDomain = flagVal("--vertical-sub-domain");
  const verticalParamsRaw = flagVal("--vertical-params");
  for (const [name, val] of [["--vertical-domain", verticalDomain], ["--vertical-sub-domain", verticalSubDomain], ["--vertical-params", verticalParamsRaw]] as const) {
    if (flagSeen(name) && (val === undefined || val.startsWith("--"))) {
      process.stderr.write("ans search: " + name + " requires a value\n");
      return 2;
    }
    if (val !== undefined && val.trim().length === 0) {
      process.stderr.write("ans search: " + name + " must be a non-empty string\n");
      return 2;
    }
  }
  if (verticalDomain === undefined && (verticalSubDomain !== undefined || verticalParamsRaw !== undefined)) {
    process.stderr.write("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain\n");
    return 2;
  }
  let verticalParams: Record<string, unknown> | undefined;
  if (verticalParamsRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(verticalParamsRaw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not a Record");
      verticalParams = parsed as Record<string, unknown>;
    } catch {
      process.stderr.write("ans search: --vertical-params must be a JSON object\n");
      return 2;
    }
  }
  // A-04 canonicalization: params:{} (or any empty/non-object params) == absent —
  // the echoed spec below is the canonical form actually routed to providers.
  const vertical = verticalDomain !== undefined
    ? canonicalizeVertical({ domain: verticalDomain, ...(verticalSubDomain ? { subDomain: verticalSubDomain } : {}), ...(verticalParams ? { params: verticalParams } : {}) })
    : undefined;

  // ADR-0062 (T3): drop every --flag token (was only --mode) so --json /
  // --fail-on-abstain can no longer leak into the provider query string.
  // R83 T1: flag VALUES are also dropped so --vertical-* arguments don't leak
  // into the query string either.
  const flagValueSet = new Set([mode, verticalDomain, verticalSubDomain, verticalParamsRaw].filter((v): v is string => v !== undefined));
  const queryClean = args.filter(a => !a.startsWith("--") && !flagValueSet.has(a)).join(" ").trim();
  if (!queryClean) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // ADR-0006 decision 3A: createEngine factory with domain filtering.
  const domain = process.env.ANS_DOMAIN;
  const { retriever, observation } = createPersistentEngine(domain);

  try {
    const envelope = await observation.recordOperation(
      {
        kind: "retrieve",
        operation: "ans.search",
        attributes: {
          "anysearch.command": "search",
          "anysearch.mode": mode,
          "anysearch.domain": domain ?? "all",
          "anysearch.source": "retrieved",
        },
      },
      // ADR-0062 D2: span passed through so the kernel can emit the dual
      // retrieval.domain_filter.* audit events + the anysearch.outcome dimension.
      (span) => retriever.search({ query: queryClean, mode, maxResults: 10, ...(vertical ? { vertical } : {}), span }),
    );

    // r83 audit F5 / ADR-0034 D4: --json pure — single JSON document on stdout, nothing else.
    if (isJson) {
      const out = {
        query: queryClean,
        mode,
        results: envelope.results,
        // ADR-0063 (R62 T2): providersFailed exposed so the install-smoke offline
        // leg anchors a structured field instead of exit codes/regexes.
        providersFailed: envelope.metadata?.providersFailed ?? [],
        answers: envelope.answers,
        sufficiency: envelope.metadata?.sufficiency ?? null,
        attribution: envelope.attribution ?? null,
        // ADR-0062 D3: first-class abstain marker is part of the --json contract.
        abstain: envelope.metadata.abstain ?? null,
        // R83 T1: resolved query-level vertical spec (repo defaults ride on the
        // retrieval.vertical.pre audit event).
        vertical: vertical ?? null,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return searchExitCode({ resultCount: envelope.results.length, abstain: !!envelope.metadata.abstain, failOnAbstain });
    }

    console.log("ans search: " + JSON.stringify({ query: queryClean, mode }));
    console.log("---");

    // ADR-0062 D3 (T3): first-class abstain — one structured line, not an error.
    const abstain = envelope.metadata.abstain;
    if (abstain) {
      console.log(formatAbstainLine(abstain));
      console.log("---");
      console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
      if (envelope.metadata.providersFailed.length > 0) {
        console.log("Providers failed: " + envelope.metadata.providersFailed.join(", "));
      }
      console.log("Elapsed: " + envelope.metadata.elapsedMs + "ms");
      return searchExitCode({ resultCount: 0, abstain: true, failOnAbstain });
    }

    // Render results.
    for (let i = 0; i < envelope.results.length; i++) {
      const r = envelope.results[i];
      console.log((i + 1) + ". [" + r.source + "] " + r.title);
      console.log("   " + r.url);
      if (r.snippet) {
        const snip = r.snippet.length > 200 ? r.snippet.slice(0, 200) + "..." : r.snippet;
        console.log("   " + snip);
      }
      console.log("");
    }

    // Metadata.
    console.log("---");
    // ADR-0022 D1: print provider answers when present (unverified, provider-side).
    if (envelope.answers.length > 0) {
      console.log("Provider answers (unverified):");
      const pa = envelope.metadata.providerAnswers ?? [];
      for (const a of pa.length > 0 ? pa : envelope.answers.map(t => ({ provider: "unknown", text: t }))) {
        // ADR-0022 D1: answers pass through at full length on CLI; if terminal rendering needs
        // a cap, set ANSWER_CLI_TRUNCATE=N env-var. Default no truncation (D1: no silent truncation).
        const cap = Number(process.env.ANSWER_CLI_TRUNCATE);
        const truncated = Number.isFinite(cap) && cap > 0 && a.text.length > cap;
        const text = truncated ? a.text.slice(0, cap) + "..." : a.text;
        console.log("  [" + a.provider + "] " + text + (truncated ? " (truncated; unset ANSWER_CLI_TRUNCATE for full text)" : ""));
      }
      console.log("");
    }
    // ADR-0034 D4: CLI attribution rendering for TTY (mark/annotated Sources). --json exits earlier.
    if (envelope.attribution) {
      const { renderAttributionText } = await import("@anysearch-cli/kernel");
      console.log(renderAttributionText(envelope.attribution));
    }

    console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
    if (envelope.metadata.providersFailed.length > 0) {
      console.log("Providers failed: " + envelope.metadata.providersFailed.join(", "));
    }
    console.log("Results: " + envelope.results.length);
    console.log("Elapsed: " + envelope.metadata.elapsedMs + "ms");

    return searchExitCode({ resultCount: envelope.results.length, abstain: false, failOnAbstain });
  } catch (e: any) {
    console.error("ans search error: " + e.message);
    return 1;
  }
}
