// ADR-0042 D1-D5 (r108 impl): dual-track observational data feed.
// Consumed track (real access_events) is always preferred; the synthetic track (committed,
// SHA-256-pinned fixture snapshots generated offline by scripts/tau/generate_fixtures.py) is
// a machinery harness only — it exercises histogram -> PSI -> AND-gate -> skip -> ledger and
// must never feed production retrieval/archive signals. Tracks share nothing: the fixture JSON
// itself carries track:"synthetic" and the loader hard-rejects anything else, so a miswired
// caller cannot pass fixture rows off as consumed data.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGE_BUCKETS, bucketHistogram } from "./day-buckets";
import { psi, type BgnbdRow, type TauFitGateInput } from "./bgnbd";

export const OBS_FIXTURE_SCHEMA = "anysearch/obs-fixture@1";
export const SIMULATED_LABEL = "simulated-observation-window";

// lazy (same CJS-bundle reason as bgnbd.ts).
function fixtureDir(): string { return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "obs-feed"); }

export interface ObsFixture {
  schema: typeof OBS_FIXTURE_SCHEMA;
  track: "synthetic";
  name: string;
  meta: {
    seed: number;
    generator: string;
    generatorVersion: number;
    windowDays: number;
    params: Record<string, number>;
    expect: string;
  };
  baselineHistogram: Record<string, number>;
  events: Array<{ unit: string; ageDays: number }>;
}

export interface ObsFeed {
  track: "synthetic";
  name: string;
  windowDays: number;
  activeRows: number;
  fittableUnits: number;
  histogram: Record<string, number>;
  psi: number;
  rows: BgnbdRow[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// 16-hex definition hash of the pinned fixture set; joins the eval baseline fingerprint
// (ADR-0042 D6 flip). r110 SP-F-03: a missing manifest (e.g. fixtures not packed) degrades
// to the explicit marker "no-fixtures" — never silently: loadObsFixture hard-throws when a
// fixture is actually requested, the value is printed into the report's observational zone
// (fixtureDefinitionHash field), and the eval CLI warns on stderr when it is active.
export function fixtureDefinitionHash(): string {
  try {
    const j = JSON.parse(readFileSync(join(fixtureDir(), "MANIFEST.json"), "utf8")) as { definitionHash?: string };
    return typeof j.definitionHash === "string" ? j.definitionHash : "no-fixtures";
  } catch {
    return "no-fixtures";
  }
}

// Load + verify a fixture: schema, track marker, bucket-key shape, and SHA-256 against
// MANIFEST.json. Any mismatch is a hard throw — silently feeding unverified data would
// defeat pinning. r110 SP-F-02 design boundary: the runtime SHA-256 check is ONLY an
// anti-miswire guard — MANIFEST.json ships in the same directory, so it can be edited
// alongside a tampered fixture (circular credential). The real tamper anchors are the CI
// regenerate-and-diff step (fixtures must hash-match what the committed generator produces)
// and code review; do not present the runtime check as integrity protection.
export function loadObsFixture(name: string): ObsFixture {
  const mpath = join(fixtureDir(), "MANIFEST.json");
  if (!existsSync(mpath)) throw new Error("obs-fixture MANIFEST.json missing at " + fixtureDir());
  const manifest = JSON.parse(readFileSync(mpath, "utf8")) as { schema?: string; files?: Record<string, string> };
  if (manifest.schema !== "anysearch/obs-fixture-manifest@1") throw new Error("obs-fixture manifest: unexpected schema " + manifest.schema);
  const want = manifest.files?.[name + ".json"];
  if (!want) throw new Error("obs-fixture unknown: " + name + " (not in MANIFEST.json)");
  const buf = readFileSync(join(fixtureDir(), name + ".json"));
  const got = sha256(buf);
  if (got !== want) throw new Error("obs-fixture " + name + " sha256 mismatch: " + got + " != " + want);
  const fx = JSON.parse(buf.toString("utf8")) as ObsFixture;
  validateFixtureDoc(fx);
  return fx;
}

// Document-level guards, exported for direct unit testing (miswired track must be rejected).
export function validateFixtureDoc(fx: ObsFixture): void {
  const name = fx?.name ?? "(unknown)";
  if (fx.schema !== OBS_FIXTURE_SCHEMA) throw new Error("obs-fixture " + name + ": unexpected schema " + fx.schema);
  if (fx.track !== "synthetic") throw new Error("obs-fixture " + name + " track miswire: " + String(fx.track) + " (synthetic snapshots must carry track synthetic)");
  if (!Array.isArray(fx.events) || !fx.meta || typeof fx.meta.windowDays !== "number") throw new Error("obs-fixture " + name + ": malformed body");
  // r110 SA-F-07: the fixture's pinned baseline histogram must use exactly the current
  // AGE_BUCKETS keys — a bucket redefinition without fixture regeneration is a hard error,
  // not a silent zero-filled comparison.
  const wantKeys = AGE_BUCKETS.map((b) => b.id).sort().join(",");
  const gotKeys = Object.keys(fx.baselineHistogram ?? {}).sort().join(",");
  if (gotKeys !== wantKeys) throw new Error("obs-fixture " + name + ": baselineHistogram keys " + JSON.stringify(gotKeys) + " != AGE_BUCKETS " + JSON.stringify(wantKeys) + " — regenerate fixtures after changing day buckets");
}

// Fixture -> the gate-visible feed (ADR-0042 D6 chain input). PSI = baseline vs current
// access-age histogram over the pre-registered D4 buckets, symmetric-KL with eps smoothing.
export function feedFromFixture(fx: ObsFixture): ObsFeed {
  const ages = fx.events.map((e) => e.ageDays);
  const histogram = bucketHistogram(ages);
  const order = Object.keys(bucketHistogram([]));
  const cur = order.map((k) => histogram[k] ?? 0);
  const base = order.map((k) => fx.baselineHistogram[k] ?? 0);
  const perUnit = new Map<string, number[]>();
  for (const e of fx.events) {
    const arr = perUnit.get(e.unit) ?? [];
    arr.push(e.ageDays);
    perUnit.set(e.unit, arr);
  }
  const rows: BgnbdRow[] = [];
  let fittable = 0;
  for (const [, as] of perUnit) {
    if (as.length >= 2) fittable += 1;
    rows.push({ frequency: as.length - 1, recency: as.length >= 2 ? Math.max(...as) - Math.min(...as) : 0, T: Math.max(...as) });
  }
  return {
    track: "synthetic",
    name: fx.name,
    windowDays: fx.meta.windowDays,
    activeRows: fx.events.length,
    fittableUnits: fittable,
    histogram,
    psi: psi(base, cur),
    rows,
  };
}

// Feed -> AND-gate input (daysSinceLastFit n/a for a fresh fixture — anti-peeking N/A).
export function feedToGateInput(feed: ObsFeed): TauFitGateInput {
  return {
    activeRows: feed.activeRows,
    fittableUnits: feed.fittableUnits,
    psi: feed.psi,
    windowDays: feed.windowDays,
    daysSinceLastFit: null,
  };
}
