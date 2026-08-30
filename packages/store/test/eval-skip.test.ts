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

console.log("eval-skip tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
