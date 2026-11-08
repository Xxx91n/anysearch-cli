// Native-handle teardown registry — each drain runs pending closes once, in
// order; a throwing close is swallowed and stays queued for the next drain.
// unrefPendingHandles is a no-throw backstop for pending libuv handles.
import { registerTeardown, runTeardown, unrefPendingHandles } from "../src/teardown";
import { pendingTeardowns } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

const order: string[] = [];
registerTeardown(() => order.push("a"));
registerTeardown(() => { throw new Error("boom"); });
registerTeardown(() => order.push("c"));
assert(pendingTeardowns() === 3, "registerTeardown from the CLI re-export lands in the store registry");
runTeardown();
assert(order.join(",") === "a,c", "teardowns ran in order, throwing close swallowed");
assert(pendingTeardowns() === 1, "a throwing close stays queued for the next drain");
runTeardown();
assert(order.join(",") === "a,c", "teardown registry drains — runs once");
assert(pendingTeardowns() === 1, "the throwing close is still queued after a second drain");
unrefPendingHandles();
assert(pendingTeardowns() === 1, "unrefPendingHandles leaves the teardown registry untouched");

console.log("--- teardown tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
