// R62 D-003 (T4): native-handle teardown registry — registered closes run once,
// in order, errors swallowed (a bad close must never mask the exit path).
// unrefPendingHandles is a no-throw backstop for pending libuv handles.
import { registerTeardown, runTeardown, unrefPendingHandles } from "../src/teardown";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

const order: string[] = [];
registerTeardown(() => order.push("a"));
registerTeardown(() => { throw new Error("boom"); });
registerTeardown(() => order.push("c"));
runTeardown();
assert(order.join(",") === "a,c", "teardowns ran in order, throwing close swallowed");
runTeardown();
assert(order.join(",") === "a,c", "teardown registry drains — runs once");
unrefPendingHandles();
assert(true, "unrefPendingHandles no-throw");

console.log("--- teardown tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
