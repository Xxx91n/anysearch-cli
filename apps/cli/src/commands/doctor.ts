// ans doctor: smoke test - provider ping + config check + domain TOML validate.
// Seam 5 composition root: wires providers + store + engine for diagnostic.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch/retriever/providers";
import { loadDomainFromString } from "@anysearch/store";
import { SqliteSessionStore } from "@anysearch/store";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  console.log("---");
  console.log("Result: " + passed + " passed, " + skipped + " skipped, " + failed + " failed");
  return failed === 0 ? 0 : 1;
}
