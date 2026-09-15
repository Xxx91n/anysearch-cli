// R64 T2 calibration probe: run the real bundled bin for every live-scoped
// golden entry (quarantined included) and dump the actual result URLs so
// mustHitPaths fragments can be chosen from live returns, not guessed.
// Also probes self-controlled sentinel candidates (repo GitHub URL).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const dist = join(root, "apps", "cli", "dist", "index.js");
const looks = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));
const scopes = looks.golden.scopes ?? {};
const entries = looks.golden.entries.filter((e) => scopes[e.id] === "live" || scopes[e.id] === "both");

const out = {};
for (const e of entries) {
  const env = { ...process.env, ANS_DOMAIN: e.domain };
  const r = spawnSync(process.execPath, [dist, "search", e.question, "--json"], { env, encoding: "utf8", timeout: 90000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const rec = {
    id: e.id,
    question: e.question,
    abstain: j?.abstain ?? null,
    n: j?.results?.length ?? null,
    urls: (j?.results ?? []).map((x) => x.url),
    err: r.error ? String(r.error) : (j ? null : String(r.stdout ?? "").slice(-200)),
  };
  out[e.id] = rec;
  console.log(e.id + " n=" + rec.n + " abstain=" + JSON.stringify(rec.abstain));
  for (const u of rec.urls) console.log("   " + u);
  if (rec.err) console.log("   ERR " + rec.err);
}
writeFileSync(join(here, "probe-0.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log("WROTE probe-0.json");
