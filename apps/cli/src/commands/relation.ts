// ans relation: KG-lite edge inspection + idempotent backfill (ADR-0035 D6/D7).
// Subcommands: list [--entity N] [--limit N] | backfill-relations [--apply] [--batch N] [--from-id N] [--limit N] [--reprocess]

import { createEngine } from "../composition";
import type { RelationRow, BackfillRelationsResult } from "@anysearch/store";

interface RelationStore {
  listRelations(opts?: { entity?: string; limit?: number }): Promise<RelationRow[]>;
  backfillRelations(opts: { apply: boolean; batch?: number; fromId?: number; limit?: number; reprocess?: boolean; fullRefresh?: boolean }): Promise<BackfillRelationsResult>;
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans relation — entity relation edges (KG-lite fifth arm, ADR-0035)",
      "",
      "Commands:",
      "  list [--entity N] [--limit N]   List live relation edges (optionally filtered by entity name)",
      "  backfill-relations              Dry-run report of edges the rule layer would extract (default)",
      "    [--apply]                     Actually write edges (idempotent; reruns supersede)",
      "    [--batch N] [--from-id N] [--limit N]  Keyset pagination controls",
      "    [--reprocess]                 Re-extract rows whose rules_version is older (supersede, never DELETE)",
      "    [--full-refresh]              Rebuild the edges table from scratch (dbt full-refresh safety net, r87; mutually exclusive with --from-id/--limit)",
      "",
      "Exit codes: 0 success / 1 runtime error / 2 usage error.",
      "Run backfills during a quiet window: WAL single-writer, no concurrent MCP traffic.",
      "",
    ].join("\n") + "\n"
  );
}

function intOpt(args: string[], flag: string, usage: string): { value?: number; error?: string } {
  const i = args.indexOf(flag);
  if (i < 0) return {};
  const raw = args[i + 1];
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n <= 0) return { error: flag + " must be a positive integer (" + usage + ")" };
  return { value: n };
}

export async function runRelation(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") { printHelp(); return 0; }
  const eng = createEngine(process.env.ANS_DOMAIN || "default");
  const store = eng.store as unknown as RelationStore;

  if (sub === "list") {
    const rest = args.slice(1);
    const limit = intOpt(rest, "--limit", "relation list");
    if (limit.error) { process.stderr.write("ans relation list: " + limit.error + "\n"); return 2; }
    const ei = rest.indexOf("--entity");
    const entity = ei >= 0 ? rest[ei + 1] : undefined;
    if (ei >= 0 && (!entity || entity.startsWith("--"))) { process.stderr.write("ans relation list: --entity needs a name\n"); return 2; }
    const rows = await store.listRelations({ entity, limit: limit.value });
    if (rows.length === 0) { process.stdout.write("(no live relation edges)\n"); return 0; }
    for (const r of rows) {
      process.stdout.write("#" + r.id + "  " + r.sourceName + " --" + r.relation + "--> " + r.targetName + "  conf=" + r.confidence + " ep=" + (r.episodeMemoryId ?? "-") + " v" + r.rulesVersion + "\n");
    }
    return 0;
  }

  if (sub === "backfill-relations") {
    const rest = args.slice(1);
    const apply = rest.includes("--apply");
    const reprocess = rest.includes("--reprocess");
    const fullRefresh = rest.includes("--full-refresh");
    const batch = intOpt(rest, "--batch", "backfill-relations");
    const fromId = intOpt(rest, "--from-id", "backfill-relations");
    const limit = intOpt(rest, "--limit", "backfill-relations");
    const bad = batch.error || fromId.error || limit.error;
    if (bad) { process.stderr.write("ans relation backfill-relations: " + bad + "\n"); return 2; }
    if (fullRefresh && (fromId.value !== undefined || limit.value !== undefined)) {
      process.stderr.write("ans relation backfill-relations: --full-refresh cannot be combined with --from-id/--limit\n");
      return 2;
    }
    const r = await store.backfillRelations({
      apply, reprocess, fullRefresh, batch: batch.value, fromId: fromId.value, limit: limit.value,
    });
    const mode = r.apply ? "APPLY" : "DRY-RUN (use --apply to write)";
    process.stdout.write(
      "backfill-relations " + mode + ": scanned=" + r.scanned + " written=" + r.written + " dedupSkipped=" + r.dedupSkipped + " schemaRejected=" + r.schemaRejected + " lastId=" + r.lastId + "\n"
    );
    return 0;
  }

  process.stderr.write("ans relation: unknown subcommand " + sub + "\n");
  printHelp();
  return 2;
}
