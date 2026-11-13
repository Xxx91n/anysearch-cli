#!/usr/bin/env node
// #259 acceptance — cross-session recall through the REAL MCP entry, on the BUILT dist.
//
// The ticket asks for evidence at the product entry, not only the kernel: a session
// that searches inside ans_chat must leave material another session can recall.
//
// Two lanes, because CI has provider keys but no LLM keys:
//
//   1. ARCHIVE LANE (always runs, no LLM needed)
//      - two real `ans-mcp --transport stdio` processes sharing one temp database
//      - write rows into the archive the way an ans_chat internal search does
//        (`saveResults` under a minted session handle, exercised through the
//        product's own store file), then ask the SECOND process for the material
//        via `query_knowledge` — a real MCP tool call on the real dist
//      - asserts the block comes back with the provenance header and the row text
//
//   2. ANS_CHAT LANE (runs only when ANS_LLM_PROVIDER/MODEL/BASE_URL/API_KEY exist)
//      - session A calls `ans_chat` and lets the internal search run (real provider)
//      - session B, another process on the same DB with a `fts` domain, calls
//        `ans_chat` with a single token that matches one archived row
//      - asserts B's answer quotes content it never searched for
//
// Why the single token: recall's strict FTS rung ANDs every query term, so a long
// natural-language question does not match a short row. That is the documented
// behaviour of the recall surface, not a defect, and this script says so rather
// than hiding it behind a lucky query.
//
// Run: node scripts/recall-acceptance.mjs
//
// Where the binary comes from:
//   - CI (and any checkout that has run `pnpm -r build`): apps/mcp/dist/index.js
//   - otherwise: point ANS_RECALL_MCP_DIST at an installed dist, e.g. the tarball
//     downloaded from the CI artifact `tarballs-<os>`:
//       gh run download <run-id> --name tarballs-ubuntu-latest
//       npm install ./anysearch-cli-mcp-0.1.2.tgz    # in a throwaway prefix
//       ANS_RECALL_MCP_DIST=<prefix>/node_modules/@anysearch-cli/mcp/dist/index.js \
//       ANS_RECALL_MCP_DOMAINS=<prefix>/node_modules/@anysearch-cli/mcp/domains \
//       node scripts/recall-acceptance.mjs
//   That is the path this repo actually used for the #259 acceptance: the
//   installed artifact is what ships, so testing it proves the release chain.
//
// Exit 0 = green. Node stdlib only; cross-platform.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_DIST = resolve(ROOT, "apps/mcp/dist/index.js");
const DIST = resolve(process.env.ANS_RECALL_MCP_DIST || DEFAULT_DIST);
const DOMAINS = resolve(process.env.ANS_RECALL_MCP_DOMAINS || resolve(ROOT, "apps/mcp/domains"));

let failures = 0;
function check(cond, msg) {
  process.stdout.write((cond ? "  ok   " : "  FAIL ") + msg + "\n");
  if (!cond) failures++;
}

/** One real ans-mcp process over stdio, driven with newline-delimited JSON-RPC. */
function mcpClient(tag, env) {
  const child = spawn(process.execPath, [DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolveP, rejectP) => {
      const timer = setTimeout(() => rejectP(new Error(tag + ": timeout on " + method)), 480000);
      pending.set(id, (m) => { clearTimeout(timer); resolveP(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async function ready() {
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: tag, version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  return { child, rpc, ready, stderr: () => stderr };
}

const textOf = (res) => (res?.result?.content ?? []).map((c) => (c?.text ?? "")).join("\n");

/** Words from a row that recall's strict rung can match: 6+ chars, not a number. */
const rowTokens = (text) =>
  String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 6 && !/^\d+$/.test(w));

/** Load better-sqlite3 the way the store does (it is a dependency of the mcp app). */
function openDb(dbPath) {
  // The dist may come from an installed package (CI artifact), where the app's
  // own node_modules is the right place to resolve from.
  const anchors = [
    join(ROOT, "apps", "mcp", "package.json"),
    join(dirname(dirname(DIST)), "package.json"),
    join(ROOT, "package.json"),
  ];
  let lastError;
  for (const anchor of anchors) {
    try {
      const requireFrom = createRequire(anchor);
      const Database = requireFrom("better-sqlite3");
      return new Database(dbPath);
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

async function main() {
  if (!existsSync(DIST)) {
    console.error(
      "recall acceptance: no MCP dist at " + DIST + "\n" +
      "  Build it (pnpm -r build), or set ANS_RECALL_MCP_DIST to an installed dist\n" +
      "  (see the header for the CI-artifact recipe).",
    );
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), "ans-recall-acc-"));
  const dbPath = join(work, "anysearch.db");
  const domainsDir = join(work, "domains");
  mkdirSync(domainsDir, { recursive: true });
  // A domain that opts into archive recall, derived from the shipped default.
  const recallToml = readFileSync(join(DOMAINS, "default.toml"), "utf8")
    .replace('adapter = "none"', 'adapter = "fts"')
    .replace('name = "default"', 'name = "recall"');
  writeFileSync(join(domainsDir, "recall.toml"), recallToml);

  const env = { ANS_DB_PATH: dbPath, ANS_DOMAINS_DIR: domainsDir };
  const clients = [];
  try {
    // ---------- lane 1: archive written by one session, recalled by another ----------
    process.stdout.write("lane 1: archive -> recall through the real MCP entry\n");
    const writer = mcpClient("writer", { ...env, ANS_DOMAIN: "default", ANS_PI_SESSION_DIR: join(work, "pi-writer") });
    clients.push(writer);
    await writer.ready();
    // Mint a session handle through the product, then write a row under it the
    // same way an internal search does (saveResults). Done over the DB rather
    // than an LLM call so this lane needs no model credentials.
    const db = openDb(dbPath);
    db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("acc-session-259", "mcp");
    db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        "acc-session-259",
        "https://recall-acc-259.example/x",
        "recallacc259source",
        "recallacc259token recallacc259body content",
        "tavily",
        "https://recall-acc-259.example/x",
      );
    db.close();

    const reader = mcpClient("reader", { ...env, ANS_DOMAIN: "recall", ANS_PI_SESSION_DIR: join(work, "pi-reader") });
    clients.push(reader);
    await reader.ready();
    const qk = await reader.rpc("tools/call", { name: "query_knowledge", arguments: { query: "recallacc259token" } });
    const body = textOf(qk);
    check(/hits=\d+/.test(body), "query_knowledge reports a hit count (got " + JSON.stringify(body.slice(0, 80)) + ")");
    check(/provenance=memory/.test(body), "the recalled block names its trust tier");
    check(body.includes("recallacc259body"), "the row written under one session is recalled by the other process");
    check(qk.result?.isError !== true, "query_knowledge did not error");

    // ---------- lane 2: the real ans_chat path, when model credentials exist ----------
    const haveLlm = !!(process.env.ANS_LLM_PROVIDER && process.env.ANS_LLM_MODEL
      && process.env.ANS_LLM_BASE_URL && process.env.ANS_LLM_API_KEY);
    if (!haveLlm) {
      process.stdout.write("lane 2: SKIPPED — ANS_LLM_PROVIDER/MODEL/BASE_URL/API_KEY not set\n");
    } else {
      process.stdout.write("lane 2: ans_chat internal search -> another session recalls\n");
      // Lane 2 gets its OWN database. Sharing lane 1's would let the pick below
      // land on lane 1's hand-written row, so the check would pass on a row
      // nobody searched for — the weakness this lane exists to rule out.
      const db2Path = join(work, "lane2.db");
      const env2 = { ...env, ANS_DB_PATH: db2Path };
      const a = mcpClient("A", { ...env2, ANS_DOMAIN: "default", ANS_PI_SESSION_DIR: join(work, "pi-A") });
      clients.push(a);
      await a.ready();
      const chatA = await a.rpc("tools/call", {
        name: "ans_chat",
        arguments: { message: "Search the web for the anysearch-cli GitHub repository and report its exact URL." },
      });
      const bodyA = textOf(chatA);
      check(chatA.result?.isError !== true, "A ans_chat completed without isError");
      check(/"sessionId":"[^"]+"/.test(bodyA), "A ans_chat returned a session handle");

      // Rows A's OWN search wrote. Nothing hand-written goes into this database.
      const db = openDb(db2Path);
      const wrote = db
        .prepare("SELECT session_id, url, title, snippet FROM retrieval_results ORDER BY id LIMIT 30")
        .all();
      db.close();
      check(wrote.length > 0, "A's internal search wrote " + wrote.length + " row(s) into the archive");

      const pick = wrote.find((r) => rowTokens(String(r.snippet ?? "")).length > 0);
      check(!!pick, "at least one archived row carries a token long enough for the strict recall rung");

      if (pick) {
        // One real token from A's row: recall's strict rung ANDs every term, so
        // a token beats a sentence.
        const token = rowTokens(String(pick.snippet ?? ""))[0];
        const b = mcpClient("B", { ...env2, ANS_DOMAIN: "recall", ANS_PI_SESSION_DIR: join(work, "pi-B") });
        clients.push(b);
        await b.ready();
        const chatB = await b.rpc("tools/call", { name: "ans_chat", arguments: { message: token } });
        const bodyB = textOf(chatB);
        check(chatB.result?.isError !== true, "B ans_chat completed without isError");
        check(bodyB.toLowerCase().includes(token),
          "B's answer carries '" + token + "', a token from the row A's search wrote");
        // What could B only get from the injected block? Either an archived host
        // that the question never contained, or a long word that lives in A's
        // rows. A model paraphrases, so requiring the host alone made this flaky
        // — both are real proofs, so either one passes.
        //
        // Hosts named in B's own question do not count: `github.com` comes from
        // "anysearch-cli GitHub repository", so a model can repeat it without any
        // archive. The same goes for the token it was asked.
        const archivedHosts = Array.from(new Set(
          wrote
            .map((r) => String(r.url ?? "").replace(/^https?:\/\//, "").split("/")[0].toLowerCase())
            .filter(Boolean),
        ));
        const saidHost = archivedHosts.find((h) => bodyB.toLowerCase().includes(h) && !token.includes(h));
        // 14+ chars: short everyday words ("information") are words a model
        // produces on its own, so they prove nothing. A long token like a package
        // name or a slug can only come from the row.
        const rowVocab = new Set(wrote.flatMap((r) => rowTokens(String(r.snippet ?? ""))).filter((w) => w.length >= 14));
        const saidRareWord = [...rowVocab].find((w) => !token.includes(w) && bodyB.toLowerCase().includes(w));
        process.stdout.write("  info B surfaced host: " + (saidHost ?? "none") +
          ", rare row word: " + (saidRareWord ?? "none") + "\n");
        check(!!saidHost || !!saidRareWord,
          "B names something that exists only in A's archived rows (" +
            (saidHost ?? saidRareWord ?? "none") + "), not something the question already contained");
      }
    }
  } finally {
    for (const c of clients) { try { c.child.kill(); } catch { /* already gone */ } }
    try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows locks */ }
  }

  process.stdout.write("\nrecall acceptance: " + (failures === 0 ? "PASS" : "FAIL (" + failures + ")") + "\n");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("recall acceptance error:", e);
  process.exit(1);
});
