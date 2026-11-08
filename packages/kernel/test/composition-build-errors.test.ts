// T7 ruling (#105): provider factory construction failure is fail-open named
// degradation — never silent. Each failed arm writes a named stderr line and
// lands in CompositionResult.providerBuildErrors (id -> message); the healthy
// path reports an empty record. Missing-key faults word the message as a
// credential hint; unexpected faults word it as a construction bug.
// ponytail: no test framework, assert-based demo.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEngine } from "../src/composition";

function closeResult(r: { store: unknown; observation: { close?: () => void } }) {
  (r.store as { close?: () => void }).close?.();
  r.observation.close?.();
}

const savedExaKey = process.env.EXA_API_KEY;
const origStderrWrite = process.stderr.write;
let captured = "";
try {
  process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;

  // Missing EXA_API_KEY -> exa arm fails construction, named on stderr + record.
  delete process.env.EXA_API_KEY;
  const r = createEngine(undefined, { dbPath: ":memory:" });
  assert.ok(r.providerBuildErrors.exa, "exa construction failure recorded");
  assert.equal(r.providerBuildErrors.exa, "permanent: missing/invalid credential — set the provider's API key env",
    "credential-shaped fault records the safe category message");
  assert.match(captured, /\[anysearch\] provider exa construction failed: /,
    "named stderr line present (stdout keeps MCP protocol purity)");
  // Other arms (tavily keyless, anysearch optional-key) built fine: the record
  // holds exactly the failed arms, no per-key absence probing.
  assert.deepEqual(Object.keys(r.providerBuildErrors), ["exa"],
    "record holds exactly the failed arms");
  closeResult(r);

  // Domain path: domain enabling only exa surfaces the same named degradation.
  captured = "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-composition-builderr-"));
  try {
    fs.writeFileSync(path.join(dir, "exaonly.toml"), [
      'name = "exaonly"',
      '[sources]',
      'enabled = ["exa"]',
      '[rag]',
      'adapter = "none"',
      "",
    ].join("\n"), "utf8");
    const d = createEngine("exaonly", { domainsDirs: [dir], dbPath: ":memory:" });
    assert.ok(d.providerBuildErrors.exa, "domain-scoped exa failure recorded");
    assert.match(captured, /\[anysearch\] provider exa construction failed:/, "domain path stderr line");
    closeResult(d);

    // Healthy path: every enabled arm builds -> empty record, no stderr noise.
    captured = "";
    fs.writeFileSync(path.join(dir, "healthy.toml"), [
      'name = "healthy"',
      '[sources]',
      'enabled = ["anysearch"]',
      '[rag]',
      'adapter = "none"',
      "",
    ].join("\n"), "utf8");
    const h = createEngine("healthy", { domainsDirs: [dir], dbPath: ":memory:" });
    assert.deepEqual(h.providerBuildErrors, {}, "healthy path has an empty build-error record");
    assert.equal(captured, "", "no construction stderr on the healthy path");
    closeResult(h);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // A dummy key lets exa construct -> record empties (constructor validates
  // presence, not reachability).
  process.env.EXA_API_KEY = "test-dummy-key";
  captured = "";
  const ok = createEngine(undefined, { dbPath: ":memory:" });
  assert.deepEqual(ok.providerBuildErrors, {}, "dummy key clears the exa build error");
  closeResult(ok);

  // CWE-532 + wording regression: a malformed key value throws inside the
  // constructor (Node embeds the value in the Headers error message) — the
  // secret value must reach neither the record nor stderr, and the fault is
  // worded as the credential category (permanent config fault per ruling 2).
  process.env.EXA_API_KEY = "sk-secret-do-not-log\nheader-fault";
  captured = "";
  const leak = createEngine(undefined, { dbPath: ":memory:" });
  assert.ok(leak.providerBuildErrors.exa, "malformed-key fault recorded");
  assert.equal(leak.providerBuildErrors.exa, "permanent: missing/invalid credential — set the provider's API key env",
    "invalid-header-value fault worded as credential category");
  assert.ok(!leak.providerBuildErrors.exa.includes("sk-secret-do-not-log"),
    "record carries the category, never the raw error text");
  assert.ok(!captured.includes("sk-secret-do-not-log"),
    "stderr carries no raw error text");
  closeResult(leak);

  // Best-effort diagnostic: a broken stderr must not crash the fail-open
  // build. Sync arm — write() throws.
  process.stderr.write = (() => { throw new Error("EPIPE: broken pipe"); }) as typeof process.stderr.write;
  const syncBroken = createEngine(undefined, { dbPath: ":memory:" });
  assert.ok(syncBroken.providerBuildErrors.exa, "record populated despite a throwing stderr");
  closeResult(syncBroken);

  // Async arm — Node invokes the write callback with the error BEFORE emitting
  // 'error'; the mock reproduces that ordering (callback-with-error, then the
  // event on nextTick) so a prematurely removed listener would crash the test.
  process.stderr.write = ((() => {
    return (msg: unknown, cb?: (err?: Error | null) => void) => {
      cb?.(new Error("EPIPE: broken pipe"));
      process.nextTick(() => process.stderr.emit("error", new Error("EPIPE: broken pipe")));
      return true;
    };
  }) as unknown) as typeof process.stderr.write;
  const asyncBroken = createEngine(undefined, { dbPath: ":memory:" });
  assert.ok(asyncBroken.retriever, "fail-open engine returned despite a broken stderr");
  assert.ok(asyncBroken.providerBuildErrors.exa, "record populated despite a broken stderr");
  closeResult(asyncBroken);
} finally {
  process.stderr.write = origStderrWrite;
  if (savedExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = savedExaKey;
}
console.log("composition-build-errors.test: ok");
