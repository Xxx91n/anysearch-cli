#!/usr/bin/env node
// scripts/validate-domains.mjs
//
// ADR-0021 D3 — Domain Schema Validation Acceptance step 1.5 (blocking).
// Scans domains/*.toml, parses with smol-toml (already a store dep, resolved
// via createRequire so no new dependency is introduced), applies compaction
// guards from ADR-0021 D1, exits 1 with file:line on any violation.
//
// Guards enforced:
//   - compaction.lowWatermark as absolute number must be >= 50000
//     (Anthropic 50K hard floor, see ADR-0021 D1);
//   - compaction.lowWatermark as {fraction} must land in (0,1);
//   - compaction.reuseCap must be a number >= 1;
//   - unknown top-level sections beyond schema (fail-fast, voodoo avoidance).
//
// Exit codes: 0 = all green (or no domains found → skip), 1 = violation.
// stdlib + smol-toml only (zero new dependencies).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOMAINS_DIR = path.join(ROOT, "domains");

// Resolve smol-toml from packages/store (single existing source).
const requireFromStore = createRequire(
  path.join(ROOT, "packages/store/package.json")
);
const { parse: parseToml } = requireFromStore("smol-toml");

const ANSI = process.stdout.isTTY
  ? { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", reset: "\x1b[0m" }
  : { green: "", red: "", yellow: "", reset: "" };

function fail(msg) {
  process.stdout.write(`${ANSI.red}[fail]${ANSI.reset} ${msg}\n`);
  process.exit(1);
}
function pass(msg) {
  process.stdout.write(`${ANSI.green}[pass]${ANSI.reset} ${msg}\n`);
}
function info(msg) {
  process.stdout.write(`${ANSI.yellow}[info]${ANSI.reset} ${msg}\n`);
}

if (!fs.existsSync(DOMAINS_DIR)) {
  info("domains/ not present — skip (ADR-0021 D3 allows absent)");
  process.exit(0);
}

const files = fs
  .readdirSync(DOMAINS_DIR)
  .filter((f) => f.endsWith(".toml"))
  .sort();

if (files.length === 0) {
  info("no domains/*.toml — skip");
  process.exit(0);
}

const KNOWN_TOP = new Set([
  "name",
  "description",
  "base",
  "settings",
  "prompts",
  "skills",
  "sources",
  "rag",
  "hooks",
  "compaction",
]);

function lineOf(src, needle) {
  const idx = src.indexOf(needle);
  if (idx < 0) return 0;
  return src.slice(0, idx).split("\n").length;
}

for (const file of files) {
  const abs = path.join(DOMAINS_DIR, file);
  const src = fs.readFileSync(abs, "utf8");
  let doc;
  try {
    doc = parseToml(src);
  } catch (e) {
    fail(`${file}: TOML parse error — ${e.message}`);
  }
  if (!doc || typeof doc !== "object") fail(`${file}: parsed TOML is not a table`);

  // Unknown top-level keys → fail-fast (avoid voodoo fields, see ADR-0021 D6).
  for (const k of Object.keys(doc)) {
    if (!KNOWN_TOP.has(k)) {
      fail(`${file}:${lineOf(src, k)} unknown top-level key "${k}"`);
    }
  }

  const c = doc.compaction;
  if (c !== undefined) {
    if (typeof c !== "object" || c === null) {
      fail(`${file}:${lineOf(src, "[compaction]")} [compaction] must be a table`);
    }
    if (c.lowWatermark !== undefined) {
      const ln = lineOf(src, "lowWatermark");
      if (typeof c.lowWatermark === "number") {
        if (!Number.isFinite(c.lowWatermark) || c.lowWatermark < 50000) {
          fail(
            `${file}:${ln} compaction.lowWatermark=${c.lowWatermark} must be >= 50000 (Anthropic 50K floor, ADR-0021 D1)`
          );
        }
      } else if (typeof c.lowWatermark === "object" && c.lowWatermark !== null) {
        const f = c.lowWatermark.fraction;
        if (typeof f !== "number" || !(f > 0 && f < 1)) {
          fail(
            `${file}:${ln} compaction.lowWatermark.fraction=${String(f)} must be in (0,1)`
          );
        }
      } else {
        fail(`${file}:${ln} compaction.lowWatermark must be number or {fraction}`);
      }
    }
    if (c.reuseCap !== undefined) {
      const ln = lineOf(src, "reuseCap");
      if (typeof c.reuseCap !== "number" || !Number.isFinite(c.reuseCap) || c.reuseCap < 1) {
        fail(`${file}:${ln} compaction.reuseCap=${String(c.reuseCap)} must be >= 1`);
      }
    }
    if (c.model !== undefined && typeof c.model !== "string") {
      fail(`${file}:${lineOf(src, "model")} compaction.model must be a string`);
    }
  }

  pass(`${file} OK`);
}

pass(`validate-domains green (${files.length} file(s))`);
