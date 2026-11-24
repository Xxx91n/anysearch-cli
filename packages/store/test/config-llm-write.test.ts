// Atomic write of the user-level config.toml (#539). Rewriting the target in
// place truncates before it writes, so a full disk or a killed process left a
// half-written config — and the read side treats a file it cannot parse as
// "never configured", so the user's settings disappeared without a word.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync,
  unlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { userConfigPath, writeUserLlmConfig } from "../src/config-llm.js";
import { configWriteSeam } from "../src/config-llm-seam.js";

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

test("a symlinked config file still writes through to its target", (context) => {
  const { home, path } = fixture();
  const real = join(home, "dotfiles-config.toml");
  writeFileSync(real, GOOD);
  try {
    symlinkSync(real, path, "file");
  } catch {
    context.skip("this host does not allow creating symlinks");
    return;
  }
  writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, home);
  assert.ok(lstatSync(path).isSymbolicLink(), "the link is still a link, not a regular file");
  assert.ok(readFileSync(real, "utf8").includes('provider = "openai"'), "the real file got the new content");
  assert.deepEqual(temps(home), [], "no temp file left behind");
});

test("a symlink that cannot be resolved stops the write instead of being replaced", (context) => {
  const { home, path } = fixture();
  writeFileSync(join(home, "dotfiles-config.toml"), GOOD);
  try {
    symlinkSync(join(home, "dotfiles-config.toml"), path, "file");
  } catch {
    context.skip("this host does not allow creating symlinks");
    return;
  }
  // Point the link at something that no longer exists: the write must not fall
  // back to replacing the link with a regular file.
  unlinkSync(join(home, "dotfiles-config.toml"));
  assert.throws(
    () => writeUserLlmConfig({ provider: "openai" }, home),
    /it is a symlink and its target cannot be resolved/,
  );
  assert.ok(lstatSync(path).isSymbolicLink(), "the link is still a link");
  assert.deepEqual(temps(home), [], "no temp file left behind");
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

test("a write sweeps its own stale temp files and leaves every other .tmp", () => {
  const { home, path } = fixture();
  const dir = dirname(path);
  // Take the name from the writer itself, so this test follows its shape
  // instead of pinning a literal.
  let ownTemp = "";
  withSeam({
    write: (file, body) => {
      ownTemp = file;
      writeFileSync(file, body);
    },
  }, () => writeUserLlmConfig({ provider: "openai", model: "gpt-5" }, home));
  // The first write published that temp away; put an abandoned copy back under
  // the same name, and a younger sibling of the same shape.
  writeFileSync(ownTemp, "stale");
  const fresh = ownTemp.slice(0, -".tmp".length) + ".fresh.tmp";
  const unrelated = join(dir, "notes.tmp");
  writeFileSync(fresh, "fresh");
  writeFileSync(unrelated, "unrelated");
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(ownTemp, twoHoursAgo, twoHoursAgo);
  utimesSync(unrelated, twoHoursAgo, twoHoursAgo);
  writeUserLlmConfig({ provider: "openai" }, home);
  assert.ok(!existsSync(ownTemp), "an abandoned temp of this file is swept");
  assert.deepEqual(
    temps(home).sort(),
    [basename(fresh), basename(unrelated)].sort(),
    "only the fresh and unrelated temps survive",
  );
});

test("a stale temp that cannot be deleted does not stop the write", () => {
  const { home, path } = fixture();
  const stuck = join(dirname(path), ".config.toml.999.deadbeef1234.tmp");
  // A directory wearing the temp name: stat succeeds, removal without recursion fails.
  mkdirSync(stuck);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stuck, twoHoursAgo, twoHoursAgo);
  const written = writeUserLlmConfig({ provider: "openai" }, home);
  assert.equal(written, path);
  assert.ok(readFileSync(path, "utf8").includes('provider = "openai"'), "the write went through");
  assert.ok(existsSync(stuck), "the file the sweep could not remove stays where it was");
});

test("a write through the legacy config home sweeps there too", () => {
  const home = mkdtempSync(join(tmpdir(), "ans-config-write-legacy-"));
  const legacy = join(home, ".anysearch-cli");
  mkdirSync(legacy, { recursive: true });
  const path = join(legacy, "config.toml");
  writeFileSync(path, GOOD);
  assert.equal(userConfigPath(home), path, "the fixture starts on the legacy file");
  const stale = join(legacy, ".config.toml.999.deadbeef1234.tmp");
  writeFileSync(stale, "stale");
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stale, twoHoursAgo, twoHoursAgo);
  writeUserLlmConfig({ model: "gpt-5" }, home);
  assert.ok(!existsSync(stale), "the sweep follows the path the writer actually uses");
});

test("a symlinked config is swept beside the real file, not the link", (context) => {
  const { home, path } = fixture();
  const realDir = join(home, "dotfiles");
  mkdirSync(realDir, { recursive: true });
  const real = join(realDir, "config.toml");
  writeFileSync(real, GOOD);
  try {
    symlinkSync(real, path, "file");
  } catch {
    context.skip("this host does not allow creating symlinks");
    return;
  }
  const stale = join(realDir, ".config.toml.999.deadbeef1234.tmp");
  writeFileSync(stale, "stale");
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stale, twoHoursAgo, twoHoursAgo);
  writeUserLlmConfig({ model: "gpt-5" }, home);
  assert.ok(!existsSync(stale), "the sweep follows the link to the file that was written");
});
