#!/usr/bin/env node
// R95 T7 — machine-checkable verification signal for the finding
// "upstream sub_domains vocab doc vs finance.fundamental validator mismatch"
// (registry id finding-r95-upstream-validator-vs-doc-vocab-mismatch).
//
// It pins BOTH sides of the claim so a future reader reruns ONE command:
//   doc side (offline): the archived get_sub_domains snapshot states cn_code is
//     required only for the named A-share types, with symbol carrying the
//     international/overview route — so
//     {domain:finance, sub_domain:fundamental, sub_domain_params:{type:overview,symbol:MSFT}}
//     is legal under the documented per-type rule.
//   validator side (--live): one anonymous tools/call replays that doc-legal
//     request and asserts the reply still names the tag-level cn_code demand.
//
// Exit codes (claim semantics, not build semantics):
//   0 = mismatch reproduced (the finding holds as of this run)
//   1 = mismatch NOT reproduced (doc-legal request accepted -> upstream may
//       have been fixed: owner re-check, never rubber-stamp)
//   2 = environment failure (transport / quota-auth nudge) -> no claim verdict
//
// Run (tsx resolution lives in the workspace packages):
//   cd packages/store
//   node --import tsx ../../.scratch/grill-round-95/evidence/verify-validator-vs-doc.ts
//   node --import tsx ../../.scratch/grill-round-95/evidence/verify-validator-vs-doc.ts --live
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnySearchProvider } from "../../../packages/retriever/src/providers/anysearch";

const BT = "\x60"; // backtick, kept out of source literals deliberately
const VOCAB_PATH = fileURLToPath(new URL("../../grill-round-84/evidence/sub-domains-vocab.json", import.meta.url));
const LIVE = process.argv.includes("--live");
const QUERY = "MSFT analyst ratings and target price overview";
const SPEC = { domain: "finance", subDomain: "fundamental", params: { type: "overview", symbol: "MSFT" } };
const EXPECT = "Missing required params for tag 'finance.fundamental': cn_code";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

// ---- doc side (offline) ----
const vocab = JSON.parse(readFileSync(VOCAB_PATH, "utf8")) as Record<string, { isError?: unknown; text?: string }>;
const docText = vocab.finance?.text ?? "";
assert(typeof docText === "string" && docText.length > 0, "doc snapshot carries a finance vocabulary text");
const section = docText.split("### finance.fundamental")[1]?.split("\n### ")[0] ?? "";
assert(section.length > 0, "doc snapshot carries a finance.fundamental section");
const cnClause = /\*\*required\*\* when type=([a-z/]+)/.exec(section);
assert(!!cnClause, "doc states cn_code is required only for a named type set (got " + (cnClause?.[1] ?? "none") + ")");
const types = (cnClause?.[1] ?? "").split("/");
assert(!!cnClause && !types.includes("overview"), "doc type set excludes overview -> {type:overview, symbol} is doc-legal (set=" + types.join("/") + ")");
assert(section.includes(BT + "symbol" + BT + " (required)"), "doc marks symbol required (international/overview route)");

if (!LIVE) {
  console.log(failures === 0
    ? "DOC SIDE OK: archived snapshot deems {type:overview, symbol:MSFT} legal. Add --live to replay against the validator."
    : "DOC SIDE DRIFT: snapshot no longer supports the claim — owner re-check.");
  process.exitCode = failures === 0 ? 0 : 1;
} else {
  // ---- validator side (live, anonymous) ----
  const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
  let envFailure = false;
  try {
    const env = await p.search({ query: QUERY, mode: "fast", maxResults: 3, vertical: SPEC } as never, AbortSignal.timeout(30000));
    assert(false, "upstream ACCEPTED the doc-legal request (results=" + env.results.length + ") -> mismatch no longer reproduces");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota\/auth nudge/i.test(msg) || /permanent-auth/.test(msg)) {
      console.log("ENV FAILURE (quota/auth nudge) — no claim verdict: " + msg.slice(0, 220));
      envFailure = true;
    } else {
      assert(msg.includes(EXPECT), "upstream reply still names the tag-level cn_code demand (got: " + msg.slice(0, 220) + ")");
    }
  }
  console.log(envFailure ? "SIGNAL: no verdict (environment)"
    : failures === 0 ? "SIGNAL: mismatch reproduced (finding holds)"
      : "SIGNAL: not reproduced (owner re-check required)");
  process.exitCode = envFailure ? 2 : failures === 0 ? 0 : 1;
}
