// PROTOTYPE — read-only evidence from the existing r19 question-level runs.
// The project-level run has not started, but the same arm config was used at
// question level: dsh + the harness MCP filter (--allow ans_chat). This script
// re-counts what the host actually saw and whether it threaded sessionId.
//
// Run: node prototype/memory-wiring/probe-q3-sessions.mjs

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const BASE = join(homedir(), ".dsh", "sessions");
const RUN_PREFIX = "t9-formal-2026-10-29-";
const arms = { g3: { calls: 0, withSession: 0, headers: 0, headersAnsChat: 0, headersRecall: 0, resultSessionBlocks: 0, dirs: 0 },
  g5: { calls: 0, withSession: 0, headers: 0, headersAnsChat: 0, headersRecall: 0, resultSessionBlocks: 0, dirs: 0 } };
const otherToolNames = new Set();

for (const dir of readdirSync(BASE).filter((d) => d.includes(RUN_PREFIX))) {
  const arm = dir.includes("-g3-") ? "g3" : dir.includes("-g5-") ? "g5" : null;
  if (!arm) continue;
  arms[arm].dirs++;
  for (const sd of readdirSync(join(BASE, dir))) {
    const p = join(BASE, dir, sd, "session.v4.jsonl.zstd");
    if (!existsSync(p)) continue;
    const lines = zstdDecompressSync(readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const d = e.data || {};
      if (e.type === "request/header") {
        arms[arm].headers++;
        const names = (d.header?.tools || []).map((t) => t.name);
        if (names.includes("mcp__anysearch__ans_chat")) arms[arm].headersAnsChat++;
        if (names.some((n) => String(n).includes("recall_memory"))) arms[arm].headersRecall++;
        for (const n of names) otherToolNames.add(n);
      }
      if (e.type === "tool/call" && String(d.name || "").includes("ans_chat")) {
        arms[arm].calls++;
        let args = d.arguments;
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        if (args?.sessionId) arms[arm].withSession++;
      }
      if (e.type === "tool/result" && JSON.stringify(d).includes("sessionId")) arms[arm].resultSessionBlocks++;
    }
  }
}

const totals = { calls: arms.g3.calls + arms.g5.calls, withSession: arms.g3.withSession + arms.g5.withSession };
const result = {
  generatedAt: new Date().toISOString(),
  inputSource: "existing ~/.dsh/sessions logs for r19 question-level g3/g5 runs (read-only)",
  note: "project-level runs have not started; the arm config is the same filter (--allow ans_chat)",
  arms: {
    g3: { ...arms.g3, toolSurface: ["mcp__anysearch__ans_chat"] },
    g5: { ...arms.g5, toolSurface: ["mcp__anysearch__ans_chat"] },
  },
  totals,
  hostToolNamesSeen: [...otherToolNames].sort(),
};
writeFileSync(join(OUT, "probe-q3-sessions.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
