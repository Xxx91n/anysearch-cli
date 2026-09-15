// R63 T3 (D-003): quarantine ratchet — fixture-level red/green contract for the ship-gate
// assertions. Green = the ratified 10 shrink or stay; red = new id / renewal / unruled expiry
// / flag-without-record drift / second longterm exit (flag ∪ record) / unparseable date.
import { checkQuarantineRatchet } from "../../../scripts/quarantine-ratchet.mjs";

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

const BASE = ["docs-g0001", "docs-g0002"];
const entry = (id, over = {}) => ({
  id, group: "eval-looks-live", reason: "r", quarantinedAt: "2026-09-14T00:00:00Z",
  ttlDays: 30, expiresAt: "2026-10-14T00:00:00Z", renewals: 0, reviews: [], ...over,
});
const NOW = "2026-09-20T00:00:00Z"; // before expiry

// green: exact baseline set
assert(checkQuarantineRatchet({ entries: BASE.map((id) => entry(id)) }, BASE, NOW).length === 0, "baseline set passes");
// green: shrunk set (promote removed one)
assert(checkQuarantineRatchet({ entries: [entry("docs-g0001")] }, BASE, NOW).length === 0, "shrunk set passes (shrink-only)");
// green: retired entry stays in ledger, still counts as baseline member
// (flag + retire review record — the ledger API co-writes both; flag alone is drift = red)
assert(checkQuarantineRatchet({ entries: BASE.map((id) => entry(id, { retired: true, reviews: [{ at: NOW, decision: "retire", note: "n" }] })) }, BASE, NOW).length === 0, "retired baseline entries pass");
// green: longterm conversion used exactly once is legal
assert(checkQuarantineRatchet({ entries: [entry("docs-g0001", { longterm: true, reviews: [{ at: NOW, decision: "longterm", note: "n" }] }), entry("docs-g0002")] }, BASE, NOW).length === 0, "single longterm exit passes");

// red 1: expansion — new id not in baseline
const r1 = checkQuarantineRatchet({ entries: [...BASE.map((id) => entry(id)), entry("docs-g0099")] }, BASE, NOW);
assert(r1.some((e) => e.includes("docs-g0099") && e.includes("not in baseline")), "new quarantine entry is red");

// red 2: renewal
const r2 = checkQuarantineRatchet({ entries: BASE.map((id) => entry(id, id === "docs-g0001" ? { renewals: 1 } : {})) }, BASE, NOW);
assert(r2.some((e) => e.includes("docs-g0001") && e.includes("renewals=1")), "renewal is red");

// red 3: expired with no ruling
const PAST = "2026-10-15T00:00:00Z"; // after expiresAt
const r3 = checkQuarantineRatchet({ entries: BASE.map((id) => entry(id)) }, BASE, PAST);
assert(r3.filter((e) => e.includes("expired") && e.includes("no promote/retire/longterm ruling")).length === 2, "unruled expiry is red (both entries)");

// green-after-ruling: expired but retired ruling recorded -> not red
const r4 = checkQuarantineRatchet({ entries: [entry("docs-g0001", { retired: true, reviews: [{ at: PAST, decision: "retire", note: "n" }] }), entry("docs-g0002", { retired: true, reviews: [{ at: PAST, decision: "retire", note: "n" }] })] }, BASE, PAST);
assert(r4.length === 0, "expired+retired entries pass");

// red 4: second longterm exit exceeds the one-time cap
const r5 = checkQuarantineRatchet({ entries: BASE.map((id) => entry(id, { longterm: true, reviews: [{ at: NOW, decision: "longterm", note: "n" }] })) }, BASE, NOW);
assert(r5.some((e) => e.includes("longterm") && e.includes("cap is 1")), "second longterm exit is red");

// red 5: expired entry with retired flag but empty reviews — flag without record is drift,
// and the flag alone does not satisfy the forced ruling
const r6 = checkQuarantineRatchet({ entries: [entry("docs-g0001", { retired: true }), entry("docs-g0002")] }, BASE, PAST);
assert(r6.some((e) => e.includes("docs-g0001") && e.includes("no retire review record")), "expired retired-flag entry with empty reviews is red (flag/record drift)");

// red 6: unparseable `now` fails closed instead of silently skipping the expiry check
const r7 = checkQuarantineRatchet({ entries: BASE.map((id) => entry(id)) }, BASE, "not-a-date");
assert(r7.some((e) => e.includes("unparseable now")), "unparseable now is red (fail-closed clock)");

// red 7: the longterm cap counts flag ∪ record — one proper flag+record exit plus a second
// entry carrying only a decision:"longterm" review record still spends the cap twice
const r8 = checkQuarantineRatchet({ entries: [entry("docs-g0001", { longterm: true, reviews: [{ at: NOW, decision: "longterm", note: "n" }] }), entry("docs-g0002", { reviews: [{ at: NOW, decision: "longterm", note: "n" }] })] }, BASE, NOW);
assert(r8.some((e) => e.includes("cap is 1")), "longterm flag ∪ record counts toward the cap (second exit red)");

console.log("eval-quarantine-ratchet.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
