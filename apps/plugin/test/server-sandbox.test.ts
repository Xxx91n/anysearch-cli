// #351: this helper is what stands between a test run and the operator's own
// database, and when it breaks nothing else goes red — the leak is silent, no
// assertion in the suite notices. These two checks are the alarm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { serverSandbox } from "./server-sandbox.js";

const inside = (home: string, value: string | undefined): boolean =>
  typeof value === "string" && value.startsWith(home.endsWith(sep) ? home : home + sep);

test("server sandbox: every path the service writes lands inside the temp home", () => {
  const home = mkdtempSync(join(tmpdir(), "ans-sandbox-"));
  try {
    const { env, durableDb } = serverSandbox(home, 1234, "sandbox-token");
    assert.equal(env.ANS_DB_PATH, durableDb, "the returned database is the one the service is told to use");
    for (const key of ["ANS_DB_PATH", "ANS_PROJECT_DB", "ANS_SERVER_REGISTRY"]) {
      assert.ok(inside(home, env[key]), key + " must stay inside " + home + ", got " + String(env[key]));
    }
    assert.equal(env.HOME, home, "the service's home is the temp dir");
    assert.equal(env.USERPROFILE, home, "and so is the profile Windows resolves the home from");
    assert.equal(env.ANS_SERVER_PORT, "1234", "the port is the one asked for");
    assert.equal(env.ANS_SERVER_TOKEN, "sandbox-token", "the token is the one asked for");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("server sandbox: an ANS_* the runner carries cannot follow the service in", () => {
  const home = mkdtempSync(join(tmpdir(), "ans-sandbox-"));
  const saved = { ANS_DB_PATH: process.env.ANS_DB_PATH, ANS_HOME: process.env.ANS_HOME };
  process.env.ANS_DB_PATH = join(tmpdir(), "operator-real.db");
  process.env.ANS_HOME = join(tmpdir(), "operator-real-home");
  try {
    const { env } = serverSandbox(home, 1234, "sandbox-token");
    assert.ok(inside(home, env.ANS_DB_PATH), "the inherited override is dropped, not passed through");
    assert.equal(env.ANS_HOME, undefined, "no other ANS_* survives");
  } finally {
    if (saved.ANS_DB_PATH === undefined) delete process.env.ANS_DB_PATH;
    else process.env.ANS_DB_PATH = saved.ANS_DB_PATH;
    if (saved.ANS_HOME === undefined) delete process.env.ANS_HOME;
    else process.env.ANS_HOME = saved.ANS_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
