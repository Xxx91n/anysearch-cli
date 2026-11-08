#!/usr/bin/env node
// criterion 5: Tavily include_domains leakage probe — INJECT-style
// deterministic ledger. Re-runnable: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs
// Output: .scratch/grill-round-62/tavily-probe-ledger.{json,md}
// Arms: A default-mode leak / B filter-mode hard / C subdomain directionality /
// D research-endpoint soft preference (live arm gated by PROBE_TAVILY_RESEARCH=1).
// Design: a run with no conclusive arm (missing/invalid key, all arms ERROR)
// exits 2 and marks the ledger evidenceStatus=not-verified — SKIPPED/ERROR arms
// are not evidence, so the run must not look green; rerun with a key to
// produce a PASS/LEAK ledger.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const NL = String.fromCharCode(10);
const OUT_DIR = join(process.cwd(), ".scratch", "grill-round-62"); // r61 originals are SKIPPED-tagged — a rerun must not overwrite them
const KEY = process.env.TAVILY_API_KEY;
const HOST = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const inDomain = (u, allow) => { const h = HOST(u); return allow.some((e) => h === e || h.endsWith("." + e)); };
async function tavily(endpoint, body) {
  const res = await fetch("https://api.tavily.com" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 400) };
}
const ledger = { schema: "anysearch/tavily-domain-probe@1", ranAt: new Date().toISOString(), key: KEY ? "set" : "unset", evidenceStatus: "pending", arms: [] };
const record = (arm) => { ledger.arms.push(arm); console.log("[" + arm.status + "] " + arm.id + " - " + arm.summary); };
if (!KEY) {
  for (const id of ["A-default-mode", "B-filter-mode", "C-subdomain-direction", "D-research-endpoint"])
    record({ id, status: "SKIPPED", summary: "TAVILY_API_KEY unset - live arm not run", evidence: null });
} else {
  try {
    const r = await tavily("/search", { query: "tokio JoinSet rust spawn structured concurrency", max_results: 10, include_domains: ["pnpm.io"] });
    if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.text);
    const urls = (r.json?.results ?? []).map((x) => x.url);
    const leaks = urls.filter((u) => !inDomain(u, ["pnpm.io"]));
    const status = urls.length === 0 ? "INCONCLUSIVE" : (leaks.length ? "LEAK" : "PASS");
    record({ id: "A-default-mode", status, summary: urls.length === 0 ? "0 results — vacuous, no source checked" : leaks.length + "/" + urls.length + " results outside include_domains (default mode)", evidence: { urls, leaks } });
  } catch (e) { record({ id: "A-default-mode", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  try {
    const r = await tavily("/search", { query: "tokio JoinSet rust spawn structured concurrency", max_results: 10, include_domains: ["pnpm.io"], include_domains_mode: "filter" });
    if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.text);
    const urls = (r.json?.results ?? []).map((x) => x.url);
    const leaks = urls.filter((u) => !inDomain(u, ["pnpm.io"]));
    const status = urls.length === 0 ? "INCONCLUSIVE" : (leaks.length ? "LEAK" : "PASS");
    record({ id: "B-filter-mode", status, summary: urls.length === 0 ? "0 results — vacuous, no source checked" : leaks.length + "/" + urls.length + " results outside include_domains (filter mode)", evidence: { urls, leaks } });
  } catch (e) { record({ id: "B-filter-mode", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  try {
    const parent = await tavily("/search", { query: "typescript tsconfig compilerOptions", max_results: 10, include_domains: ["typescriptlang.org"], include_domains_mode: "filter" });
    const sub = await tavily("/search", { query: "typescript tsconfig compilerOptions", max_results: 10, include_domains: ["www.typescriptlang.org"], include_domains_mode: "filter" });
    if (parent.status !== 200 || sub.status !== 200) throw new Error("HTTP " + parent.status + "/" + sub.status);
    const pHosts = [...new Set((parent.json?.results ?? []).map((x) => HOST(x.url)))];
    const sHosts = [...new Set((sub.json?.results ?? []).map((x) => HOST(x.url)))];
    const parentCoversSub = pHosts.some((h) => h !== "typescriptlang.org" && h.endsWith(".typescriptlang.org"));
    const subPullsParent = sHosts.some((h) => h === "typescriptlang.org" || (h.endsWith(".typescriptlang.org") && h !== "www.typescriptlang.org"));
    const status = pHosts.length === 0 && sHosts.length === 0 ? "INCONCLUSIVE" : "PASS";
    record({ id: "C-subdomain-direction", status, summary: (status === "INCONCLUSIVE" ? "0 hosts — vacuous, no source checked; " : "") + "parent hosts=" + JSON.stringify(pHosts) + " sub hosts=" + JSON.stringify(sHosts) + " parentCoversSub=" + parentCoversSub + " subPullsParent=" + subPullsParent, evidence: { pHosts, sHosts, parentCoversSub, subPullsParent } });
  } catch (e) { record({ id: "C-subdomain-direction", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  if (process.env.PROBE_TAVILY_RESEARCH === "1") {
    try {
      const r = await tavily("/research", { input: "tokio JoinSet structured concurrency", include_domains: ["pnpm.io"] });
      const urls = [];
      const walk = (o) => { if (!o || typeof o !== "object") return; if (typeof o.url === "string") urls.push(o.url); for (const v of Object.values(o)) walk(v); };
      walk(r.json);
      const leaks = urls.filter((u) => !inDomain(u, ["pnpm.io"]));
      // honesty fix: 0 extracted sources is vacuous, not a pass — the
      // research response shape returned no url fields this run, so the arm
      // records INCONCLUSIVE with the response keys for later review instead
      // of overstating leakage assurance.
      const dStatus = urls.length === 0 ? "INCONCLUSIVE" : (leaks.length ? "LEAK" : "PASS");
      const dSummary = urls.length === 0
        ? "0 url fields in /research response (keys: " + Object.keys(r.json ?? {}).join(",") + ") — vacuous, response shape needs review"
        : leaks.length + "/" + urls.length + " research sources outside include_domains";
      record({ id: "D-research-endpoint", status: dStatus, summary: dSummary, evidence: { urls: urls.slice(0, 20), leaks: leaks.slice(0, 20), httpStatus: r.status, responseKeys: Object.keys(r.json ?? {}) } });
    } catch (e) { record({ id: "D-research-endpoint", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  } else {
    record({ id: "D-research-endpoint", status: "SKIPPED", summary: "PROBE_TAVILY_RESEARCH=1 not set - changelog documents research include_domains as soft preference", evidence: null });
  }
}
const conclusive = ledger.arms.some((a) => a.status === "PASS" || a.status === "LEAK");
ledger.evidenceStatus = conclusive ? "live" : "not-verified";
if (!conclusive) console.error("no conclusive evidence this run — evidenceStatus=not-verified (exit 2, not a pass)");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "tavily-probe-ledger.json"), JSON.stringify(ledger, null, 2) + NL, "utf8");
const md = ["# Tavily include_domains probe ledger (criterion 5)", "", "ranAt: " + ledger.ranAt + " | key: " + ledger.key + " | evidence: " + ledger.evidenceStatus, "", "| arm | status | summary |", "|---|---|---|",...ledger.arms.map((a) => "| " + a.id + " | " + a.status + " | " + a.summary.replace(/\|/g, "/") + " |"), "", "Re-run: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs (PROBE_TAVILY_RESEARCH=1 enables arm D)."].join(NL);
writeFileSync(join(OUT_DIR, "tavily-probe-ledger.md"), md + NL, "utf8");
console.log("ledger -> " + join(OUT_DIR, "tavily-probe-ledger.{json,md}"));
if (!conclusive) process.exitCode = 2;
