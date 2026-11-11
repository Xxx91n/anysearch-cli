#!/usr/bin/env node
// Answer one question: will CI's dependency age check accept this lockfile, and
// if not, when will it?
//
// Why (issue #256): `minimumReleaseAge: 2880` in pnpm-workspace.yaml (2 days)
// can reject a lockfile that pnpm itself wrote a minute earlier, because the
// versions it resolved were published less than two days ago. The local run
// also keeps a cached verdict ("verified 22h ago"), while CI re-checks every
// time. So a local green can hide a CI red, and the only honest answer is the
// real publish time from the registry.
//
// This script never relaxes anything. It prints the blocking entries and the
// moment the last one clears. The fix is to wait for that time, or to choose a
// different dependency version. Turning the gate off is not a fix: it hides
// exactly the check CI runs.
//
// Node stdlib only, like the other scripts/ gates.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org/";

// pnpm 11.24.0's config defaults: `"minimum-release-age": 24 * 60`.
// Used when the workspace does not set the key.
const DEFAULT_MIN_AGE_MINUTES = 1440;

// A `packages:` key is `'@scope/name@1.2.3':` or `name@1.2.3:`. pnpm quotes
// single quotes by convention, but a hand-edited or rewritten lockfile may use
// double quotes, so both are accepted. `snapshots:` keys repeat the same
// versions with peer suffixes, so they are skipped.
const KEY_LINE = /^ {2}('([^']+)'|"([^"]+)"|([^'@\s][^:]*@[^:]+)):\s*$/;
const VERSION_TAIL = /@([0-9][0-9A-Za-z.\-+]*)$/;

export function parseLockfileEntries(lockText) {
  const seen = new Map();
  let inPackages = false;
  for (const raw of lockText.split(/\r?\n/)) {
    if (raw === "packages:") { inPackages = true; continue; }
    if (/^[A-Za-z]/.test(raw)) { inPackages = false; continue; }
    if (!inPackages) continue;
    const m = KEY_LINE.exec(raw);
    if (!m) continue;
    const key = m[2] ?? m[3] ?? m[4];
    const tail = VERSION_TAIL.exec(key);
    if (!tail) continue; // file:, git:, link: refs have no publish time
    const name = key.slice(0, -tail[0].length);
    const id = name + "@" + tail[1];
    if (!seen.has(id)) seen.set(id, { name, version: tail[1] });
  }
  return [...seen.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
  );
}

export function readAgePolicy(workspaceYaml) {
  // Same comment-stripping as ship-gate's E6 block, but a different question:
  // E6 asserts the policy was never loosened; this reads the value the gate
  // actually applies. If either reader changes, check the other still agrees.
  const lines = workspaceYaml.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, ""));
  const scalar = (key) => {
    const hit = lines.map((l) => new RegExp("^" + key + "\\s*:\\s*(\\S+)").exec(l)).find(Boolean);
    return hit ? hit[1] : null;
  };
  const raw = scalar("minimumReleaseAge");
  // pnpm's default table ships `"minimum-release-age": 24 * 60` (verified in
  // pnpm 11.24.0's bundle, and by installing a 14-hour-old package with no
  // config: pnpm rewrote the workspace to add a minimumReleaseAgeExclude entry
  // instead of failing). So an absent key means a one-day gate, not no gate.
  const minutes = raw === null || raw === "" ? DEFAULT_MIN_AGE_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error("minimumReleaseAge is not a number: " + raw);
  // `minimumReleaseAgeIgnoreMissingTime: false` means a package with no publish
  // time is rejected (fail-closed). Unset keeps pnpm's default, which accepts it.
  const ignoreMissingTimeRaw = scalar("minimumReleaseAgeIgnoreMissingTime");
  return {
    minutes,
    configured: raw !== null && raw !== "",
    strictOnMissingTime: ignoreMissingTimeRaw === "false",
    excludes: readExcludeEntries(lines),
    // Both spellings work in pnpm; the lowercase one is the documented form.
    envOverride: process.env.PNPM_CONFIG_MINIMUM_RELEASE_AGE
      ?? process.env.pnpm_config_minimum_release_age
      ?? null,
  };
}

// `minimumReleaseAgeExclude` is a list of package names or `@scope/*` patterns.
function readExcludeEntries(lines) {
  const at = lines.findIndex((l) => /^minimumReleaseAgeExclude\s*:/.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^minimumReleaseAgeExclude\s*:/, "").trim();
  if (inline === "[]") return [];
  if (inline !== "") return inline.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const baseIndent = (lines[at].match(/^\s*/) ?? [""])[0].length;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if ((l.match(/^\s*/) ?? [""])[0].length <= baseIndent) break;
    const m = /^-?\s*['"]?([^'"#]+?)['"]?\s*$/.exec(l.trim());
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

// `minimumReleaseAgeExclude` patterns, with pnpm's own semantics: a bare name
// matches that package at any version, `name@version` matches one version, and
// `*` is a glob inside a name (pnpm writes `react@0.0.0-experimental-*` itself
// when it adopts a too-young update, so this form must work).
export function excludePatternMatches(pattern, name, version) {
  if (pattern === "*") return true;
  const at = pattern.lastIndexOf("@");
  // A leading "@" is the scope marker, not a version separator.
  const hasVersion = at > 0;
  const patternName = hasVersion ? pattern.slice(0, at) : pattern;
  const patternVersion = hasVersion ? pattern.slice(at + 1) : null;
  const glob = (p, s) => {
    if (!p.includes("*")) return p === s;
    const re = new RegExp("^" + p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(s);
  };
  return glob(patternName, name) && (patternVersion === null || glob(patternVersion, version));
}

const defaultExcludeMatches = (name, version, patterns) =>
  patterns.some((p) => excludePatternMatches(p, name, version));

// `times` is the registry packument's `time` map: { [version]: publishISOString }.
// `excludes` are the `minimumReleaseAgeExclude` patterns pnpm skips; matching
// entries are reported separately and never counted as blocking.
export function ageStatus(entries, timesByName, {
  now,
  minAgeMinutes,
  strictOnMissingTime = false,
  excludes = [],
  excludeMatches = defaultExcludeMatches,
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error("now is not a date");
  const windowMs = minAgeMinutes * 60_000;
  const blocked = [];
  const unverifiable = [];
  const skipped = [];
  for (const { name, version } of entries) {
    if (excludeMatches(name, version, excludes)) {
      skipped.push({ name, version });
      continue;
    }
    const published = timesByName[name]?.[version];
    if (!published) {
      unverifiable.push({ name, version, reason: "registry has no publish time" });
      continue;
    }
    const publishedMs = Date.parse(published);
    if (Number.isNaN(publishedMs)) {
      unverifiable.push({ name, version, reason: "publish time is not a date: " + published });
      continue;
    }
    const unlockMs = publishedMs + windowMs;
    if (unlockMs > nowMs) {
      blocked.push({
        name,
        version,
        publishedAt: new Date(publishedMs).toISOString(),
        unlockAt: new Date(unlockMs).toISOString(),
        minutesLeft: Math.ceil((unlockMs - nowMs) / 60_000),
      });
    }
  }
  blocked.sort((a, b) => Date.parse(a.unlockAt) - Date.parse(b.unlockAt));
  const countedMissing = strictOnMissingTime ? unverifiable.length : 0;
  return {
    blocked,
    unverifiable,
    skipped,
    // The moment the too-young entries finish ageing. This does NOT clear a
    // missing publish time: waiting cannot fix that, so when such entries block
    // the run too, `clearsAt` is not the answer and `blockedByMissingTime` says so.
    clearsAt: blocked.length
      ? blocked.reduce((max, b) => (b.unlockAt > max ? b.unlockAt : max), blocked[0].unlockAt)
      : null,
    blockedByMissingTime: countedMissing,
    // A missing publish time is only fatal when the workspace says so.
    blockingCount: blocked.length + countedMissing,
  };
}

async function fetchPublishTimes(names) {
  const out = {};
  for (const name of names) {
    // A hung request would otherwise stall the whole run; 30s per package is
    // far longer than a normal registry answer and short enough to stay useful.
    const res = await fetch(REGISTRY + name.replace("/", "%2F"), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error("registry " + name + " answered HTTP " + res.status);
    const body = await res.json();
    out[name] = body.time ?? {};
  }
  return out;
}

function formatTable(rows) {
  const cell = (r, i) => [r.name, r.version, r.publishedAt, r.unlockAt][i];
  const widths = [0, 1, 2].map((i) => {
    let w = ["name", "version", "published"].map((s) => s.length)[i] ?? 0;
    for (const r of rows) w = Math.max(w, String(cell(r, i)).length);
    return w;
  });
  return rows
    .map((r) => "  " + [0, 1, 2].map((i) => String(cell(r, i)).padEnd(widths[i] + 2)).join("") + r.unlockAt)
    .join("\n");
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const noNetwork = args.includes("--parse-only");
  const lockPath = args.find((a) => a.startsWith("--lockfile="))?.slice("--lockfile=".length);
  const nowArg = args.find((a) => a.startsWith("--now="))?.slice("--now=".length);

  const lockfile = lockPath ?? path.join(ROOT, "pnpm-lock.yaml");
  const policy = readAgePolicy(fs.readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8"));
  const entries = parseLockfileEntries(fs.readFileSync(lockfile, "utf8"));

  if (policy.envOverride !== null) {
    process.stderr.write(
      "dep-age-status: PNPM_CONFIG_MINIMUM_RELEASE_AGE=" + policy.envOverride + " is set in this shell.\n" +
        "  It switches the age gate off for pnpm commands but not for CI. This report uses the\n" +
        "  workspace value (" + policy.minutes + " minutes) anyway.\n"
    );
  }
  if (policy.excludes.length > 0) {
    process.stderr.write(
      "dep-age-status: minimumReleaseAgeExclude lists " + policy.excludes.length + " pattern(s): " +
        policy.excludes.join(", ") + ".\n" +
        "  pnpm skips those names. ship-gate E6 refuses a non-empty list, so CI is not relaxed either.\n"
    );
  }

  if (noNetwork) {
    const out = {
      schema: "anysearch/dep-age-status@1",
      lockfile: path.relative(ROOT, lockfile),
      minAgeMinutes: policy.minutes,
      configured: true,
      lockfileEntries: entries.length,
      registryChecked: false,
    };
    process.stdout.write(
      json
        ? JSON.stringify(out, null, 2) + "\n"
        : "dep-age-status: " + entries.length + " lockfile entries, age gate " + policy.minutes +
            " minutes, no registry check\n"
    );
    return 0;
  }

  const names = [...new Set(entries.map((e) => e.name))];
  const times = await fetchPublishTimes(names);
  const now = nowArg ? new Date(nowArg) : new Date();
  const status = ageStatus(entries, times, {
    now,
    minAgeMinutes: policy.minutes,
    strictOnMissingTime: policy.strictOnMissingTime,
    excludes: policy.excludes,
  });

  const payload = {
    schema: "anysearch/dep-age-status@1",
    lockfile: path.relative(ROOT, lockfile),
    minAgeMinutes: policy.minutes,
    strictOnMissingTime: policy.strictOnMissingTime,
    excluded: policy.excludes,
    checkedAt: now.toISOString(),
    lockfileEntries: entries.length,
    ...status,
  };

  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(
      "dep-age-status: " + entries.length + " lockfile entries, age gate " + policy.minutes +
        " minutes, checked " + now.toISOString() + "\n"
    );
    if (status.blocked.length) {
      process.stdout.write("\n" + status.blocked.length + " entries are too young:\n" + formatTable(status.blocked) + "\n");
      if (status.blockedByMissingTime > 0) {
        process.stdout.write(
          "\nthe too-young ones clear at " + status.clearsAt + ", but " + status.blockedByMissingTime +
            " entr" + (status.blockedByMissingTime === 1 ? "y has" : "ies have") +
            " no publish time and waiting does not fix that\n"
        );
        process.stdout.write("Until those entries get a readable publish time, the check stays red.\n");
      } else {
        process.stdout.write("\nthe last one clears at " + status.clearsAt + "\n");
        process.stdout.write("Wait for that time or pick another version. Turning the gate off is not a fix: ship-gate E6 refuses an exclude list, so CI stays strict.\n");
      }
    } else if (status.blockingCount === 0) {
      process.stdout.write("\nevery entry is old enough\n");
    }
    if (status.skipped.length) {
      process.stdout.write(
        "\n" + status.skipped.length + " entries are on the workspace exclude list, so pnpm skips them " +
          "(ship-gate E6 refuses that list):\n"
      );
      for (const s of status.skipped) process.stdout.write("  " + s.name + "@" + s.version + "\n");
    }
    if (status.unverifiable.length) {
      process.stdout.write(
        "\n" + status.unverifiable.length + " entries have no usable publish time (" +
          (policy.strictOnMissingTime
            ? "the workspace policy counts these as blocked"
            : "pnpm lets these through by default") + "):\n"
      );
      for (const u of status.unverifiable) process.stdout.write("  " + u.name + "@" + u.version + " — " + u.reason + "\n");
    }
  }

  return status.blockingCount > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write("dep-age-status: FAIL: " + (err && err.message ? err.message : String(err)) + "\n");
      process.exit(2);
    }
  );
}
