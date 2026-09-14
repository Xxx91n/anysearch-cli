// R62 D-006 (T6): eval-looks golden executor — ONLINE live layer.
// Entries with scope live|both run through the REAL bundled ans bin
// (`node apps/cli/dist/index.js search --json`) — the shipped path, not a test
// double — with hard verdict/mustHitHosts/mustHitUrls/minResults assertions.
// Discovered only by `pnpm -C packages/store test:online` (glob *.online.ts);
// never on the ship-gate --offline path (D-006). Flaky live failures belong to
// the eval-quarantine.json ledger (ADR-0027 D8), not relaxed assertions.
// Skip policy: the bundled bin must exist and at least one provider key must be
// set — a silent zero-provider run would fake a pass, so we skip loudly instead.

import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dist = join(root, "apps", "cli", "dist", "index.js");
const looks = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));

const keyed = ["EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY"].some((k) => !!process.env[k]);

function searchJson(question: string, env: NodeJS.ProcessEnv): any {
  const r = spawnSync(process.execPath, [dist, "search", question, "--json"], { env, encoding: "utf8", timeout: 60000 });
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

function main() {
  if (!existsSync(dist)) {
    console.log("SKIP eval-looks live: apps/cli/dist/index.js missing (run pnpm --filter @anysearch/cli build)");
    return;
  }
  if (!keyed) {
    console.log("SKIP eval-looks live: no provider key set (EXA_API_KEY/TAVILY_API_KEY/ANYSEARCH_API_KEY)");
    return;
  }

  const scopes: Record<string, string> = looks.golden.scopes ?? {};
  const entries: any[] = looks.golden.entries.filter((e: any) => scopes[e.id] === "live" || scopes[e.id] === "both");
  assert(entries.length > 0, "live slice non-empty (got " + entries.length + ")");

  // ADR-0027 D8: active-quarantined entries are reported, not silently skipped —
  // the quarantine mark is policy, the TTL clock lives in eval-quarantine.json.
  const qPath = join(root, "packages", "store", "eval-quarantine.json");
  const quarantined = new Set<string>();
  if (existsSync(qPath)) {
    const q = JSON.parse(readFileSync(qPath, "utf8"));
    const now = Date.now();
    for (const e of q.entries ?? []) {
      if (!e.retired && Date.parse(e.expiresAt) > now) quarantined.add(e.id);
    }
  }

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
    if (quarantined.has(e.id)) { console.log("QUARANTINED " + e.id + " (eval-quarantine.json active; TTL clock running)"); continue; }
    const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAIN: e.domain };
    if (e.domain === "cold") env.ANS_DOMAINS_DIR = coldDir;
    const j = searchJson(e.question, env);
    assert(!j.__error, e.id + " ran (" + (j.__error ?? "ok") + ")");
    if (j.__error) continue;
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
    }
  }

  rmSync(coldDir, { recursive: true, force: true });
  console.log("--- eval-looks live executor: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main();
