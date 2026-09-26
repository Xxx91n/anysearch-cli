// R84 T3 / ADR-0085 draft: paired vertical-delta live runner.
// Runs each live-scoped vertical corpus entry TWICE through the real bundled
// `ans` bin: vertical-on (the entry's injected spec) vs vertical-off (same
// query, no flags). Arm-level delta (the anysearch arm's raw post-gate list
// via metadata.fusion under ANS_ARM_SNAPSHOT=1) is the PRIMARY evidence;
// fused-level numbers are a secondary observational column only — never a
// prefer-capable promotion argument (D-005).
//
// Emits .scratch/grill-round-84/evidence/vertical-delta.json (env
// ANS_VERTICAL_DELTA_OUT overrides) with dataset fingerprint, arm identity,
// explicit n, per-stratum rates, and honest nulls for unmeasurable cells.
// Control entries (role:"control") record existence facts — their failures
// walk the degraded list, never the red gate (D-004 iii).
// ANS_VERTICAL_DELTA_LIMIT=N caps the corpus slice for smoke runs.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..", "..");
const dist = join(root, "apps", "cli", "dist", "index.js");
// Round-neutral default path (the artifact is a durable evidence channel, not
// an R84 scratch file); CI/devs override via env for dated snapshots.
const DELTA_OUT = process.env.ANS_VERTICAL_DELTA_OUT
  ?? join(root, ".scratch", "vertical-eval", "delta.json");
const LIMIT = Number(process.env.ANS_VERTICAL_DELTA_LIMIT ?? "0") || 0;
const CONCURRENCY = 4;

function hostOf(url: string): string {
  // Upstream vertical results may arrive schemeless (site.financialmodelingprep.com/…
  // observed 2026-09-26) — tolerate by synthesizing a scheme for parsing.
  try { return new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function pathOf(url: string): string {
  try { return new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).pathname; } catch { return ""; }
}
// hitHosts pools hold canonical domains; matching is suffix-domain (a hit on
// site.financialmodelingprep.com counts for pool entry financialmodelingprep.com)
// — measured against real upstream host shapes observed 2026-09-26.
function hostIn(host: string, pool: string[]): boolean {
  return pool.some((h) => host === h || host.endsWith("." + h));
}
function anyHostHit(urls: string[], pool: string[]): boolean {
  return urls.some((u) => hostIn(hostOf(u), pool));
}
function strongHit(urls: string[], pool: string[], paths: string[]): boolean {
  return urls.some((u) => hostIn(hostOf(u), pool) && paths.some((p) => pathOf(u).startsWith(p)));
}
// Rank of the first pool hit, 1-based. Absent = null (never 0 — R84 honesty
// rule: unmeasurable cells are null/unknown, not zero).
function rankOf(urls: string[], pool: string[]): number | null {
  for (let i = 0; i < urls.length; i++) if (hostIn(hostOf(urls[i]!), pool)) return i + 1;
  return null;
}

interface JsonOut {
  __error?: string;
  results?: Array<{ url: string; extra?: { vertical?: { domain?: string } } }>;
  fusion?: { labels: string[]; lists: string[][] } | null;
  providersFailed?: string[];
  abstain?: unknown;
}
function searchJson(question: string, env: NodeJS.ProcessEnv, vertical: any | undefined): Promise<JsonOut> {
  const args = [dist, "search", question, "--json"];
  if (vertical) {
    args.push("--vertical-domain", vertical.domain);
    if (vertical.subDomain) args.push("--vertical-sub-domain", vertical.subDomain);
    if (vertical.params !== undefined) args.push("--vertical-params", JSON.stringify(vertical.params));
  }
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ __error: String(e) }));
    p.on("close", (code) => {
      try { resolve(JSON.parse(out)); }
      catch { resolve({ __error: "unparseable exit=" + code + " stderr=" + err.slice(-160) }); }
    });
    setTimeout(() => { try { p.kill(); } catch { /* noop */ } }, 60000);
  });
}

function armList(j: JsonOut, arm = "anysearch"): string[] | null {
  const f = j.fusion;
  if (!f || !Array.isArray(f.labels) || !Array.isArray(f.lists)) return null;
  const i = f.labels.indexOf(arm);
  return i >= 0 ? f.lists[i]! : null;
}
function fusedUrls(j: JsonOut): string[] {
  return (j.results ?? []).map((r) => r.url).filter((u): u is string => typeof u === "string");
}
function marked(j: JsonOut): number {
  return (j.results ?? []).filter((r) => r.extra?.vertical !== undefined).length;
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]!, k); }
  }));
}

(async () => {
  if (!existsSync(dist)) { console.log("SKIP: dist/index.js missing — run pnpm -C apps/cli build first"); process.exit(0); }
  const ledger = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));
  const scopes: Record<string, string> = ledger.golden?.scopes ?? {};
  const all = (ledger.golden?.entries ?? []).filter(
    (e: any) => (scopes[e.id] === "live" || scopes[e.id] === "both") && e.expected?.vertical !== undefined,
  );
  const entries = LIMIT > 0 ? all.slice(0, LIMIT) : all;
  if (entries.length === 0) { console.log("SKIP: no live-scoped vertical entries"); process.exit(0); }

  // Dataset fingerprint over the vertical slice actually measured (id+spec+
  // expectation+scope), sorted — changes to corpus content flip it.
  const fpSrc = entries.map((e: any) => ({ id: e.id, v: e.vertical ?? null, x: e.expected.vertical, s: scopes[e.id] }))
    .sort((a: any, b: any) => String(a.id).localeCompare(b.id));
  const fingerprint = createHash("sha256").update(JSON.stringify(fpSrc)).digest("hex").slice(0, 16);

  const baseEnv = { ...process.env, ANS_DOMAIN: "default", ANS_ARM_SNAPSHOT: "1" };
  const rows: any[] = [];
  let controlDegraded = 0;

  await pool(entries, CONCURRENCY, async (e: any) => {
    const vexp = e.expected.vertical;
    const stratum = (e.dimensions ?? []).find((t: string) => String(t).startsWith("stratum:"))?.split(":")[1] ?? "unknown";
    const vdom = (e.dimensions ?? []).find((t: string) => String(t).startsWith("vdomain:"))?.split(":")[1] ?? "unknown";
    const hosts: string[] = vexp.hitHosts ?? [];
    const paths: string[] = vexp.hitPaths ?? [];

    // Four runs per spec-carrying entry: the isolated anysearch arm pair is
    // the PRIMARY measurement (no grace-window cancellation from faster arms);
    // the full-fanout pair feeds the fused-level secondary column.
    // No-spec controls run the OFF pair only (a self-pair measures nothing).
    const isoEnv = { ...baseEnv, ANS_PROVIDERS: "anysearch" };
    const isoOn = e.vertical ? await searchJson(e.question, isoEnv, e.vertical) : null;
    const isoOff = await searchJson(e.question, isoEnv, undefined);
    const fullOn = e.vertical ? await searchJson(e.question, baseEnv, e.vertical) : null;
    const fullOff = await searchJson(e.question, baseEnv, undefined);
    for (const [tag, j] of [["isoOn", isoOn], ["isoOff", isoOff], ["fullOn", fullOn], ["fullOff", fullOff]] as const) {
      if (j !== null && j.__error) console.log("DEGRADED " + e.id + " " + tag + " run error: " + j.__error);
    }
    const aOn = isoOn === null || isoOn.__error ? null : fusedUrls(isoOn);
    const aOff = isoOff.__error ? null : fusedUrls(isoOff);
    const on = fullOn, off = fullOff;
    const fOn = on === null || on.__error ? [] : fusedUrls(on);
    const fOff = off.__error ? [] : fusedUrls(off);

    const row: any = {
      id: e.id, stratum, vdomain: vdom, role: vexp.role,
      arm: "anysearch",
      armOn: aOn === null ? null : {
        n: aOn.length,
        hostHit: hosts.length ? anyHostHit(aOn, hosts) : null,
        strongHit: hosts.length && paths.length ? strongHit(aOn, hosts, paths) : null,
        rankOf: hosts.length ? rankOf(aOn, hosts) : null,
        marked: isoOn === null || isoOn.__error ? null : marked(isoOn),
      },
      armOff: aOff === null ? null : {
        n: aOff.length,
        hostHit: hosts.length ? anyHostHit(aOff, hosts) : null,
        strongHit: hosts.length && paths.length ? strongHit(aOff, hosts, paths) : null,
        rankOf: hosts.length ? rankOf(aOff, hosts) : null,
      },
      fusedOn: { n: fOn.length, hostHit: hosts.length ? anyHostHit(fOn, hosts) : null, rankOf: hosts.length ? rankOf(fOn, hosts) : null, marked: on === null || on.__error ? null : marked(on) },
      fusedOff: { n: fOff.length, hostHit: hosts.length ? anyHostHit(fOff, hosts) : null, rankOf: hosts.length ? rankOf(fOff, hosts) : null },
      // Whether the anysearch arm survived the fanout grace window (its raw
      // list inside fusion.lists) — survival is upstream-timing evidence, not
      // a gate.
      armInFanoutOn: on === null || on.__error ? null : armList(on) !== null,
      armInFanoutOff: off.__error ? null : armList(off) !== null,
      providersFailedOn: on?.providersFailed ?? null,
      providersFailedOff: off.providersFailed ?? null,
      // Isolated-arm failure surface — an empty arm list without this context
      // is indistinguishable from "arm returned zero results", so quota/arm
      // failures on the primary measurement leg must be named.
      providersFailedIsoOn: isoOn?.providersFailed ?? null,
      providersFailedIsoOff: isoOff.providersFailed ?? null,
      // First-3 URL samples per arm — audit-trail anchor so reviewers can
      // re-check hosts/paths against hitPools without rerunning the leg.
      armOnSample: (aOn ?? []).slice(0, 3),
      armOffSample: (aOff ?? []).slice(0, 3),
    };
    // Paired verdict on the arm level: presence flip wins, else rank diff.
    const rOn = row.armOn?.rankOf ?? null, rOff = row.armOff?.rankOf ?? null;
    const hOn = row.armOn?.hostHit ?? null, hOff = row.armOff?.hostHit ?? null;
    row.delta = {
      hostFlip: hOn === null || hOff === null ? null : hOn !== hOff ? (hOn ? "better" : "worse") : null,
      rankDiff: rOn !== null && rOff !== null ? rOff - rOn : null,
      verdict: hOn === null || hOff === null ? "unknown"
        : hOn !== hOff ? (hOn ? "better" : "worse")
          : rOn !== null && rOff !== null ? (rOn < rOff ? "better" : rOn > rOff ? "worse" : "tied")
            : "tied",
    };
    if (vexp.role === "control" && ((on !== null && on.__error) || off.__error || isoOff.__error || (isoOn !== null && isoOn.__error))) controlDegraded++;
    rows.push(row);
  });

  // Per-stratum aggregates — arm level is PRIMARY; fused level is the
  // secondary observational column (D-005, never a weighting-gain argument).
  const strata = [...new Set(rows.map((r) => r.stratum))].sort();
  const byStratum: Record<string, any> = {};
  const domains = [...new Set(rows.map((r) => r.vdomain))].sort();
  const byDomain: Record<string, any> = {};
  const agg = (rs: any[]) => {
    const paired = rs.filter((r) => r.armOn !== null && r.armOff !== null);
    const rate = (xs: any[], pick: (r: any) => boolean | null) => {
      const vals = xs.map(pick).filter((v) => v !== null);
      return vals.length === 0 ? null : vals.filter(Boolean).length / vals.length;
    };
    const diffs = paired.map((r) => r.delta.rankDiff).filter((d): d is number => d !== null);
    return {
      n: rs.length, nPaired: paired.length,
      armHostHit: { on: rate(paired, (r) => r.armOn.hostHit), off: rate(paired, (r) => r.armOff.hostHit) },
      armStrongHit: { on: rate(paired, (r) => r.armOn.strongHit), off: rate(paired, (r) => r.armOff.strongHit) },
      fusedHostHit: { on: rate(paired, (r) => r.fusedOn.hostHit), off: rate(paired, (r) => r.fusedOff.hostHit) },
      expectRankOfMeanDiff: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
      verdicts: { better: rs.filter((r) => r.delta.verdict === "better").length, worse: rs.filter((r) => r.delta.verdict === "worse").length, tied: rs.filter((r) => r.delta.verdict === "tied").length, unknown: rs.filter((r) => r.delta.verdict === "unknown").length },
      ci: null, // n too small for interval claims — placeholder field per D-004(iv)
    };
  };
  for (const s of strata) byStratum[s] = agg(rows.filter((r) => r.stratum === s));
  for (const d of domains) byDomain[d] = agg(rows.filter((r) => r.vdomain === d));

  const artifact = {
    schema: "anysearch/vertical-delta@1",
    generatedAt: new Date().toISOString(),
    datasetFingerprint: fingerprint,
    arms: { on: "vertical-on (entry spec via --vertical-*)", off: "vertical-off (no spec)", measured: "anysearch arm raw list via metadata.fusion" },
    n: rows.length,
    controlDegraded,
    primary: "arm-level delta (anysearch arm)", secondary: "fused-level delta (observational only — never weighting-gain proof)",
    byStratum, byDomain, rows,
  };
  mkdirSync(dirname(DELTA_OUT), { recursive: true });
  writeFileSync(DELTA_OUT, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  console.log("--- vertical delta ---");
  console.log("n=" + rows.length + " fingerprint=" + fingerprint + " controlDegraded=" + controlDegraded);
  for (const s of strata) {
    const a = byStratum[s]!;
    console.log(s + " n=" + a.n + " paired=" + a.nPaired + " armHost on=" + fmt(a.armHostHit.on) + " off=" + fmt(a.armHostHit.off) + " fused on=" + fmt(a.fusedHostHit.on) + " off=" + fmt(a.fusedHostHit.off) + " rankDiff=" + fmt(a.expectRankOfMeanDiff) + " v=" + JSON.stringify(a.verdicts));
  }
  // Structural assertions on the artifact, not on quality values (small n —
  // values are evidence, not gates). Every row must carry arm identity + the
  // fingerprint must be present; unknown cells stay null.
  assert(artifact.datasetFingerprint.length === 16, "fingerprint hex16 present");
  assert(rows.every((r) => r.arm === "anysearch"), "every row carries arm identity");
  assert(rows.every((r) => Object.hasOwn(r.delta, "verdict")), "every row carries a verdict field");
  assert(controlDegraded <= rows.filter((r) => r.role === "control").length, "control degraded count consistent");
  if (LIMIT === 0) assert(byStratum.control !== undefined, "control stratum aggregated (full-corpus run)");
  console.log("PASS: vertical-delta artifact emitted -> " + DELTA_OUT);
  function fmt(v: number | null): string { return v === null ? "null" : String(Math.round(v * 100) / 100); }
})().catch((e) => { console.error(e); process.exit(1); });
