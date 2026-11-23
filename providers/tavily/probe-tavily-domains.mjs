#!/usr/bin/env node
// Tavily include_domains leakage probe: four arms, one ledger per run, exit 1 on a leak
// and exit 2 when the run proved nothing.
// Arms: A default-mode leak / B restrict-vs-prefer contrast / C subdomain directionality /
// D research-endpoint soft preference (live arm gated by PROBE_TAVILY_RESEARCH=1).
// Design: exit 2 also covers "B never saw prefer widen" — A or C passing shows the filter
// held, not that upstream read the field, so they cannot carry the run on their own.
// Credentials come from the same resolver the product uses (env TAVILY_API_KEY first, then
// ~/.ans/credentials.json); the ledger records where, as keySource: env / user / none.
// PROBE_TAVILY_ENDPOINT points the run at a local stub; the default is the public
// https://api.tavily.com and no endpoint value is ever printed.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { maskSecrets, resolveProbeCredentials } from "../probe-credentials.mjs";
const NL = String.fromCharCode(10);
const OUT_DIR = process.env.PROBE_TAVILY_OUT_DIR || join(process.cwd(), ".scratch", "tavily-probe"); // per-run file names, so a rerun never overwrites an earlier ledger
// 产品同一套解析：环境变量优先，再读凭据文件；文件坏了会带 credentialWarning 出来，
// 不会被当成「没配 key」。
const credentials = resolveProbeCredentials("tavily");
const KEY = credentials.apiKey;
// Probe-only endpoint override: 凭据接线只能用本地桩验，不能让测试打真上游。
// Design: 探针自己的 endpoint 用 PROBE_TAVILY_ENDPOINT 覆盖，默认仍是公开地址 —— anysearch
// 的 ANYSEARCH_ENDPOINT 是同一个先例，适配器那边不开这个口子（#497 记的决定）。值不打印。
const BASE = (process.env.PROBE_TAVILY_ENDPOINT || "https://api.tavily.com").replace(/\/+$/, "");
const scrubText = (s) => maskSecrets(String(s), [[KEY, "<key>"], [BASE, "<endpoint>"]]);
// A, B and D share this query and allowlist: A sends no mode, B sends restrict and
// prefer, D switches to the /research endpoint (no mode field there at all).
const QUERY = "tokio JoinSet rust spawn structured concurrency";
const ALLOW = ["pnpm.io"];
const MAX_RESULTS = 10;
const MODE_RESTRICT = "restrict";
const MODE_PREFER = "prefer";
const ARM_A = "A-default-mode";
const ARM_C = "C-subdomain-direction";
const ARM_D = "D-research-endpoint";
// C compares a parent against one of its subdomains, so both calls must be the same search.
const CF_QUERY = "cloudflare workers durable objects";
const CF_PARENT = ["cloudflare.com"];
const CF_SUB = ["developers.cloudflare.com"];
// The arm name and the exit-code check share this constant.
const ARM_B = "B-restrict-vs-prefer";
const HOST = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const inDomain = (u, allow) => { const h = HOST(u); return allow.some((e) => h === e || h.endsWith("." + e)); };
// The urls that fall outside an allowlist.
const leaksIn = (urls, allow) => urls.filter((u) => !inDomain(u, allow));
// A rejected call still has to reach the ledger as evidence, not as a bare thrown error.
const settledResult = (r) => {
  if (r.status === "fulfilled") return r.value;
  const why = r.reason;
  const detail = [why?.message, why?.cause?.message].filter(Boolean).join(" — ") || String(why);
  return { status: 0, json: null, text: scrubText(detail) };
};
// A and D both just need the outside-allowlist count, though they answer different
// questions: A asks whether the hard filter leaks, D whether /research stays soft.
const judgeLeaks = (urls, allow) => {
  const leaks = leaksIn(urls, allow);
  let status = "PASS";
  if (urls.length === 0) status = "INCONCLUSIVE";
  else if (leaks.length > 0) status = "LEAK";
  return { status, leaks };
};
const resultUrls = (json) => (Array.isArray(json?.results) ? json.results : [])
  .map((x) => x?.url)
  .filter((u) => typeof u === "string" && /^https?:/i.test(u));
async function tavily(endpoint, body) {
  const res = await fetch(BASE + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 400) };
}
const ledger = {
  schema: "anysearch/tavily-domain-probe@2",
  ranAt: new Date().toISOString(),
  keySource: credentials.keySource,
  ...(credentials.credentialWarning ? { credentialWarning: scrubText(credentials.credentialWarning) } : {}),
  evidenceStatus: "pending",
  arms: [],
};
const LEDGER_BASE = "tavily-probe-ledger-" + ledger.ranAt.replace(/[^0-9TZ]/g, "");
// Flushed after every arm: a run killed halfway still leaves what it learned on disk.
const flush = () => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, LEDGER_BASE + ".json"), JSON.stringify(ledger, null, 2) + NL, "utf8");
  const rows = ledger.arms.map((a) => "| " + a.id + " | " + a.status + " | " + a.summary.replace(/\|/g, "/") + " |");
  const md = [
    "# Tavily include_domains probe ledger", "",
    "ranAt: " + ledger.ranAt + " | keySource: " + ledger.keySource + " | evidence: " + ledger.evidenceStatus,
    ...(ledger.credentialWarning ? ["credentialWarning: " + ledger.credentialWarning] : []),
    "", "| arm | status | summary |", "|---|---|---|", ...rows, "",
    "Re-run: TAVILY_API_KEY=tvly-... node providers/tavily/probe-tavily-domains.mjs",
    "(or `ans auth set tavily` first; PROBE_TAVILY_RESEARCH=1 enables arm D.)",
  ].join(NL);
  writeFileSync(join(OUT_DIR, LEDGER_BASE + ".md"), md + NL, "utf8");
  return join(OUT_DIR, LEDGER_BASE + ".{json,md}");
};
const record = (arm) => {
  // 摘要会进 stdout 和台账：key 或 endpoint 的值出现在上游报错里也遮掉。
  const safe = { ...arm, summary: scrubText(arm.summary) };
  ledger.arms.push(safe);
  console.log("[" + safe.status + "] " + safe.id + " - " + safe.summary);
  flush();
};
// 文件读坏 / 解析坏不是「没配 key」：两个出口都说出来，别让人去查上游额度。
if (credentials.credentialWarning) console.error("credentialWarning: " + scrubText(credentials.credentialWarning));
if (!KEY) {
  // 摘要也得分清「没配」和「文件坏了」——否则坏文件那一跑等于在台账里断言文件里没 key。
  const why = credentials.credentialWarning
    ? "no usable tavily key — the credential file is unreadable (see credentialWarning); live arm not run"
    : "no tavily key in the environment or ~/.ans/credentials.json — live arm not run";
  for (const id of [ARM_A, ARM_B, ARM_C, ARM_D])
    record({ id, status: "SKIPPED", summary: why, evidence: null });
} else {
  let aPartial = null;
  try {
    const r = settledResult((await Promise.allSettled([
      tavily("/search", { query: QUERY, max_results: MAX_RESULTS, include_domains: ALLOW }),
    ]))[0]);
    aPartial = { urls: resultUrls(r.json), httpStatus: r.status, resultKeys: Object.keys(r.json ?? {}) };
    if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.text);
    const allResults = Array.isArray(r.json?.results) ? r.json.results : [];
    const urls = resultUrls(r.json);
    const judged = judgeLeaks(urls, ALLOW);
    const summary = urls.length === 0
      ? "0 valid result URLs (of " + allResults.length + ") — vacuous, no source checked"
      : judged.leaks.length + "/" + urls.length + " results outside include_domains (no mode sent)";
    record({ id: ARM_A, status: judged.status, summary, evidence: { urls, leaks: judged.leaks, httpStatus: r.status, resultKeys: Object.keys(r.json ?? {}) } });
  } catch (e) { record({ id: ARM_A, status: "ERROR", summary: String(e.message || e), evidence: aPartial }); }
  let bPartial = null;
  try {
    // Same query, restrict against prefer. "restrict" alone answers exactly like
    // sending no mode, so only the pair shows whether upstream reads the field.
    const [strictR, wideR] = await Promise.allSettled([
      tavily("/search", { query: QUERY, max_results: MAX_RESULTS, include_domains: ALLOW, include_domains_mode: MODE_RESTRICT }),
      tavily("/search", { query: QUERY, max_results: MAX_RESULTS, include_domains: ALLOW, include_domains_mode: MODE_PREFER }),
    ]);
    const strict = settledResult(strictR);
    const wide = settledResult(wideR);
    bPartial = { strictUrls: resultUrls(strict.json), preferUrls: resultUrls(wide.json), httpStatus: { restrict: strict.status, prefer: wide.status } };
    if (strict.status !== 200 || wide.status !== 200) throw new Error("HTTP " + strict.status + "/" + wide.status + " — " + strict.text + " | " + wide.text);
    const sAll = Array.isArray(strict.json?.results) ? strict.json.results : [];
    const wAll = Array.isArray(wide.json?.results) ? wide.json.results : [];
    const sUrls = resultUrls(strict.json);
    const wUrls = resultUrls(wide.json);
    const sLeaks = leaksIn(sUrls, ALLOW);
    const wLeaks = leaksIn(wUrls, ALLOW);
    // Empty restrict first, then a restrict leak, then whether prefer widened.
    let status = "INCONCLUSIVE";
    let summary = "both arms stayed inside include_domains (restrict " + sUrls.length + ", prefer " + wUrls.length + ") — prefer did not widen, field unproven";
    if (sUrls.length === 0) {
      summary = "restrict returned 0 valid result URLs (of " + sAll.length + ") — vacuous, nothing proved";
    } else if (sLeaks.length > 0) {
      status = "LEAK";
      summary = "restrict " + sLeaks.length + "/" + sUrls.length + " outside include_domains (prefer " + wLeaks.length + "/" + wUrls.length + ")";
    } else if (wLeaks.length > 0) {
      status = "PASS";
      summary = "restrict 0/" + sUrls.length + " outside include_domains; prefer " + wLeaks.length + "/" + wUrls.length + " outside";
    } else if (wUrls.length === 0) {
      summary = "prefer returned 0 valid result URLs (of " + wAll.length + ") — vacuous, prefer not compared";
    }
    record({ id: ARM_B, status, summary, evidence: { strictUrls: sUrls, strictLeaks: sLeaks, preferUrls: wUrls, preferLeaks: wLeaks, strictCount: sAll.length, preferCount: wAll.length, strictKeys: Object.keys(strict.json ?? {}), preferKeys: Object.keys(wide.json ?? {}), httpStatus: { restrict: strict.status, prefer: wide.status } } });
  } catch (e) { record({ id: ARM_B, status: "ERROR", summary: String(e.message || e), evidence: bPartial }); }
  let cPartial = null;
  try {
    // cloudflare.com answers this query with several of its own subdomains, so parent
    // coverage is visible; the narrow query shows what a subdomain-scoped search pulls.
    const [parentR, subR] = await Promise.allSettled([
      tavily("/search", { query: CF_QUERY, max_results: MAX_RESULTS, include_domains: CF_PARENT, include_domains_mode: MODE_RESTRICT }),
      tavily("/search", { query: CF_QUERY, max_results: MAX_RESULTS, include_domains: CF_SUB, include_domains_mode: MODE_RESTRICT }),
    ]);
    const parent = settledResult(parentR);
    const sub = settledResult(subR);
    cPartial = { parentUrls: resultUrls(parent.json), subUrls: resultUrls(sub.json), httpStatus: { parent: parent.status, sub: sub.status } };
    if (parent.status !== 200 || sub.status !== 200) throw new Error("HTTP " + parent.status + "/" + sub.status + " — " + parent.text + " | " + sub.text);
    const parentUrls = resultUrls(parent.json);
    const subUrls = resultUrls(sub.json);
    const pHosts = [...new Set(parentUrls.map(HOST))].filter((h) => h !== "");
    const sHosts = [...new Set(subUrls.map(HOST))].filter((h) => h !== "");
    // The pair under test is CF_PARENT versus CF_SUB, so the parent query has to bring
    // back that exact subdomain — any other cloudflare host proves nothing about the pair.
    const parentCoversSub = pHosts.some((h) => CF_SUB.some((e) => h === e || h.endsWith("." + e)));
    const parentLeaks = leaksIn(parentUrls, CF_PARENT);
    const subLeaks = leaksIn(subUrls, CF_SUB);
    const cLeaks = [...new Set([...parentLeaks, ...subLeaks])];
    // Leaks are judged against each query's own include_domains, like A/B. PASS means
    // both directions were seen: the parent brought its own subdomains, and the
    // subdomain-scoped query stayed inside itself (anything else would be a leak). A run
    // where the parent returned no subdomain is INCONCLUSIVE — it observed no coverage.
    let status = "PASS";
    let cNote = "";
    if (cLeaks.length > 0) {
      status = "LEAK";
      cNote = "results outside include_domains: " + JSON.stringify(cLeaks) + "; ";
    } else if (parentUrls.length === 0 || subUrls.length === 0) {
      status = "INCONCLUSIVE";
      cNote = "no direction observed (an arm returned no results); ";
    } else if (!parentCoversSub) {
      status = "INCONCLUSIVE";
      cNote = "no direction observed (the parent query returned no " + CF_SUB[0] + "); ";
    }
    record({ id: ARM_C, status, summary: cNote + "parent hosts=" + JSON.stringify(pHosts) + " sub hosts=" + JSON.stringify(sHosts) + " parentCoversSub=" + parentCoversSub + " subLeaks=" + subLeaks.length, evidence: { pHosts, sHosts, parentCoversSub, subLeaks, leaks: cLeaks, httpStatus: { parent: parent.status, sub: sub.status } } });
  } catch (e) { record({ id: ARM_C, status: "ERROR", summary: String(e.message || e), evidence: cPartial }); }
  if (process.env.PROBE_TAVILY_RESEARCH === "1") {
    let dPartial = null;
    try {
      const r = settledResult((await Promise.allSettled([
        tavily("/research", { input: QUERY, include_domains: ALLOW }),
      ]))[0]);
      dPartial = { httpStatus: r.status, responseKeys: Object.keys(r.json ?? {}) };
      if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.text);
      const rawUrls = [];
      const walk = (o) => { if (!o || typeof o !== "object") return; if (typeof o.url === "string") rawUrls.push(o.url); for (const v of Object.values(o)) walk(v); };
      walk(r.json);
      const urls = rawUrls.filter((u) => /^https?:/i.test(u));
      // 0 extracted sources is vacuous, not a pass: the /research shape carries no
      // url fields, so the arm records INCONCLUSIVE with the response keys.
      const judged = judgeLeaks(urls, ALLOW);
      const dSummary = urls.length === 0
        ? "0 valid URL fields (of " + rawUrls.length + ") in /research response (keys: " + Object.keys(r.json ?? {}).join(",") + ") — vacuous, response shape needs review"
        : judged.leaks.length + "/" + urls.length + " research sources outside include_domains (of " + rawUrls.length + " url strings)";
      record({ id: ARM_D, status: judged.status, summary: dSummary, evidence: { urls: urls.slice(0, 20), leaks: judged.leaks.slice(0, 20), rawUrlCount: rawUrls.length, httpStatus: r.status, responseKeys: Object.keys(r.json ?? {}) } });
    } catch (e) { record({ id: ARM_D, status: "ERROR", summary: String(e.message || e), evidence: dPartial }); }
  } else {
    record({ id: ARM_D, status: "SKIPPED", summary: "PROBE_TAVILY_RESEARCH=1 not set - changelog documents research include_domains as soft preference", evidence: null });
  }
}
// D answering LEAK is the documented /research soft preference, not a probe failure.
const HARD_ARMS = [ARM_A, ARM_B, ARM_C];
const leaked = ledger.arms.some((a) => a.status === "LEAK" && HARD_ARMS.includes(a.id));
// Only B can show upstream reads the field; A and C just show the filter did not leak.
const fieldProven = ledger.arms.some((a) => a.id === ARM_B && a.status === "PASS");
const conclusive = fieldProven || leaked;
ledger.evidenceStatus = conclusive ? "live" : "not-verified";
if (!conclusive) console.error("no conclusive evidence this run — evidenceStatus=not-verified (exit 2, not a pass; needs " + ARM_B + " to PASS)");
else if (leaked) console.error("LEAK detected — evidenceStatus=live (exit 1, probe failed)");
console.log("ledger -> " + flush());
if (!conclusive) process.exitCode = 2;
else if (leaked) process.exitCode = 1;
