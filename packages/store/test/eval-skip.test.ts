// explicit-skip three-tier markers + @3 skip-ledger schema/upcast/validation contract tests.
import { skip, isSkip } from "../src/eval/explicit-skip";
import { emptySkipLedger, parseSkipLedger } from "../src/eval/skip-ledger";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// tiers
const s1 = skip("T1 blocked", "gate-not-met");
assert(s1.status === "skipped" && s1.tier === "gate-not-met" && s1.reason === "T1 blocked", "tier gate-not-met marker");
assert(skip("d", "offline-deferred").tier === "offline-deferred", "tier offline-deferred");
assert(skip("e", "infra-failure").tier === "infra-failure", "tier infra-failure");
assert(isSkip(s1) && !isSkip({ status: "ok" }) && !isSkip(null), "isSkip guard");

// r110 SA-: corrupt/unknown ledgers FAIL LOUD (never silently cleared). Callers
// quarantine the file aside; parse itself throws SkipLedgerError.
function assertThrows(label: string, fn: () => void) { try { fn(); assert(false, label + " should throw"); } catch { passed++; } }
assertThrows("corrupt ledger JSON throws", () => parseSkipLedger("not json"));
assertThrows("wrong schema throws", () => parseSkipLedger('{"schema":"wrong"}'));

// ---- skip-ledger schema @1/@2 -> @3 lossless upcast ----
const v1 = { schema: "anysearch/gain-ledger@1", consecutiveWarn: 2, history: [{ at: "2026-01-01", tier: "warn", look: "a" }], resolutions: [{ at: "x", decision: "stay-warn", note: "n" }], lastSkipKeys: ["a"] };
const m1 = parseSkipLedger(JSON.stringify(v1));
assert(m1.schema === "anysearch/gain-ledger@3", "@1 upcasts to @3 on read");
assert(m1.consecutiveWarn === 2 && m1.history.length === 1, "@1 streak + history preserved (lossless)");
assert(m1.history[0]!.track === "consumed" && m1.history[0]!.reasonCode === "gate-not-met", "@1 entries default track=consumed / reasonCode=gate-not-met");
assert(m1.resolutions.length === 1 && m1.lastSkipKeys![0] === "a", "@1 resolutions + lastSkipKeys preserved");
assert(parseSkipLedger(JSON.stringify(m1)).schema === "anysearch/gain-ledger@3", "@3 re-parse idempotent");
assertThrows("unknown future schema @9 throws (no forward-compat data loss)", () => parseSkipLedger('{"schema":"anysearch/gain-ledger@9"}'));
assert(emptySkipLedger().schema === "anysearch/gain-ledger@3", "new ledgers are @3");

// ---- r110 SA-: entry-level validation + green omits reasonCode ----
const junk = { schema: "anysearch/gain-ledger@3", consecutiveWarn: 0, history: [{ at: "x", tier: "warn", look: "", track: "bogus", reasonCode: "gate-not-met" }], resolutions: [], state: { phase: "S0", since: null, transitionId: null, evidenceHash: null }, actions: [] };
assertThrows("bogus track entry rejected", () => parseSkipLedger(JSON.stringify(junk)));
const junk2 = { schema: "anysearch/gain-ledger@3", consecutiveWarn: 0, history: [{ at: "x", tier: "green", look: "", track: "consumed", reasonCode: "gate-not-met" }], resolutions: [], state: { phase: "S0", since: null, transitionId: null, evidenceHash: null }, actions: [] };
assertThrows("green row with reasonCode rejected", () => parseSkipLedger(JSON.stringify(junk2)));
const junk3 = { schema: "anysearch/gain-ledger@3", consecutiveWarn: 0, history: [{ at: "x", tier: "warn", look: "", track: "consumed" }], resolutions: [], state: { phase: "S0", since: null, transitionId: null, evidenceHash: null }, actions: [] };
assertThrows("warn row without reasonCode rejected", () => parseSkipLedger(JSON.stringify(junk3)));
// @1 green entries upcast without an invented reason code
const v1g = { schema: "anysearch/gain-ledger@1", consecutiveWarn: 0, history: [{ at: "x", tier: "green", look: "" }], resolutions: [] };
assert(parseSkipLedger(JSON.stringify(v1g)).history[0]!.reasonCode === undefined, "@1 green upcast omits reasonCode");

console.log("eval-skip tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
