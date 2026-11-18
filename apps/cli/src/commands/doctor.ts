// ans doctor: smoke test - provider ping + config check + domain TOML validate.
// CLI wiring: wires providers + store + engine for diagnostics.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch-cli/retriever/providers";
import { loadDomain, loadDomainFromString, listDomainTomls, MANUAL_RECOVERY_NOTE, readUserCredentials, resolveConfigHome, resolveSearchCredentials, SEARCH_PROVIDER_IDS, userCredentialsPath } from "@anysearch-cli/store";
import { domainSearchDirs } from "../db";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// use the build-time define — the same single standard as src/index.ts.
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
    // vector arm is optional — absent is a legal FTS-only state,
    // surfaced as SKIP (degraded-but-supported), like a missing provider key.
    const vt = await store.vectorTelemetry();
    // SKIP text is executable — copy/paste enable path
    // (spike evidence: npm+pnpm global installs resolve via sibling-root
    // fallback; first embed downloads the model, then rows backfill).
    if (vt.absent) skip("  vector arm", "@anysearch-cli/embedding absent — FTS-only; enable: npm i -g @anysearch-cli/embedding (pnpm: pnpm add -g @anysearch-cli/embedding) && ans memory backfill-vectors");
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
  // #301: a key may also come from the user credential file, which is what a
  // GUI host without a shell env reads. Show the effective source per provider,
  // never the value, and say so when the file itself is unusable.
  {
    // One resolved root for the whole section: reporting a path from a different
    // rule than the one that read the file would describe a file nobody touched.
    const home = resolveConfigHome();
    const resolved = resolveSearchCredentials(process.env, { home });
    const path = userCredentialsPath(home);
    const file = readUserCredentials({ home });
    if (file.error) check("  user credential file", false, file.error + " — fix or remove it, then run `ans auth set <provider>`");
    else check("  user credential file", true, existsSync(path) ? path + " (" + file.bindings.length + " key(s), plain text)" : path + " (not created yet)");
    for (const provider of SEARCH_PROVIDER_IDS) {
      const entry = resolved[provider];
      if (!entry) continue;
      const source = entry.source === "env" ? "env" : "user credential file";
      check("  " + provider + " key source", true, source);
    }
    for (const warning of resolved.warnings) check("  [credentials] " + warning, false);
  }
  check("  ANS_DOMAIN", true, process.env.ANS_DOMAIN || "not set (default)");
  check("  ANS_DOMAINS_DIR", true, process.env.ANS_DOMAINS_DIR?.trim() || "not set (resolution chain in [6])");
  {
    // Durable DB writability — created lazily at search time; probe the resolved path now.
    try {
      const { resolveDbPath } = await import("@anysearch-cli/kernel");
      const dbPath = resolveDbPath();
      const dbDir = path.dirname(dbPath);
      mkdirSync(dbDir, { recursive: true });
      check("  durable DB path", existsSync(dbDir), dbPath);
    } catch (e: any) {
      check("  durable DB path", false, String(e?.message || e).slice(0, 80));
    }
  }

  // 5. #310: migration state of the durable DB — a READ-ONLY probe. doctor
  // neither assembles nor migrates; opening the store is what does that, after
  // its snapshot. What this section answers: which layout is on disk, whether a
  // pre-migration backup exists, and how to recover if the user wants the old
  // program back (manual by design — restoring loses post-migration writes).
  console.log("[5] Database migration state:");
  try {
    const { resolveDbPath } = await import("@anysearch-cli/kernel");
    const { readMigrationStatus, preMigrationBackupPath, preMigrationRecordPath } = await import("@anysearch-cli/store");
    const dbPath = resolveDbPath();
    const status = readMigrationStatus(dbPath);
    switch (status.layout) {
      case "memory":
        check("  layout", true, "ANS_DB_PATH 指向内存库，没有持久化迁移可查");
        break;
      case "absent":
        check("  layout", true, "还没有数据库文件，首次打开时按新布局创建");
        break;
      case "fresh":
        check("  layout", true, "文件在但没有表，下次打开按新布局初始化");
        break;
      case "legacy":
        // Not a failure: the next store open will snapshot then migrate. The
        // point of showing it is that the user can see the change coming and
        // where the safety copy will land.
        check("  layout", true, "旧布局——下次打开会先做迁移前备份，再迁移，不需要手动操作");
        break;
      case "sessionless":
        // Observability-only databases (eval/audit paths) never carry session
        // structure; the session assembly on them is purely additive, so no
        // pre-migration backup is owed. Saying this here keeps doctor from
        // implying a backup is coming.
        check("  layout", true, "只有观测这类非会话数据，没有会话表——不会触发迁移，也不需要迁移前备份");
        break;
      case "current":
        check("  layout", true, "当前布局");
        break;
      default:
        check("  layout", false, "打不开数据库（" + (status.error ?? "未知原因") + "），判断不了布局");
    }
    if (status.layout === "current" || status.layout === "legacy") {
      if (status.backupExists) {
        const backupFile = preMigrationBackupPath(dbPath);
        const record = status.record;
        check("  迁移前备份", true,
          backupFile +
          (record ? "（" + record.createdAt + "，" + record.bytes + " 字节，sha256 " + record.sha256.slice(0, 12) + "…，记录在 " + preMigrationRecordPath(dbPath) + "）" : ""));
        // Same export the JSON record carries — hand-copying it here would
        // drift the moment one side is reworded.
        console.log("    " + MANUAL_RECOVERY_NOTE);
      } else if (status.layout === "current") {
        skip("  迁移前备份", "库是本版本建的，没经历过旧布局，本来就没有备份");
      } else {
        skip("  迁移前备份", "还没迁移过，下次打开时会生成");
      }
    }
  } catch (e: any) {
    check("  migration state", false, String(e?.message || e).slice(0, 80));
  }

  // 6. B1 (T1 "五端联动 doctor 可见"): discover real domains/*.toml on the
  // resolution chain, validate each, and show the active domain's five downstream
  // layers a domain switch links (sources/skills/hooks/prompts/rag — GLOSSARY.md).
  console.log("[6] Domains:");
  const found = listDomainTomls(domainSearchDirs()); // toml file name -> its domains dir
  if (found.size === 0) {
    check("  discovery", false, "no domains/*.toml found on the resolution chain — fix: create ./domains/, set ANS_DOMAINS_DIR, or reinstall @anysearch-cli/cli");
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
      // B3 self-service: every enabled provider without a key is silently
      // dropped from the fan-out — name the key to set or the entry to remove.
      // the provider actually reads ANYSEARCH_API_KEY (see
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
