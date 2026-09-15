// ans doctor: smoke test - provider ping + config check + domain TOML validate.
// Seam 5 composition root: wires providers + store + engine for diagnostic.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch/retriever/providers";
import { loadDomain, loadDomainFromString, listDomainTomls } from "@anysearch/store";
import { domainSearchDirs } from "../db";
import { SqliteSessionStore } from "@anysearch/store";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// ADR-0059 D7 (T-6.2): use the build-time define — the same single standard as src/index.ts.
// The previous runtime package.json read resolved to the REPO ROOT once tsup bundled the CLI into
// a single dist/index.js, so `ans doctor` printed the root package's 0.0.0.
declare const __PACKAGE_VERSION__: string | undefined;
const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__ ? __PACKAGE_VERSION__ : "0.0.0";

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label: string, ok: boolean, detail?: string) {
  const mark = ok ? "[OK]" : "[FAIL]";
  if (ok) { passed++; } else { failed++; }
  console.log(mark + " " + label + (detail ? " " + String.fromCharCode(40) + detail + String.fromCharCode(41) : ""));
}
function skip(label: string, detail?: string) {
  skipped++;
  console.log("[SKIP] " + label + (detail ? " " + String.fromCharCode(40) + detail + String.fromCharCode(41) : ""));
}

export async function runDoctor(): Promise<number> {
  console.log(`ans doctor v${PKG_VERSION}`);
  console.log("---");

  // 1. Provider smoke test: construct each, check id+modes.
  // Providers may throw on construction if API key not set — report individually.
  console.log("[1] Provider registry:");
  const providerCtors: Array<{ name: string; ctor: () => any }> = [
    { name: "tavily", ctor: () => new TavilyProvider() },
    { name: "exa", ctor: () => new ExaProvider() },
    { name: "anysearch", ctor: () => new AnySearchProvider() },
  ];
  for (const { name, ctor } of providerCtors) {
    try {
      const p = ctor();
      check("  " + p.id + " modes=" + p.modes.join("|"), p.id.length > 0 && p.modes.length >= 3);
    } catch (e: any) {
      // Missing API key is expected in dev — skip, not fail.
      const reason = String(e.message || e).slice(0, 60);
      skip("  " + name, reason);
    }
  }

  // 2. Session store smoke: open in-memory, create + search.
  console.log("[2] SessionStore (in-memory):");
  try {
    const store = new SqliteSessionStore(":memory:");
    const session = await store.createSession("doctor");
    check("  createSession", session.id.length > 0);
    await store.append(session.id, { role: "user", content: "doctor smoke test" });
    const hits = await store.searchFts5(session.id, "doctor");
    check("  searchFts5", hits.length >= 1, "hits=" + hits.length);
    // R62 D-002: vector arm is optional — absent is a legal FTS-only state,
    // surfaced as SKIP (degraded-but-supported), like a missing provider key.
    const vt = await store.vectorTelemetry();
    if (vt.absent) skip("  vector arm", "@anysearch/embedding absent — FTS-only (optional peer)");
    else check("  vector arm", true, "present embeds=" + vt.embeds + " failures=" + vt.failures + (vt.circuitOpen ? " circuitOpen" : ""));
    store.close();
  } catch (e: any) {
    check("  SessionStore", false, e.message);
  }

  // 3. Domain TOML validate: parse + resolve + validate a minimal domain.
  console.log("[3] Domain TOML parse + validate:");
  const testToml = [
    'name = "doctor"',
    'description = "Doctor smoke test domain"',
    "",
    "[settings]",
    'language = "TypeScript"',
    "",
    "[skills]",
    'active = ["doctor"]',
    "",
    "[sources]",
    'enabled = ["tavily"]',
    "",
    "[rag]",
    'adapter = "none"',
    "",
    "[hooks]",
    'toolWhitelist = ["ctx_execute"]',
  ].join("\n");
  try {
    const schema = loadDomainFromString(testToml);
    check("  parseDomainToml", schema.name === "doctor");
    check("  validate", schema.rag.adapter === "none");
    check("  skills.active", schema.skills.active.length === 1);
  } catch (e: any) {
    check("  Domain TOML", false, e.message);
  }

  // 4. Config check: env vars.
  console.log("[4] Environment config:");
  const envKeys = ["TAVILY_API_KEY", "EXA_API_KEY"];
  for (const key of envKeys) {
    const val = process.env[key];
    check("  " + key, true, val ? "set" : "not set (optional)");
  }
  check("  ANS_DOMAIN", true, process.env.ANS_DOMAIN || "not set (default)");
  check("  ANS_DOMAINS_DIR", true, process.env.ANS_DOMAINS_DIR?.trim() || "not set (resolution chain in [5])");
  {
    // Durable DB writability — created lazily at search time; probe the resolved path now.
    try {
      const { resolveDbPath } = await import("@anysearch/kernel");
      const dbPath = resolveDbPath();
      const dbDir = path.dirname(dbPath);
      mkdirSync(dbDir, { recursive: true });
      check("  durable DB path", existsSync(dbDir), dbPath);
    } catch (e: any) {
      check("  durable DB path", false, String(e?.message || e).slice(0, 80));
    }
  }

  // 5. ADR-0061 B1 (T1 "五端联动 doctor 可见"): discover real domains/*.toml on the
  // resolution chain, validate each, and show the active domain's five downstream
  // layers a domain switch links (sources/skills/hooks/prompts/rag — CONTEXT.md).
  console.log("[5] Domains:");
  const found = listDomainTomls(domainSearchDirs()); // toml file name -> its domains dir
  if (found.size === 0) {
    check("  discovery", false, "no domains/*.toml found on the resolution chain — fix: create ./domains/, set ANS_DOMAINS_DIR, or reinstall @anysearch/cli");
  }
  for (const [f, dir] of found) {
    try {
      const s = loadDomain(path.join(dir, f));
      check("  " + f.replace(/\.toml$/, ""), s.name.length > 0, dir);
    } catch (e: any) {
      check("  " + f, false, String(e?.message || e).slice(0, 80));
    }
  }
  const activeName = process.env.ANS_DOMAIN || "default";
  const activeEntry = [...found].find(([f]) => f === activeName + ".toml");
  if (!activeEntry) {
    check("  active domain '" + activeName + "'", false, "not found on the resolution chain (silent full-fanout) — fix: ans domain <one of the listed names> or point ANS_DOMAINS_DIR at your toml dir");
  } else {
    try {
      const s = loadDomain(path.join(activeEntry[1], activeEntry[0]));
      console.log("  active: " + s.name + "  (resolved from " + activeEntry[1] + ")");
      check("    sources.enabled", s.sources.enabled.length > 0, s.sources.enabled.join(","));
      check("    skills.active", true, s.skills.active.join(",") || "none");
      check("    hooks.toolWhitelist", true, s.hooks.toolWhitelist.length + " tools");
      check("    prompts", true, (s.prompts?.length ?? 0) + " entries");
      check("    rag.adapter", s.rag.adapter.length > 0, s.rag.adapter);
      if (s.sources.urlAllowlist?.length) {
        console.log("    urlAllowlist: " + s.sources.urlAllowlist.join(", "));
      }
      // ADR-0061 B3 self-service: every enabled provider without a key is silently
      // dropped from the fan-out — name the key to set or the entry to remove.
      // ADR-0062 T5: the provider actually reads ANYSEARCH_API_KEY (see
      // packages/retriever/src/providers/anysearch.ts). ANS_API_KEY here was a
      // drift bug — doctor advised setting a variable nothing reads.
      const KEY_BY_PROVIDER: Record<string, string> = { tavily: "TAVILY_API_KEY", exa: "EXA_API_KEY", anysearch: "ANYSEARCH_API_KEY" };
      for (const prov of s.sources.enabled) {
        const key = KEY_BY_PROVIDER[prov];
        if (key) {
          // SKIP not FAIL: an unset key is a degraded-but-supported config — the
          // engine drops that provider from the fan-out. Failing would turn every
          // keyless CI run red; the remediation text is the self-service part.
          if (process.env[key]) check("    provider " + prov + " key", true, "set");
          else skip("    provider " + prov + " key", key + " unset -> provider skipped at search; set the key or drop '" + prov + "' from sources.enabled");
        }
      }
    } catch (e: any) {
      check("  active domain '" + activeName + "'", false, String(e?.message || e).slice(0, 80));
    }
  }

  console.log("---");
  const summary = "Result: " + passed + " passed, " + skipped + " skipped, " + failed + " failed";
  if (failed > 0) console.error("ans doctor: " + summary); else console.log(summary);
  return failed === 0 ? 0 : 1;
}
