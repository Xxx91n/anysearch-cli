// ADR-0039 D7: explicit-skip three-tier + WARN ledger + 3-streak escalation (negative: silent
// swallow impossible — skip without reason/key recording fails these assertions).
import { skip, isSkip, skipKey } from "../src/eval/explicit-skip";
import { emptySkipLedger, parseSkipLedger, recordSkips, skipMustFail, SKIP_STREAK_LIMIT } from "../src/eval/skip-ledger";

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
assert(skipKey("bgnbd", s1) === "bgnbd|gate-not-met|T1 blocked", "skipKey = metric|tier|reason");

// ledger: corrupt/absent handled by parse (fail-safe empty)
assert(parseSkipLedger("not json").consecutiveWarn === 0, "corrupt ledger -> empty (fail-safe)");
assert(parseSkipLedger('{"schema":"wrong"}').consecutiveWarn === 0, "wrong schema -> empty");

// streak: identical skip keys 3 runs -> mustFail; a green run resets.
let l = emptySkipLedger();
const keys = [skipKey("bgnbd", s1)];
assert(recordSkips(l, keys, "t1") === 1, "first identical skip -> streak 1");
assert(recordSkips(l, keys, "t2") === 2, "second identical skip -> streak 2");
assert(!skipMustFail(l), "streak 2 below limit " + SKIP_STREAK_LIMIT);
assert(recordSkips(l, keys, "t3") === 3, "third identical skip -> streak 3");
assert(skipMustFail(l), "streak 3 = forced human review");
// different reason breaks identity
const s2 = skip("T3 window short", "gate-not-met");
assert(recordSkips(l, [skipKey("bgnbd", s2)], "t4") === 1, "different reason = not identical -> streak resets to 1");
assert(recordSkips(l, [], "t5") === 0, "green run clears streak");
assert(l.history.length === 5, "history retains all entries");


// ---- ADR-0042 D4: skip-ledger schema @2 — @1 migration + reason-code split ----
const v1 = { schema: "anysearch/gain-ledger@1", consecutiveWarn: 2, history: [{ at: "2026-01-01", tier: "warn", look: "a" }], resolutions: [{ at: "x", decision: "stay-warn", note: "n" }], lastSkipKeys: ["a"] };
const m1 = parseSkipLedger(JSON.stringify(v1));
assert(m1.schema === "anysearch/gain-ledger@2", "@1 upcasts to @2 on read");
assert(m1.consecutiveWarn === 2 && m1.history.length === 1, "@1 streak + history preserved (lossless)");
assert(m1.history[0]!.track === "consumed" && m1.history[0]!.reasonCode === "gate-not-met", "@1 entries default track=consumed / reasonCode=gate-not-met");
assert(m1.resolutions.length === 1 && m1.lastSkipKeys![0] === "a", "@1 resolutions + lastSkipKeys preserved");
assert(parseSkipLedger(JSON.stringify(m1)).schema === "anysearch/gain-ledger@2", "@2 re-parse idempotent");
assert(parseSkipLedger('{"schema":"anysearch/gain-ledger@9"}').consecutiveWarn === 0, "unknown future schema -> fail-safe empty");

// data-absent never increments the streak and breaks an in-flight gate-not-met run.
let l2 = emptySkipLedger();
assert(recordSkips(l2, ["bgnbd|gate-not-met|T1: x"], "t1") === 1, "gate-not-met streak 1");
assert(recordSkips(l2, ["bgnbd|gate-not-met|T1: x"], "t2") === 2, "gate-not-met streak 2");
assert(recordSkips(l2, ["accessAge|gate-not-met|no access events"], "t3", { reasonCode: "data-absent" }) === 0, "data-absent never bumps the streak");
assert(l2.consecutiveWarn === 0, "data-absent breaks the in-flight run");
assert(l2.history[2]!.tier === "data-absent" && l2.history[2]!.reasonCode === "data-absent", "data-absent entry recorded with reason code");
assert(recordSkips(l2, ["bgnbd|gate-not-met|T1: x"], "t4") === 1, "first gate-not-met after data-absent starts counting from 1");
assert(recordSkips(l2, ["bgnbd|gate-not-met|T1: x"], "t5") === 2 && !skipMustFail(l2), "streak resumes 1..2 after data-absent");
assert(recordSkips(emptySkipLedger(), ["k"], "t6") === 1, "default meta = consumed + gate-not-met (legacy callers unchanged)");
assert(emptySkipLedger().schema === "anysearch/gain-ledger@2", "new ledgers are @2");

console.log("eval-skip tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
