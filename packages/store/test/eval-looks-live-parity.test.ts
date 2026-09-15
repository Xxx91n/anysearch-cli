// R64 D-004: the live runner must consume the quarantine ledger's single
// classification implementation — a second inline predicate already drifted
// once (it ignored the longterm flag). This test pins the contract two ways:
//  (a) a mixed ledger (active / expired / retired / longterm / retired+longterm)
//      asserts activeIds() === isActive() per entry — the exact semantics the
//      runner now calls;
//  (b) a source-level check that eval-looks-live.online.ts imports activeIds
//      and carries no inline retired/expiresAt classification copy.
// Plus (c) the R64 D-005 schema_version:1 sentinel on the eval-looks root.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeIds,
  isActive,
  QUARANTINE_SCHEMA,
  type QuarantineEntry,
  type QuarantineLedger,
} from "../src/eval/quarantine-ledger";
import { EVAL_LOOKS_SCHEMA_VERSION } from "../src/eval/docs-golden";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");

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

const NOW = "2026-09-16T00:00:00.000Z";
const entry = (id: string, over: Partial<QuarantineEntry>): QuarantineEntry => ({
  id,
  group: "eval-looks-live",
  reason: "parity fixture",
  quarantinedAt: "2026-09-14T19:02:29Z",
  ttlDays: 30,
  expiresAt: "2026-10-14T19:02:29Z",
  renewals: 0,
  reviews: [],
  ...over,
});
const ledger: QuarantineLedger = {
  schema: QUARANTINE_SCHEMA,
  entries: [
    entry("docs-g0001", {}),                                                          // active
    entry("docs-g0002", { expiresAt: "2026-09-15T00:00:00.000Z" }),                   // expired
    entry("docs-g0003", { retired: true }),                                           // retired
    entry("docs-g0004", { longterm: true, expiresAt: "2026-09-15T00:00:00.000Z" }),   // longterm outlives expiry
    entry("docs-g0005", { retired: true, longterm: true }),                           // retired beats longterm
  ],
};

// (a) runner-visible classification agrees with isActive() per entry.
const viaActiveIds = new Set(activeIds(ledger, NOW));
for (const e of ledger.entries) {
  assert(viaActiveIds.has(e.id) === isActive(ledger, e.id, NOW), e.id + ": activeIds() and isActive() agree");
}
assert(viaActiveIds.has("docs-g0001"), "unexpired entry is active");
assert(!viaActiveIds.has("docs-g0002"), "expired entry is inactive");
assert(!viaActiveIds.has("docs-g0003"), "retired entry is inactive");
assert(viaActiveIds.has("docs-g0004"), "longterm entry stays active past expiry");
assert(!viaActiveIds.has("docs-g0005"), "retired+longterm entry is inactive");

// (b) the runner calls the ledger implementation — no third predicate copy.
const runnerSrc = fs.readFileSync(
  path.join(root, "packages", "store", "test", "online", "eval-looks-live.online.ts"),
  "utf8",
);
assert(runnerSrc.includes('from "../../src/eval/quarantine-ledger"'), "runner imports the quarantine ledger module");
assert(runnerSrc.includes("activeIds("), "runner classification calls activeIds()");
assert(!/!e.retired && Date.parse(e.expiresAt)/.test(runnerSrc), "runner carries no inline retired/expiresAt classification copy");
assert(runnerSrc.includes("ANS_EVAL_EVIDENCE"), "runner exposes the evidence-mode env flag");
assert(runnerSrc.includes("EVIDENCE "), "runner emits EVIDENCE quadruple lines");
assert(runnerSrc.includes("RETIRE_CANDIDATE"), "runner flags consecutive all-red entries");
assert(runnerSrc.includes("mustHitPaths"), "runner consumes the mustHitPaths page-family layer");
assert(runnerSrc.includes("mustNotHitPaths"), "runner consumes the mustNotHitPaths negative pins");
assert(runnerSrc.includes("WATCH "), "runner surfaces the post-promote watch mark");

// (c) R64 D-005: eval-looks.json root schema_version:1 sentinel; golden
// sub-schema unchanged (additive change, no v2 migration).
const looks = JSON.parse(fs.readFileSync(path.join(root, "eval-looks.json"), "utf8"));
assert(looks.schema === "anysearch/eval-looks@2", "eval-looks.json keeps schema anysearch/eval-looks@2");
assert(looks.schema_version === EVAL_LOOKS_SCHEMA_VERSION, "eval-looks.json root carries the schema_version sentinel matching EVAL_LOOKS_SCHEMA_VERSION");
assert(looks.golden?.schema === "anysearch/docs-golden@1", "golden sub-schema unchanged");

console.log("eval-looks-live-parity: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
