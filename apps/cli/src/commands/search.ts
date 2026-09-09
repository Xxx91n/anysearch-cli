// ans search: run a retrieval query through the Retroaererd Engine.
// ADR-0006 decision 3A: uses createEngine() factory, not inline wiring.

import type { Mode } from "@anysearch/retriever";
import { createPersistentEngine } from "../db";

export async function runSearch(args: string[]): Promise<number> {
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // Parse optional --mode flag (default: fast).
  let mode: Mode = "fast";
  const isJson = args.includes("--json");
  const modeIdx = args.indexOf("--mode");
  if (modeIdx >= 0 && args[modeIdx + 1]) {
    const m = args[modeIdx + 1];
    if (m === "fast" || m === "index" || m === "deep" || m === "answer") {
      mode = m;
    }
  }
  const queryClean = args.filter(a => !a.startsWith("--mode") && a !== mode).join(" ").trim();

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
      () => retriever.search({ query: queryClean, mode, maxResults: 10 }),
    );

    // r83 audit F5 / ADR-0034 D4: --json pure — single JSON document on stdout, nothing else.
    if (isJson) {
      const out = {
        query: queryClean,
        mode,
        results: envelope.results,
        answers: envelope.answers,
        sufficiency: envelope.metadata?.sufficiency ?? null,
        attribution: envelope.attribution ?? null,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return envelope.results.length > 0 ? 0 : 1;
    }

    console.log("ans search: " + JSON.stringify({ query: queryClean, mode }));
    console.log("---");

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
      const { renderAttributionText } = await import("@anysearch/kernel");
      console.log(renderAttributionText(envelope.attribution));
    }

    console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
    if (envelope.metadata.providersFailed.length > 0) {
      console.log("Providers failed: " + envelope.metadata.providersFailed.join(", "));
    }
    console.log("Results: " + envelope.results.length);
    console.log("Elapsed: " + envelope.metadata.elapsedMs + "ms");

    return envelope.results.length > 0 ? 0 : 1;
  } catch (e: any) {
    console.error("ans search error: " + e.message);
    return 1;
  }
}
