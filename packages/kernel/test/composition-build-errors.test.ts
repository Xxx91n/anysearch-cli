// T7 ruling (#105): provider factory construction failure is fail-open named
// degradation — never silent. Each failed arm writes a named stderr line and
// lands in CompositionResult.providerBuildErrors (id -> message); the healthy
// path reports an empty record. A key we cannot use words the message as a
// credential hint; unexpected faults word it as a construction bug.
// ponytail: no test framework, assert-based demo.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEngine } from "../src/composition";
import { resolveSearchCredentials } from "@anysearch-cli/store";

function closeResult(r: { store: unknown; observation: { close?: () => void } }) {
  (r.store as { close?: () => void }).close?.();
  r.observation.close?.();
}

// These fixtures drive the unusable key through the environment, so the seam
// resolves the env only: the user credential file is not an input here and must
// not leak a developer's key into the record. #500 made the exa factory a pure
// function of its argument, so an engine built without this seam would take the
// free-quota arm and prove nothing.
const envCredentials = (e?: NodeJS.ProcessEnv) =>
  resolveSearchCredentials(e, { credentialsFile: { bindings: [] } });

// 用不了的 key：值里带换行，exa-js 构造时往请求头里塞就当场抛。它是这个文件里
// 「构造会抛」的真实样本（#500 起没配 key 走免费额度，不再算样本）。
// 值本身不许出现在记录或 stderr 里，下面有专门一条断言盯着。
const UNUSABLE_EXA_KEY = "sk-secret-do-not-log\nheader-fault";
const savedExaKey = process.env.EXA_API_KEY;
const savedEvalTimeout = process.env.ANS_EVAL_REQUEST_TIMEOUT_MS;
const origStderrWrite = process.stderr.write;
let captured = "";
try {
  process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;

  // 配了一把用不了的 key -> exa arm fails construction, named on stderr + record.
  process.env.EXA_API_KEY = UNUSABLE_EXA_KEY;
  const r = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
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
    const d = createEngine("exaonly", { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
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
    const h = createEngine("healthy", { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
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
  const ok = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
  assert.deepEqual(ok.providerBuildErrors, {}, "dummy key clears the exa build error");
  closeResult(ok);

  // CWE-532 + wording regression: a malformed key value throws inside the
  // constructor (Node embeds the value in the Headers error message) — the
  // secret value must reach neither the record nor stderr, and the fault is
  // worded as the credential category (permanent config fault per ruling 2).
  process.env.EXA_API_KEY = UNUSABLE_EXA_KEY;
  captured = "";
  const leak = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
  assert.ok(leak.providerBuildErrors.exa, "malformed-key fault recorded");
  assert.equal(leak.providerBuildErrors.exa, "permanent: missing/invalid credential — set the provider's API key env",
    "invalid-header-value fault worded as credential category");
  assert.ok(!leak.providerBuildErrors.exa.includes("sk-secret-do-not-log"),
    "record carries the category, never the raw error text");
  assert.ok(!captured.includes("sk-secret-do-not-log"),
    "stderr carries no raw error text");
  closeResult(leak);

  // #500 验收：没配 key 不再是一次构造失败——exa 臂换成免费额度，建得起来，记录里不点名。
  delete process.env.EXA_API_KEY;
  captured = "";
  const withoutKey = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
  assert.deepEqual(withoutKey.providerBuildErrors, {}, "a missing key builds the free-quota arm, nothing to report");
  assert.equal(captured, "", "the path without a key writes no construction failure");
  closeResult(withoutKey);

  // 评测的钟和用户的钟分开。`ANS_EVAL_REQUEST_TIMEOUT_MS` 只由 `ans search`
  // 读进来交给组合根；kernel 自己不读这个变量，chat 和 MCP 那两处调用也不读、不传，
  // 所以它们永远拿 4000。四条规矩：不设 = 4000、传 15000 生效、非法或 ≤0（含小数）回落 4000、上限 15000。
  process.env.ANS_EVAL_REQUEST_TIMEOUT_MS = "15000";
  const defaultClock = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
  assert.equal(defaultClock.requestTimeoutMs, 4000,
    "不设就是 4000：环境变量设了也不算，kernel 不读它");
  closeResult(defaultClock);

  const raisedClock = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: 15000 });
  assert.equal(raisedClock.requestTimeoutMs, 15000, "传 15000 生效");
  closeResult(raisedClock);

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 0.5, 1.9]) {
    const r = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: bad });
    assert.equal(r.requestTimeoutMs, 4000, "非法或 ≤0 回落 4000（传的是 " + String(bad) + "）");
    closeResult(r);
  }

  const cappedClock = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: 60000 });
  assert.equal(cappedClock.requestTimeoutMs, 15000, "评测默认上限 15000");
  closeResult(cappedClock);

  const userClock = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: 60000, requestTimeoutCapMs: 60000 });
  assert.equal(userClock.requestTimeoutMs, 60000, "--deadline 的 60s 上限不被评测的 15s 截断");
  closeResult(userClock);

  const tightCap = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: 20000, requestTimeoutCapMs: 1500.5 });
  assert.equal(tightCap.requestTimeoutMs, 1500, "小数 cap 向下取整，不能反手放大成 15000");
  closeResult(tightCap);

  const hugeClock = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials, requestTimeoutMs: 3_000_000_000, requestTimeoutCapMs: 3_000_000_000 });
  assert.equal(hugeClock.requestTimeoutMs, 2_147_483_647, "超过引擎上限的值和 cap 都夹到 2^31-1，不把 RangeError 甩给调用方");
  closeResult(hugeClock);

  // Best-effort diagnostic: a broken stderr must not crash the fail-open
  // build. Sync arm — write() throws. The failure has to be a real one, so the
  // unusable key comes back for these two arms.
  process.env.EXA_API_KEY = UNUSABLE_EXA_KEY;
  process.stderr.write = (() => { throw new Error("EPIPE: broken pipe"); }) as typeof process.stderr.write;
  const syncBroken = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
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
  const asyncBroken = createEngine(undefined, { dbPath: ":memory:", searchCredentials: envCredentials });
  assert.ok(asyncBroken.retriever, "fail-open engine returned despite a broken stderr");
  assert.ok(asyncBroken.providerBuildErrors.exa, "record populated despite a broken stderr");
  closeResult(asyncBroken);
} finally {
  process.stderr.write = origStderrWrite;
  if (savedExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = savedExaKey;
  if (savedEvalTimeout === undefined) delete process.env.ANS_EVAL_REQUEST_TIMEOUT_MS;
  else process.env.ANS_EVAL_REQUEST_TIMEOUT_MS = savedEvalTimeout;
}
console.log("composition-build-errors.test: ok");
