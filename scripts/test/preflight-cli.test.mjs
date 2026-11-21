import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "preflight-test.mjs");

test("a red run exits non-zero and names the failed task", () => {
  withFakePnpm({ code: 1, lines: [" Tasks:    2 successful, 3 total", "\u001b[31mFailed:\u001b[0m @anysearch-cli/kernel#test"] }, (bin) => {
    const result = runCli(bin);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /@anysearch-cli\/kernel#test/);
  });
});

test("a green run exits 0 and prints how long it took", () => {
  withFakePnpm({ code: 0, lines: [" Tasks:    1 successful, 1 total"] }, (bin) => {
    const result = runCli(bin);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /green in \d+\.\ds \(full\)/);
  });
});

function runCli(bin) {
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    // A full run starts the gate's own tests, which include this file; the fake
    // pnpm is here to test the runner, not to re-enter it.
    PREFLIGHT_SELF_TEST: "0",
  };
  if (process.platform === "win32") env.Path = env.PATH;
  return spawnSync(process.execPath, [cli, "--full"], { encoding: "utf8", env });
}

function withFakePnpm({ code, lines }, run) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-cli-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh\n${lines.map((line) => `echo "${line}"`).join("\n")}\nexit ${code}\n`);
    chmodSync(join(bin, "pnpm"), 0o755);
    writeFileSync(join(bin, "pnpm.cmd"), `@echo off\r\n${lines.map((line) => `echo ${line}`).join("\r\n")}\r\nexit /b ${code}\r\n`);
    run(bin);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
