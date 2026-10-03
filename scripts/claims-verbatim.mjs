// scripts/claims-verbatim.mjs
// ADR-0098 D4 verbatim claim check, extracted from ship-gate (R98 R5/P-6 +
// anchor:ratchet-recount): the claims leg consumes this; the enforcement-
// anchor probe consumes it TOO - the same function is the only recount
// implementation, so a probe cannot diverge from what the gate runs.
//
// Returns a list of human-readable problems (empty = verified). Callers map
// them to their own failure surface (ship-gate fail(), probes {killed}).
import fs from "node:fs";
import path from "node:path";

export function checkVerbatimClaim(c, { root }) {
  const tag = "closeout-claim " + String(c && c.id) + " (" + String(c && c.kind) + ")";
  const problems = [];
  if (!c || typeof c !== "object") return [tag + " is not an object"];
  if (!c.file || typeof c.text !== "string" || !c.text) problems.push(tag + " needs file + non-empty text");
  else if (typeof c.reason !== "string" || !c.reason.trim()) problems.push(tag + " needs a non-empty reason (re-anchor ritual)");
  else if (!Number.isInteger(c.reauthored) || c.reauthored < 0) problems.push(tag + " needs a non-negative integer reauthored count");
  else {
    // R5 (P-6 rework): the ratchet is a RECOUNT, not a flag. reauthored must
    // equal the length of `reanchor_log`, and every entry carries the ritual
    // pair (reason + audit pointer).
    const rlog = Array.isArray(c.reanchor_log) ? c.reanchor_log : [];
    if (rlog.length !== c.reauthored)
      problems.push(
        tag +
          " declares reauthored=" +
          c.reauthored +
          " but reanchor_log carries " +
          rlog.length +
          " entr(ies) — the ratchet is a recount, not a flag"
      );
    for (let li = 0; li < rlog.length; li++) {
      const le = rlog[li];
      if (!le || typeof le.reason !== "string" || !le.reason.trim())
        problems.push(tag + " reanchor_log[" + li + "] lacks a non-empty reason (ritual)");
      if (typeof le.audit !== "string" || !le.audit.trim())
        problems.push(tag + " reanchor_log[" + li + "] lacks an audit pointer (ritual)");
    }
    const fp = path.join(root, c.file);
    if (!fs.existsSync(fp)) problems.push(tag + " file missing: " + c.file);
    else if (!fs.readFileSync(fp, "utf8").includes(c.text))
      problems.push(tag + " verbatim sentence absent — rewritten without the re-anchor ritual");
  }
  return problems;
}
