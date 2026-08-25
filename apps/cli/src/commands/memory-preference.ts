// ans pref: T0 durable preference management (ADR-0024 D1/D2/D7).
// Subcommands: list | remember <key> <value> [--scope project|global] | forget <key> [--scope project|global]
//
// C-prime promote gate (ADR-0024 D3): explicit (/remember) OR correction-count>=2 (implicit).
// demote: d-i conflict / d-iii /forget / d-ii eviction at cap overflow (all land in quarantine, never drop).
// Post-write: regenerates MEMORY.md projection (temp+fsync+rename, key-override merge global+project).

import { createEngine } from "../composition";
import { writeProjection } from "@anysearch/kernel";
import type { T0PreferenceInput } from "@anysearch/store";

function printHelp(): void {
  process.stdout.write(
    [
      "ans pref — manage T0 durable preferences (ADR-0024)",
      "",
      "Commands:",
      "  list                              Show live preferences (global + project merged)",
      "  remember <key> <value> [--scope]  Promote a preference (explicit channel)",
      "  forget   <key> [--scope]          Demote a preference (user channel; recoverable)",
      "  review  [--keep|--drop|--promote <id>]  Resolve quarantined equal-conflict memories (ADR-0025)",
      "",
      "Scope: --scope global (default) | --scope project",
      "  global  → ~/.anysearch/MEMORY.md",
      "  project → ./.anysearch/MEMORY.md (no auto-creation; only on first promote)",
      "",
      "Injection: preferences are wrapped as <user_preferences updated=...> block",
      "and prepended to the first USER message on every chat turn (ADR-0024 D5).",
      "",
    ].join("\n") + "\n"
  );
}

export async function runMemoryPreference(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") { printHelp(); return 0; }

  // Parse --scope from tail of args after key/value.
  let scope = "global";
  const cleanArgs: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--scope" && args[i + 1]) {
      scope = args[i + 1] === "project" ? process.cwd() : "global";
      i++;
    } else {
      cleanArgs.push(args[i]);
    }
  }

  const eng = createEngine(process.env.ANS_DOMAIN || "default");

  if (sub === "list") {
    const rows = await eng.store.listPreferences(process.cwd());
    if (rows.length === 0) { process.stdout.write("(none — promote with: ans pref remember <key> <value>)\n"); return 0; }
    for (const r of rows) {
      const tag = r.scope === "global" ? "G" : "P";
      process.stdout.write(tag + "  " + r.key + " = " + r.value + "  (modified " + r.modified + ", via " + r.source + ")\n");
    }
    return 0;
  }

  if (sub === "remember") {
    const [key, value] = cleanArgs;
    if (!key || value === undefined) {
      process.stderr.write("Usage: ans pref remember <key> <value> [--scope project|global]\n");
      return 2;
    }
    const input: T0PreferenceInput = {
      key, value, scope,
      source: "explicit",
      provenance: { event: "user:/remember", at: new Date().toISOString(), why: "explicit remember" },
    };
    const res = await eng.store.promotePreference(input);
    if (res.action === "rejected") {
      process.stderr.write("ans pref: promote rejected: " + (res.reason ?? "unknown") + "\n");
      return 1;
    }
    // Projection regeneration is fail-open (never blocks user).
    const written = await writeProjection(eng.store, scope === "global" ? undefined : scope);
    const out = written.map((w) => w.path).join(", ");
    process.stdout.write("Promoted: " + key + " = " + value + "\nProjected to: " + out + "\n");
    return 0;
  }

  if (sub === "forget") {
    const key = cleanArgs[0];
    if (!key) {
      process.stderr.write("Usage: ans pref forget <key> [--scope project|global]\n");
      return 2;
    }
    await eng.store.demotePreference(key, scope, "user:/forget");
    const written = await writeProjection(eng.store, scope === "global" ? undefined : scope);
    const out = written.map((w) => w.path).join(", ");
    process.stdout.write("Demoted: " + key + "\nProjected to: " + out + "\n");
    return 0;
  }

  if (sub === "review") {
    // ADR-0025 D2: equal-conflict review channel. List quarantined writes, resolve by id.
    // keep = new value wins (quarantine cleared, live counterpart superseded);
    // drop = old value confirmed (row stays isolated, marked resolved_drop);
    // promote = keep + lift to T0 preference via the existing promotePreference channel.
    let action: "keep" | "drop" | "promote" | null = null;
    let idArg: string | null = null;
    for (let i = 0; i < cleanArgs.length; i++) {
      const a = cleanArgs[i];
      if ((a === "--keep" || a === "--drop" || a === "--promote") && cleanArgs[i + 1]) {
        action = a.slice(2) as "keep" | "drop" | "promote";
        idArg = cleanArgs[i + 1];
        i++;
      }
    }
    if (action === null) {
      const rows = await eng.store.listQuarantinedMemories();
      if (rows.length === 0) {
        process.stdout.write("(quarantine empty - nothing to review)\n");
        return 0;
      }
      for (const r of rows) {
        process.stdout.write(
          "#" + r.id + "  entity=" + (r.entity ?? r.url) + "  source=" + (r.source ?? "?") + "  at=" + r.createdAt + "\n" +
          "  " + (r.title ?? "") + " - " + (r.snippet ?? "") + "\n"
        );
      }
      process.stdout.write("Resolve with: ans pref review --keep <id> | --drop <id> | --promote <id>\n");
      return 0;
    }
    const id = Number(idArg);
    if (!Number.isInteger(id) || id <= 0) {
      process.stderr.write("ans pref review: invalid id " + JSON.stringify(idArg) + "\n");
      return 2;
    }
    const row = (await eng.store.listQuarantinedMemories()).find((r) => r.id === id);
    if (!row) {
      process.stderr.write("ans pref review: no quarantined memory #" + id + "\n");
      return 1;
    }
    const res = await eng.store.resolveQuarantinedMemory(id, action === "drop" ? "drop" : "keep");
    if (!res.ok) {
      process.stderr.write("ans pref review: resolve failed for #" + id + "\n");
      return 1;
    }
    if (action === "promote") {
      const promo = await eng.store.promotePreference({
        key: row.entity ?? row.url,
        value: (row.title ?? "") + " - " + (row.snippet ?? ""),
        scope: "global",
        source: "explicit",
        provenance: { event: "user:pref review --promote", at: new Date().toISOString(), why: "promoted from quarantined memory #" + id },
      });
      if (promo.action === "rejected") {
        process.stderr.write("ans pref review: promote rejected: " + (promo.reason ?? "unknown") + "\n");
        return 1;
      }
      // Projection regen is fail-open, same contract as remember.
      try { await writeProjection(eng.store, undefined); } catch {}
    }
    process.stdout.write("pref review " + action + ": #" + id + " resolved\n");
    return 0;
  }

  process.stderr.write("ans pref: unknown subcommand " + String.fromCharCode(39) + sub + String.fromCharCode(39) + "\n");
  printHelp();
  return 2;
}
