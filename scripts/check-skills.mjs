#!/usr/bin/env node
// Repo-wide Agent Skills check (#387).
//
// Every SKILL.md Git can see is handed to validateSkillDirectory from
// apps/cli/src/skill-store.ts — the same code `ans skill install` and
// `ans skill validate` run, so the three cannot drift apart.
//
// Usage:
//   node scripts/check-skills.mjs                  # every SKILL.md Git can see
//   node scripts/check-skills.mjs <dir|SKILL.md>   # only these
//
// Exit codes: 0 every skill passes · 1 a skill broke a rule, or discovery found
// no SKILL.md at all · 2 the check could not run (no Git, no tsx, a path
// argument that does not exist, a file that cannot be read).
//
// `ANS_CHECK_SKILLS_ROOT` retargets discovery at another checkout; only the
// script's tests use it.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
/** Which checkout to scan. The tests point this at a throwaway repo. */
const ROOT = process.env.ANS_CHECK_SKILLS_ROOT ? path.resolve(process.env.ANS_CHECK_SKILLS_ROOT) : SCRIPT_ROOT;
/** Set in the child so the re-entry below happens exactly once. */
const TSX_MARKER = "ANS_CHECK_SKILLS_TSX";
/**
 * The workspace tsx loader: the checker imports TypeScript sources directly, no
 * build first. Resolved through the package so a tsx upgrade that moves its
 * files does not turn into "skill check failed".
 */
function tsxLoader() {
  const fromCli = createRequire(path.join(SCRIPT_ROOT, "apps", "cli", "package.json"));
  return fromCli.resolve("tsx");
}

function fail(code, detail) {
  process.stderr.write("check-skills: " + detail + "\n");
  process.exit(code);
}

/** Map a CLI argument to the SKILL.md it names. */
function skillFileOf(target) {
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error("no such file or directory: " + resolved);
  return stat.isDirectory() ? path.join(resolved, "SKILL.md") : resolved;
}

/**
 * Every SKILL.md Git can see: tracked files plus the ones not ignored yet, so a
 * newly written skill is checked before it is staged. Not a directory walk —
 * build output (apps/cli/dist carries a copy of the plugin skills) and
 * node_modules hold copies of the same file, and checking those would report
 * every rule twice.
 */
function gitVisibleSkillFiles() {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
  });
  if (listed.error) throw new Error("cannot run git ls-files: " + listed.error.message);
  if (listed.status !== 0) {
    throw new Error("git ls-files failed in " + ROOT + ": " + (String(listed.stderr).trim() || "exit " + listed.status));
  }
  return [...new Set(String(listed.stdout).split("\0").filter(Boolean)
    .filter((file) => path.posix.basename(file) === "SKILL.md"))]
    .map((file) => path.join(ROOT, file))
    .sort();
}

/** Rule messages end with ": <file>", and the [FAIL] line already names the file. */
function withoutTrailingPath(message, file) {
  const suffix = ": " + file;
  return message.endsWith(suffix) ? message.slice(0, -suffix.length) : message;
}

/** Show a path relative to where the check was started, for readable CI logs. */
function shown(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : file;
}

async function run() {
  const { validateSkillDirectory, SkillError } = await import("../apps/cli/src/skill-store.ts");
  const args = process.argv.slice(2);
  let files;
  try {
    files = args.length > 0 ? args.map(skillFileOf) : gitVisibleSkillFiles();
  } catch (error) {
    fail(2, error.message);
  }
  // Design: a green run that checked nothing is not evidence. The repository
  // ships a skill; if discovery finds none, the check is broken, not the skills.
  if (files.length === 0) {
    process.stdout.write("[FAIL] no SKILL.md found — refusing to pass with nothing checked\n");
    return 1;
  }
  let failed = 0;
  let unreadable = 0;
  for (const file of files) {
    try {
      const name = validateSkillDirectory(path.dirname(file));
      process.stdout.write(`[OK] ${shown(file)} (name: ${name})\n`);
    } catch (error) {
      // A rule failure reads "field + what was expected"; anything else (a
      // permission error, an I/O failure) is reported apart and fails the run as
      // "could not check", never as "this skill is broken". SkillError carries
      // the exit code the CLI would use, so a usage-class error would stay apart
      // too — no rule raises one today, but the split does not depend on that.
      if (error instanceof SkillError && error.exitCode === 1) {
        failed += 1;
        process.stdout.write(`[FAIL] ${shown(file)}: ${withoutTrailingPath(error.message, file)}\n`);
      } else {
        unreadable += 1;
        process.stdout.write(`[ERROR] ${shown(file)}: ${String(error && error.stack || error)}\n`);
      }
    }
  }
  const counted = [`${files.length} SKILL.md checked`, `${failed} failed`];
  if (unreadable > 0) counted.push(`${unreadable} could not be read`);
  process.stdout.write(counted.join(", ") + "\n");
  return unreadable > 0 ? 2 : failed === 0 ? 0 : 1;
}

if (process.env[TSX_MARKER] !== "1") {
  let loader;
  try {
    loader = tsxLoader();
  } catch (error) {
    fail(2, `cannot find the workspace tsx package (${error.message}); run pnpm install first`);
  }
  const entry = path.relative(process.cwd(), SCRIPT).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", pathToFileURL(loader).href, entry, ...process.argv.slice(2)], {
    env: { ...process.env, [TSX_MARKER]: "1" },
    stdio: "inherit",
    timeout: 10 * 60_000,
  });
  if (child.error) fail(2, "cannot start the TypeScript loader: " + child.error.message);
  process.exit(child.status ?? 2);
}

run().then((code) => process.exit(code), (error) => {
  process.stderr.write("check-skills: internal error: " + String(error && error.stack || error) + "\n");
  process.exit(2);
});
