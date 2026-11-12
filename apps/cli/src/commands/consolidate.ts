// ans consolidate - turn episode records into semantic memories.
//
// Both entry points share their rules with the MCP tool (`ans_chat` with
// operation=consolidate), so the two cannot drift apart:
// - the scope rule and its errors come from the store (resolveConsolidateScope),
// - the summarize seam, the fidelity gate and the usage ledger come from the
//   kernel (createConsolidationSeams).
//
// Fail-open on configuration, fail-closed on scope: a missing LLM still runs
// and reports llmUnavailable, while a missing scope is a usage error and never
// widens into a full-archive run.

import {
  createLlmSession,
  createConsolidationSeams,
  isConsolidationBudgetError,
  resolveConsolidationMetering,
  CONSOLIDATION_UNMETERED_TEXT,
  MISSING_CONSOLIDATION_USAGE,
  MISSING_CONSOLIDATION_CACHE,
  MISSING_CONSOLIDATION_COST,
  resolveDbPath,
} from "@anysearch-cli/kernel";
import {
  SqliteSessionStore,
  resolveConsolidateScope,
  ConsolidateScopeError,
  formatConsolidateScope,
  loadDomainByNameIn,
  toBudgetCaps,
  type BudgetConfig,
  type ConsolidateReport,
} from "@anysearch-cli/store";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { domainSearchDirs } from "../db";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function help(): string {
  return [
    "ans consolidate - turn stored research materials into long-term knowledge",
    "",
    "Usage: ans consolidate [--session ID | --memory ID]... [--single-evidence] [--dry-run|--apply] [--limit N]",
    "",
    "An explicit scope is required. --session ID reads that session's materials;",
    "--memory ID reads exactly the listed materials (repeatable). Both flags may be",
    "given, but the memory list stays the scope: the session never widens it. With",
    "neither flag the command refuses to run instead of consolidating the whole archive.",
    "",
    "Materials are grouped by entity; a group that passes the existing batch threshold",
    "is summarized through the configured LLM (ANS_LLM_PROVIDER/MODEL, optionally",
    "ANS_LLM_BASE_URL + ANS_LLM_API + ANS_LLM_API_KEY), gated per claim against its own",
    "evidence, then written to semantic_memories as the sixth retrieval arm.",
    "",
    "--single-evidence lets ONE material correct an existing knowledge row even though",
    "it cannot pass the batch threshold. A lone material may only correct existing",
    "knowledge, never create a new long-term conclusion, and the correction must pass",
    "the same-fact check (same object, matter, scope and time) and the reliability",
    "check. A refused correction is reported with the old content, the candidate, its",
    "sources, the check's verdict and what to look into next; the materials stay.",
    "",
    "A correction that lands replaces only the corrected fact: the merged text keeps",
    "the old row's other facts, and a final content check runs before anything is",
    "written. When the merge fails, comes back empty or the final check fails, the",
    "replacement is withheld and the run reports the correction as incomplete (exit 1);",
    "the previous knowledge stays live.",
    "",
    "--dry-run runs the identical path inside a rolled-back transaction: nothing is",
    "saved (no knowledge, no material state, no version relation, no summary change).",
    "It can still call the model and cost money, and the preview describes the state it",
    "read - a concurrent write afterwards can change what an apply would do.",
    "Default: --apply.",
    "",
    "The run reports calls, input/output tokens, cache reads/writes and how the cost",
    "figure was obtained: not-called, unknown, a price estimate, or a server-returned",
    "figure. An unknown cost is never shown as zero. A mix of server-returned and",
    "estimated prices is reported as mixed.",
    "Metering: a run with exactly one --session is charged against that session when the",
    "Active Domain declares [budget] caps; a refused call stops the run and is counted.",
    "Otherwise the output says why it ran unmetered (no owning session, several owners,",
    "no declared caps, or a failed budget setup) instead of implying a cap was enforced.",
    "",
    "Without an LLM configured the run reports llmUnavailable and writes nothing (exit 1).",
    "",
  ].join("\n");
}

export async function runConsolidate(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "--help" || cmd === "-h") { process.stdout.write(help()); return 0; }
  const { flags: llmFlags, argv: args } = parseLlmFlags(argv);

  // One pass: reject unknown flags AND collect the scope values. Two loops let
  // a bad value hide behind a later good flag.
  //
  // Design: a value is only rejected as "missing" when the next token is one of
  // THIS command's own options. A session id may legitimately start with `--`
  // (the scope rule accepts any visible ASCII), and the old prefix test made the
  // CLI refuse handles the MCP entry accepts.
  const KNOWN_FLAGS = new Set(["--session", "--memory", "--limit", "--dry-run", "--apply", "--single-evidence"]);
  const sessionIds: string[] = [];
  const memoryIds: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit") { i++; continue; }
    if (a === "--session") {
      const value = args[i + 1];
      if (value === undefined || KNOWN_FLAGS.has(value)) {
        process.stderr.write("ans consolidate: --session requires an id\n");
        return 2;
      }
      sessionIds.push(value);
      i++;
      continue;
    }
    if (a === "--memory") {
      const raw = args[i + 1];
      const id = Number(raw);
      if (raw === undefined || !Number.isInteger(id) || id < 1) {
        process.stderr.write("ans consolidate: --memory must be a positive integer id (got " + JSON.stringify(raw) + ")\n");
        return 2;
      }
      memoryIds.push(id);
      i++;
      continue;
    }
    if (a !== "--dry-run" && a !== "--apply" && a !== "--single-evidence") {
      process.stderr.write("ans consolidate: unknown flag " + a + "\n");
      return 2;
    }
  }

  const dryRun = args.includes("--dry-run");
  const allowSingleEvidence = args.includes("--single-evidence");
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    process.stderr.write("ans consolidate: --limit must be a positive integer\n");
    return 2;
  }

  // Q18: the same scope rule the MCP tool applies. A missing or malformed scope
  // is a usage error (exit 2), never a full-archive run. Absent flags are passed
  // as absent (not as empty arrays): "the flag was not given" and "the list was
  // given empty" are different requests, and only the second is malformed.
  let scope: ReturnType<typeof resolveConsolidateScope>;
  try {
    scope = resolveConsolidateScope({
      ...(sessionIds.length > 0 ? { sessionIds } : {}),
      ...(memoryIds.length > 0 ? { memoryIds } : {}),
    });
  } catch (e) {
    if (e instanceof ConsolidateScopeError) {
      process.stderr.write("ans consolidate: " + e.message + "\n");
      return 2;
    }
    throw e;
  }

  // LLM summarize seam (fail-open when unconfigured). Layered config (#108):
  // --llm.* flag > ANS_LLM_* env > .anysearch/config.toml > ~/.anysearch-cli/config.toml.
  // A baseUrl without api is warned by the loader and fail-closed by createLlmSession.
  const llmCfg = resolveLlmConfig({ flags: llmFlags });
  const providerName = llmCfg.provider;
  const modelName = llmCfg.model;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteSessionStore(dbPath);

  // Budget wiring (D4). The rule lives in the kernel so this path and the MCP
  // tool cannot answer "was this run charged?" differently.
  //
  // Design: registering the Active Domain's caps here (not only at `ans chat`)
  // is what makes the cap real — the ledger's reserve passes for every session
  // that has no row, so a run that never registers one would claim a cap it
  // does not have.
  let domainForBudget: ReturnType<typeof loadDomainByNameIn> | undefined;
  try {
    domainForBudget = loadDomainByNameIn(process.env.ANS_DOMAIN || "default", domainSearchDirs());
  } catch (e) {
    // Same fail-open contract `ans chat` uses: a missing/broken domain leaves
    // the run unmetered, not broken. The metering result says so.
    process.stderr.write(
      "[warn] domain load failed for budget (" + (e instanceof Error ? e.message : String(e)) + "); consolidation runs unmetered\n",
    );
  }
  const metering = await resolveConsolidationMetering({
    store,
    scope,
    domain: domainForBudget,
    toCaps: (b) => toBudgetCaps(b as BudgetConfig),
    domainLabel: "consolidate",
    warn: (m) => process.stderr.write("[warn] " + m + "; consolidation runs unmetered\n"),
  });
  const budget = metering.metered ? metering.budget : undefined;

  let seams: ReturnType<typeof createConsolidationSeams> | undefined;
  if (providerName && modelName) {
    try {
      const session = await createLlmSession({
        provider: providerName, model: modelName, baseUrl: llmCfg.baseUrl, api: llmCfg.api,
        apiKey: llmCfg.apiKey,
      });
      seams = createConsolidationSeams(session, budget ? { budget } : {});
    } catch (e) {
      process.stderr.write("[warn] LLM init failed (" + (e as Error).message + "); clusters will report llmUnavailable\n");
    }
  } else {
    process.stderr.write("[warn] LLM provider/model not configured (env, config files, or --llm.* flags); consolidation will report llmUnavailable\n");
  }

  let r: ConsolidateReport;
  try {
    r = await store.consolidateMemory(
      { dryRun, ...(limit !== undefined ? { limit } : {}), scope, ...(allowSingleEvidence ? { allowSingleEvidence: true } : {}) },
      // This run's own seams: the usage counter belongs to this invocation, so
      // it is passed in rather than parked on the store.
      seams
        ? { summarize: seams.summarize, classify: seams.classify, verify: seams.verify, verifyFinal: seams.verifyFinal }
        : undefined,
    );
  } catch (e) {
    if (isConsolidationBudgetError(e)) {
      // A store-level refusal is not a report: the run stopped before any cluster
      // finished. Say so and exit non-zero instead of printing an empty summary.
      process.stderr.write("ans consolidate: " + e.message + "\n");
      return 1;
    }
    throw e;
  }

  process.stdout.write(
    "consolidate" + (dryRun ? " (dry-run)" : "") +
      ": scanned " + r.clustersScanned + " cluster(s), triggered " + r.clustersTriggered +
      ", llmUnavailable " + r.llmUnavailable + ", gateRejected " + r.gateRejected +
      ", add " + r.add + ", noop " + r.noop + ", update " + r.update +
      (r.singleEvidenceSkipped > 0 ? ", singleEvidenceSkipped " + r.singleEvidenceSkipped : "") +
      (r.supersededClusterSkipped > 0 ? ", supersededClusterSkipped " + r.supersededClusterSkipped : "") +
      (r.verifyRejected > 0 ? ", verifyRejected " + r.verifyRejected : "") +
      (r.correctionsIncomplete > 0 ? ", correctionsIncomplete " + r.correctionsIncomplete : "") +
      (r.budgetRejected > 0 ? ", budgetRejected " + r.budgetRejected : "") + "\n",
  );

  // The scope that was really used, not the one the caller thinks it passed.
  process.stdout.write("scope: " + formatConsolidateScope(r.scope) + "\n");
  if (dryRun) {
    process.stdout.write(
      "dry-run: nothing saved. The counts describe the state read now; a concurrent write\n" +
        "before an apply can make the apply differ.\n",
    );
  }
  if (r.semanticIds.length > 0) {
    process.stdout.write("semantic ids: " + r.semanticIds.join(", ") + "\n");
  }
  // Knowledge that lived outside the selected materials can still be replaced
  // by a reliable correction. Say so per row: "only the selected materials
  // moved" must never be something the caller has to assume.
  for (const u of r.updates.filter((x) => !x.withinScope)) {
    process.stdout.write(
      "update outside scope: knowledge " + u.oldId + " -> " + u.newId +
        " (replaced; its materials outside this scope: " + u.outsideScopeMaterialIds.join(", ") + ")\n",
    );
  }
  // A landed correction says WHY it was accepted, so "same fact, reliable,
  // explicit correction" is visible rather than a keyword hit.
  //
  // In a dry-run this word must not be "verified": the write was rolled back,
  // so nothing landed. The preview keeps the same information, labelled as what
  // it is — a correction that WOULD land.
  for (const c of r.verifiedCorrections) {
    process.stdout.write(
      (dryRun ? "correction that would land: knowledge " : "verified correction: knowledge ") + c.oldId +
        " sameFact=" + c.sameFact + " reliable=" + c.reliable +
        (c.relation ? " relation=" + c.relation : "") +
        (c.reason ? " (" + c.reason + ")" : "") + "\n",
    );
  }
  // D6: a refused correction hands the caller everything needed to keep
  // investigating — old content, the candidate, its sources, the check's
  // verdict and reason, and what to look into next. The materials stay.
  for (const d of r.verifyDetails) {
    process.stdout.write(
      "correction refused: knowledge " + d.oldId +
        " sameFact=" + d.sameFact + " reliable=" + d.reliable +
        (d.relation ? " relation=" + d.relation : "") + "\n" +
        "  old: " + d.oldContent + "\n" +
        "  candidate: " + d.candidate + "\n" +
        "  sources: " + d.evidence.map((e) => e.url).join(", ") + "\n" +
        (d.reason ? "  reason: " + d.reason + "\n" : "") +
        "  next: " + d.followUp + "\n",
    );
  }
  // D7: a withheld replacement is named as incomplete — which stage failed and
  // why, with the same evidence a retry would need. The old knowledge is live.
  for (const d of r.incompleteDetails) {
    process.stdout.write(
      "correction incomplete (" + d.stage + "): knowledge " + d.oldId + " was NOT replaced" +
        (d.reason ? "; " + d.reason : "") + "\n" +
        "  candidate: " + d.candidate + "\n" +
        "  sources: " + d.evidence.map((e) => e.url).join(", ") + "\n",
    );
  }

  if (seams) {
    const u = seams.usage;
    process.stdout.write(
      "usage: consolidation calls " + u.calls + ", in " + u.inputTokens + ", out " + u.outputTokens +
        ", cacheRead " + u.cacheReadTokens + ", cacheWrite " + u.cacheWriteTokens +
        ", total " + u.totalTokens +
        ", costUsd " + (u.costBasis === "unknown" || u.costBasis === "not-called" ? "unknown" : String(u.costUsd)) +
        ", costBasis " + u.costBasis +
        (u.missing.length > 0 ? ", MISSING " + u.missing.join(" + ") : "") + "\n",
    );
  } else {
    process.stdout.write(
      "usage: consolidation calls 0, cost unknown (not called), MISSING " +
        [MISSING_CONSOLIDATION_USAGE, MISSING_CONSOLIDATION_CACHE, MISSING_CONSOLIDATION_COST].join(" + ") + "\n",
    );
  }
  if (!metering.metered) {
    process.stdout.write("budget: unmetered — " + CONSOLIDATION_UNMETERED_TEXT[metering.reason] + ".\n");
  }

  // Design: any budget refusal makes the run incomplete, so it must not exit 0.
  // The partial-work case matters too — an earlier cluster may have written
  // knowledge before a later one was refused, and exiting 0 there would tell an
  // automated caller the whole scope was handled. The report above already
  // shows what landed; the exit code carries "not finished".
  if (r.budgetRejected > 0) {
    process.stderr.write(
      "ans consolidate: stopped by the session budget (" + r.budgetRejected +
        " call(s) refused); " +
        (r.add + r.update === 0 ? "nothing was written." : "the rest of the scope was not processed.") + "\n",
    );
    return 1;
  }
  // A withheld correction is the same kind of "not finished": the caller asked
  // for a correction and it did not land. The previous knowledge stays live and
  // the report says which stage failed, but exit 0 would read as success to an
  // automated caller that only checks the code.
  if (r.correctionsIncomplete > 0) {
    process.stderr.write(
      "ans consolidate: " + r.correctionsIncomplete +
        " correction(s) not completed (merge or final check); those rows keep their previous knowledge." +
        (r.update > 0 ? (r.dryRun ? " " + r.update + " other correction(s) would land." : " " + r.update + " other correction(s) did land.") : "") + "\n",
    );
    return 1;
  }
  return r.llmUnavailable > 0 && r.add === 0 && r.update === 0 ? 1 : 0;
}
