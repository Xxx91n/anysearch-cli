#!/usr/bin/env node
// Repo-wide Agent Skills spec check (#387, parent #378).
//
// Every SKILL.md this repository ships goes through the *same* code the product
// uses: `ans skill install` and `ans skill validate` both call
// validateSkillDirectory / validateSkillFile in apps/cli/src/skill-store.ts, and
// so does this script. Nothing is re-implemented here on purpose — a rule that
// only existed in CI would drift from the one users hit.
//
// Usage:
//   node scripts/check-skills.mjs                  # every SKILL.md Git tracks
//   node scripts/check-skills.mjs <dir|SKILL.md>   # only these
//
// Exit codes: 0 every skill passes · 1 a skill broke a rule · 2 the check could
// not run (no Git, no tsx, a path that does not exist).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
/** Set in the child so the re-entry below happens exactly once. */
const TSX_MARKER = "ANS_CHECK_SKILLS_TSX";
/** The workspace tsx loader: the checker imports TypeScript sources directly, no build first. */
const TSX_LOADER = path.join(ROOT, "apps", "cli", "node_modules", "tsx", "dist", "loader.mjs");

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
 * Every SKILL.md Git tracks. Tracking, not a directory walk: build output
 * (apps/cli/dist carries a copy of the plugin skills) and node_modules hold
 * copies of the same file, and re-checking those would report each rule twice.
 */
function trackedSkillFiles() {
  const listed = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error) throw new Error("cannot run git ls-files: " + listed.error.message);
  if (listed.status !== 0) {
    throw new Error("git ls-files failed in " + ROOT + ": " + (String(listed.stderr).trim() || "exit " + listed.status));
  }
  return String(listed.stdout).split("\0").filter(Boolean)
    .filter((file) => path.posix.basename(file) === "SKILL.md")
    .map((file) => path.join(ROOT, file))
    .sort();
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
    files = args.length > 0 ? args.map(skillFileOf) : trackedSkillFiles();
  } catch (error) {
    fail(2, error.message);
  }
  if (files.length === 0) {
    process.stdout.write("check-skills: no SKILL.md found\n");
    return 0;
  }
  let failed = 0;
  for (const file of files) {
    try {
      const name = validateSkillDirectory(path.dirname(file));
      process.stdout.write(`[OK] ${shown(file)} (name: ${name})\n`);
    } catch (error) {
      failed += 1;
      // A rule failure reads "field + what was expected + which file"; anything
      // else (a broken read, a missing parent) keeps its stack so it is not
      // mistaken for a rule verdict.
      const detail = error instanceof SkillError ? error.message : String(error && error.stack || error);
      process.stdout.write(`[FAIL] ${shown(file)}: ${detail}\n`);
    }
  }
  process.stdout.write(`${files.length} SKILL.md checked, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

if (process.env[TSX_MARKER] !== "1") {
  if (!fs.existsSync(TSX_LOADER)) {
    fail(2, `tsx loader not found at ${TSX_LOADER}; run pnpm install before this check`);
  }
  const entry = path.relative(process.cwd(), SCRIPT).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", pathToFileURL(TSX_LOADER).href, entry, ...process.argv.slice(2)], {
    env: { ...process.env, [TSX_MARKER]: "1" },
    stdio: "inherit",
  });
  if (child.error) fail(2, "cannot start the TypeScript loader: " + child.error.message);
  process.exit(child.status ?? 2);
}

run().then((code) => process.exit(code), (error) => {
  process.stderr.write("check-skills: internal error: " + String(error && error.stack || error) + "\n");
  process.exit(2);
});
