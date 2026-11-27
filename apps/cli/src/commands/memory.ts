// ans memory — memory_embeddings maintenance.
// backfill-vectors: idempotent re-embed of retrieval_results rows missing a vector.
// Serves 3 roles: pendingVectors cleanup, pre- upgrade backfill, future model re-embed.

import { createEngineForActiveDomain } from "../db";

interface MemoryStore {
  vectorTelemetry?(): Promise<{ absent: boolean }>;
  backfillEmbeddings(dryRun?: boolean, limit?: number): Promise<{ scanned: number; embedded: number; failed: number }>;
  backfillChunkVectors(dryRun?: boolean, limit?: number): Promise<{ scanned: number; embedded: number; failed: number; rebuiltPages: number; rebuildFailed: number }>;
  // reversible active forgetting (archive + undo).
  scanArchive(opts?: { limit?: number }): Array<{ id: number; entity: string | null; reason: string }>;
  applyArchive(ids?: number[], opts?: { dryRun?: boolean }): { dryRun: boolean; requested: number; archived: number; skipped: number; logIds: number[]; undoableTotal: number };
  undoArchive(logId: number): { ok: boolean; memoryId?: number };
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans memory — memory_embeddings maintenance",
      "",
      "Commands:",
      "  backfill-vectors [--dry-run] [--limit N]  Embed rows missing a vector and repair page-body blocks (idempotent)",
      " forget [--dry-run|--apply] [--limit N] Archive stale, never-accessed episodes",
      "  forget --undo <logId>                   Restore an archived episode (idempotent)",
      "",
      "--dry-run reports counts without writing; --limit caps pages/blocks per run. Exit 0 on full completion,",
      "exit 1 when a row or block failed to embed, or a page could not be rebuilt.",
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
    const eng = createEngineForActiveDomain();
    const store = eng.store as unknown as MemoryStore;
    const r = await store.backfillEmbeddings(dryRun, dryRun ? undefined : limit);
    const chunks = await store.backfillChunkVectors(dryRun, dryRun ? undefined : limit);
    if (dryRun) {
      process.stdout.write("dry-run: the whole archive has " + r.scanned + " row(s) pending embedding; " +
        chunks.rebuiltPages + " page(s) missing chunks; " + chunks.scanned +
        " block(s) pending embedding (no writes; --limit ignored)\n");
      return 0;
    }
    process.stdout.write("backfilled" + r.embedded + "/" + r.scanned + " vector(s)" + (r.failed > 0 ? " (" + r.failed + " failed)" : "") + "\n");
    process.stdout.write("chunk index: rebuilt " + chunks.rebuiltPages + " page(s); backfilled " +
      chunks.embedded + "/" + chunks.scanned + " block vector(s)" +
      (chunks.failed > 0 ? " (" + chunks.failed + " failed)" : "") +
      (chunks.rebuildFailed > 0 ? " (" + chunks.rebuildFailed + " page(s) not rebuilt)" : "") + "\n");
    if (chunks.rebuildFailed > 0) {
      process.stderr.write("hint: " + chunks.rebuildFailed + " page(s) could not be rebuilt; retry ans memory backfill-vectors.\n");
    }
    if (r.failed > 0 || chunks.failed > 0) {
      const telemetry = store.vectorTelemetry ? await store.vectorTelemetry() : undefined;
      process.stderr.write(
        telemetry?.absent
          ? "hint: @anysearch-cli/embedding is not installed; install it (npm i -g @anysearch-cli/embedding) and rerun ans memory backfill-vectors.\n"
          : "hint: embedding failed — the model downloads on first use; check huggingface.co reachability " +
            "and any proxy/firewall, or pre-seed the cache dir (ANYSEARCH_MODEL_CACHE, default ~/.ans/models) " +
            "from a connected host; run ans doctor to confirm the vector arm is present.\n"
      );
    }
    if (r.failed > 0 || chunks.failed > 0 || chunks.rebuildFailed > 0) return 1;
    return 0;
  }


  if (sub === "forget") {
    const eng = createEngineForActiveDomain();
    const store = eng.store as unknown as MemoryStore;
    const ui = args.indexOf("--undo");
    if (ui >= 0) {
      const logId = Number(args[ui + 1]);
      if (!Number.isInteger(logId) || logId < 1) {
        process.stderr.write("ans memory forget --undo: logId must be a positive integer\n");
        return 2;
      }
      const r = store.undoArchive(logId);
      process.stdout.write(r.ok ? "restored memory" + r.memoryId + " from archive_log" + logId + "\n" : "nothing to undo for archive_log" + logId + "\n");
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
