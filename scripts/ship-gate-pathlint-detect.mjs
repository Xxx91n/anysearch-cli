// ADR-0072 + R78 D-003(A++): machine-local path detector — token+separator classifier.
// Pure functions shared by ship-gate.mjs (fail-closed consumer) and the warn-sweep
// driver (.scratch/grill-round-78/evidence/t1-warn-sweep.driver.mjs, collect mode).
// Rule model (decision ledger D-003): a locator is a TOKEN followed by a path
// separator. Bare env-var/tilde prose mentions (%PATH%, $HOME, ~) never fire.
// Single-segment POSIX roots (/x without a known prefix) surface at info level —
// visible, not blocking. Markers are ratcheted: a marker that no longer guards a
// hit is itself a violation (markers only shrink).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Enumeration (moved verbatim from ship-gate.mjs — one implementation, two callers)
// ---------------------------------------------------------------------------
export function enumerateScopedMarkdown(cfg, ROOT) {
  const ls = (a) => {
    const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) throw new Error("git " + a.join(" ") + " failed — cannot enumerate the registered sweep (fail-closed): " + String(r.stderr || "").trim().slice(0, 200));
    return (r.stdout || "").split("\n").map((x) => x.trim()).filter(Boolean);
  };
  const files = [...new Set([...ls(["ls-files"]), ...ls(["ls-files", "-o", "--exclude-standard"])])].filter((f) => f.endsWith(".md"));
  const globOk = (f) => cfg.roots.some((g) => {
    if (g === "*.md") return !f.includes("/");
    const m = g.match(/^(.+)\/\*\*\/\*\.md$/);
    if (m) return f.startsWith(m[1] + "/");
    return f === g;
  });
  return files.filter(globOk);
}

// ---------------------------------------------------------------------------
// Detector patterns
// ---------------------------------------------------------------------------
// Boundary: a token preceded by an alphanumeric is mid-word (URL host/path,
// identifier) and does not count — same guard the legacy PATH_RE applied.
const WORD_CHAR = /[A-Za-z0-9]/;

// Hard-hit classes. Env-var and tilde forms bake the REQUIRED trailing separator
// into the token regex; literal forms (drive, /Users|home|tmp/, AppData\) carry
// their own separators intrinsically.
const CLASS_RES = [
  ["win-envvar", /%[A-Za-z_][A-Za-z0-9_]*%[\\/]/g],
  ["posix-envvar", /\$[A-Za-z_][A-Za-z0-9_]*[\\/]|\$\{[^\s}]+\}[\\/]/g],
  ["tilde", /~[\\/]/g],
  ["unc", /\\\\[^\s\\/"':*?<>|]+[\\/]/g],
  ["drive", /[A-Za-z]:[\\/]/g],
  ["posix-home", /\/(?:Users|home|tmp)\//g],
  ["appdata", /AppData[\\/]/g],
];

export function detectHits(line) {
  const hits = [];
  for (const [cls, re] of CLASS_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > 0 && WORD_CHAR.test(line[m.index - 1])) continue;
      hits.push({ cls, text: m[0], index: m.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Single-segment POSIX root: /word — no known prefix, not a URL/path segment.
// Excluded when preceded by word char / scheme colon / dot / slash / backslash /
// ~ / % / $ (those belong to other classes or to prose like "~/x", "%T%/x"),
// and excluded when followed by another separator or word char (multi-segment
// absolute paths like /etc/foo or URL paths like /v1/search stay silent).
const POSIX_ROOT_RE = /\/[A-Za-z][A-Za-z0-9._-]*/g;
const INFO_PREV_BAD = /[A-Za-z0-9_:.\\/~%$]/;
export function detectSurfacedSkips(line) {
  const out = [];
  POSIX_ROOT_RE.lastIndex = 0;
  let m;
  while ((m = POSIX_ROOT_RE.exec(line))) {
    if (m.index > 0 && INFO_PREV_BAD.test(line[m.index - 1])) continue;
    const after = line[m.index + m[0].length];
    if (after !== undefined && /[A-Za-z0-9_/\\-]/.test(after)) continue;
    out.push({ text: m[0], index: m.index });
  }
  return out;
}

// Full literal tokens for the in-repo check — verbatim from the legacy TOKEN_RE
// (only literal absolute forms can resolve inside the repo; env-var/tilde/UNC
// tokens are machine-local by construction and never resolve to ROOT).
const TOK_CLS = "[^\\s\"'`\\)><\\]:+,，、。；：（）【】《》|&]*";
const TOKEN_RE = new RegExp("[A-Za-z]:[\\\\/]" + TOK_CLS + "|\\/(?:Users|home|tmp)\\/" + TOK_CLS + "|" + TOK_CLS + "AppData[\\\\/]" + TOK_CLS, "g");

export function buildEnv(cfg, ROOT) {
  const markerOk = /<!--\s*machine-local\s*:\s*[^@<>\s][^@<>]*?@\s*\d{4}-\d{2}-\d{2}\s*-->/;
  const markerAny = new RegExp(cfg.marker.slice(0, cfg.marker.indexOf("<reason>")).trimEnd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i");
  const locators = (cfg.locatorLinePatterns || []).map((x) => new RegExp(x));
  const rootAbs = ROOT.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const inRepo = (tok) => {
    const t = tok.replace(/\\/g, "/").toLowerCase();
    if (!t.startsWith(rootAbs + "/")) return false;
    const rel = t.slice(rootAbs.length + 1);
    return /^[a-z0-9._~*{?%$]/.test(rel);
  };
  return { markerOk, markerAny, locators, inRepo };
}

const FENCE_RE = /^\s*```/;

function hitViolation(l, i, env) {
  const toks = l.match(TOKEN_RE) || [];
  const bad = toks.filter(env.inRepo);
  if (bad.length) return { line: i + 1, kind: "in-repo", detail: "in-repo target reference must be repo-relative (markers do not exempt in-repo refs): " + [...new Set(bad)].slice(0, 3).join(", ") };
  if (env.markerOk.test(l)) return null;
  return { line: i + 1, kind: env.markerAny.test(l) ? "malformed-marker" : "missing-marker", detail: (env.markerAny.test(l) ? "malformed machine-local marker (needs non-empty reason + @ YYYY-MM-DD)" : "machine-local path requires a governed marker <!-- machine-local: <reason> @ <YYYY-MM-DD> -->") + ": " + l.trim().slice(0, 100) };
}

// Scan one file's lines. Returns { violations, infos } with 1-based line numbers.
// violations: hard hits lacking a valid marker, in-repo refs, stale markers.
// infos: single-segment POSIX root surfaced-skips (visible, non-blocking).
export function scanLines(lines, env) {
  const violations = [];
  const infos = [];
  let fenced = false, fenceMarked = false, fenceHadHit = false, fenceMarkerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (FENCE_RE.test(l)) {
      if (!fenced) {
        const prevCover = i > 0 && env.markerOk.test(lines[i - 1]);
        const selfCover = env.markerOk.test(l);
        fenceMarked = prevCover || selfCover;
        fenceMarkerLine = selfCover ? i : prevCover ? i - 1 : -1;
        fenceHadHit = false;
      } else {
        if (fenceMarked && !fenceHadHit)
          violations.push({ line: fenceMarkerLine + 1, kind: "stale-marker", detail: "machine-local marker covers a fenced block with no machine-local path — remove it (markers only shrink)" });
        fenceMarked = false;
        fenceMarkerLine = -1;
      }
      fenced = !fenced;
      continue;
    }
    const hits = detectHits(l);
    for (const inf of detectSurfacedSkips(l)) infos.push({ line: i + 1, kind: "posix-root", detail: "single-segment POSIX root " + JSON.stringify(inf.text) + " — surfaced-skip (cannot determine; not blocking)" });
    if (fenced) {
      if (hits.length) {
        fenceHadHit = true;
        if (!fenceMarked) { const v = hitViolation(l, i, env); if (v) violations.push(v); }
      }
      continue;
    }
    const isLocator = env.locators.some((re) => re.test(l));
    if (hits.length && !isLocator) { const v = hitViolation(l, i, env); if (v) violations.push(v); }
    // Ratchet leg: a marker on a line with no locator token is dead weight —
    // unless it directly precedes a ``` fence (evaluated at block close above).
    if (env.markerOk.test(l) && hits.length === 0) {
      const nxt = lines[i + 1];
      if (!(nxt !== undefined && FENCE_RE.test(nxt)))
        violations.push({ line: i + 1, kind: "stale-marker", detail: "machine-local marker on a line with no machine-local path — remove it (markers only shrink)" });
    }
  }
  return { violations, infos };
}
