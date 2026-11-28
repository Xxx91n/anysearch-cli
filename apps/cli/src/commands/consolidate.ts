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
  taskBudgetMetering,
  wireTaskBudget,
  CONSOLIDATION_UNMETERED_TEXT,
  MISSING_CONSOLIDATION_USAGE,
  MISSING_CONSOLIDATION_CACHE,
  MISSING_CONSOLIDATION_COST,
  resolveDbPath,
  describeDomainFailure,
  describeDomainFallback,
  resolveDomainConstraint,
  type ConsolidationMetering,
} from "@anysearch-cli/kernel";
import {
  SqliteSessionStore,
  resolveConsolidateScope,
  ConsolidateScopeError,
  formatConsolidateScope,
  formatConsolidateMaterialFeed,
  formatConsolidateQuotes,
  toBudgetCaps,
  type BudgetConfig,
  type ConsolidateReport,
} from "@anysearch-cli/store";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { domainSearchDirs } from "../db";
import { currentCliTask } from "../cli-task-context";
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
    "Concurrent corrections: when another session replaced the same knowledge first,",
    "this run re-reads the current version and re-judges at most once. An already",
    "applied correction creates no second version; a still-needed one is re-merged",
    "onto the latest version. If that cannot be done, the conflict is reported with",
    "both sides' materials, the current content and the reason, and the run exits 1",
    "(the current knowledge is NOT replaced).",
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
    "Metering: this run is charged to its own task when the Active Domain declares",
    "[budget] caps — a memory list, one chat, or materials from several chats all bill",
    "the same run, so no single conversation is picked to pay for it. A refused call",
    "stops the run and is counted; anything already spent stays on the task's row.",
    "Only when no task budget can be attached and the domain declares none does it",
    "fall back to the old session form; then the output says why it ran unmetered",
    "(no owning session, several owners, no declared caps, or a failed budget setup)",
    "instead of implying a cap was enforced. A domain that DOES declare [budget] stops",
    "instead of falling back.",
    "",
    "Without an LLM configured the run reports llmUnavailable and writes nothing (exit 1).",
    "",
    "Per-material detail prints only what needs attention (a material got no room, was",
    "truncated, or was planned by section). --verbose prints every material and every",
    "quote block, which is what a full-archive run should not do by default.",
    "",
  ].join("\n");
}

// The same formatter is used by the CLI and its regression test: refusals
// must show the old knowledge that was deliberately kept live.
export function formatIncompleteCorrection(d: ConsolidateReport["incompleteDetails"][number]): string {
  return "correction incomplete (" + d.stage + "): knowledge " + d.oldId + " was NOT replaced" +
    (d.reason ? "; " + d.reason : "") + "\n" +
    "  old: " + d.oldContent + "\n" +
    "  candidate: " + d.candidate + "\n" +
    "  sources: " + d.evidence.map((e) => e.url).join(", ") + "\n";
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
  const KNOWN_FLAGS = new Set(["--session", "--memory", "--limit", "--dry-run", "--apply", "--single-evidence", "--verbose"]);
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
    if (a !== "--dry-run" && a !== "--apply" && a !== "--single-evidence" && a !== "--verbose") {
      process.stderr.write("ans consolidate: unknown flag " + a + "\n");
      return 2;
    }
  }

  const dryRun = args.includes("--dry-run");
  const allowSingleEvidence = args.includes("--single-evidence");
  const verbose = args.includes("--verbose");
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
  // --llm.* flag > ANS_LLM_* env > .ans/config.toml > ~/.ans/config.toml.
  // A baseUrl without api is warned by the loader and fail-closed by createLlmSession.
  const llmCfg = resolveLlmConfig({ flags: llmFlags });
  const providerName = llmCfg.provider;
  const modelName = llmCfg.model;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteSessionStore(dbPath);

  // Budget wiring (D4 / #304). The rule lives in the kernel so this path and
  // the MCP tool cannot answer "was this run charged?" differently.
  //
  // Design: this run is its own task, so the materials' provenance no longer
  // decides who pays. A memory list has no owning session, and several
  // --session owners used to leave the run unmetered; both now bill the task
  // this invocation registered, so no single chat is picked to pay for work
  // that spans chats. Registering the Active Domain's caps on that task is what
  // makes the cap real — a ledger whose row was never written passes every
  // reserve, so a run that skipped this would claim a cap it does not have.
  // #306: the same three-state answer `ans search` and `ans chat` ask for.
  // A declared domain that cannot be read stops the run; the convention
  // default being absent is a legal undeclared run with no caps to enforce.
  const active = resolveActiveDomain();
  const budgetConstraint = resolveDomainConstraint({
    name: active.name,
    declared: active.declared,
    dirs: domainSearchDirs(),
  });
  if (budgetConstraint.state === "failed" && budgetConstraint.fatal) {
    process.stderr.write("ans consolidate: " + describeDomainFailure(budgetConstraint) + "\n");
    return 1;
  }
  if (budgetConstraint.state === "failed") {
    process.stderr.write("[warn] " + describeDomainFallback(budgetConstraint) + "\n");
  }
  const domainForBudget = budgetConstraint.state === "established" ? budgetConstraint.schema : undefined;
  // #304: a declared [budget] that cannot be established stops before any
  // model call. Falling back to the session form here would be exactly the
  // "keep going unmetered" the spec forbids for a declared constraint. The
  // session form below stays only for the no-task fallback.
  const budgetWarn = (m: string): void => {
    process.stderr.write("[warn] " + m + "; consolidation runs unmetered\n");
  };
  const taskBudgetWiring = wireTaskBudget(store, currentCliTask()?.taskId, domainForBudget?.budget, {
    warn: budgetWarn,
  });
  if (taskBudgetWiring.taskBudgetFault) {
    process.stderr.write(
      "ans consolidate: this run's task budget could not be established — " +
        taskBudgetWiring.taskBudgetFault + "\nNo model call was sent and nothing was written.\n",
    );
    return 1;
  }
  const taskMetering = taskBudgetMetering(taskBudgetWiring);
  let metering: ConsolidationMetering;
  if (taskMetering) {
    metering = taskMetering;
  } else {
    // No task budget to bill (a broken registry / dispatch outside the CLI):
    // the old session form stands unchanged, and says why it is unmetered.
    metering = await resolveConsolidationMetering({
      store,
      scope,
      domain: domainForBudget,
      toCaps: (b) => toBudgetCaps(b as BudgetConfig),
      domainLabel: "consolidate",
      warn: budgetWarn,
    });
  }
  const budget = metering.metered ? metering.budget : undefined;

  // #277: the Active Domain's declared cross-script mappings take effect here,
  // before any material is clustered, so a pair the operator wrote down is in
  // force for this run. Applied once per run and idempotent.
  //
  // Not under --dry-run: that mode promises "nothing saved", and an alias (plus
  // the entity row and log row behind it) is a saved change like any other. The
  // dry-run preview still describes the mappings correctly, because the same
  // table is read again by the run itself.
  //
  // A skipped group is a real conflict (one name claimed by two objects) and is
  // reported by name: silently dropping it would leave the operator believing a
  // mapping they wrote is active.
  if (domainForBudget?.entityAliases && !dryRun) {
    const applied = store.applyDeclaredAliases(domainForBudget.entityAliases);
    for (const s of applied.skipped) {
      process.stderr.write("[warn] entityAliases." + s.group + " not applied: " + s.reason + "\n");
    }
    if (applied.applied > 0) {
      process.stdout.write("entity pairs declared: " + applied.applied + " alias(es) applied from the Active Domain\n");
    }
  } else if (domainForBudget?.entityAliases && dryRun) {
    process.stdout.write("dry-run: entityAliases mappings were NOT applied (nothing is saved in this mode)\n");
  }

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

  // #277: the cross-script entity judge rides the same run's seams, so its calls
  // are counted in the same usage block the operator already reads. Absent an
  // LLM it is simply unavailable, and the declared paths still work.
  const deps = seams
    ? {
        summarize: seams.summarize, classify: seams.classify, verify: seams.verify, verifyFinal: seams.verifyFinal,
        judgeEntityAlias: seams.judgeEntityAlias,
      }
    : undefined;

  let r: ConsolidateReport;
  try {
    r = await store.consolidateMemory(
      { dryRun, ...(limit !== undefined ? { limit } : {}), scope, ...(allowSingleEvidence ? { allowSingleEvidence: true } : {}) },
      // This run's own seams: the usage counter belongs to this invocation, so
      // it is passed in rather than parked on the store.
      deps,
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
      (r.duplicateMaterialSkipped > 0 ? ", duplicateMaterialSkipped " + r.duplicateMaterialSkipped : "") +
      (r.verifyRejected > 0 ? ", verifyRejected " + r.verifyRejected : "") +
      (r.correctionsIncomplete > 0 ? ", correctionsIncomplete " + r.correctionsIncomplete : "") +
      (r.summariesSuspended > 0 ? ", summariesSuspended " + r.summariesSuspended : "") +
      (r.conflicts > 0 ? ", conflicts " + r.conflicts : "") +
      (r.resolvedCollisions.length > 0 ? ", collisionsResolved " + r.resolvedCollisions.length : "") +
      (r.budgetRejected > 0 ? ", budgetRejected " + r.budgetRejected : "") +
      // The cluster material budget. Printed only when it mattered, so a
      // small run reads exactly as before.
      (r.clustersOverBudget > 0
        ? ", clusterTokenBudget " + r.clusterTokenBudget + ", clustersOverBudget " + r.clustersOverBudget
        : "") +
      (r.quotesMissing > 0 ? ", quotesMissing " + r.quotesMissing : "") +
      (r.quotesMalformed > 0 ? ", quotesMalformed " + r.quotesMalformed : "") +
      (r.noConclusion > 0 ? ", noConclusion " + r.noConclusion : "") +
      // #277: how the cross-script pass went. Printed only when it did
      // something, so a run over same-language material reads exactly as before.
      (r.crossScriptDeclared > 0 ? ", crossScriptDeclared " + r.crossScriptDeclared : "") +
      (r.crossScriptProposed > 0 ? ", crossScriptProposed " + r.crossScriptProposed + " (review: ans entity aliases --pending)" : "") +
      (r.crossScriptUndetermined > 0 ? ", crossScriptUndetermined " + r.crossScriptUndetermined : "") + "\n",
  );

  // The scope that was really used, not the one the caller thinks it passed.
  process.stdout.write("scope: " + formatConsolidateScope(r.scope) + "\n");
  // Dry-run says so before the detail, not after a thousand material lines.
  if (dryRun) {
    process.stdout.write(
      "dry-run: nothing saved. The counts describe the state read now; a concurrent write\n" +
        "before an apply can make the apply differ.\n",
    );
  }
  // Material detail: by default only what needs attention prints — a material
  // that got no room, was cut short, or was planned by section. `overBudget` is
  // a cluster flag, so it would print every material of an over-budget cluster
  // and defeat the filter on a full-archive run. --verbose prints them all.
  const notable = r.materialsFed.filter((m) => m.fedChars === 0 || m.truncated || m.sections.length > 0);
  for (const m of verbose ? r.materialsFed : notable) {
    process.stdout.write(formatConsolidateMaterialFeed(m) + "\n");
  }
  if (!verbose && notable.length < r.materialsFed.length) {
    process.stdout.write(
      "materials: " + r.materialsFed.length + " fed, " + notable.length +
        " shown (only those that need attention; --verbose lists every material and quote)\n",
    );
  }
  // The verbatim quotes the summarizer selected. They are not persisted in
  // semantic memory; the report is the only place they survive, so they print
  // only when the caller asked for the full report.
  if (verbose) {
    for (const q of r.quotes) {
      process.stdout.write(formatConsolidateQuotes(q) + "\n");
    }
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
  // #263 (D9): a summary built from the replaced fact stopped being injected.
  // Named per session and anchor so a caller can find the exact stale block;
  // its text and dependency list are still stored, which is why this says
  // "suspended" and not "deleted". In a dry-run nothing was committed.
  // A summary can depend ONLY on retired materials and never have read the
  // knowledge row whose correction triggered this, so "built from knowledge X"
  // would name a source it never had. What the id honestly is: the correction
  // that caused the suspension.
  for (const s of r.suspendedSummaries) {
    process.stdout.write(
      (dryRun ? "summary that would be suspended: " : "summary suspended: ") +
        "session " + s.sessionId + " anchor " + s.anchorId +
        " (suspended by the correction of knowledge " + s.triggerKnowledgeId + ")\n",
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
    process.stdout.write(formatIncompleteCorrection(d));
  }
  // Design: #262 (D11) — an unresolved collision between concurrent
  // corrections. Both sides travel back — the planned target, our candidate
  // and sources, the current live content, the other side's sources, the
  // reason, next steps. Neither side is deleted and write order is not a
  // verdict.
  for (const d of r.conflictDetails) {
    process.stdout.write(
      "concurrent correction conflict: planned knowledge " + d.plannedTargetId +
      ", current knowledge " + (d.currentTargetId ?? "none") + ", retries=" + d.retries + "\n" +
      "  we planned to replace: " + d.plannedContent + "\n" +
      "  our candidate: " + d.candidate + "\n" +
      "  our sources: " + d.evidence.map((e) => e.url).join(", ") + "\n" +
      "  current live content: " + d.currentContent + "\n" +
      "  current sources: " + d.currentEvidence.map((e) => e.url).join(", ") + "\n" +
      "  reason: " + d.reason + "\n" +
      "  next: " + d.followUp + "\n",
    );
  }
  // Design: #262 (D11) — a resolved collision is named too, so "the
  // correction landed after one re-judge" is visible rather than
  // indistinguishable from a normal run.
  for (const d of r.resolvedCollisions) {
    process.stdout.write(
      "collision resolved: " + (d.resolution === "re-merged"
        ? "knowledge " + d.targetId + " -> " + d.newId + " re-merged against the latest version"
        : "no new version; knowledge " + d.targetId + " already carries the correction") +
      " (re-judge retries=" + d.retries + ", sameFact=" + d.sameFact + ", reliable=" + d.reliable +
      (d.reason ? ", " + d.reason : "") + ")\n",
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
      "ans consolidate: stopped by this run's budget (" + r.budgetRejected +
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
        " correction(s) not completed (merge, re-judge, or final check); those rows keep their previous knowledge." +
        (r.update > 0 ? (r.dryRun ? " " + r.update + " other correction(s) would land." : " " + r.update + " other correction(s) did land.") : "") + "\n",
    );
    return 1;
  }
  // Design: #262 (D11) — an unresolved concurrent conflict is "not finished"
  // too: the caller's correction did not land and the current knowledge was
  // not replaced by this run. Both sides' evidence is printed above; exit 0
  // would read as success to an automated caller that only checks the code.
  // (Dry-run keeps this exit: the repo already treats a previewed withheld
  // correction as exit 1, and a previewed conflict is the same kind of
  // "this would not finish" fact.)
  if (r.conflicts > 0) {
    process.stderr.write(
      "ans consolidate: " + r.conflicts +
        " concurrent correction conflict(s) unresolved — this run did not replace the current knowledge; both sides' evidence is printed above.\n",
    );
    return 1;
  }
  // A cluster that answered without a conclusion wrote nothing, the same as a
  // missing model. It is counted separately so the operator looks in the right
  // place, but the exit code still says "this run finished nothing".
  return (r.llmUnavailable > 0 || r.noConclusion > 0) && r.add === 0 && r.update === 0 ? 1 : 0;
}
