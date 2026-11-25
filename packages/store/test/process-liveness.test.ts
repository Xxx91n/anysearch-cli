// #570: one pid-liveness probe for the whole product. `probePid` keeps
// alive / dead / unknown apart because a caller that must word a message
// (the skill lock) has to tell "running" from "cannot be proven dead";
// `pidIsAlive` is the boolean reading every lock and ledger uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pidIsAlive, probePid } from "../src/process-liveness";

/** Run `body` with process.kill stubbed: null = probe succeeds, else the thrown code. */
function withProbe(code: string | null, body: () => void): void {
  const realKill = process.kill;
  const stub: typeof process.kill = () => {
    if (code === null) return true;
    throw Object.assign(new Error("probe failure"), { code });
  };
  process.kill = stub;
  try {
    body();
  } finally {
    process.kill = realKill;
  }
}

test("pidIsAlive: only ESRCH proves death", () => {
  withProbe(null, () => assert.equal(pidIsAlive(1234), true, "a successful probe is alive"));
  withProbe("EPERM", () => assert.equal(pidIsAlive(1234), true, "EPERM means the process exists for another user"));
  withProbe("ERR_INVALID_ARG_TYPE", () => assert.equal(pidIsAlive(1234), true, "an unclassifiable probe is not death"));
  withProbe("EACCES", () => assert.equal(pidIsAlive(1234), true, "any other errno is not death"));
  withProbe("ESRCH", () => assert.equal(pidIsAlive(1234), false, "ESRCH is the one proof of death"));
});

test("probePid keeps dead, alive and unconfirmable apart", () => {
  withProbe(null, () => assert.equal(probePid(1234), "alive"));
  withProbe("EPERM", () => assert.equal(probePid(1234), "alive", "EPERM proves the process exists"));
  withProbe("ESRCH", () => assert.equal(probePid(1234), "dead", "ESRCH proves it is gone"));
  withProbe("ERR_INVALID_ARG_TYPE", () => assert.equal(probePid(1234), "unknown"));
  withProbe("EACCES", () => assert.equal(probePid(1234), "unknown"));
});
