// ans memory — memory_embeddings maintenance (ADR-0033 D6).
// backfill-vectors: idempotent re-embed of retrieval_results rows missing a vector.
//   Serves 3 roles: pendingVectors cleanup, pre-ADR-0033 upgrade backfill, future model re-embed.

import { createPersistentEngine } from "../db";

interface MemoryStore {
  backfillEmbeddings(dryRun?: boolean, limit?: number): Promise<{ scanned: number; embedded: number; failed: number }>;
  // ADR-0037 D5: reversible active forgetting (archive + undo).
  scanArchive(opts?: { limit?: number }): Array<{ id: number; entity: string | null; reason: string }>;
  applyArchive(ids?: number[], opts?: { dryRun?: boolean }): { dryRun: boolean; requested: number; archived: number; skipped: number; logIds: number[]; undoableTotal: number };
  undoArchive(logId: number): { ok: boolean; memoryId?: number };
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans memory — memory_embeddings maintenance (ADR-0033)",
      "",
      "Commands:",
      "  backfill-vectors [--dry-run] [--limit N]  Embed rows missing a vector (idempotent)",
      "  forget [--dry-run|--apply] [--limit N]  Archive stale, never-accessed episodes (ADR-0037 D5)",
      "  forget --undo <logId>                   Restore an archived episode (idempotent)",
      "",
      "--dry-run reports counts without writing; --limit caps the scan. Exit 0 on full completion,",
      "exit 1 when any row failed to embed (circuit breaker / model unavailable).",
      "",
    ].join("\n") + "\n"
  );
}

export async function runMemory(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") { printHelp(); return 0; }

  if (sub === "backfill-vectors") {
    const dryRun = args.includes("--dry-run");
    const li = args.indexOf("--limit");
    const limit = li >= 0 ? Number(args[li + 1]) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      process.stderr.write("ans memory backfill-vectors: --limit must be a positive integer\n");
      return 2;
    }
    const eng = createPersistentEngine(process.env.ANS_DOMAIN || "default");
    const store = eng.store as unknown as MemoryStore;
    const r = await store.backfillEmbeddings(dryRun, limit);
    if (dryRun) {
      process.stdout.write("dry-run: " + r.scanned + " row(s) pending embedding (no writes)\n");
      return 0;
    }
    process.stdout.write("backfilled " + r.embedded + "/" + r.scanned + " vector(s)" + (r.failed > 0 ? " (" + r.failed + " failed)" : "") + "\n");
    // R71 T1 (ADR-0072, spike finding d): a failed row means the embedding arm
    // could not produce a vector — first use downloads the model, so the cause
    // is almost always reachability. Point at the actionable knobs instead of
    // leaving a bare count (npm arm transcript: raw ENOTDIR gave no guidance).
    if (r.failed > 0) {
      process.stderr.write(
        "hint: embedding failed — the model downloads on first use; check huggingface.co reachability " +
        "and any proxy/firewall, or pre-seed the cache dir (ANYSEARCH_MODEL_CACHE, default ~/.anysearch/models) " +
        "from a connected host; run ans doctor to confirm the vector arm is present.\n"
      );
      return 1;
    }
    return 0;
  }


  if (sub === "forget") {
    const eng = createPersistentEngine(process.env.ANS_DOMAIN || "default");
    const store = eng.store as unknown as MemoryStore;
    const ui = args.indexOf("--undo");
    if (ui >= 0) {
      const logId = Number(args[ui + 1]);
      if (!Number.isInteger(logId) || logId < 1) {
        process.stderr.write("ans memory forget --undo: logId must be a positive integer\n");
        return 2;
      }
      const r = store.undoArchive(logId);
      process.stdout.write(r.ok ? "restored memory " + r.memoryId + " from archive_log " + logId + "\n" : "nothing to undo for archive_log " + logId + "\n");
      return r.ok ? 0 : 1;
    }
    const dryRun = args.includes("--dry-run") || !args.includes("--apply");
    const li = args.indexOf("--limit");
    const limit = li >= 0 ? Number(args[li + 1]) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      process.stderr.write("ans memory forget: --limit must be a positive integer\n");
      return 2;
    }
    const candidates = store.scanArchive({ limit });
    if (candidates.length === 0) { process.stdout.write("no archive candidates\n"); return 0; }
    const r = store.applyArchive(candidates.map((c) => c.id), { dryRun });
    process.stdout.write((dryRun ? "dry-run archive: " : "applied archive: ") + r.archived + " archived, " + r.skipped + " skipped (" + (dryRun ? "no writes" : "undoable: " + r.undoableTotal) + ")\n");
    for (const c of candidates.slice(0, 10)) process.stdout.write("  #" + c.id + " [" + (c.entity ?? "-") + "] " + c.reason + "\n");
    return 0;
  }
  process.stderr.write("ans memory: unknown subcommand '" + sub + "'\n");
  printHelp();
  return 2;
}
