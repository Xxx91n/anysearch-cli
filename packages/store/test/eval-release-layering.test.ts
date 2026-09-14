// ADR-0059 D2 (T-1 / F-15): layering contract — regular CI runs observational and never spends a
// preregistered OF look; the decision-grade peek lives only in the release workflow. The seam the
// ticket is graded on is asserted here rather than left to the workflow run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLook,
  emptyLooksLedger,
  latestLook,
  LOOKS_LEDGER_MAX_ROWS,
  nextLook,
  readLooksLedger,
  type LooksLedger,
  type LooksLedgerEntry,
} from "../src/eval/looks-ledger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(root, p), "utf8");

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error("FAIL: " + msg);
    return;
  }
  passed++;
}

// --- 1. the merge gate is observational and never consumes a look ----------
const shipGate = read("scripts/ship-gate.mjs");
assert(!shipGate.includes('evalArgs.push("--decision")'), "ship-gate must not run decision grade in regular CI (ADR-0059 D2)");
assert(shipGate.includes('ANS_EVAL_NO_LOOK: "1"'), "ship-gate step 7 must set ANS_EVAL_NO_LOOK=1");

// --- 2. decision grade lives in the release workflow only ------------------
const release = read(".github/workflows/release.yml");
assert(/tags:\s*\["v\*"\]/.test(release), "release.yml triggers on v* tags");
assert(release.includes("workflow_dispatch") && release.includes("runPurpose"), "release.yml exposes a runPurpose dispatch input");
assert(release.includes("scripts/release-gate.mjs"), "release.yml calls the release gate script");
assert(release.includes("--pre-tag") && release.includes("--post-tag"), "release.yml wires both release-gate modes");
assert(!release.includes("--decision"), "release.yml delegates the decision flag to release-gate.mjs");

// --- 3. ship-gate.yml aligned on Node 22 (ledger D-003 4) ------------------
const shipGateYml = read(".github/workflows/ship-gate.yml");
assert(!shipGateYml.includes("node-version: 24"), "ship-gate.yml must not pin Node 24");
// R62 T4 added a third job (macos-spillover-probe, non-blocking) — assert EVERY
// node-version pin is 22 rather than a fixed job count (no 24, no other version).
const pins = shipGateYml.match(/node-version: \d+/g) ?? [];
assert(pins.length >= 2 && pins.every((p) => p === "node-version: 22"), "every ship-gate.yml job pins Node 22 (" + pins.join(", ") + ")");

// --- 4. the ledger is a committed repo-root file --------------------------
assert(fs.existsSync(path.join(root, "eval-looks.json")), "the OF look ledger is committed at the repo root");
assert(
  read(".gitignore").split("\n").every((l) => !l.trim().startsWith("eval-looks.json")),
  "eval-looks.json must not be gitignored"
);

// --- 5. append + compaction behaviour -------------------------------------
let ledger: LooksLedger = emptyLooksLedger();
assert(nextLook(ledger, "a:b") === 1, "empty ledger starts at look 1");
const first: LooksLedgerEntry = { key: "a:b", at: "2026-09-12T00:00:00.000Z", look: 1, verdict: "pass", exitCode: 0, integrity: "pass" };
ledger = appendLook(ledger, first, first.at);
assert(nextLook(ledger, "a:b") === 2, "one row advances the look counter");
const newest = latestLook(ledger, "a:b");
assert(newest !== undefined && newest.verdict === "pass" && newest.integrity === "pass", "latestLook returns the newest row for the pair");
assert(latestLook(ledger, "z:z") === undefined, "unknown pair has no row");
for (let i = 0; i < LOOKS_LEDGER_MAX_ROWS + 5; i++) {
  ledger = appendLook(ledger, { key: "a:b", at: "2026-09-12T00:00:00.000Z", look: i + 2, verdict: "warn", exitCode: 0 }, "2026-09-12T00:00:00.000Z");
}
assert(ledger.looks.length === LOOKS_LEDGER_MAX_ROWS, "row cap enforced (" + ledger.looks.length + ")");
assert(ledger.compaction !== undefined && /^[0-9a-f]{64}$/.test(ledger.compaction.preCompactionHash), "compaction preserves the pre-compaction sha256");
assert(ledger.compaction !== undefined && ledger.compaction.droppedRows > 0, "compaction records dropped rows");
const last = latestLook(ledger, "a:b");
assert(last !== undefined && last.look === LOOKS_LEDGER_MAX_ROWS + 6, "compaction keeps the newest rows");

// --- 6. legacy @1 ledger upcasts without crashing -------------------------
const tmp = path.join(os.tmpdir(), "ans-t1-legacy-looks-" + process.pid + ".json");
fs.writeFileSync(tmp, JSON.stringify({ schema: "anysearch/eval-looks@1", looks: [{ key: "k:h", at: "2026-01-01T00:00:00.000Z" }] }), "utf8");
const up = readLooksLedger(tmp);
assert(up.looks.length === 1 && up.looks[0] !== undefined && up.looks[0].verdict === "unknown", "legacy @1 rows upcast without crashing");
fs.rmSync(tmp, { force: true });

console.log("eval-release-layering.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
