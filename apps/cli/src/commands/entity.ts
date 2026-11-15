// ans entity: entity merge execution + candidate review list (-D4).
// Subcommands: merge <fromId> <toId> | unmerge <logId> | review [keep|drop <id>]
//              | alias <name> <name> | aliases [--pending] | unresolved [keep|drop <id>]
//
// #277 adds the cross-script surface: `alias` writes a mapping down and it takes
// effect at once; `aliases` is the audit view (where did each mapping come
// from?); `unresolved` is where a record whose object could not be established
// waits for a human instead of silently staying out of recall.

import { createPersistentEngine } from "../db";
import type { EntityReviewRow, AliasRow, UnresolvedEntityMemory } from "@anysearch-cli/store";

interface EntityStore {
  combineEntities(fromId: number, toId: number): Promise<{ ok: boolean; logId?: number; error?: string }>;
  unmergeEntity(logId: number): Promise<{ ok: boolean; error?: string }>;
  undoEntityMerge(logId: number): boolean;
  listEntityReview(): Promise<EntityReviewRow[]>;
  resolveEntityReview(id: number, action: "keep" | "drop"): Promise<{ ok: boolean; error?: string }>;
  declareEntityAlias(a: string, b: string): { ok: boolean; entityId?: number; logId?: number; error?: string };
  listEntityAliases(opts?: { pendingOnly?: boolean }): AliasRow[];
  listUnresolvedEntityMemories(): UnresolvedEntityMemory[];
  resolveUnresolvedEntityMemory(id: number, action: "keep" | "drop"): { ok: boolean; error?: string };
}

function printHelp(): void {
  process.stdout.write(
    [
      "ans entity — entity merge execution + review list (0032)",
      "",
      "Commands:",
      "  merge <fromId> <toId>   Merge entity fromId into toId (destructive redirect + snapshot)",
      "  unmerge <logId>         Undo a merge or alias log entry (bounded, snapshot-driven)",
      "  review                  List pending merge candidates (hit_count >= 2 = suggested)",
      "  review keep <id>        Confirm candidate: merge its entity into the target",
      "  review drop <id>        Reject candidate: keep both entities separate",
      "  alias <name> <name>     Declare two names are one object (applies at once, no review)",
      "  aliases [--pending]     Audit view: every mapping and why it exists; --pending = review queue",
      "  unresolved              Records whose object could not be established (excluded from recall)",
      "  unresolved keep <id>    Accept the record: it takes part in recall again",
      "  unresolved drop <id>    Leave it out permanently",
      "",
      "Guards: type gate (no cross-type merge); every merge writes a full snapshot;",
      "unmerge leaves an override record so the pair never auto-merges again.",
      "Cross-script mappings (Chinese name <-> Latin name) are never decided by",
      "spelling similarity; a declared mapping applies at once, a model proposal",
      "waits in `review` until confirmed.",
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
        // #277: the two kinds mean different things, so they are labelled rather
        // than merged into one list nobody can read. A cross-script proposal is
        // "these two names may be one object"; keep adds the alias and destroys
        // nothing, unlike the fuzzy candidate whose keep is a real merge.
        const kind = r.kind === "cross_script" ? "  [cross-script]" : "";
        process.stdout.write("#" + r.id + kind + "  " + r.sourceName + " ~> #" + r.targetEntityId + " (" + (r.targetName ?? "?") + ")  hits=" + r.hitCount + tag + "\n");
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

  // #277: declare a mapping. Takes effect at once — no model call, no review.
  if (sub === "alias") {
    const a = args[1];
    const b = args[2];
    if (!a || !b) { process.stderr.write("ans entity alias: needs two names (ans entity alias Acme 甲公司)\n"); return 2; }
    const r = store.declareEntityAlias(a, b);
    if (!r.ok) { process.stderr.write("alias failed: " + (r.error ?? "unknown") + "\n"); return 1; }
    process.stdout.write("aliased " + a + " = " + b + " on entity #" + r.entityId + " (log #" + r.logId + ", effective now)\n");
    return 0;
  }

  // #277: the audit view — every mapping and the reason it exists.
  if (sub === "aliases") {
    const pendingOnly = args.includes("--pending");
    const rows = store.listEntityAliases(pendingOnly ? { pendingOnly: true } : {});
    if (rows.length === 0) {
      process.stdout.write(pendingOnly ? "(no mappings waiting for review)\n" : "(no cross-script mappings recorded)\n");
      return 0;
    }
    for (const r of rows) {
      const state = r.resolved === null ? "pending" : r.resolved;
      process.stdout.write("#" + r.id + "  " + r.sourceName + " ~> #" + r.targetEntityId + " (" + (r.targetName ?? "?") + ")  kind=" + r.kind + " evidence=" + r.evidence + " state=" + state + "\n");
    }
    process.stdout.write("\nundo a mapping with: ans entity unmerge <id>\n");
    return 0;
  }

  // #277: records whose object could not be established. They are stored but
  // excluded from every recall path until a human answers — the exit that keeps
  // the mark from turning into a silent backlog.
  if (sub === "unresolved") {
    const action = args[1];
    if (!action) {
      const rows = store.listUnresolvedEntityMemories();
      if (rows.length === 0) { process.stdout.write("(no records with an undetermined object)\n"); return 0; }
      for (const r of rows) {
        process.stdout.write("#" + r.id + "  " + (r.title ?? "(no title)") + "  " + r.url + "\n");
      }
      process.stdout.write("\nresolve with: ans entity unresolved keep <id> | drop <id>\n");
      return 0;
    }
    if (action === "keep" || action === "drop") {
      const id = Number(args[2]);
      if (!Number.isInteger(id)) { process.stderr.write("ans entity unresolved " + action + ": id must be an integer\n"); return 2; }
      const r = store.resolveUnresolvedEntityMemory(id, action);
      if (!r.ok) { process.stderr.write("unresolved " + action + " failed: " + (r.error ?? "unknown") + "\n"); return 1; }
      process.stdout.write("unresolved " + action + " #" + id + ": resolved\n");
      return 0;
    }
    process.stderr.write("ans entity unresolved: unknown action " + action + "\n");
    return 2;
  }

  process.stderr.write("ans entity: unknown subcommand " + sub + "\n");
  printHelp();
  return 2;
}
