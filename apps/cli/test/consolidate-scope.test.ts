// #260 — `ans consolidate` exit codes, scope echo and dry-run reporting
// (spec D5, test T2).
//
// The command is imported directly (no build, no spawn): these assertions are
// about the argument/scope contract and the output it produces, and a real
// spawn would only add process startup to the same code path. The dist-level
// exit-code check lives in the e2e suite that runs after a build.
//
// Offline by construction: the shell may carry a real endpoint, and a test must
// never spend real money. With no LLM configured the command still runs and
// reports llmUnavailable, which is the honest shape this file pins.
//
// Run: pnpm --filter @anysearch-cli/cli run test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatIncompleteCorrection, runConsolidate } from "../src/commands/consolidate.js";

for (const key of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY"]) {
  delete process.env[key];
}

const dir = mkdtempSync(join(tmpdir(), "ans-260-cli-"));
// Keep every run on a temp database: never the operator's real archive.
process.env.ANS_DB_PATH = join(dir, "cli.db");
process.env.USERPROFILE = dir;
process.env.HOME = dir;

/** Capture what the command writes without letting it reach the test runner. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: any) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    const code = await runConsolidate(argv);
    return { code, out, err };
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
  }
}

test("no scope: exit 2, refuses the full archive, writes nothing to stdout", async () => {
  const r = await run([]);
  assert.equal(r.code, 2);
  assert.match(r.err, /explicit scope is required/i);
  assert.match(r.err, /full archive/i);
  assert.equal(r.out, "");
});

test("bare --session with no id: exit 2", async () => {
  const r = await run(["--session"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--session requires an id/);
});

test("--session with a following known flag: exit 2 (not read as an id)", async () => {
  const r = await run(["--session", "--dry-run"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--session requires an id/);
});

test("a session id starting with -- is accepted (the scope rule allows it)", async () => {
  // The value is legal per the shared scope rule, so the CLI must not reject it
  // just for the prefix; only the command's own options signal a missing value.
  const r = await run(["--session", "--weird-handle", "--dry-run"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: session --weird-handle/);
});

test("--memory with a non-integer id: exit 2 (no other flag can rescue it)", async () => {
  for (const bad of [["--memory", "0"], ["--memory", "-3"], ["--memory", "1.5"], ["--memory", "abc"]]) {
    const r = await run(bad);
    assert.equal(r.code, 2, "argv " + JSON.stringify(bad) + " exits 2");
    assert.match(r.err, /positive integer id/);
  }
});

test("unknown flag: exit 2 instead of silently running --apply", async () => {
  const r = await run(["--session", "s1", "--oops"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown flag/);
});

test("session scope runs and echoes the scope it used", async () => {
  const r = await run(["--session", "cli-session-a", "--dry-run"]);
  assert.equal(r.code, 0, "an empty but valid scope is a successful run (stderr: " + r.err + ")");
  assert.match(r.out, /^consolidate \(dry-run\):/m);
  assert.match(r.out, /scope: session cli-session-a/);
  assert.match(r.out, /materials read 0/);
  // The honest accounting: no model configured means no call, and the gaps are named.
  assert.match(r.out, /calls 0/);
  assert.match(r.out, /MISSING/);
});

test("dry-run says nothing was saved and that the preview describes the state it read", async () => {
  const r = await run(["--session", "cli-session-a", "--dry-run"]);
  assert.match(r.out, /dry-run: nothing saved/);
  assert.match(r.out, /concurrent write/);
});

test("memory scope echoes the list and the requested count", async () => {
  const r = await run(["--memory", "5", "--memory", "7", "--apply"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: memory 5, 7/);
  assert.match(r.out, /requested/);
  assert.doesNotMatch(r.out, /dry-run/);
  // No owning session => nothing to charge. The output has to say that, not
  // silently imply a cap was enforced.
  assert.match(r.out, /budget: unmetered — a memory-list scope has no owning session to charge/);
});

test("memory list beats the session: the session is not applied and the output says so", async () => {
  const r = await run(["--session", "cli-session-a", "--memory", "5", "--dry-run"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: memory 5/);
  assert.match(r.out, /materials read 0 of 1 requested/);
  assert.match(r.out, /sessionId not applied/);
});

test("several --session owners: unmetered, because one run's spend cannot be split", async () => {
  const r = await run(["--session", "cli-session-a", "--session", "cli-session-b", "--dry-run"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: session cli-session-a, cli-session-b/);
  assert.match(r.out, /budget: unmetered — several session owners cannot share one run's spend/);
});

test("help documents the scope requirement and the cost basis", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Explicit scope is required/i);
  assert.match(r.out, /--memory/);
  assert.match(r.out, /not-called, unknown, a price estimate, or a server-returned/i);
  assert.match(r.out, /unknown cost is never shown as zero/i);
});

// --- #261: the single-evidence correction flag ------------------------------

test("--single-evidence is a known flag: accepted, does not eat the next value", async () => {
  const r = await run(["--single-evidence", "--memory", "5", "--dry-run"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: memory 5/);
  // No unknown-flag error, and --memory still got its id.
  assert.doesNotMatch(r.err, /unknown flag/);
});

test("--single-evidence with a session scope runs and the flag is not confused with --session", async () => {
  const r = await run(["--session", "cli-single", "--single-evidence", "--dry-run"]);
  assert.equal(r.code, 0, "stderr: " + r.err);
  assert.match(r.out, /scope: session cli-single/);
});

test("help documents the single-evidence exception and the withheld-correction exit", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /--single-evidence/);
  assert.match(r.out, /may only correct existing\s+knowledge/i);
  assert.match(r.out, /correction as incomplete \(exit 1\)/i);
});

test("CLI incomplete correction prints retained old knowledge, candidate and sources", () => {
  // Use the actual formatter called by runConsolidate: an ordinary empty-store
  // command cannot reach the incomplete-correction branch without model seams.
  for (const stage of ["merge-failed", "merge-empty", "final-check"] as const) {
    const out = formatIncompleteCorrection({
      oldId: 42,
      oldContent: "Support hours weekdays; email help@acme.example.",
      candidate: "Support hours now 24x7.",
      evidence: [{ title: "Official update", snippet: "24x7", url: "https://acme.example/notice" }],
      stage,
      reason: "unable to preserve old facts",
    });
    assert.match(out, new RegExp("correction incomplete \\(" + stage + "\\)"));
    assert.match(out, /knowledge 42 was NOT replaced/);
    assert.match(out, /old: Support hours weekdays; email help@acme\.example/);
    assert.match(out, /candidate: Support hours now 24x7/);
    assert.match(out, /sources: https:\/\/acme\.example\/notice/);
    assert.ok(out.indexOf("  old: ") < out.indexOf("  candidate: "),
      "old knowledge must precede candidate for " + stage);
  }
});

rmSync(dir, { recursive: true, force: true });
