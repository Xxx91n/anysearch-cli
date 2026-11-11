// dep-age-status: the two things the CI age gate turns on — which lockfile
// entries are too young, and the moment the last one clears. Pure functions,
// fixture strings, no network.
//
// Why the test exists (issue #256): the local pnpm run keeps a cached verdict
// ("verified 22h ago") while CI re-checks every time, so a local green can
// hide a red. The reported unlock time is what later tickets wait for; a silent
// consumer bug here would turn "wait until 11-11T23:45Z" into a wrong number.
import assert from "node:assert/strict";
import {
  parseLockfileEntries,
  readAgePolicy,
  ageStatus,
  excludePatternMatches,
} from "../../../scripts/dep-age-status.mjs";

const MIN = 2880;
const NOW = Date.parse("2026-11-10T19:50:00.000Z");

// A lockfile with two documents on purpose: the first document in this repo
// belongs to the pnpm version pin (`packages:` holds only pnpm itself), the
// second is the workspace resolution. Only `packages:` keys count.
const LOCK = [
  "---",
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    packageManagerDependencies:",
  "      pnpm:",
  "        specifier: 11.24.0",
  "        version: 11.24.0",
  "packages:",
  "  '@pnpm/exe@11.24.0':",
  "    resolution: {integrity: sha512-aaa}",
  "---",
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    configDependencies: {}",
  "packages:",
  "  '@scope/old@1.0.0':",
  "    resolution: {integrity: sha512-bbb}",
  "  '@scope/young@2.0.0':",
  "    resolution: {integrity: sha512-ccc}",
  "  plain-name@3.1.4:",
  "    resolution: {integrity: sha512-ddd}",
  "  '@scope/linked':",
  "    resolution: {directory: ../linked}",
  "  '@scope/dup@1.0.0':",
  "    resolution: {integrity: sha512-eee}",
  "  '@scope/dup@1.0.0':",
  "    resolution: {integrity: sha512-eee}",
  "snapshots:",
  "  '@scope/old@1.0.0': {}",
  "  '@scope/young@2.0.0(peer@1.0.0)': {}",
].join("\n");

// --- 1. only real registry versions are entries ---------------------------
{
  const entries = parseLockfileEntries(LOCK);
  const ids = entries.map((e) => e.name + "@" + e.version);
  assert.deepEqual(ids, [
    "@pnpm/exe@11.24.0", "@scope/dup@1.0.0", "@scope/old@1.0.0", "@scope/young@2.0.0", "plain-name@3.1.4",
  ], "packages: keys parse; `snapshots:` peer variants and path refs add nothing: " + ids.join(", "));
  // The fixture carries `@scope/dup` twice, so this fails without the dedupe.
  assert.equal(new Set(ids).size, ids.length, "a repeated packages: key collapses to one entry");
}

// --- 1b. double-quoted keys are entries too --------------------------------
// pnpm writes single quotes, but a rewritten lockfile may use double quotes.
// Missing them would under-report and could turn a red into a false green.
{
  const lock = [
    "packages:",
    '  "quoted-pkg@1.0.0":',
    "    resolution: {integrity: sha512-x}",
  ].join("\n");
  assert.deepEqual(parseLockfileEntries(lock), [{ name: "quoted-pkg", version: "1.0.0" }],
    "a double-quoted package key is read");
}

// --- 2. the policy is read from the workspace, and a missing-time switch
//        keeps its real meaning (false = reject) ---------------------------
{
  const p = readAgePolicy([
    "minimumReleaseAge: 2880   # 2 days",
    "minimumReleaseAgeIgnoreMissingTime: false",
    "minimumReleaseAgeExclude:",
    "  - '@scope/young'",
  ].join("\n"));
  assert.equal(p.minutes, MIN, "minutes read past the trailing comment");
  assert.equal(p.strictOnMissingTime, true, "IgnoreMissingTime:false means a missing time is rejected");
  assert.deepEqual(p.excludes, ["@scope/young"], "the exclude list is read as names, not just counted");
}
{
  const p = readAgePolicy("minimumReleaseAge: 2880");
  assert.equal(p.strictOnMissingTime, false, "unset keeps pnpm's permissive default");
  assert.deepEqual(p.excludes, []);
}
// pnpm 11.24.0's own default table ships `"minimum-release-age": 24 * 60`, so an
// absent key is a one-day gate, not "no gate". Verified against pnpm itself:
// installing a 14-hour-old package with no config rewrote the workspace to add
// a minimumReleaseAgeExclude entry instead of failing.
{
  const p = readAgePolicy("pmOnFail: error\n");
  assert.equal(p.configured, false, "an absent key reports the default, not a user value");
  assert.equal(p.minutes, 1440, "an absent key means pnpm's one-day default, not 0 and not 2880");
}
assert.throws(() => readAgePolicy("minimumReleaseAge: not-a-number"), /not a number/,
  "a non-numeric age gate is an error, not a silent zero");

// --- 3. the split: old entries pass, young entries report their unlock time
{
  const entries = parseLockfileEntries(LOCK);
  const times = {
    "@pnpm/exe": { "11.24.0": "2026-01-01T00:00:00.000Z" },
    "@scope/dup": { "1.0.0": "2026-01-01T00:00:00.000Z" },
    "@scope/old": { "1.0.0": "2026-01-01T00:00:00.000Z" },
    "@scope/young": { "2.0.0": "2026-11-09T23:45:13.428Z" },
    "plain-name": { "3.1.4": "2026-01-01T00:00:00.000Z" },
  };
  const s = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN });
  assert.equal(s.blocked.length, 1, "only the young entry is blocked");
  assert.equal(s.blocked[0].name, "@scope/young");
  assert.equal(s.blocked[0].unlockAt, "2026-11-11T23:45:13.428Z", "unlock = publish + 2 days");
  // 1676 minutes from 2026-11-10T19:50Z to 2026-11-11T23:45:13.428Z, rounded
  // up: the wait a person is told to sit through.
  assert.equal(s.blocked[0].minutesLeft, 1676, "minutesLeft is the remaining wait in whole minutes");
  assert.equal(s.clearsAt, "2026-11-11T23:45:13.428Z", "the last unlock is the moment the lockfile clears");
  assert.equal(s.blockingCount, 1);
}

// --- 4. clearsAt is the LATEST unlock, not the first entry seen ------------
{
  const entries = [
    { name: "a", version: "1.0.0" },
    { name: "b", version: "1.0.0" },
  ];
  const times = {
    a: { "1.0.0": "2026-11-09T20:14:00.000Z" }, // clears 11-11T20:14
    b: { "1.0.0": "2026-11-09T23:45:00.000Z" }, // clears 11-11T23:45
  };
  const s = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN });
  assert.equal(s.blocked.length, 2);
  assert.equal(s.clearsAt, "2026-11-11T23:45:00.000Z", "clearsAt tracks the latest entry whichever order they arrive in");
  assert.equal(s.blocked[0].unlockAt, "2026-11-11T20:14:00.000Z", "table rows are sorted by unlock time");
}

// --- 5. an entry that just cleared is not blocked --------------------------
{
  const entries = [{ name: "edge", version: "1.0.0" }];
  const published = "2026-11-09T23:45:13.428Z";
  const s = ageStatus(entries, { edge: { "1.0.0": published } }, {
    now: Date.parse(published) + MIN * 60_000,
    minAgeMinutes: MIN,
  });
  assert.equal(s.blocked.length, 0, "exactly at the boundary the entry passes");
  assert.equal(s.clearsAt, null);
  assert.equal(s.blockingCount, 0);
}

// --- 6. missing or unusable publish time is reported, not silently passed --
{
  const entries = [
    { name: "no-time", version: "1.0.0" },
    { name: "bad-time", version: "1.0.0" },
  ];
  const times = { "no-time": {}, "bad-time": { "1.0.0": "not-a-date" } };
  const permissive = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN });
  assert.equal(permissive.unverifiable.length, 2, "both entries are surfaced");
  assert.equal(permissive.blockingCount, 0, "pnpm's default accepts a missing time");
  const strict = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN, strictOnMissingTime: true });
  assert.equal(strict.blockingCount, 2, "the workspace's fail-closed switch makes them block");
  assert.equal(strict.clearsAt, null, "a missing time has no unlock moment to report");
  assert.equal(strict.blockedByMissingTime, 2, "and waiting cannot clear them");
}

// --- 6b. a young entry plus an untimed one: clearsAt is not the whole answer
// Waiting until clearsAt still leaves the untimed entry blocking, so the run
// has to say so instead of promising "wait and it passes".
{
  const entries = [
    { name: "young", version: "1.0.0" },
    { name: "no-time", version: "1.0.0" },
  ];
  const times = { young: { "1.0.0": "2026-11-09T23:45:13.428Z" }, "no-time": {} };
  const s = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN, strictOnMissingTime: true });
  assert.equal(s.blocked.length, 1);
  assert.equal(s.clearsAt, "2026-11-11T23:45:13.428Z", "the young entry's unlocking time is still reported");
  assert.equal(s.blockedByMissingTime, 1, "the untimed entry is called out separately");
  assert.equal(s.blockingCount, 2, "both still block");
}

// --- 7. entries on the workspace exclude list are skipped, not blocked ------
// pnpm skips these names. Counting them as blocked would report a fictional
// wait; they are surfaced separately so the caller can see why the gate is off.
{
  const entries = [
    { name: "@scope/young", version: "2.0.0" },
    { name: "@scope/fresh", version: "1.0.0" },
    // Outside the excluded scope, so it must stay blocked. A wildcard that
    // matches everything would hide this entry and report a false green.
    { name: "other-young", version: "1.0.0" },
  ];
  const times = {
    "@scope/young": { "2.0.0": "2026-11-09T23:45:13.428Z" },
    "@scope/fresh": { "1.0.0": "2026-11-09T23:45:13.428Z" },
    "other-young": { "1.0.0": "2026-11-09T23:45:13.428Z" },
  };
  const s = ageStatus(entries, times, { now: NOW, minAgeMinutes: MIN, excludes: ["@scope/*"] });
  assert.deepEqual(s.blocked.map((b) => b.name), ["other-young"],
    "only names outside the excluded scope stay blocked");
  assert.equal(s.skipped.length, 2, "both excluded entries are listed as skipped");
  assert.equal(s.blockingCount, 1, "a blocked entry outside the scope still moves the exit code");
  assert.equal(s.clearsAt, "2026-11-11T23:45:13.428Z");
}

// --- 8. an inline exclude list is a flat list, not a nested array ----------
{
  const p = readAgePolicy("minimumReleaseAge: 2880\nminimumReleaseAgeExclude: ['a', 'b']");
  assert.deepEqual(p.excludes, ["a", "b"], "inline YAML list yields two names, not one nested array");
}

// --- 9. exclude patterns follow pnpm's meaning, not a startsWith shortcut ---
// pnpm writes `react@0.0.0-experimental-*` into the workspace itself when it
// adopts a too-young update, so the version part has to work.
{
  const cases = [
    ["@scope/*", "@scope/young", "2.0.0", true],
    ["@scope/*", "other-young", "1.0.0", false],
    ["react@0.0.0-experimental-*", "react", "0.0.0-experimental-abc", true],
    ["react@0.0.0-experimental-*", "react", "18.0.0", false],
    ["foo*", "foo-bar", "1.0.0", true],
    ["*", "anything", "1.0.0", true],
    ["pkg@1.2.3", "pkg", "1.2.3", true],
    ["pkg@1.2.3", "pkg", "1.2.4", false],
    ["pkg", "pkg", "9.9.9", true],
  ];
  for (const [pattern, name, version, want] of cases) {
    assert.equal(excludePatternMatches(pattern, name, version), want,
      "pattern " + pattern + " vs " + name + "@" + version);
  }
}

assert.throws(() => ageStatus([], {}, { now: "not-a-date", minAgeMinutes: MIN }), /now is not a date/,
  "a bad clock is an error, not an empty green");

console.log("dep-age-status.test.mjs: all checks passed");
