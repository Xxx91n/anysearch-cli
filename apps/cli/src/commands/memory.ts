// ans memory — memory_embeddings maintenance (ADR-0033 D6).
// backfill-vectors: idempotent re-embed of retrieval_results rows missing a vector.
//   Serves 3 roles: pendingVectors cleanup, pre-ADR-0033 upgrade backfill, future model re-embed.

import { createEngine } from "../composition";

interface MemoryStore {
  backfillEmbeddings(dryRun?: boolean, limit?: number): Promise<{ scanned: number; embedded: number; failed: number }>;
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans memory — memory_embeddings maintenance (ADR-0033)",
      "",
      "Commands:",
      "  backfill-vectors [--dry-run] [--limit N]  Embed rows missing a vector (idempotent)",
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
    const eng = createEngine(process.env.ANS_DOMAIN || "default");
    const store = eng.store as unknown as MemoryStore;
    const r = await store.backfillEmbeddings(dryRun, limit);
    if (dryRun) {
      process.stdout.write("dry-run: " + r.scanned + " row(s) pending embedding (no writes)\n");
      return 0;
    }
    process.stdout.write("backfilled " + r.embedded + "/" + r.scanned + " vector(s)" + (r.failed > 0 ? " (" + r.failed + " failed)" : "") + "\n");
    return r.failed > 0 ? 1 : 0;
  }

  process.stderr.write("ans memory: unknown subcommand '" + sub + "'\n");
  printHelp();
  return 2;
}
