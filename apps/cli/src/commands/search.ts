// ans search: run a retrieval query through the retrieval engine.
// decision 3A: uses createEngine factory, not inline wiring.

import type { Mode, ProviderErrorClass } from "@anysearch-cli/retriever";
import { buildVerticalSpec, verticalSpecReject } from "@anysearch-cli/retriever";
import { wireTaskBudget, isTaskBudgetRejectedError, DomainConstraintError, describeDomainFallback, resolveDomainConstraint, providerErrorHints, type DomainConfigPort } from "@anysearch-cli/kernel";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";
import { createPersistentEngine, domainSearchDirs } from "../db";
import { currentCliTask } from "../cli-task-context";

import {
  searchExitCode,
  formatAbstainLine,
  formatProviderAbsentLine,
  formatProvidersCancelledLine,
  formatProvidersFailedLine,
  formatProviderHintLines,
} from "./search-abstain";

// Both render paths print "Providers failed"; both must print the remedy
// beside it, or an abstain hides why the arm died.
function printProviderFailureHints(metadata: {
  providersFailed: string[];
  providerErrorClasses?: Record<string, ProviderErrorClass>;
  providerErrorRetryAfterSeconds?: Record<string, number>;
}): void {
  const hints = providerErrorHints(
    metadata.providersFailed,
    metadata.providerErrorClasses,
    metadata.providerErrorRetryAfterSeconds,
  );
  for (const line of formatProviderHintLines(hints)) console.log(line);
}

export async function runSearch(args: string[]): Promise<number> {
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // Parse optional --mode flag (default: fast).
  let mode: Mode = "fast";
  const isJson = args.includes("--json");
  // --fail-on-abstain promotes abstain to exit 3.
  const failOnAbstain = args.includes("--fail-on-abstain");
  const modeIdx = args.indexOf("--mode");
  if (modeIdx >= 0 && args[modeIdx + 1]) {
    const m = args[modeIdx + 1];
    if (m === "fast" || m === "index" || m === "deep" || m === "answer") {
      mode = m;
    }
  }
  // query-level vertical flags — whole-replace over
  // the domain TOML sources.vertical default (no deep-merge).
  // --vertical-domain X --vertical-sub-domain Y --vertical-params '{"k":"v"}'
  const flagVal = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // (draft): malformed vertical input is fail-fast —
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
  // the require-domain verdict comes from the
  // shared guard layer — the raw params string stands in for the payload
  // (presence is all the guard checks; JSON decoding errors still fire
  // below, preserving the established check order byte-for-byte).
  if (verticalSpecReject({ domain: verticalDomain, subDomain: verticalSubDomain, params: verticalParamsRaw }) !== null) {
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
  // canonicalization rides inside buildVerticalSpec (params:{} ≡ absent) —
  // the echoed spec below is the canonical form actually routed to providers.
  // The guard already ran above; a rejection here is unreachable but rendered
  // identically rather than dropped silently.
  const built = buildVerticalSpec({ domain: verticalDomain, subDomain: verticalSubDomain, params: verticalParams });
  if (!built.ok) {
    process.stderr.write("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain\n");
    return 2;
  }
  const vertical = built.vertical;

  // Drop every --flag token (was only --mode) so --json /
  // --fail-on-abstain can no longer leak into the provider query string.
  // flag VALUES are also dropped so --vertical-* arguments don't leak
  // into the query string either.
  // flag values are consumed POSITIONALLY — the slot
  // immediately after a known value-flag is the value position. A query term
  // identical to a flag value survives (the old value-set heuristic swallowed
  // it: "--vertical-domain finance finance" collapsed to an empty query).
  const valueFlags = new Set(["--mode", "--vertical-domain", "--vertical-sub-domain", "--vertical-params"]);
  const consumed = new Set<number>();
  args.forEach((a, i) => {
    if (valueFlags.has(a) && i + 1 < args.length) consumed.add(i + 1);
  });
  const queryClean = args.filter((a, i) => !a.startsWith("--") && !consumed.has(i)).join(" ").trim();
  if (!queryClean) {
    process.stderr.write("ans search <query>\n");
    return 2;
  }

  // decision 3A: createEngine factory with domain filtering.
  // #306: an unset ANS_DOMAIN is "nobody declared a domain" — the legal
  // no-filtering default. A set one is a declaration, and createEngine stops
  // the command when it cannot be honoured instead of fanning out to every
  // provider with the operator's allowlist silently gone.
  const active = resolveActiveDomain();
  // draft: ANS_PROVIDERS env-gated provider subset filter —
  // eval channel for arm-isolated measurement (the paired delta runner runs
  // ANS_PROVIDERS=anysearch so a slow vertical arm is not cancelled by faster
  // arms inside the engine grace window). Absent = full fanout, unchanged.
  const providersSel = process.env.ANS_PROVIDERS?.split(",").map((s) => s.trim()).filter(Boolean);
  const engine = createPersistentEngine(active.declaredName);
  const { retriever, observation, providerBuildErrors, store, config, credentialSources } = engine;
  // #304: this execution is its own task. The Active Domain's [budget] caps
  // this run, not a session (a bare search has none). A declared budget that
  // cannot be established stops before any provider request; an undeclared one
  // travels a no-row scope and caps nothing.
  //
  // Design: the budget comes from the same three-state answer `ans chat` and
  // `ans consolidate` ask for, not from `config ?? load()` — an unset ANS_DOMAIN
  // keeps the historical full fanout for provider selection but must not
  // silently drop the default domain's declared cap, and reading that default
  // TOML once here (rather than trusting the engine's own config, which is
  // absent when nobody declared a domain) is what keeps the cap attached.
  //
  // The fatal branch is not redundant for a bare search: the engine only loads
  // a domain when one was declared, so a BROKEN `default.toml` is invisible to
  // it here. Refusing it is the point — treating it as "no budget" would ignore
  // a declared cap while still fanning out to every provider.
  // A declared domain was already resolved by the engine, and `config` is that
  // exact schema — resolving again would read the TOML (and its base chain) a
  // second time and could disagree with the copy the providers were built from.
  // The undeclared case needs its own read: the engine loads nothing then, and
  // the default domain's [budget] still has to be attached.
  const defaultDomain = config
    ? null
    : resolveDomainConstraint({ name: active.name, declared: active.declared, dirs: domainSearchDirs() });
  if (defaultDomain?.state === "failed" && defaultDomain.fatal) {
    throw new DomainConstraintError(defaultDomain);
  }
  if (defaultDomain?.state === "failed") {
    process.stderr.write("[warn] " + describeDomainFallback(defaultDomain) + "\n");
  }
  const budgetDomain: DomainConfigPort | undefined = config
    ?? (defaultDomain?.state === "established" ? defaultDomain.schema as DomainConfigPort : undefined);
  const budgetWiring = wireTaskBudget(store, currentCliTask()?.taskId, budgetDomain?.budget, {
    warn: (m) => process.stderr.write("[warn] " + m + "\n"),
    fallbackText: "this run is unmetered",
  });
  if (budgetWiring.taskBudgetFault) {
    process.stderr.write(
      "ans search: this run's task budget could not be established — " +
        budgetWiring.taskBudgetFault + "\nNo provider request was sent.\n",
    );
    return 1;
  }
  const taskBudget = budgetWiring.taskBudget;
  // #180: one-line construction-absence note paired with the runtime provider
  // chain lines below ("Providers queried" / "Providers failed") — undefined
  // when every enabled arm built, so the healthy path adds zero noise. The
  // category wording is the kernel's safe message verbatim (CWE-532).
  const providerAbsentLine = formatProviderAbsentLine(providerBuildErrors);

  try {
    const envelope = await observation.recordOperation(
      {
        kind: "retrieve",
        operation: "ans.search",
        attributes: {
          "anysearch.command": "search",
          "anysearch.mode": mode,
          "anysearch.domain": active.declaredName ?? "all",
          "anysearch.source": "retrieved",
        },
      },
      // span passed through so the kernel can emit the dual
      // retrieval.domain_filter.* audit events + the anysearch.outcome dimension.
      (span) => retriever.search({ query: queryClean, mode, maxResults: 10, ...(vertical ? { vertical } : {}), ...(providersSel?.length ? { providers: providersSel } : {}), ...(taskBudget ? { taskBudget } : {}), span }),
    );

    // --json pure — single JSON document on stdout, nothing else.
    if (isJson) {
      const out = {
        query: queryClean,
        mode,
        results: envelope.results,
        // providersFailed exposed so the install-smoke offline
        // leg anchors a structured field instead of exit codes/regexes.
        providersFailed: envelope.metadata?.providersFailed ?? [],
        // Who was asked, and who we cut off. With providersFailed above, these
        // three answer "what happened to each arm": without providersQueried a
        // domain-disabled arm is invisible, and a cut-off arm simply vanishes.
        providersQueried: envelope.metadata?.providersQueried ?? [],
        providersCancelled: envelope.metadata?.providersCancelled ?? [],
        // error-class channel next to the flag (additive).
        providerErrorClasses: envelope.metadata?.providerErrorClasses ?? {},
        // construction-time provider absences (id -> safe category), paired
        // with the runtime providersFailed chain above — the audit surface for
        // "which arm never entered the fanout, and why" (#180). Additive; {}
        // when every enabled arm built.
        providerBuildErrors,
        // credentialSources 由引擎给出、原样透出；没接凭据时是 null。
        credentialSources: credentialSources ?? null,
        answers: envelope.answers,
        sufficiency: envelope.metadata?.sufficiency ?? null,
        attribution: envelope.attribution ?? null,
        // first-class abstain marker is part of the --json contract.
        abstain: envelope.metadata.abstain ?? null,
        // resolved query-level vertical spec (repo defaults ride on the
        // retrieval.vertical.pre audit event).
        vertical: vertical ?? null,
        // draft: arm-level provenance snapshot — env-gated
        // (ANS_ARM_SNAPSHOT=1) because it is eval-channel data, not the
        // default --json contract. The paired delta runner reads
        // fusion.labels/lists for per-arm result sets (pre-truncation,
        // post-gate) instead of reverse-engineering arms out of fused rows.
        ...(process.env.ANS_ARM_SNAPSHOT === "1" ? { fusion: envelope.metadata?.fusion ?? null } : {}),
      };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return searchExitCode({ resultCount: envelope.results.length, abstain: !!envelope.metadata.abstain, failOnAbstain });
    }

    console.log("ans search: " + JSON.stringify({ query: queryClean, mode }));
    console.log("---");

    // First-class abstain — one structured line, not an error.
    const abstain = envelope.metadata.abstain;
    if (abstain) {
      console.log(formatAbstainLine(abstain));
      console.log("---");
      console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
      if (envelope.metadata.providersFailed.length > 0) {
        console.log(formatProvidersFailedLine(envelope.metadata.providersFailed, credentialSources));
        printProviderFailureHints(envelope.metadata);
      }
      // 这条分支不打 cancelled：宽限窗口要先攒够结果才武装，拒答的前提是结果池
      // 是空的，CLI 又不传调用方信号，所以这里的 cancelled 恒为空表。
      if (providerAbsentLine) console.log(providerAbsentLine);
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
    // print provider answers when present (unverified, provider-side).
    if (envelope.answers.length > 0) {
      console.log("Provider answers (unverified):");
      const pa = envelope.metadata.providerAnswers ?? [];
      for (const a of pa.length > 0 ? pa : envelope.answers.map(t => ({ provider: "unknown", text: t }))) {
        // answers pass through at full length on CLI; if terminal rendering needs
        // a cap, set ANSWER_CLI_TRUNCATE=N env-var. Default no truncation (D1: no silent truncation).
        const cap = Number(process.env.ANSWER_CLI_TRUNCATE);
        const truncated = Number.isFinite(cap) && cap > 0 && a.text.length > cap;
        const text = truncated ? a.text.slice(0, cap) + "..." : a.text;
        console.log("  [" + a.provider + "] " + text + (truncated ? " (truncated; unset ANSWER_CLI_TRUNCATE for full text)" : ""));
      }
      console.log("");
    }
    // CLI attribution rendering for TTY (mark/annotated Sources). --json exits earlier.
    if (envelope.attribution) {
      const { renderAttributionText } = await import("@anysearch-cli/kernel");
      console.log(renderAttributionText(envelope.attribution));
    }

    console.log("Providers queried: " + envelope.metadata.providersQueried.join(", "));
    if (envelope.metadata.providersFailed.length > 0) {
      console.log(formatProvidersFailedLine(envelope.metadata.providersFailed, credentialSources));
      printProviderFailureHints(envelope.metadata);
    }
    const cancelledLine = formatProvidersCancelledLine(envelope.metadata.providersCancelled);
    if (cancelledLine) console.log(cancelledLine);
    if (providerAbsentLine) console.log(providerAbsentLine);
    console.log("Results: " + envelope.results.length);
    console.log("Elapsed: " + envelope.metadata.elapsedMs + "ms");

    return searchExitCode({ resultCount: envelope.results.length, abstain: false, failOnAbstain });
  } catch (e: any) {
    // A refused reservation never reached a provider: name the budget stop
    // instead of reporting it as an upstream error.
    if (isTaskBudgetRejectedError(e)) {
      process.stderr.write("ans search: stopped by this run's task budget — " + e.message + "\n");
      return 1;
    }
    console.error("ans search error: " + e.message);
    // All-absent arm case (#180): with every enabled arm failing construction
    // the kernel engine throws "No providers registered" (pinned contract,
    // engine.test.ts) before any envelope exists, so the runtime chain lines
    // above never render. The construction-absence note is the self-service
    // diagnostic for exactly this case — stderr, so the --json stdout contract
    // stays pure even on the error path.
    if (providerAbsentLine) console.error(providerAbsentLine);
    return 1;
  }
}
