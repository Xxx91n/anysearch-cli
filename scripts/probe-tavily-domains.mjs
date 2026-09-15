#!/usr/bin/env node
// ADR-0062 D3 criterion 5 (T1): Tavily include_domains leakage probe — INJECT-style
// deterministic ledger. Re-runnable: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs
// Output: .scratch/grill-round-62/tavily-probe-ledger.{json,md}
// Arms: A default-mode leak / B filter-mode hard / C subdomain directionality /
// D research-endpoint soft preference (live arm gated by PROBE_TAVILY_RESEARCH=1).
// SKIPPED is recorded honestly when TAVILY_API_KEY is absent.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const NL = String.fromCharCode(10);
const OUT_DIR = join(process.cwd(), ".scratch", "grill-round-62"); // R63 T4/F-3: r61 originals are SKIPPED-tagged — a rerun must not overwrite them
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
const ledger = { schema: "anysearch/tavily-domain-probe@1", ranAt: new Date().toISOString(), key: KEY ? "set" : "unset", arms: [] };
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
    record({ id: "A-default-mode", status: leaks.length ? "LEAK" : "PASS", summary: leaks.length + "/" + urls.length + " results outside include_domains (default mode)", evidence: { urls, leaks } });
  } catch (e) { record({ id: "A-default-mode", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  try {
    const r = await tavily("/search", { query: "tokio JoinSet rust spawn structured concurrency", max_results: 10, include_domains: ["pnpm.io"], include_domains_mode: "filter" });
    if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.text);
    const urls = (r.json?.results ?? []).map((x) => x.url);
    const leaks = urls.filter((u) => !inDomain(u, ["pnpm.io"]));
    record({ id: "B-filter-mode", status: leaks.length ? "LEAK" : "PASS", summary: leaks.length + "/" + urls.length + " results outside include_domains (filter mode)", evidence: { urls, leaks } });
  } catch (e) { record({ id: "B-filter-mode", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  try {
    const parent = await tavily("/search", { query: "typescript tsconfig compilerOptions", max_results: 10, include_domains: ["typescriptlang.org"], include_domains_mode: "filter" });
    const sub = await tavily("/search", { query: "typescript tsconfig compilerOptions", max_results: 10, include_domains: ["www.typescriptlang.org"], include_domains_mode: "filter" });
    if (parent.status !== 200 || sub.status !== 200) throw new Error("HTTP " + parent.status + "/" + sub.status);
    const pHosts = [...new Set((parent.json?.results ?? []).map((x) => HOST(x.url)))];
    const sHosts = [...new Set((sub.json?.results ?? []).map((x) => HOST(x.url)))];
    const parentCoversSub = pHosts.some((h) => h !== "typescriptlang.org" && h.endsWith(".typescriptlang.org"));
    const subPullsParent = sHosts.some((h) => h === "typescriptlang.org" || (h.endsWith(".typescriptlang.org") && h !== "www.typescriptlang.org"));
    record({ id: "C-subdomain-direction", status: "PASS", summary: "parent hosts=" + JSON.stringify(pHosts) + " sub hosts=" + JSON.stringify(sHosts) + " parentCoversSub=" + parentCoversSub + " subPullsParent=" + subPullsParent, evidence: { pHosts, sHosts, parentCoversSub, subPullsParent } });
  } catch (e) { record({ id: "C-subdomain-direction", status: "ERROR", summary: String(e.message || e), evidence: null }); }
  if (process.env.PROBE_TAVILY_RESEARCH === "1") {
    try {
      const r = await tavily("/research", { input: "tokio JoinSet structured concurrency", include_domains: ["pnpm.io"] });
      const urls = [];
      const walk = (o) => { if (!o || typeof o !== "object") return; if (typeof o.url === "string") urls.push(o.url); for (const v of Object.values(o)) walk(v); };
      walk(r.json);
      const leaks = urls.filter((u) => !inDomain(u, ["pnpm.io"]));
      // R62 T8 honesty fix: 0 extracted sources is vacuous, not a pass — the
      // /research response shape returned no url fields this run, so the arm
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
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "tavily-probe-ledger.json"), JSON.stringify(ledger, null, 2) + NL, "utf8");
const md = ["# Tavily include_domains probe ledger (ADR-0062 criterion 5)", "", "ranAt: " + ledger.ranAt + " | key: " + ledger.key, "", "| arm | status | summary |", "|---|---|---|", ...ledger.arms.map((a) => "| " + a.id + " | " + a.status + " | " + a.summary.replace(/\|/g, "/") + " |"), "", "Re-run: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs (PROBE_TAVILY_RESEARCH=1 enables arm D)."].join(NL);
writeFileSync(join(OUT_DIR, "tavily-probe-ledger.md"), md + NL, "utf8");
console.log("ledger -> " + join(OUT_DIR, "tavily-probe-ledger.{json,md}"));
