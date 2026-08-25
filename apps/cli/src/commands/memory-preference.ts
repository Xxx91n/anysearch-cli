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

  process.stderr.write("ans pref: unknown subcommand " + String.fromCharCode(39) + sub + String.fromCharCode(39) + "\n");
  printHelp();
  return 2;
}
