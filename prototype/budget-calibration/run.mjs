// PROTOTYPE (throwaway) — Q2(d') output-reserve calibration sampler.
//
// Question: what default should [budget].outputReserveTokens use?
// Method: run the PRODUCTION `ans chat` entry (built dist/index.js) end to end,
//   real LLM + real Active Domain + memory wiring, and harvest the run-level
//   usage line the runtime already prints:
//     "Agent completed (tokens: <in> in + <out> out)"
//   Those two numbers are Sigma(message_end usage.input/output) over the run —
//   the same accumulator `settleTokens` uses (packages/kernel/src/pi-runtime.ts).
//
// Notes / known limits (documented, not bugs to fix here):
//   * usage.input excludes cacheRead/cacheWrite; settle's totalTokens includes
//     them. For the OUTPUT reserve this does not matter; total is reported as
//     in+out and labelled as a cache-excluded lower bound.
//   * Each run gets a unique ANS_SESSION_ID so runs are independent.
//   * Runs write real rows into ~/.anysearch/anysearch.db (expected side effect).
//
// Usage:
//   node prototype/budget-calibration/run.mjs            # full plan
//   node prototype/budget-calibration/run.mjs --dry      # print plan only
//   PROTO_LIMIT=4 node ...run.mjs                        # first N runs
//   PROTO_OUT=prototype/budget-calibration/out/raw.jsonl

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const CLI = join(REPO, "apps", "cli", "dist", "index.js");
const OUT_DIR = join(HERE, "out");
const RAW = process.env.PROTO_OUT || join(OUT_DIR, "raw.jsonl");
const DRY = process.argv.includes("--dry");
const LIMIT = Number(process.env.PROTO_LIMIT || 0);

// Fixed query set: four docs-style, four research-style, two general.
// Two repetitions per query so identical-task spread is observable.
const QUERIES = [
  { domain: "docs", q: "How do I configure strict mode for a TypeScript project?" },
  { domain: "docs", q: "pnpm 的 workspace 协议 workspace:* 是什么含义？" },
  { domain: "docs", q: "What is the MCP initialize handshake and which capabilities are negotiated?" },
  { domain: "docs", q: "How does pnpm decide the store location and can I relocate it?" },
  { domain: "research", q: "What is the current evidence that retrieval augmented generation improves factual accuracy in LLM assistants?" },
  { domain: "research", q: "比较 RRF 融合与单一 BM25 在真实检索系统中的效果证据" },
  { domain: "research", q: "What do recent benchmarks say about long-context models versus RAG for knowledge tasks?" },
  { domain: "research", q: "LLM agent memory 有哪些主流架构方案？给出来源对比" },
  { domain: "default", q: "What are the tradeoffs between SQLite WAL mode and rollback journal?" },
  { domain: "default", q: "How do token-bucket and sliding-window rate limiters differ in practice?" },
];

const REPEATS = 2;
// Condition B: same docs domain but RAG adapter fts (shipped domains are all
// adapter=none, so RAG injection would otherwise never be exercised).
const FTS_DOMAINS_DIR = join(HERE, "domains");
const FTS_QUERIES = [
  "How do I configure strict mode for a TypeScript project?",
  "What is the MCP initialize handshake and which capabilities are negotiated?",
].map((q) => ({ domain: "docs", q, rag: "fts" }));

const PLAN = [
  ...QUERIES.flatMap((c) => Array.from({ length: REPEATS }, () => ({ ...c, rag: "none" }))),
  ...FTS_QUERIES.flatMap((c) => Array.from({ length: REPEATS }, () => ({ ...c }))),
];

const TOKEN_RE = /Agent completed \(tokens: (\d+) in \+ (\d+) out\)/;
const TIMEOUT_MS = 300_000;

function sessionId(i) {
  return `proto-q2d-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${i}`;
}

function main() {
  if (!existsSync(CLI)) {
    console.error("missing " + CLI + " — run: pnpm --filter @anysearch-cli/cli build");
    process.exit(2);
  }
  const plan = LIMIT > 0 ? PLAN.slice(0, LIMIT) : PLAN;
  if (DRY) {
    plan.forEach((c, i) =>
      console.log(`${String(i + 1).padStart(2)} ${c.rag.padEnd(4)} ${c.domain.padEnd(8)} ${c.q}`),
    );
    console.log(`total=${plan.length} (repeats=${REPEATS})`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const seen = existsSync(RAW) ? readFileSync(RAW, "utf8").trim().split("\n").filter(Boolean).length : 0;
  if (seen > 0) console.log(`[proto] resuming: ${seen} rows already in ${RAW}`);

  for (let i = 0; i < plan.length; i++) {
    const c = plan[i];
    const rid = `r${String(i + 1).padStart(2, "0")}`;
    if (existsSync(RAW)) {
      const done = readFileSync(RAW, "utf8").includes(`"runId":"${rid}"`);
      if (done) { console.log(`[proto] skip ${rid} (already recorded)`); continue; }
    }
    const env = {
      ...process.env,
      ANS_DOMAIN: c.domain,
      ANS_NO_INTERACTIVE: "1",
      ANS_SESSION_ID: sessionId(i + 1),
    };
    // RAG condition: point the domain chain at the prototype domains dir.
    if (c.rag === "fts") env.ANS_DOMAINS_DIR = FTS_DOMAINS_DIR;
    else delete env.ANS_DOMAINS_DIR;

    const started = Date.now();
    const res = spawnSync(process.execPath, [CLI, "chat", c.q], {
      cwd: REPO,
      env,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    const wallMs = Date.now() - started;
    const stdout = res.stdout || "";
    const stderr = res.stderr || "";
    const m = stdout.match(TOKEN_RE) || stderr.match(TOKEN_RE);
    const row = {
      runId: rid,
      at: new Date().toISOString(),
      rag: c.rag,
      domain: c.domain,
      query: c.q,
      sessionId: env.ANS_SESSION_ID,
      exitCode: res.status,
      signal: res.signal,
      timedOut: res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM",
      wallMs,
      inputTokens: m ? Number(m[1]) : null,
      outputTokens: m ? Number(m[2]) : null,
      ok: Boolean(m) && res.status === 0,
      failTail: m ? "" : (stderr || stdout).slice(-400).replace(/\s+/g, " "),
    };
    appendFileSync(RAW, JSON.stringify(row) + "\n");
    const tag = row.ok ? `${row.inputTokens} in / ${row.outputTokens} out` : `FAIL exit=${res.status}`;
    console.log(`[proto] ${rid} ${c.rag}/${c.domain} ${(wallMs / 1000).toFixed(1)}s ${tag}`);
  }
  console.log(`[proto] done -> ${RAW}`);
  writeFileSync(join(OUT_DIR, "plan.json"), JSON.stringify({ startedAt: new Date().toISOString(), plan }, null, 2));
}

main();
