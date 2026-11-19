// 关门口的两个分支（#307）。
//
// 这里测的是「按合同走」：两条判据都过 → 关库退 0；有一条没过 → 不关库、说清楚、退 1。
//
// 不宣称真信号验证过。规格 T4 明确写了「Windows 程序模拟 SIGINT 不等于真实
// Ctrl+C」，所以这一组只覆盖关门口这个函数本身，真信号、宿主怎么对待停止信号，
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

test("shutdown: a second signal does not rerun the teardown", async () => {
  // The guard lives in index.ts (`shuttingDown`); this pins the invariant it
  // protects — one runShutdown call is one exit, whatever happens around it.
  const { deps, exits } = recorder({ drainPostWork: async () => false });
  await runShutdown(deps);
  assert.deepEqual(exits, [1], "one settled decision, not two exits racing");
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
