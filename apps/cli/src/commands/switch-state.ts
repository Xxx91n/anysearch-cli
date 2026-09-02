// ans switch-state — read-only switch-governance query (ADR-0043 D7).
// Prints the current S0-S4 phase and last transition from the @3 skip-ledger; --verify
// cross-checks the ledger's evidenceHash against the access_events chain (chain wins).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDbPath } from "@anysearch/kernel";
import { parseSkipLedger, verifySwitchState } from "@anysearch/store";

export async function runSwitchState(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        "ans switch-state — switch governance state reader (ADR-0043 D7, read-only)",
        "",
        "Options:",
        "  --verify   Cross-check ledger evidenceHash against the access_events chain",
        "  --db PATH  Durable database path (default: ANS_DB_PATH or ~/.anysearch/anysearch.db)",
        "  --out DIR  Dir holding skip-ledger.json (default: ./.ship-gate)",
      ].join("\n") + "\n",
    );
    return 0;
  }
  const di = args.indexOf("--db");
  const dbPath = di >= 0 && args[di + 1] ? args[di + 1]! : resolveDbPath();
  const oi = args.indexOf("--out");
  const outDir = oi >= 0 && args[oi + 1] ? args[oi + 1]! : join(process.cwd(), ".ship-gate");
  const ledgerPath = join(outDir, "skip-ledger.json");
  if (!existsSync(ledgerPath)) {
    process.stdout.write("[switch-state] no ledger at " + ledgerPath + " — phase S0 (boot)\n");
    return 0;
  }
  let ledger;
  try {
    ledger = parseSkipLedger(readFileSync(ledgerPath, "utf8"));
  } catch (e) {
    process.stderr.write("[switch-state] ledger unreadable: " + String((e as Error).message ?? e) + "\n");
    return 1;
  }
  const st = ledger.state;
  const last = ledger.actions.at(-1);
  process.stdout.write("[switch-state] phase=" + st.phase + " since=" + (st.since ?? "-") + " transitionId=" + (st.transitionId ?? "-") + " evidenceHash=" + (st.evidenceHash ? st.evidenceHash.slice(0, 12) : "-") + "\n");
  if (last) process.stdout.write("[switch-state] last action: [" + last.kind + "] " + last.from + "->" + last.to + " — " + last.reason + "\n");
  if (args.includes("--verify")) {
    const v = verifySwitchState(outDir, dbPath);
    process.stdout.write("[switch-state] verify: " + (v.ok ? "OK" : "FAIL") + " — " + v.detail + "\n");
    return v.ok ? 0 : 1;
  }
  return 0;
}
