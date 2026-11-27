import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gitEnv } from "../preflight-git.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scripts, "..");
const cli = join(scripts, "preflight-hooks.mjs");
const source = readFileSync(join(repoRoot, "scripts", "hooks", "pre-push-user"), "utf8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const hookPath = (cwd) => join(cwd, ".git", "hooks", "pre-push");

/** A temp dir whose git sees no config of the operator's, plus a fresh clone in it. */
function withSandbox(fn) {
  const base = mkdtempSync(join(tmpdir(), "ans-hooks-"));
  const home = join(base, "home");
  const empty = join(base, "gitconfig-empty");
  mkdirSync(home, { recursive: true });
  writeFileSync(empty, "");
  // A global core.hooksPath, or a repository exported by the caller, would send
  // installs outside the sandbox — and --force could then overwrite a real hook
  // on the operator's machine.
  const env = gitEnv(process.env);
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_CONFIG_NOSYSTEM: "1",
  });
  // A developer who exported the strict switch for their own pushes would turn
  // every case below into a full run; the case that wants it passes it in.
  delete env.ANS_PUSH_GATE;
  const git = (cwd, args) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const run = (cwd, args, command = cli, extraEnv = {}) =>
    spawnSync(process.execPath, [command, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
  const cloneInto = (origin, name) => {
    const dir = join(base, name);
    const result = spawnSync("git", ["clone", "-q", origin, dir], { cwd: base, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git clone failed: ${result.stderr}`);
    return dir;
  };

  const clone = () => {
    const origin = join(base, "origin");
    mkdirSync(origin);
    git(origin, ["init", "-q", "--initial-branch=main"]);
    const dir = cloneInto(origin, "clone");
    placeGate(dir);
    return dir;
  };

  // A clone whose origin already holds one commit: origin/HEAD exists, so git
  // can name a change set, and the gate reads a one-package workspace instead of
  // nothing. The gate stub is committed, so a fresh clone has no changes at all.
  const seeded = () => {
    const origin = join(base, "seed-origin");
    mkdirSync(join(origin, "packages", "store"), { recursive: true });
    git(origin, ["init", "-q", "--initial-branch=main"]);
    writeFileSync(join(origin, "README.md"), "# seed\n");
    writeFileSync(join(origin, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    writeFileSync(join(origin, "packages", "store", "package.json"), '{\n  "name": "@anysearch-cli/store"\n}\n');
    placeGate(origin);
    git(origin, ["add", "-A"]);
    git(origin, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "seed"]);
    return cloneInto(origin, "seeded");
  };

  try {
    return fn({ base, env, git, run, clone, seeded });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function installOk(box, cwd, ...flags) {
  const result = box.run(cwd, ["install", ...flags]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// A stand-in for scripts/preflight-test.mjs at the path the hook names: status
// checks that the script is there and parses, and never runs it.
const GATE_STUB = [
  "#!/usr/bin/env node",
  "// Stand-in for scripts/preflight-test.mjs: hooks:status only checks that this",
  "// file is there and parses, so the fixture needs no gate of its own.",
  "",
].join("\n");

function placeGate(dir) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "preflight-test.mjs"), GATE_STUB);
}

/** A clone that holds the script itself, the way a real checkout does. */
function withScriptsIn(clone) {
  mkdirSync(join(clone, "scripts", "hooks"), { recursive: true });
  copyFileSync(join(repoRoot, "package.json"), join(clone, "package.json"));
  // Every module the copy imports, so a new relative import in the script cannot
  // leave this fixture short of a file.
  for (const name of readdirSync(scripts)) {
    if (name.endsWith(".mjs")) copyFileSync(join(scripts, name), join(clone, "scripts", name));
  }
  copyFileSync(join(repoRoot, "scripts", "hooks", "pre-push-user"), join(clone, "scripts", "hooks", "pre-push-user"));
  return join(clone, "scripts", "preflight-hooks.mjs");
}

test("package.json wires both commands to this script", () => {
  assert.equal(manifest.scripts["hooks:install"], "node scripts/preflight-hooks.mjs install");
  assert.equal(manifest.scripts["hooks:status"], "node scripts/preflight-hooks.mjs status");
});

test("a fresh clone says the hook is missing until one command installs it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const before = box.run(clone, ["status"]);
    assert.equal(before.status, 1, before.stderr);
    assert.match(before.stderr, /pre-push is missing/);
    assert.match(before.stderr, /pnpm -w hooks:install from a subdirectory/);

    installOk(box, clone);

    assert.equal(readFileSync(hookPath(clone), "utf8"), source);

    const after = box.run(clone, ["status"]);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /runs: scripts\/preflight-test\.mjs --pushed/);
  });
});

test("the commands find the repo from a subdirectory, not only the root", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const nested = join(clone, "apps", "cli");
    mkdirSync(nested, { recursive: true });
    installOk(box, nested);
    const status = box.run(nested, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("installing twice is not an error and does not rewrite the file", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);

    const stamp = statSync(hookPath(clone)).mtimeMs;
    const again = installOk(box, clone);
    assert.match(again.stdout, /already installed and current/);
    assert.equal(statSync(hookPath(clone)).mtimeMs, stamp, "a second install rewrote the hook");
  });
});

test("install never touches GitButler's pre-commit and clears our old commit hook", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const hooks = join(clone, ".git", "hooks");
    const preCommit = join(hooks, "pre-commit");
    const gbutler = "#!/bin/sh\n# GitButler owns this file\nexit 0\n";
    writeFileSync(preCommit, gbutler);
    const oldCommitHook = join(hooks, "pre-commit-user");
    writeFileSync(oldCommitHook, "#!/bin/sh\nexit 0\n");

    const install = installOk(box, clone);
    assert.equal(readFileSync(preCommit, "utf8"), gbutler, "pre-commit was written to");
    assert.equal(existsSync(oldCommitHook), false, "the old commit hook is still there");
    assert.match(install.stdout, /left alone/);
  });
});

test("a hook left behind by an older script is reported, and install refreshes it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace(/^exec .*$/m, (line) => `${line} --old`));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date, its code differs/);

    const install = installOk(box, clone);
    assert.match(install.stdout, /replaced with the current script/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("a hook whose comments moved on is still current, and install leaves the bytes alone", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    // A sibling worktree installed from a different commit: same code, other
    // comments. That cannot change what the hook does.
    const edited = `${readFileSync(hookPath(clone), "utf8")}\n# installed by another checkout\n`;
    writeFileSync(hookPath(clone), edited);
    const stamp = statSync(hookPath(clone)).mtimeMs;

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);

    const install = installOk(box, clone);
    assert.match(install.stdout, /already installed and current/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), edited, "install rewrote a hook that already runs the right code");
    assert.equal(statSync(hookPath(clone)).mtimeMs, stamp);
  });
});

test("someone else's pre-push is reported, and install refuses to overwrite it without --force", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = "#!/bin/sh\necho mine\n";
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);

    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /--force/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, "a hook we do not own was overwritten");

    installOk(box, clone, "--force");
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a copy that gained a command is out of date, and install brings it back", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    // Still our hook (banner and exec are ours), but it runs something the
    // source does not: comments may differ between checkouts, commands may not.
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace(/^exec /m, "set -e\nexec "));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date/);
    assert.match(stale.stderr, /runs: scripts\/preflight-test\.mjs --pushed/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a changed shebang counts as a different hook", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace("#!/bin/sh", "#!/bin/bash"));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date, its code differs/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("status names what a hook runs even when it is not our command", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "#!/bin/sh\nexec ./scripts/gate.sh\n");

    const foreign = box.run(clone, ["status"]);
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /another script, not ours/);
    assert.match(foreign.stderr, /runs: exec \.\/scripts\/gate\.sh/);
  });
});

test("a banner outside the header is a note, not ownership", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = ["#!/bin/sh", "# mine", "# notes: this used to be", "# anysearch push gate", "echo theirs", ""].join("\n");
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs);
  });
});

test("a header banner that does not run the gate is still someone else's", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = "#!/bin/sh\n# anysearch pre-push: disabled on this box\nexit 0\n";
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs);
  });
});

test("a hand-written hook that only mentions the gate is still someone else's", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = [
      "#!/bin/sh",
      "# wrapper, see scripts/preflight-test.mjs",
      "echo theirs",
      'exec node "$(git rev-parse --show-toplevel)/scripts/preflight-test.mjs" --pushed',
      "",
    ].join("\n");
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1, status.stderr);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, "a hand-written hook was overwritten");
  });
});

test("an empty pre-push is nobody's hook: status says so and install replaces it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /pre-push is an empty file/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a hook with no exec line still has its command named", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "#!/bin/sh\n. _/husky.sh\nnpm test\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    assert.match(status.stderr, /runs: \. _\/husky\.sh/);
  });
});

test("install goes where git reads hooks, including a core.hooksPath directory", () => {
  withSandbox((box) => {
    const clone = box.clone();
    mkdirSync(join(clone, ".githooks"));
    box.git(clone, ["config", "core.hooksPath", ".githooks"]);

    installOk(box, clone);
    assert.equal(readFileSync(join(clone, ".githooks", "pre-push"), "utf8"), source);
    assert.equal(existsSync(hookPath(clone)), false, "the hook landed where git does not read it");
    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("outside a git repo it says it cannot tell instead of guessing", () => {
  withSandbox((box) => {
    const empty = join(box.base, "not-a-repo");
    mkdirSync(empty);

    const status = box.run(empty, ["status"]);
    assert.equal(status.status, 2);
    assert.match(status.stderr, /cannot tell/);
    const refused = box.run(empty, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
  });
});

test("an unknown command is a usage error, not a silent success", () => {
  withSandbox((box) => {
    const clone = box.clone();
    for (const args of [[], ["instal"], ["status", "--wat"], ["constructor"], ["toString", "--force"]]) {
      const result = box.run(clone, args);
      assert.equal(result.status, 2, `${args.join(" ") || "(no args)"} exited ${result.status}`);
      assert.match(result.stderr, /usage:/);
    }
  });
});

test("a clone that holds the script runs both commands itself", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const local = withScriptsIn(clone);

    const before = box.run(clone, ["status"], local);
    assert.equal(before.status, 1, before.stderr);

    const install = box.run(clone, ["install"], local);
    assert.equal(install.status, 0, install.stderr);

    const after = box.run(clone, ["status"], local);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("the documented pnpm commands reach the script, --force included", (t) => {
  withSandbox((box) => {
    const clone = box.clone();
    withScriptsIn(clone);
    const pnpm = (args) =>
      spawnSync("pnpm", args, { cwd: clone, env: box.env, encoding: "utf8", shell: process.platform === "win32" });

    const probe = pnpm(["-v"]);
    if (probe.error || probe.status !== 0) {
      // The only check that the command AGENTS.md documents works must run in
      // CI, so a missing pnpm there is a failure, not a skip.
      if (process.env.CI) assert.fail(`pnpm is not on PATH in CI: ${probe.error?.message ?? probe.stderr}`);
      t.skip("pnpm is not on PATH here");
      return;
    }

    const before = pnpm(["hooks:status"]);
    assert.equal(before.status, 1, before.stderr);

    const install = pnpm(["hooks:install"]);
    assert.equal(install.status, 0, install.stderr);

    const after = pnpm(["hooks:status"]);
    assert.equal(after.status, 0, after.stderr);

    const theirs = "#!/bin/sh\necho mine\n";
    writeFileSync(hookPath(clone), theirs);
    const refused = pnpm(["hooks:install"]);
    assert.notEqual(refused.status, 0, `pnpm swallowed the refusal: ${refused.stderr}`);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, refused.stderr);

    const forced = pnpm(["hooks:install", "--force"]);
    assert.equal(forced.status, 0, `pnpm did not pass --force through: ${forced.stderr}`);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a hook without the execute bit is reported, and install fixes it", { skip: process.platform === "win32" }, () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    chmodSync(hookPath(clone), 0o644);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1, status.stderr);
    assert.match(status.stderr, /not executable/);

    installOk(box, clone);
    assert.notEqual(statSync(hookPath(clone)).mode & 0o111, 0, "install left the hook unexecutable");
    const fixed = box.run(clone, ["status"]);
    assert.equal(fixed.status, 0, fixed.stderr);
  });
});

test("status names the mode a push lands in and what waiting for it costs", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);

    const clean = box.run(clone, ["status"]);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /mode: nothing to run — no changed files/);
    assert.match(clean.stdout, /wait budget: none — nothing runs/);

    writeFileSync(join(clone, "packages", "store", "index.ts"), "export const a = 1;\n");
    const incremental = box.run(clone, ["status"]);
    assert.equal(incremental.status, 0, incremental.stderr);
    assert.match(incremental.stdout, /mode: incremental/);
    assert.match(incremental.stdout, /set the calling tool's timeout to 0, which means no cap, or to at least 600/);
  });
});

test("a change no package owns reads as the advisory mode and runs nothing", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    writeFileSync(join(clone, "tools.mjs"), "export const b = 2;\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: advisory/);
    assert.match(status.stdout, /CI's check-build covers that change/);
    assert.match(status.stdout, /wait budget: none — nothing runs/);
  });
});

// A root file's readers run without their dependents, so the incremental sentence
// about "inside a package and everything that depends on it" would overstate it.
test("a root file runs its readers, and the line says so", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    // AGENTS.md is a row in the plan's reader table: store's tests read it.
    writeFileSync(join(clone, "AGENTS.md"), "# notes\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: incremental — a changed root file runs only the packages whose tests read it/);
    assert.match(status.stdout, /at least 600/);
  });
});

test("a package change next to a root file names the readers it adds", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    writeFileSync(join(clone, "packages", "store", "index.ts"), "export const a = 1;\n");
    writeFileSync(join(clone, "AGENTS.md"), "# notes\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: incremental — a package change runs that package and its dependents, plus the packages whose tests read a changed root file/);
  });
});

test("a docs-only change reads as nothing to run, not as a test run", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    mkdirSync(join(clone, "docs"));
    writeFileSync(join(clone, "docs", "note.md"), "# note\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: nothing to run — every changed file is documentation/);
  });
});

// A hook can carry our banner and still run the gate in a line status cannot
// parse. It is ours: install has to put it back, not refuse it as someone else's.
test("our hook with an exec line status cannot parse is still ours, and install fixes it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    // The `;` sits right after the script name, where the gate command's own
    // shape ends: status cannot parse it, but the hook is still ours.
    writeFileSync(
      hookPath(clone),
      source.replace(/^(exec .*)$/m, 'exec node "$(git rev-parse --show-toplevel)/scripts/preflight-test.mjs"; echo done'),
    );

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1, status.stderr);
    assert.match(status.stderr, /out of date/);

    const install = box.run(clone, ["install"]);
    assert.equal(install.status, 0, `install refused our own hook: ${install.stderr}`);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

// Only a hook that already matches the source gets there: anything else that
// cannot be parsed is stale, and install repairs it. So the advice has to name the
// source, or the person reinstalls and lands in the same place.
test("a hook source status cannot follow is reported against the source, not the install", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const local = withScriptsIn(clone);
    const hookSource = join(clone, "scripts", "hooks", "pre-push-user");
    writeFileSync(
      hookSource,
      readFileSync(hookSource, "utf8").replace(/^(exec .*)$/m, 'exec node "$(git rev-parse --show-toplevel)/scripts/preflight-test.mjs"; echo done'),
    );

    const install = box.run(clone, ["install"], local);
    assert.equal(install.status, 0, install.stderr);

    const status = box.run(clone, ["status"], local);
    assert.equal(status.status, 2, status.stderr);
    assert.match(status.stderr, /cannot follow the hook's exec line/);
    // Two keywords, not the whole sentence: the advice may be reworded, and the
    // file's other assertions read this way.
    assert.match(status.stderr, /pre-push-user/);
    assert.match(status.stderr, /hooks:install/);
  });
});

// The repo's own hook source is where a lasting "always run everything" edit
// lands: change it, install, and the installed hook still counts as current.
test("a hook source that runs the whole suite reads as the full mode", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const local = withScriptsIn(clone);
    const hookSource = join(clone, "scripts", "hooks", "pre-push-user");
    writeFileSync(hookSource, readFileSync(hookSource, "utf8").replace(/^(exec .*)$/m, "$1 --full"));

    const install = box.run(clone, ["install"], local);
    assert.equal(install.status, 0, install.stderr);

    const status = box.run(clone, ["status"], local);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: full — every push runs the whole suite/);
    assert.match(status.stdout, /at least 900/);
  });
});

test("ANS_PUSH_GATE=strict reads as the full mode and a longer wait", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);

    const status = box.run(clone, ["status"], cli, { ANS_PUSH_GATE: "strict" });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: full — every push runs the whole suite/);
    assert.match(status.stdout, /set the calling tool's timeout to 0, which means no cap, or to at least 900/);
  });
});

test("a change set git cannot name reads as unknown, not as a fault", () => {
  withSandbox((box) => {
    // An empty origin has no HEAD to compare against, which is a repository
    // without commits, not a broken gate.
    const clone = box.clone();
    installOk(box, clone);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /mode: unknown/);
    assert.match(status.stdout, /wait budget: unknown/);
  });
});

test("a gate script that is not in the checkout is a problem, not a healthy status", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    rmSync(join(clone, "scripts", "preflight-test.mjs"));

    const status = box.run(clone, ["status"]);
    // 2 is the gate's own code for "could not do its job", which is what a script
    // that is gone means; 1 would say the code under test is bad.
    assert.equal(status.status, 2, status.stderr);
    assert.match(status.stderr, /blocked: the gate script is not in this checkout: .*preflight-test\.mjs/);
    assert.doesNotMatch(status.stdout, /mode:/);
  });
});

test("a gate script that does not parse is a problem too", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    writeFileSync(join(clone, "scripts", "preflight-test.mjs"), "export const = ;\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 2, status.stderr);
    assert.match(status.stderr, /blocked: the gate script does not parse: SyntaxError/);
  });
});

test("a gate script whose import is gone is a problem too", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    // The script parses; what it loads does not exist, which is how a half-deleted
    // scripts/ directory fails at the first line of the hook.
    writeFileSync(join(clone, "scripts", "preflight-test.mjs"), 'import "./preflight-gone.mjs";\n');

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 2, status.stderr);
    assert.match(status.stderr, /blocked: the gate script imports a file that is not there: .*preflight-gone\.mjs/);
  });
});

test("a repository the gate cannot read is blocked, not reported as fine", () => {
  withSandbox((box) => {
    const clone = box.seeded();
    installOk(box, clone);
    writeFileSync(join(clone, "packages", "store", "package.json"), "{ broken\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 2, status.stderr);
    assert.match(status.stderr, /blocked: the gate cannot read this repository/);
    assert.match(status.stderr, /reason: cannot read packages\/store\/package\.json/);
  });
});
