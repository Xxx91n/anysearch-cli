// R78 T1 (D-003 A++): ship-gate pathlint detector contract tests — red/green
// paired fixtures exercise the token+separator classifier both directions.
// Red fixture: every listed line must violate (incl. the two real escape
// instances, inline code, unmarked fences, stale markers). Green fixture:
// prose mentions, URLs, marked lines, locator lines, marked fences must pass.
// Run: node --import tsx --test test/ship-gate-pathlint.test.mjs (via turbo test)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnv, scanLines, detectHits, detectSurfacedSkips } from "../../../scripts/ship-gate-pathlint-detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
// fake repo root so in-repo detection is deterministic across machines
const env = buildEnv(cfg, "D:/Repo/Root");
const redLines = fs.readFileSync(path.join(ROOT, "packages/store/fixtures/pathlint/red.md"), "utf8").split("\n");
const greenLines = fs.readFileSync(path.join(ROOT, "packages/store/fixtures/pathlint/green.md"), "utf8").split("\n");

test("red fixture: every path-bearing line violates", () => {
  const { violations } = scanLines(redLines, env);
  const at = (n) => violations.filter((v) => v.line === n);
  // lines 4-19: all token classes + the two real escape instances
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 30]) {
    assert.equal(at(n).length, 1, `red line ${n} must violate exactly once`);
  }
  assert.equal(at(21)[0].kind, "in-repo", "in-repo ref must be flagged even though other tokens exist");
  assert.equal(at(22)[0].kind, "malformed-marker", "marker with empty reason is malformed");
  assert.equal(at(23)[0].kind, "stale-marker", "standalone marker guarding nothing is stale");
  assert.equal(at(24)[0].kind, "stale-marker", "fence-cover marker over a pathless block is stale");
});

test("red fixture: inline code is not exempt", () => {
  const { violations } = scanLines(redLines, env);
  const v = violations.find((x) => x.line === 20);
  assert.ok(v, "backtick-quoted %LOCALAPPDATA%/x must still violate");
  assert.equal(v.kind, "missing-marker");
});

test("green fixture: zero violations", () => {
  const { violations } = scanLines(greenLines, env);
  assert.deepEqual(violations, [], "green fixture must produce no violations: " + JSON.stringify(violations));
  // F-2 audit fix: the marked UNC + AppData green lines are exercised explicitly —
  // located dynamically via marker text, never hardcoded line numbers.
  for (const needle of ["\\\\host\\share", "AppData\\Roaming"]) {
    const n = greenLines.findIndex((l) => l.includes(needle) && l.includes("machine-local: green fixture marker")) + 1;
    assert.ok(n > 0, `green fixture must contain a marked line carrying ${needle}`);
    assert.ok(detectHits(greenLines[n - 1]).length > 0, `line ${n} must carry a real detector hit (the marker is what keeps it green)`);
    assert.equal(violations.filter((v) => v.line === n).length, 0, `marked line ${n} must produce zero violations`);
  }
});

test("red fixture: unmarked-fence in-repo ref still violates (neighbor control)", () => {
  const { violations } = scanLines(redLines, env);
  const n = redLines.findIndex((l) => l.includes("inside unmarked fence")) + 1;
  assert.ok(n > 0, "red fixture must carry the unmarked-fence in-repo line");
  assert.equal(violations.filter((v) => v.line === n)[0]?.kind, "in-repo", "uncovered fence keeps in-repo enforcement");
});

test("exemption domain: /x info silent on every fence + locator line (A2)", () => {
  const { infos } = scanLines(greenLines, env);
  let fenced = false;
  const exempt = new Set();
  greenLines.forEach((l, idx) => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return; }
    if (fenced || env.locators.some((re) => re.test(l))) exempt.add(idx + 1);
  });
  const baits = [...exempt].filter((n) => detectSurfacedSkips(greenLines[n - 1]).length > 0);
  assert.ok(baits.length >= 3, "expected >=3 exempt-surface /x bait lines, got " + baits.length + ": " + JSON.stringify(baits));
  for (const i of infos) assert.ok(!exempt.has(i.line), "surfaced-skip must be silent on exempt line " + i.line + ": " + JSON.stringify(greenLines[i.line - 1]));
  assert.ok(infos.some((i) => i.detail.includes("/etc")), "prose /etc info must remain");
});

test("exemption domain: covered fence skips in-repo check; locator line exempts in-repo", () => {
  const { violations } = scanLines(greenLines, env);
  const cov = greenLines.findIndex((l) => l.includes("covered transcript excerpt")) + 1;
  const covHit = greenLines.findIndex((l) => l.includes("D:/Repo/Root/docs/x.md verbatim")) + 1;
  const loc = greenLines.findIndex((l) => /^\s*Stack\b/.test(l) && l.includes("D:/Repo/Root")) + 1;
  assert.ok(cov > 0 && covHit > 0 && loc > 0, "fixture must carry covered-fence + locator in-repo lines cov=" + cov + " hit=" + covHit + " loc=" + loc);
  assert.equal(violations.filter((v) => v.line === covHit).length, 0, "covered-fence in-repo ref must be exempt");
  assert.equal(violations.filter((v) => v.line === loc).length, 0, "locator in-repo ref must be exempt");
});
test("green fixture: /etc produces info surfaced-skip only", () => {
  const { infos } = scanLines(greenLines, env);
  assert.ok(infos.some((i) => i.line === 12 && i.detail.includes("/etc")), "single-segment /etc must surface at info level");
  assert.ok(!infos.some((i) => i.detail.includes("/var")), "multi-segment /var/log/syslog stays silent");
});

test("unit: prose mentions never fire", () => {
  for (const s of ["set %PATH% first", "$HOME is an env var", "${TMPDIR} quoted", "a lone ~ here", "approx ~50% done"]) {
    assert.equal(detectHits(s).length, 0, `prose must not hit: ${s}`);
  }
});

test("unit: tokens need a following separator", () => {
  assert.ok(detectHits("%TEMP%/x").length > 0);
  assert.equal(detectHits("%TEMP% done").length, 0);
  assert.ok(detectHits("$HOME/x").length > 0);
  assert.equal(detectHits("$HOME done").length, 0);
  assert.ok(detectHits("${X}/y").length > 0);
  assert.ok(detectHits("~/x").length > 0);
  assert.ok(detectHits("~\\x").length > 0);
  assert.equal(detectHits("see ~ user").length, 0);
  assert.ok(detectHits("\\\\host\\share\\x").length > 0);
});

test("unit: boundary guard kills URL/identifier false positives", () => {
  assert.equal(detectHits("https://example.com/tmp/x").length, 0);
  assert.equal(detectHits("https://host/Users/u/x").length, 0);
  assert.equal(detectHits("wordC:\\x").length, 0);
  assert.ok(detectHits("(C:\\x)").length > 0);
});

test("unit: /x info surfaced-skip boundaries", () => {
  assert.ok(detectSurfacedSkips("see /etc for details").length > 0);
  assert.equal(detectSurfacedSkips("https://a.com/etc").length, 0);
  assert.equal(detectSurfacedSkips("/etc/foo multi-seg").length, 0);
  assert.equal(detectSurfacedSkips("./rel/path").length, 0);
});

test("unit: in-repo detection uses literal tokens only", () => {
  const v = scanLines(["ref D:/Repo/Root/scripts/x.mjs here"], env).violations;
  assert.equal(v[0]?.kind, "in-repo");
  // env-var tokens cannot resolve to the repo root — marker class, not in-repo
  const w = scanLines(["ref %ROOT%/scripts/x.mjs here"], env).violations;
  assert.equal(w[0]?.kind, "missing-marker");
});
