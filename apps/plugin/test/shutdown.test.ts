// 收到停止信号后的收尾，两个分支（#307）。
//
// 这里测的是「按合同走」：两条判据都过 → 关库退 0；有一条没过 → 不关库、说清楚、退 1。
//
// 不宣称真信号验证过。规格 T4 明确写了「Windows 程序模拟 SIGINT 不等于真实
// Ctrl+C」，所以这一组只覆盖收尾函数本身，真信号、宿主怎么对待停止信号，
// 仍然算未覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrainMs, runShutdown, type ShutdownDeps } from "../src/server/shutdown.js";

/** 记下每项动作，检查顺序和退出码。 */
function recorder(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const exits: number[] = [];
  const deps: ShutdownDeps = {
    closeServer: async () => { calls.push("closeServer"); },
    drainPostWork: async () => { calls.push("drain"); return true; },
    pendingPostWork: () => 0,
    closeStores: () => { calls.push("closeStores"); },
    clearRegistry: () => { calls.push("clearRegistry"); },
    stopPostWork: () => { calls.push("stopPostWork"); },
    exit: (code) => { calls.push("exit:" + code); exits.push(code); },
    write: (line) => { lines.push(line); },
    drainMs: 50,
    signal: "SIGTERM",
    ...overrides,
  };
  return { deps, calls, lines, exits };
}

test("shutdown: both settled → stores closed, registry cleared, exit 0", async () => {
  const { deps, calls, exits, lines } = recorder();
  await runShutdown(deps);
  assert.deepEqual(calls, ["closeServer", "drain", "closeStores", "clearRegistry", "stopPostWork", "exit:0"]);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(lines, [], "a clean stop says nothing on stderr");
});

test("shutdown: post-work still running → stores NOT closed, says which part, exit 1", async () => {
  const { deps, calls, exits, lines } = recorder({
    drainPostWork: async () => false,
    pendingPostWork: () => 2,
  });
  await runShutdown(deps);
  assert.ok(!calls.includes("closeStores"), "the running work still holds the stores");
  assert.ok(!calls.includes("stopPostWork"), "the registry is still in use");
  assert.ok(calls.includes("clearRegistry"), "the published address is dropped on the failure path too");
  assert.deepEqual(exits, [1]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /SIGTERM/);
  assert.match(lines[0]!, /2 post-work unit\(s\) still running/);
  assert.match(lines[0]!, /open task rows stay as blockers/);
});

test("shutdown: a request stuck in flight (no unit running) is named as such", async () => {
  // The old text said "post-work still running (0 unit(s))", which sent the
  // reader looking at the wrong thing.
  const { deps, calls, exits, lines } = recorder({
    closeServer: () => new Promise<void>(() => { /* never resolves: client holds the socket */ }),
    drainPostWork: async () => true,
    pendingPostWork: () => 0,
  });
  await runShutdown(deps);
  assert.ok(!calls.includes("closeStores"));
  assert.deepEqual(exits, [1]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /requests still in flight/);
  assert.match(lines[0]!, /no post-work unit is running/);
});

test("shutdown: one settled decision per call (the repeat guard lives in index.ts)", async () => {
  // The `shuttingDown` guard that stops a second signal from rerunning this is
  // in index.ts's wrapper, not here — calling runShutdown once cannot test it.
  // What this pins is the shape the guard relies on: one call is one exit.
  const { deps, exits } = recorder({ drainPostWork: async () => false });
  await runShutdown(deps);
  assert.deepEqual(exits, [1], "one settled decision, not two exits racing");
});

test("shutdown: a failing dependency still reaches the exit code", async () => {
  // index.ts calls `void runShutdown(...)`, so a rejection here would become an
  // unhandled rejection and the process would die without the teardown or an
  // exit code. Both a rejecting drain and a throwing closeStores are covered.
  const { deps, calls, exits, lines } = recorder({
    drainPostWork: () => Promise.reject(new Error("drain blew up")),
  });
  await runShutdown(deps);
  assert.deepEqual(exits, [1], "a failing drain counts as 'not settled'");
  assert.equal(lines.length, 1);
  // The message names what the code knows: units vs requests. A failing drain
  // is neither, so it must not claim requests are stuck; it says the stop did
  // not settle and names nothing specific.
  assert.match(lines[0]!, /after 50ms — exiting without closing stores/);
  assert.doesNotMatch(lines[0]!, /requests still in flight/);

  const second = recorder({
    closeStores: () => { throw new Error("close failed"); },
  });
  await runShutdown(second.deps);
  assert.deepEqual(second.exits, [0], "a throwing close must not swallow the exit");
  assert.deepEqual(second.calls, ["closeServer", "drain", "clearRegistry", "stopPostWork", "exit:0"],
    "the remaining teardown still runs after one step throws");
});

test("shutdown: pending is read once, so the message cannot contradict itself", async () => {
  let reads = 0;
  const { deps, lines } = recorder({
    drainPostWork: async () => false,
    // The second read would see 0 (the last unit finished between the two).
    pendingPostWork: () => (reads++ === 0 ? 1 : 0),
  });
  await runShutdown(deps);
  assert.equal(reads, 1, "the count is taken once");
  assert.match(lines[0]!, /1 post-work unit\(s\) still running/);
});

test("parseDrainMs: bad values fall back to 10000 and say so", () => {
  const lines: string[] = [];
  const write = (line: string) => { lines.push(line); };
  assert.equal(parseDrainMs(undefined, write), 10000, "unset uses the default silently");
  assert.equal(parseDrainMs("", write), 10000, "blank uses the default silently");
  assert.equal(parseDrainMs("2500", write), 2500, "a valid value is used");
  assert.deepEqual(lines, [], "no line for the valid cases");

  for (const bad of ["abc", "-1", "0", "NaN", "Infinity"]) {
    lines.length = 0;
    assert.equal(parseDrainMs(bad, write), 10000, bad + " falls back to the default");
    assert.equal(lines.length, 1, bad + " is reported");
    assert.match(lines[0]!, /ANS_SHUTDOWN_DRAIN_MS=/);
    assert.match(lines[0]!, /using 10000ms/);
  }
});
