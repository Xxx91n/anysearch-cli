// R62 D-006 (T6): eval-looks golden executor — ONLINE live layer.
// Entries with scope live|both run through the REAL bundled ans bin
// (`node apps/cli/dist/index.js search --json`) — the shipped path, not a test
// double — with hard verdict/mustHitHosts/mustHitUrls/minResults assertions.
// Discovered only by `pnpm -C packages/store test:online` (glob *.online.ts);
// never on the ship-gate --offline path (D-006). Flaky live failures belong to
// the eval-quarantine.json ledger (ADR-0027 D8), not relaxed assertions.
// Skip policy: the bundled bin must exist and at least one provider key must be
// set — a silent zero-provider run would fake a pass, so we skip loudly instead.
//
// R64 D-004/D-005 additions:
// - Quarantine classification consumes the ledger's single implementation
//   (readQuarantine + activeIds) — the previous inline copy ignored the
//   longterm flag (second-predicate drift).
// - Evidence mode (ANS_EVAL_EVIDENCE=1): quarantined entries actually execute
//   (quarantined-but-runnable — a skipped case can never emit a gone-green
//   signal), each executed entry appends an EVIDENCE quadruple
//   (id / verdict / ISO timestamp / run ref) to ANS_EVAL_EVIDENCE_LOG
//   (default .scratch/eval-evidence.log), a run whose only failures are
//   quarantined exits 0, and an entry all-red in consecutive evidence runs
//   prints RETIRE_CANDIDATE for reviewDue().
// - R64 D-002: mustHitPaths/mustNotHitPaths page-family layer — pathname
//   substring match, host-scoped to the entry's mustHitHosts when declared.
// - R64 D-005: watch:true entries announce their post-promote observation mark.
//
// NOTE for evidence runs: invoke this file directly
// (`node --import tsx test/online/eval-looks-live.online.ts`) — under
// node --test the 180s/file timeout cannot fit a full quarantined sweep.

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { readQuarantine, activeIds } from "../../src/eval/quarantine-ledger";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dist = join(root, "apps", "cli", "dist", "index.js");
const looks = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));

const keyed = ["EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY"].some((k) => !!process.env[k]);

const evidenceMode = process.env.ANS_EVAL_EVIDENCE === "1";
const runRef = process.env.ANS_EVAL_RUN_URL ?? "local:" + new Date().toISOString();
const evidenceLog = process.env.ANS_EVAL_EVIDENCE_LOG ?? join(root, ".scratch", "eval-evidence.log");

function searchJson(question: string, env: NodeJS.ProcessEnv, vertical?: { domain: string; subDomain?: string; params?: Record<string, unknown> }): any {
  const args = [dist, "search", question, "--json"];
  // R84 T1 / ADR-0085 draft: vertical entries ride the real --vertical-* flags —
  // the live leg exercises the same config boundary a user types at.
  if (vertical) {
    args.push("--vertical-domain", vertical.domain);
    if (vertical.subDomain) args.push("--vertical-sub-domain", vertical.subDomain);
    if (vertical.params !== undefined) args.push("--vertical-params", JSON.stringify(vertical.params));
  }
  const r = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 60000 });
  if (r.error) return { __error: String(r.error) };
  try { return JSON.parse(r.stdout); } catch { return { __error: "unparseable stdout", __raw: (r.stdout ?? "").slice(-300), __code: r.status }; }
}

// Providers return schemeless URLs (e.g. "modelcontextprotocol.io/spec/...") —
// the engine tolerates them via the same https:// prefix before parsing.
// Hosts are compared www-normalized: the engine's own normalizeUrl strips the
// leading "www." for dedup, so the alias distinction is not load-bearing here.
function parseResultUrl(url: string): URL | null {
  try { return new URL(url.includes("://") ? url : "https://" + url); }
  catch { return null; }
}

function bareHost(h: string): string { return h.replace(/^www\./, ""); }

function hostHit(results: any[], host: string): boolean {
  const want = bareHost(host);
  return results.some((r) => {
    const h = parseResultUrl(r.url)?.hostname;
    return !!h && (bareHost(h) === want || bareHost(h).endsWith("." + want));
  });
}

function trimSlash(p: string): string { return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p; }
function urlHit(results: any[], url: string): boolean {
  let want: URL | null = null;
  try { want = new URL(url); } catch { return false; }
  const wp = trimSlash(want.pathname);
  const wantHost = bareHost(want.hostname);
  return results.some((r) => {
    const u = parseResultUrl(r.url);
    return !!u && bareHost(u.hostname) === wantHost && trimSlash(u.pathname) === wp;
  });
}

// R64 D-002 page-family matchers. When the entry declares mustHitHosts the
// pattern must land on one of those hosts: the asserted product promise is
// "site X page family", not "any host with a /settings-shaped path".
function hostIn(u: URL, hosts: string[]): boolean {
  const h = bareHost(u.hostname);
  return hosts.some((w) => h === bareHost(w) || h.endsWith("." + bareHost(w)));
}
function pathHit(results: any[], pattern: string, hosts: string[]): boolean {
  return results.some((r) => {
    const u = parseResultUrl(r.url);
    return !!u && u.pathname.includes(pattern) && (hosts.length === 0 || hostIn(u, hosts));
  });
}
function pathMiss(results: any[], pattern: string, hosts: string[]): boolean {
  return !results.some((r) => {
    const u = parseResultUrl(r.url);
    return !!u && u.pathname.includes(pattern) && (hosts.length === 0 || hostIn(u, hosts));
  });
}

// Last recorded evidence record per id — consecutive-all-red detection
// input. allRed means the previous run failed every assertion (f>0 && p=0);
// a partial fail is not "全红" (audit F3).
interface EvidenceRecord { verdict: string; allRed: boolean }
function lastEvidenceVerdicts(file: string): Map<string, EvidenceRecord> {
  const last = new Map<string, EvidenceRecord>();
  if (!existsSync(file)) return last;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^EVIDENCE (\S+) (pass|fail) \S+ \S+ p=(\d+) f=(\d+)/.exec(line);
    if (m) last.set(m[1] as string, { verdict: m[2] as string, allRed: +(m[4] as string) > 0 && +(m[3] as string) === 0 });
  }
  return last;
}

function main() {
  if (!existsSync(dist)) {
    console.log("SKIP eval-looks live: apps/cli/dist/index.js missing (run pnpm --filter @anysearch-cli/cli build)");
    return;
  }
  if (!keyed) {
    console.log("SKIP eval-looks live: no provider key set (EXA_API_KEY/TAVILY_API_KEY/ANYSEARCH_API_KEY)");
    return;
  }

  const scopes: Record<string, string> = looks.golden.scopes ?? {};
  const entries: any[] = looks.golden.entries.filter((e: any) => scopes[e.id] === "live" || scopes[e.id] === "both");
  assert(entries.length > 0, "live slice non-empty (got " + entries.length + ")");
  // Baseline asserts can never be quarantine-attributable.
  let nonQuarFailed = failed;

  // ADR-0027 D8 + R64 D-004: active-quarantined entries are reported, not
  // silently skipped — the quarantine mark is policy, the TTL clock lives in
  // eval-quarantine.json. Classification = the ledger's single implementation.
  const qPath = join(root, "packages", "store", "eval-quarantine.json");
  const quarantined = new Set<string>(activeIds(readQuarantine(qPath), new Date().toISOString()));
  const priorVerdicts = evidenceMode ? lastEvidenceVerdicts(evidenceLog) : new Map<string, EvidenceRecord>();

  // Cold-domain fixture dir for entries whose domain has no shipped toml.
  const coldDir = mkdtempSync(join(tmpdir(), "ans-looks-cold-"));
  writeFileSync(join(coldDir, "cold.toml"), [
    'name = "cold"', 'description = "eval-looks live cold fixture (r61 narrow domain)"',
    '[settings]', 'language = "TypeScript"', 'depth = "docs"',
    '[skills]', 'active = ["search"]',
    '[sources]', 'enabled = ["tavily", "exa", "anysearch"]', 'urlAllowlist = ["nonexistent.invalid"]',
    '[rag]', 'adapter = "none"',
  ].join("\n"));

  for (const e of entries) {
    const isQuar = quarantined.has(e.id);
    if (isQuar && !evidenceMode) { console.log("QUARANTINED " + e.id + " (eval-quarantine.json active; TTL clock running)"); continue; }
    if (isQuar) console.log("EVIDENCE-RUN " + e.id + " (quarantined — executing for evidence)");
    if (e.watch === true) console.log("WATCH " + e.id + " (post-promote watch — a CI flip re-enters quarantine via the ratchet)");
    const p0 = passed, f0 = failed;
    const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAIN: e.domain };
    if (e.domain === "cold") env.ANS_DOMAINS_DIR = coldDir;
    const j = searchJson(e.question, env, e.vertical);
    assert(!j.__error, e.id + " ran (" + (j.__error ?? "ok") + ")");
    if (!j.__error) {
      if (e.expected.verdict === "abstain") {
        assert(j.abstain?.abstain === true, e.id + " abstain marker (got " + JSON.stringify(j.abstain) + ")");
        assert(j.results.length === 0, e.id + " zero results (got " + j.results.length + ")");
      } else {
        assert(!j.abstain, e.id + " answer verdict has no abstain marker");
        assert(j.results.length >= (e.expected.minResults ?? 1), e.id + " minResults " + (e.expected.minResults ?? 1) + " (got " + j.results.length + ")");
        for (const h of e.expected.mustHitHosts ?? [])
          assert(hostHit(j.results, h), e.id + " mustHitHost " + h + " present in results");
        for (const u of e.expected.mustHitUrls ?? [])
          assert(urlHit(j.results, u), e.id + " mustHitUrl " + u + " present in results");
        const hosts: string[] = e.expected.mustHitHosts ?? [];
        for (const m of e.expected.mustHitPaths ?? [])
          assert(pathHit(j.results, m.path, hosts), e.id + " mustHitPath " + m.path + " present in results (tolerate " + (m.tolerate ?? []).join("/") + ")");
        for (const n of e.expected.mustNotHitPaths ?? [])
          assert(pathMiss(j.results, n, hosts), e.id + " mustNotHitPath " + n + " absent from results");
      }
      // R84 T1 / ADR-0085 draft: expected.vertical assertion surface (live leg).
      // hit rides on the fused results' extra.vertical marker; control entries
      // pin the silent-fallback surface — see degraded handling below.
      const vexp = e.expected?.vertical;
      if (vexp !== undefined) {
        const marked = j.results.filter((r: any) => r.extra?.vertical !== undefined);
        if (vexp.role === "subject") {
          if (vexp.hit === true) {
            assert(marked.some((r: any) => r.extra.vertical.domain === vexp.domain), e.id + " verticalHit: result carries extra.vertical.domain=" + vexp.domain);
            if (vexp.sub_domain !== undefined) {
              assert(marked.some((r: any) => r.extra.vertical.subDomain === vexp.sub_domain), e.id + " verticalHit: marker carries subDomain=" + vexp.sub_domain);
            }
          }
        }
        if (vexp.hit === false) {
          assert(marked.length === 0, e.id + " no result carries extra.vertical (silent-fallback surface stays clean)");
        }
        if (vexp.degraded === "general-fallback") {
          // The vertical arm produced no marked results; the general fanout
          // still answers. Existence is the assertion (D-004 iii).
          assert(j.results.length >= 1, e.id + " general-fallback: results exist");
        }
      }
    }
    const ePass = passed - p0, eFail = failed - f0;
    // R84 T1 / D-004 iii: control entries' failures walk the degraded list,
    // never the red gate — existence is a first-class assertion, passing is
    // not. Failures are reclassified out of the red counter and logged.
    const isControl = e.expected?.vertical?.role === "control";
    if (isControl && eFail > 0) {
      failed -= eFail;
      console.log("CONTROL-DEGRADED " + e.id + " (control arm assertions failed -> degraded list, not the red gate; f=" + eFail + ")");
    }
    if (evidenceMode) {
      const line = "EVIDENCE " + e.id + " " + (eFail > 0 ? "fail" : "pass") + " " + new Date().toISOString() + " " + runRef + " p=" + ePass + " f=" + eFail;
      console.log(line);
      try {
        mkdirSync(dirname(evidenceLog), { recursive: true });
        appendFileSync(evidenceLog, line + "\n");
      } catch (err) {
        console.error("evidence log append failed: " + String(err));
      }
      // Consecutive all-red → retire candidate for reviewDue(): BOTH this run
      // and the previous evidence record must be fully red (zero assertions
      // passed) — a partial fail is not "全红". Quarantined entries only.
      const prior = priorVerdicts.get(e.id);
      if (isQuar && eFail > 0 && ePass === 0 && prior?.allRed === true)
        console.log("RETIRE_CANDIDATE " + e.id + " (consecutive all-red evidence runs)");
    }
    if (!isQuar && eFail > 0) nonQuarFailed += eFail;
  }

  rmSync(coldDir, { recursive: true, force: true });
  console.log("--- eval-looks live executor: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) {
    if (evidenceMode && nonQuarFailed === 0) {
      console.log("EVIDENCE-ONLY-FAILURES: every red assertion belongs to a quarantined entry — exit overridden to 0 (R64 D-004)");
      return;
    }
    process.exit(1);
  }
}
main();
