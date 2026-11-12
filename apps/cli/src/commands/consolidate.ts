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
  resolveDbPath,
} from "@anysearch-cli/kernel";
import {
  SqliteSessionStore,
  resolveConsolidateScope,
  ConsolidateScopeError,
  type ConsolidateReport,
} from "@anysearch-cli/store";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function help(): string {
  return [
    "ans consolidate - turn stored research materials into long-term knowledge",
    "",
    "Usage: ans consolidate [--session ID | --memory ID]... [--dry-run|--apply] [--limit N]",
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
    "--dry-run runs the identical path inside a rolled-back transaction: nothing is",
    "saved (no knowledge, no material state, no version relation, no summary change).",
    "It can still call the model and cost money, and the preview describes the state it",
    "read - a concurrent write afterwards can change what an apply would do.",
    "Default: --apply.",
    "",
    "The run reports calls, input/output tokens, cache reads/writes and how the cost",
    "figure was obtained: not-called, unknown, a price estimate, or a server-returned",
    "figure. An unknown cost is never shown as zero. Budget caps from the Active Domain",
    "apply to these calls too; a refused call stops the run and is counted.",
    "",
    "Without an LLM configured the run reports llmUnavailable and writes nothing (exit 1).",
    "",
  ].join("\n");
}

export async function runConsolidate(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "--help" || cmd === "-h") { process.stdout.write(help()); return 0; }
  const { flags: llmFlags, argv: args } = parseLlmFlags(argv);

  // Reject unknown flags instead of silently running --apply.
  const sessionIds: string[] = [];
  const memoryIds: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" || a === "--session") { i++; continue; }
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
    if (a !== "--dry-run" && a !== "--apply") {
      process.stderr.write("ans consolidate: unknown flag " + a + "\n");
      return 2;
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        process.stderr.write("ans consolidate: --session requires an id\n");
        return 2;
      }
      sessionIds.push(value);
      i++;
    }
  }

  const dryRun = args.includes("--dry-run");
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

  // Budget wiring (D4). A CLI consolidation has no chat session of its own, so
  // the caps that apply are the ones registered for the scope session ids.
  // Without a scope session there is nothing to meter against; the usage block
  // says that instead of pretending the calls were free.
  const budget = scope.by === "session" && scope.sessionIds.length > 0
    ? { sessionId: scope.sessionIds[0]!, ledger: store.createBudgetLedger() }
    : undefined;

  let seams: ReturnType<typeof createConsolidationSeams> | undefined;
  if (providerName && modelName) {
    try {
      const session = await createLlmSession({
        provider: providerName, model: modelName, baseUrl: llmCfg.baseUrl, api: llmCfg.api,
        apiKey: llmCfg.apiKey,
      });
      seams = createConsolidationSeams(session, budget ? { budget } : {});
      store.setConsolidationSeams?.({
        summarize: seams.summarize,
        classify: seams.classify,
      });
    } catch (e) {
      process.stderr.write("[warn] LLM init failed (" + (e as Error).message + "); clusters will report llmUnavailable\n");
    }
  } else {
    process.stderr.write("[warn] LLM provider/model not configured (env, config files, or --llm.* flags); consolidation will report llmUnavailable\n");
  }

  let r: ConsolidateReport;
  try {
    r = await store.consolidateMemory({
      dryRun,
      ...(limit !== undefined ? { limit } : {}),
      scope,
      ...(scope.by === "memory" ? { requestedMaterials: memoryIds.length } : {}),
    });
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
      (r.budgetRejected > 0 ? ", budgetRejected " + r.budgetRejected : "") + "\n",
  );

  // The scope that was really used, not the one the caller thinks it passed.
  const s = r.scope;
  process.stdout.write(
    "scope: " + s.by +
      (s.by === "session" ? " " + s.sessionIds.join(", ") : "") +
      (s.by === "memory" ? " " + s.memoryIds.join(", ") : "") +
      " (materials read " + s.materialsRead +
      (s.by === "memory" ? " of " + s.requestedMaterials + " requested" : "") + ")" +
      (s.sessionIdNotApplied ? "; sessionId not applied: the memory list is the scope" : "") + "\n",
  );
  if (dryRun) {
    process.stdout.write(
      "dry-run: nothing saved. The counts describe the state read now; a concurrent write\n" +
        "before an apply can make the apply differ.\n",
    );
  }
  if (r.semanticIds.length > 0) {
    process.stdout.write("semantic ids: " + r.semanticIds.join(", ") + "\n");
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
      "usage: consolidation calls 0, cost unknown (not called), MISSING consolidation usage + " +
        "consolidation cache usage + consolidation cost\n",
    );
  }
  if (!budget) {
    process.stdout.write(
      "budget: no scope session to meter against; these calls were not charged to a session cap.\n",
    );
  }

  return r.llmUnavailable > 0 && r.add === 0 && r.update === 0 ? 1 : 0;
}
