// ans consolidate - turn episode records into semantic memories (Phase-3 CLI).
// LLM summarize seam is assembled here via kernel createLlmSession; fidelity gate via
// kernel classifyClaim. Fail-open: missing LLM config -> dry-run with llmUnavailable counts.

import { createLlmSession, createConsolidationSeams, resolveDbPath } from "@anysearch-cli/kernel";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface ConsolidateStore {
  consolidateMemory(opts?: {
    dryRun?: boolean;
    limit?: number;
    sessionIds?: string[];
    memoryIds?: number[];
    allowSingleEvidence?: boolean;
  }): Promise<{
    dryRun: boolean; clustersScanned: number; clustersTriggered: number;
    llmUnavailable: number; gateRejected: number; add: number; noop: number; update: number;
    skip: number; conflict: number;
    staleUpdates?: number; verifyRejected?: number;
    retriedAfterStale?: number; concurrentConflicts?: number;
    staleDetails?: Array<{ entity?: string; oldId: number; expected: string; current: string | null; candidate?: string }>;
    conflictDetails?: Array<{
      entity: string; oldId: number; expected: string; current: string; candidate: string;
      candidateEvidence: Array<{ title: string; snippet: string; url: string }>;
      currentEvidence: Array<{ title: string; snippet: string; url: string }>;
      reason?: string; followUp?: string;
    }>;
    verifyDetails?: Array<{
      oldId: number; oldContent: string; candidate: string;
      evidence: Array<{ title: string; snippet: string; url: string }>;
      sameFact: boolean; reliable: boolean;
      relation?: "same" | "correction" | "different" | "unclear";
      reason?: string; followUp?: string;
    }>;
    verifiedCorrections?: Array<{
      oldId: number; oldContent: string; candidate: string;
      evidence: Array<{ title: string; snippet: string; url: string }>;
      sameFact: boolean; reliable: boolean;
      relation?: "same" | "correction" | "different" | "unclear";
      reason?: string;
    }>;
    updates: Array<{ oldId: number; newId: number; retiredEpisodeIds: number[] }>;
    retiredEpisodeIds: number[];
    summariesNeedingRefresh: string[];
    semanticIds: number[];
  }>;
}

function help(): string {
  return [
    "ans consolidate - turn episode records into semantic memories ",
    "",
    "Usage: ans consolidate [--dry-run|--apply] [--limit N] [--session ID]... [--memory ID]... [--single-evidence]",
    "",
    "Episodes are clustered by entity; clusters meeting the deterministic trigger are summarized",
    "through the configured LLM (ANS_LLM_PROVIDER/MODEL, optional ANS_LLM_BASE_URL+ANS_LLM_API),",
    "gated per-claim against source evidence, then written to semantic_memories (RRF sixth arm).",
    "--session / --memory restrict the run to those episodes (repeatable).",
    "An explicit scope is required: with neither flag the command refuses to run,",
    "so a typo cannot turn into a full-archive consolidation.",
    "--single-evidence lets one contradicting episode correct a live semantic memory; it can",
    "update, never add.",
    "--dry-run runs inside a rolled-back transaction (exact prediction, no writes). Default: --apply.",
    "Without an LLM configured the run reports llmUnavailable clusters and writes nothing (exit 1).",
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
  let allowSingleEvidence = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" || a === "--session" || a === "--memory") { i++; continue; }
    if (a === "--single-evidence") { allowSingleEvidence = true; continue; }
    if (a !== "--dry-run" && a !== "--apply") {
      process.stderr.write("ans consolidate: unknown flag " + a + "\n");
      return 2;
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1] !== undefined) sessionIds.push(args[++i]!);
    else if (args[i] === "--memory") {
      const raw = args[i + 1];
      const id = Number(raw);
      if (raw === undefined || !Number.isInteger(id) || id < 1) {
        process.stderr.write("ans consolidate: --memory must be a positive integer id\n");
        return 2;
      }
      memoryIds.push(id);
      i++;
    }
  }
  if (args.includes("--session") && sessionIds.length === 0) {
    process.stderr.write("ans consolidate: --session requires an id\n");
    return 2;
  }
  // Q18: a missing scope must be an error, not a full-archive run.
  if (sessionIds.length === 0 && memoryIds.length === 0) {
    process.stderr.write("ans consolidate: an explicit scope is required; pass --session ID or --memory ID (full-archive runs are refused).\n");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    process.stderr.write("ans consolidate: --limit must be a positive integer\n");
    return 2;
  }

  // LLM summarize seam (fail-open when unconfigured). Layered config (#108):
  // --llm.* flag > ANS_LLM_* env > .anysearch/config.toml > ~/.anysearch-cli/config.toml.
  // A baseUrl without api is warned by the loader and fail-closed by createLlmSession.
  const llmCfg = resolveLlmConfig({ flags: llmFlags });
  const providerName = llmCfg.provider;
  const modelName = llmCfg.model;

  let seams: ReturnType<typeof createConsolidationSeams> | undefined;
  if (providerName && modelName) {
    try {
      const session = await createLlmSession({
        provider: providerName, model: modelName, baseUrl: llmCfg.baseUrl, api: llmCfg.api,
        apiKey: llmCfg.apiKey,
      });
      // Shared with MCP ans_chat operation=consolidate — one implementation of
      // the summarize seam and the fidelity gate for both entry points.
      seams = createConsolidationSeams(session);
    } catch (e) {
      process.stderr.write("[warn] LLM init failed (" + (e as Error).message + "); clusters will report llmUnavailable\n");
    }
  } else {
    process.stderr.write("[warn] LLM provider/model not configured (env, config files, or --llm.* flags); consolidation will report llmUnavailable\n");
  }

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteSessionStore(dbPath, {
    consolidateSummarize: seams?.summarize,
    consolidateClassify: seams?.classify,
    consolidateVerify: seams?.verify,
  });

  const r = await store.consolidateMemory({
    dryRun,
    limit,
    ...(sessionIds.length > 0 ? { sessionIds } : {}),
    ...(memoryIds.length > 0 ? { memoryIds } : {}),
    ...(allowSingleEvidence ? { allowSingleEvidence } : {}),
  });
  process.stdout.write(
    "consolidate" + (dryRun ? " (dry-run)" : "") +
      ": scanned " + r.clustersScanned + " cluster(s), triggered " + r.clustersTriggered +
      ", add " + r.add + ", update " + r.update + ", skip " + r.skip +
      ", conflict " + r.conflict + ", failure " + r.llmUnavailable +
      (r.staleUpdates ? ", stale " + r.staleUpdates : "") +
      (r.verifyRejected ? ", verifyRejected " + r.verifyRejected : "") +
      (r.retriedAfterStale ? ", retried " + r.retriedAfterStale : "") +
      (r.concurrentConflicts ? ", unresolved " + r.concurrentConflicts : "") +
      " (llmUnavailable " + r.llmUnavailable + ", gateRejected " + r.gateRejected + ", noop " + r.noop + ")\n",
  );
  // Q18: the scope is required and is always echoed, never "full-archive".
  process.stdout.write(
    "scope: " + (sessionIds.length > 0 ? "session " + sessionIds.join(", ") : "memory " + memoryIds.join(", ")) + "\n",
  );
  if (r.semanticIds.length > 0) {
    process.stdout.write("semantic ids: " + r.semanticIds.join(", ") + "\n");
  }
  for (const u of r.updates) {
    process.stdout.write(
      "update: semantic " + u.oldId + " -> " + u.newId +
        " (retired materials: " + (u.retiredEpisodeIds.join(", ") || "none") + ")\n",
    );
  }
  for (const v of r.verifiedCorrections ?? []) {
    process.stdout.write(
      "verified correction: semantic " + v.oldId +
        " (sameFact=" + v.sameFact + ", reliable=" + v.reliable +
        (v.relation ? ", relation=" + v.relation : "") + ")\n" +
        "  old: " + v.oldContent + "\n" +
        "  candidate: " + v.candidate + "\n" +
        "  evidence: " + v.evidence.map((e) => e.url).join(", ") + "\n" +
        (v.reason ? "  reason: " + v.reason + "\n" : ""),
    );
  }
  for (const v of r.verifyDetails ?? []) {
    process.stdout.write(
      "verify rejected: semantic " + v.oldId + " (sameFact=" + v.sameFact + ", reliable=" + v.reliable +
        (v.relation ? ", relation=" + v.relation : "") + ")\n" +
        "  old: " + v.oldContent + "\n" +
        "  candidate: " + v.candidate + "\n" +
        "  evidence: " + v.evidence.map((e) => e.url).join(", ") + "\n" +
        (v.reason ? "  reason: " + v.reason + "\n" : "") +
        (v.followUp ? "  followUp: " + v.followUp + "\n" : ""),
    );
  }
  for (const c of r.conflictDetails ?? []) {
    process.stdout.write(
      "conflict unresolved: semantic " + c.oldId + " (" + c.entity + ")\n" +
        "  current: " + c.current + "\n" +
        "  candidate: " + c.candidate + "\n" +
        "  current evidence: " + (c.currentEvidence.map((e) => e.url).join(", ") || "none") + "\n" +
        "  candidate evidence: " + (c.candidateEvidence.map((e) => e.url).join(", ") || "none") + "\n" +
        (c.reason ? "  reason: " + c.reason + "\n" : "") +
        (c.followUp ? "  followUp: " + c.followUp + "\n" : ""),
    );
  }
  if (r.summariesNeedingRefresh.length > 0) {
    process.stdout.write("summaries paused (needs-refresh): " + r.summariesNeedingRefresh.join(", ") + "\n");
  }
  if (seams) {
    const u = seams.usage;
    process.stdout.write(
      "usage: consolidation calls " + u.calls + ", in " + u.inputTokens + ", out " + u.outputTokens +
        ", cacheRead " + u.cacheReadTokens + ", cacheWrite " + u.cacheWriteTokens +
        ", total " + u.totalTokens + ", costUsd " + u.costUsd + ", costBasis " + u.costBasis +
        (u.missing.length > 0 ? ", MISSING " + u.missing.join(" + ") : "") + "\n",
    );
  } else {
    process.stdout.write("usage: consolidation calls 0, costBasis not-called, MISSING consolidation usage + consolidation cache usage + consolidation cost\n");
  }
  return r.llmUnavailable > 0 && r.add === 0 && r.update === 0 ? 1 : 0;
}
