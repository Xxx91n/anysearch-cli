// Atomic write of the user-level config.toml (#539). Rewriting the target in
// place truncates before it writes, so a full disk or a killed process left a
// half-written config — and the read side treats a file it cannot parse as
// "never configured", so the user's settings disappeared without a word.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configWriteSeam, userConfigPath, writeUserLlmConfig } from "../src/config-llm.js";

const GOOD = '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\nbase_url = "https://example.test"\n';

/** A home with the config directory already there, like a machine that ran `ans` before. */
function fixture(): { home: string; path: string } {
  const home = mkdtempSync(join(tmpdir(), "ans-config-write-"));
  mkdirSync(join(home, ".ans"), { recursive: true });
  return { home, path: userConfigPath(home) };
}

/** Temp files the write left behind in the config directory. */
function temps(home: string): string[] {
  return readdirSync(join(home, ".ans")).filter((name) => name.endsWith(".tmp"));
}

/** Run with the write path's filesystem calls replaced, then put them back. */
function withSeam<T>(seam: typeof configWriteSeam, run: () => T): T {
  Object.assign(configWriteSeam, seam);
  try {
    return run();
  } finally {
    delete configWriteSeam.write;
    delete configWriteSeam.rename;
  }
}

test("a successful write publishes the new content and leaves no temp file", () => {
  const { home, path } = fixture();
  assert.equal(writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, home), path);
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.includes('provider = "openai"'));
  assert.ok(raw.includes('model = "gpt-5"'));
  assert.deepEqual(temps(home), [], "a successful write leaves no temp file");
});

test("a write that fails after bytes land leaves the original file unchanged", () => {
  const { home, path } = fixture();
  writeFileSync(path, GOOD);
  const previous = readFileSync(path, "utf8");
  withSeam({
    write: (file, body) => {
      // Half the bytes, then the fault — the shape a full disk leaves behind.
      writeFileSync(file, body.slice(0, 12));
      throw new Error("ENOSPC: no space left on device, write");
    },
  }, () => {
    assert.throws(() => writeUserLlmConfig({ model: "gpt-5" }, home), /could not write/);
  });
  assert.equal(readFileSync(path, "utf8"), previous, "the previous config is byte-for-byte unchanged");
  assert.deepEqual(temps(home), [], "a failed write leaves no temp file");
});

test("a write that fails at the rename leaves the original file unchanged", () => {
  const { home, path } = fixture();
  writeFileSync(path, GOOD);
  const previous = readFileSync(path, "utf8");
  withSeam({
    rename: (from, to) => {
      // The real Windows shape: a holder opened the target without delete sharing.
      throw Object.assign(
        new Error("EPERM: operation not permitted, rename '" + from + "' -> '" + to + "'"),
        { code: "EPERM" },
      );
    },
  }, () => {
    assert.throws(() => writeUserLlmConfig({ model: "gpt-5" }, home), /could not write/);
  });
  assert.equal(readFileSync(path, "utf8"), previous, "the previous config is byte-for-byte unchanged");
  assert.deepEqual(temps(home), [], "a failed write leaves no temp file");
});

test("a failed write names the config file, never the temp path", () => {
  const { home, path } = fixture();
  withSeam({
    rename: (from, to) => {
      throw Object.assign(
        new Error("EPERM: operation not permitted, rename '" + from + "' -> '" + to + "'"),
        { code: "EPERM" },
      );
    },
  }, () => {
    assert.throws(
      () => writeUserLlmConfig({ provider: "openai" }, home),
      (error: Error) => {
        assert.ok(error.message.includes(path), "the message names the file the user knows");
        assert.ok(!error.message.includes(".tmp"), "the temp path stays out of the message");
        return true;
      },
    );
  });
});

test("a thrown non-Error still names the config file", () => {
  const { home, path } = fixture();
  withSeam({
    rename: () => {
      // Not everything thrown is an Error; reading .code off null used to crash
      // here before the message could be built.
      throw "boom";
    },
  }, () => {
    assert.throws(
      () => writeUserLlmConfig({ provider: "openai" }, home),
      (error: Error) => {
        assert.ok(error.message.startsWith("could not write " + path + ": boom"), error.message);
        return true;
      },
    );
  });
});

test("the temp file sits beside the target and is unique per write", () => {
  const { home, path } = fixture();
  const seen: string[] = [];
  withSeam({
    write: (file, body) => {
      seen.push(file);
      writeFileSync(file, body);
    },
  }, () => {
    writeUserLlmConfig({ provider: "openai" }, home);
    writeUserLlmConfig({ model: "gpt-5" }, home);
  });
  assert.equal(seen.length, 2);
  for (const file of seen) {
    assert.equal(dirname(file), dirname(path), "a rename across directories would fail with EXDEV");
    assert.ok(file.endsWith(".tmp"));
  }
  assert.notEqual(seen[0], seen[1], "two writers cannot collide on one temp name");
});

test("the published file is owner-only even over an existing 0644 file", {
  skip: process.platform === "win32" ? "the POSIX mode is not meaningful on Windows" : false,
}, () => {
  const { home, path } = fixture();
  writeFileSync(path, GOOD, { mode: 0o644 });
  chmodSync(path, 0o644); // the umask must not decide what this test starts from
  assert.equal(statSync(path).mode & 0o777, 0o644, "the fixture starts world-readable");
  writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, home);
  assert.equal(statSync(path).mode & 0o777, 0o600, "every write tightens the mode, not just the first");
});
