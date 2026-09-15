// ans entity: entity merge execution + candidate review belt (ADR-0032 D1-D4).
// Subcommands: merge <fromId> <toId> | unmerge <logId> | review [keep|drop <id>]

import { createPersistentEngine } from "../db";
import type { EntityReviewRow } from "@anysearch-cli/store";

interface EntityStore {
  combineEntities(fromId: number, toId: number): Promise<{ ok: boolean; logId?: number; error?: string }>;
  unmergeEntity(logId: number): Promise<{ ok: boolean; error?: string }>;
  undoEntityMerge(logId: number): boolean;
  listEntityReview(): Promise<EntityReviewRow[]>;
  resolveEntityReview(id: number, action: "keep" | "drop"): Promise<{ ok: boolean; error?: string }>;
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans entity — entity merge execution + review belt (ADR-0031/0032)",
      "",
      "Commands:",
      "  merge <fromId> <toId>   Merge entity fromId into toId (destructive redirect + snapshot)",
      "  unmerge <logId>         Undo a merge or alias log entry (bounded, snapshot-driven)",
      "  review                  List pending merge candidates (hit_count >= 2 = suggested)",
      "  review keep <id>        Confirm candidate: merge its entity into the target",
      "  review drop <id>        Reject candidate: keep both entities separate",
      "",
      "Guards: type gate (no cross-type merge); every merge writes a full snapshot;",
      "unmerge leaves an override record so the pair never auto-merges again (ADR-0032 D2).",
      "",
    ].join("\n") + "\n"
  );
}

export async function runEntity(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") { printHelp(); return 0; }
  const eng = createPersistentEngine(process.env.ANS_DOMAIN || "default");
  const store = eng.store as unknown as EntityStore;

  if (sub === "merge") {
    const from = Number(args[1]);
    const to = Number(args[2]);
    if (!Number.isInteger(from) || !Number.isInteger(to)) { process.stderr.write("ans entity merge: ids must be integers\n"); return 2; }
    const r = await store.combineEntities(from, to);
    if (!r.ok) { process.stderr.write("merge failed: " + (r.error ?? "unknown") + "\n"); return 1; }
    process.stdout.write("merged entity #" + from + " -> #" + to + " (merge log #" + r.logId + ", snapshot recorded)\n");
    return 0;
  }

  if (sub === "unmerge") {
    const logId = Number(args[1]);
    if (!Number.isInteger(logId)) { process.stderr.write("ans entity unmerge: log id must be an integer\n"); return 2; }
    const m = await store.unmergeEntity(logId);
    if (m.ok) { process.stdout.write("unmerged merge log #" + logId + " (bounded restore + override guard written)\n"); return 0; }
    if (store.undoEntityMerge(logId)) { process.stdout.write("undid alias log #" + logId + "\n"); return 0; }
    process.stderr.write("unmerge failed: " + (m.error ?? "log not found or already undone") + "\n");
    return 1;
  }

  if (sub === "review") {
    const action = args[1];
    if (!action) {
      const rows = await store.listEntityReview();
      if (rows.length === 0) { process.stdout.write("(no pending merge candidates)\n"); return 0; }
      for (const r of rows) {
        const tag = r.suggested ? "  [suggested]" : "";
        process.stdout.write("#" + r.id + "  " + r.sourceName + " ~> #" + r.targetEntityId + " (" + (r.targetName ?? "?") + ")  hits=" + r.hitCount + tag + "\n");
      }
      process.stdout.write("\nresolve with: ans entity review keep <id> | drop <id>\n");
      return 0;
    }
    if (action === "keep" || action === "drop") {
      const id = Number(args[2]);
      if (!Number.isInteger(id)) { process.stderr.write("ans entity review " + action + ": id must be an integer\n"); return 2; }
      const r = await store.resolveEntityReview(id, action);
      if (!r.ok) { process.stderr.write("review " + action + " failed: " + (r.error ?? "unknown") + "\n"); return 1; }
      process.stdout.write("review " + action + " #" + id + ": resolved\n");
      return 0;
    }
    process.stderr.write("ans entity review: unknown action " + action + "\n");
    return 2;
  }

  process.stderr.write("ans entity: unknown subcommand " + sub + "\n");
  printHelp();
  return 2;
}
