// #306 — the Active Domain is either in effect, absent by choice, or a fault.
//
// What this pins:
//   - the three states are told apart, and `undefined` never stands for two of
//     them;
//   - `ans domain <name>` validates before it persists: a name that does not
//     resolve, or a config file that refuses the write, leaves the previous
//     selection in place and exits non-zero.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDomainConstraint } from "@anysearch-cli/kernel";
import { runDomain } from "../src/commands/domain.js";
import { runSearch } from "../src/commands/search.js";
import { runConsolidate } from "../src/commands/consolidate.js";
import { runTeardown } from "../src/teardown.js";

const dir = mkdtempSync(join(tmpdir(), "ans-306-domain-"));
const domainsDir = join(dir, "domains");
mkdirSync(domainsDir, { recursive: true });

writeFileSync(join(domainsDir, "good.toml"), [
  'name = "good"',
  '[sources]',
  'enabled = ["anysearch"]',
  'urlAllowlist = ["good.example"]',
  '[skills]',
  'active = ["search"]',
  '[hooks]',
  'toolWhitelist = ["search"]',
  '[rag]',
  'adapter = "none"',
  '',
].join("\n"), "utf8");

writeFileSync(join(domainsDir, "other.toml"), [
  'name = "other"',
  '[sources]',
  'enabled = ["anysearch"]',
  '[rag]',
  'adapter = "none"',
  '',
].join("\n"), "utf8");

// Found on the chain but unusable: the same fault family `createEngine` refuses.
writeFileSync(join(domainsDir, "broken.toml"), [
  'name = "broken"',
  '[sources]',
  'enabled = ["anysearch"]',
  'urlAllowlist = ["https://not-a-hostname.example"]',
  '[rag]',
  'adapter = "none"',
  '',
].join("\n"), "utf8");

const ENV_KEYS = ["ANS_DOMAINS_DIR", "ANS_DOMAIN", "ANS_DB_PATH", "USERPROFILE", "HOME"] as const;
const previousEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
process.env.ANS_DOMAINS_DIR = domainsDir;
process.env.ANS_DB_PATH = join(dir, "cli.db");
process.env.USERPROFILE = dir;
process.env.HOME = dir;
delete process.env.ANS_DOMAIN;

const configFile = join(dir, ".anysearch", "config.env");

function resetSelection(): void {
  delete process.env.ANS_DOMAIN;
  try { rmSync(join(dir, ".anysearch"), { recursive: true, force: true }); } catch { /* absent */ }
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: any) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
  }
}

function runDomainCaptured(argv: string[]) {
  return capture(() => runDomain(argv));
}

function runConsolidateCaptured(argv: string[]) {
  return capture(() => runConsolidate(argv));
}

test("undeclared is its own state, not a failed lookup", () => {
  const c = resolveDomainConstraint({ dirs: [domainsDir] });
  assert.equal(c.state, "undeclared");
});

test("a name that resolves is established, with its schema", () => {
  const c = resolveDomainConstraint({ name: "good", dirs: [domainsDir] });
  assert.equal(c.state, "established");
  if (c.state !== "established") return;
  assert.deepEqual(c.schema.sources.urlAllowlist, ["good.example"]);
});

test("a declared name that is missing is a fatal failure", () => {
  const c = resolveDomainConstraint({ name: "nobody-here", dirs: [domainsDir] });
  assert.equal(c.state, "failed");
  if (c.state !== "failed") return;
  assert.equal(c.fault, "missing");
  assert.equal(c.fatal, true, "an explicit declaration that cannot be honoured stops the work");
  assert.match(c.reason, /nobody-here/);
});

test("the convention default being missing is NOT fatal (legal undeclared run)", () => {
  const c = resolveDomainConstraint({ name: "nobody-here", declared: false, dirs: [domainsDir] });
  assert.equal(c.state, "failed");
  if (c.state !== "failed") return;
  assert.equal(c.fatal, false, "nobody asked for this name, so no filtering stays legal");
});

test("a file that exists but does not validate is always fatal", () => {
  const c = resolveDomainConstraint({ name: "broken", declared: false, dirs: [domainsDir] });
  assert.equal(c.state, "failed");
  if (c.state !== "failed") return;
  assert.equal(c.fault, "broken");
  assert.equal(c.fatal, true, "absent ≠ broken: a broken file is a fault whoever named it");
});

test("ans domain <good> persists only after the domain resolves", async () => {
  resetSelection();
  const r = await runDomainCaptured(["good"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.equal(process.env.ANS_DOMAIN, "good", "the process uses the new selection");
  const persisted = readFileSync(configFile, "utf8");
  assert.match(persisted, /^ANS_DOMAIN=good$/m, "the selection is written after validation");
  assert.match(r.out, /good/);
});

test("ans domain <missing> changes nothing and fails", async () => {
  resetSelection();
  await runDomainCaptured(["good"]);
  const before = readFileSync(configFile, "utf8");
  const r = await runDomainCaptured(["nobody-here"]);
  assert.notEqual(r.code, 0, "a switch that did not happen must not exit 0");
  assert.equal(readFileSync(configFile, "utf8"), before, "the previous selection is untouched");
  assert.equal(process.env.ANS_DOMAIN, "good", "the process keeps using the previous selection");
  assert.match(r.err, /没换成/, "it says plainly that nothing was switched");
  assert.doesNotMatch(r.err, /persisted/i, "and never claims a write happened");
});

test("ans domain <broken> changes nothing and fails", async () => {
  resetSelection();
  await runDomainCaptured(["good"]);
  const before = readFileSync(configFile, "utf8");
  const r = await runDomainCaptured(["broken"]);
  assert.notEqual(r.code, 0);
  assert.equal(readFileSync(configFile, "utf8"), before);
  assert.equal(process.env.ANS_DOMAIN, "good");
});

test("a config file that cannot be written keeps the previous selection", async () => {
  resetSelection();
  // A directory where the config file belongs makes the write fail on every OS.
  mkdirSync(join(dir, ".anysearch", "config.env"), { recursive: true });
  delete process.env.ANS_DOMAIN;
  const r = await runDomainCaptured(["good"]);
  assert.notEqual(r.code, 0, "a failed write is a failed switch");
  assert.equal(process.env.ANS_DOMAIN, undefined, "the process does not claim a selection it could not persist");
  assert.match(r.err, /写不进去/);
  assert.ok(existsSync(configFile), "the path stays what it was");
});

test("a write that fails at the temp file leaves the old selection intact", async () => {
  resetSelection();
  await runDomainCaptured(["good"]);
  const before = readFileSync(configFile, "utf8");
  // The atomic write goes through <config>.tmp. Making that path a directory
  // fails the temp write — the exact moment a plain truncating write would have
  // already emptied the config.
  mkdirSync(configFile + ".tmp", { recursive: true });
  const r = await runDomainCaptured(["other"]);
  assert.notEqual(r.code, 0, "a failed write is a failed switch");
  assert.equal(readFileSync(configFile, "utf8"), before, "the file still holds the previous selection");
  assert.equal(process.env.ANS_DOMAIN, "good");
  rmSync(configFile + ".tmp", { recursive: true, force: true });
});

test("ans search stops on a declared domain that cannot be built", async () => {
  resetSelection();
  process.env.ANS_DOMAIN = "nobody-here";
  await assert.rejects(
    () => runSearch(["q"]),
    (e: Error) => /nobody-here/.test(e.message) && /没建起来/.test(e.message),
    "a declared-but-missing domain must stop before any provider request",
  );
  resetSelection();
});

test("ans consolidate returns non-zero on a declared domain that cannot be built", async () => {
  resetSelection();
  process.env.ANS_DOMAIN = "nobody-here";
  const r = await runConsolidateCaptured(["--session", "whatever", "--dry-run"]);
  assert.equal(r.code, 1, "a declared constraint that cannot be read stops the run");
  assert.match(r.err, /没建起来/);
  assert.match(r.err, /nobody-here/);
  resetSelection();
});

test("showing the current selection reports a broken one as a failure", async () => {
  resetSelection();
  process.env.ANS_DOMAIN = "nobody-here";
  const r = await runDomainCaptured([]);
  assert.equal(r.code, 1, "doctor-style: a declared domain that will not load is not 'fine'");
  assert.match(r.err, /没建起来/);
  resetSelection();
});

// Restore the caller's environment; the CLI test runner shares one process.
test("cleanup", () => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // The command paths open the durable store; close what they registered before
  // deleting the directory (Windows refuses to remove an open database).
  try { runTeardown(); } catch { /* best-effort */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* OS temp, may still be pinned */ }
});
