// PROTOTYPE — throwaway probe, not product code.
//
// Question (Q3): can a scoped consolidation maintain shared knowledge without
// mixing unrelated sessions, let one reliable piece of evidence correct stale
// knowledge across sessions, keep provenance, and stay idempotent?
//
// Real SQLite store + real consolidateMemoryRun; scripted summarize/classify
// seams (no network).
//
// Run: node --import tsx prototype/pi-1.5.1-memory/probe-consolidate-scope.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const findings: Array<{ id: string; question: string; ok: boolean; evidence: unknown }> = [];
function record(id: string, question: string, evidence: unknown, ok: boolean) {
  findings.push({ id, question, ok, evidence });
  console.log("\n[" + id + "] " + question + "\n  ok=" + ok + "\n  " + JSON.stringify(evidence).slice(0, 800));
}

const workDir = mkdtempSync(join(tmpdir(), "anysearch-pi151-consolidate-"));
const dbPath = join(workDir, "anysearch.db");

const OLD_SUMMARY = "Tempura shop operating hours are 10:00-21:00.";
const NEW_SUMMARY = "Tempura shop operating hours are no longer 10:00-21:00; they are now 09:00-22:00.";

const summarize = async (episodes: Array<{ title: string; snippet: string; url: string }>) => {
  const text = episodes.map((e) => e.snippet).join(" ");
  if (text.includes("no longer")) return NEW_SUMMARY;
  if (text.toLowerCase().includes("sushi")) return "Sushi shop opens at 11:00 and closes at 20:00.";
  return OLD_SUMMARY;
};
const classify = () => ({ label: "supported" as const, confidence: 1 });

const store = new SqliteSessionStore(dbPath, {
  consolidateSummarize: summarize,
  consolidateClassify: classify,
});

function dbRows(sql: string, params: any[] = []): any[] {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
function dbRun(sql: string, params: any[] = []) {
  const db = new Database(dbPath, {});
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}

async function addEpisode(sessionId: string, url: string, title: string, snippet: string) {
  dbRun(
    "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionId, url, title, snippet, "probe", "tempura-shop"],
  );
}

try {
  const a = await store.createSession("chat");
  const b = await store.createSession("chat");

  // Session A: three consistent episodes about tempura hours.
  for (const n of [1, 2, 3]) {
    await addEpisode(a.id, "https://a.example/tempura-" + n, "Tempura hours " + n, "Tempura shop operating hours are 10:00-21:00, source " + n + ".");
  }
  // Session B: three unrelated episodes about sushi.
  const b2 = await store.createSession("chat");
  for (const n of [1, 2, 3]) {
    await addEpisode(b2.id, "https://b.example/sushi-" + n, "Sushi hours " + n, "Sushi shop sushi counter opens at 11:00, source " + n + ".");
  }

  // ---------- scoped run: only session A's episodes ----------
  const scopedA = await store.consolidateMemory({ sessionIds: [a.id] });
  const semanticAfterA = dbRows("SELECT id, content, source_episode_ids, salience, confidence, created_at, valid_until FROM semantic_memories");
  record(
    "Q3-1",
    "限定 session A 后，只整理 A 的资料，B 的寿司资料不混入",
    {
      report: scopedA,
      semanticRows: semanticAfterA,
      sushiMentioned: JSON.stringify(semanticAfterA).includes("Sushi"),
      scannedEpisodes: dbRows("SELECT id, session_id, entity FROM retrieval_results"),
    },
    semanticAfterA.length === 1 &&
      String(semanticAfterA[0].content).includes("Tempura") &&
      !JSON.stringify(semanticAfterA).includes("Sushi"),
  );

  // ---------- idempotency: the same scope again ----------
  const scopedA2 = await store.consolidateMemory({ sessionIds: [a.id] });
  const semanticAfterA2 = dbRows("SELECT COUNT(*) AS n FROM semantic_memories");
  record(
    "Q3-2",
    "重复整理同一范围不产生重复知识",
    { report: scopedA2, semanticCount: semanticAfterA2[0].n },
    scopedA2.noop >= 1 && scopedA2.add === 0 && semanticAfterA2[0].n === 1,
  );

  // ---------- cross-session correction from ONE new episode ----------
  const b3 = await store.createSession("chat");
  await addEpisode(
    b3.id,
    "https://c.example/tempura-corrected",
    "Tempura hours corrected",
    "Tempura shop operating hours are no longer 10:00-21:00; they are now 09:00-22:00 as of this reliable source.",
  );

  const single = await store.consolidateMemory({ sessionIds: [b3.id], allowSingleEvidence: true });
  const live = dbRows("SELECT id, content, source_episode_ids, created_at, valid_until FROM semantic_memories WHERE valid_until IS NULL");
  const closed = dbRows("SELECT id, content, valid_until FROM semantic_memories WHERE valid_until IS NOT NULL");
  record(
    "Q3-3",
    "单条可靠新证据可跨会话纠错：旧结论关闭，新结论写入",
    {
      report: single,
      live,
      closed,
      sourceEpisodesOfNew: live[0] ? JSON.parse(live[0].source_episode_ids) : [],
      newEpisodeId: dbRows("SELECT id FROM retrieval_results WHERE url = 'https://c.example/tempura-corrected'")[0]?.id,
    },
    single.update >= 1 &&
      live.length === 1 &&
      String(live[0].content).includes("no longer") &&
      closed.length >= 1,
  );

  // ---------- the corrected fact wins retrieval; the stale one is gone ----------
  const hitsOld = await store.searchMemory("Tempura operating hours 10:00-21:00", 5);
  const hitsNew = await store.searchMemory("Tempura operating hours 09:00-22:00", 5);
  const hitsText = JSON.stringify({ hitsOld, hitsNew });
  record(
    "Q3-4",
    "纠错后旧结论退出有效检索、新结论可检索",
    {
      hitsOld: hitsOld.map((h) => String(h.content).slice(0, 120)),
      hitsNew: hitsNew.map((h) => String(h.content).slice(0, 120)),
      staleStillReturned: hitsText.includes("no longer") === false && hitsText.includes(OLD_SUMMARY),
    },
    !hitsOld.some((h) => String(h.content) === OLD_SUMMARY) && hitsNew.some((h) => String(h.content).includes("no longer")),
  );

  // ---------- a single episode without the opt-in does nothing ----------
  const b4 = await store.createSession("chat");
  await addEpisode(b4.id, "https://d.example/tempura-2", "Tempura hours again", "Tempura shop operating hours are no longer 09:00-22:00; they are now 08:00-23:00.");
  const withoutFlag = await store.consolidateMemory({ sessionIds: [b4.id] });
  record(
    "Q3-5",
    "不开启单条纠错时，单条资料不会触发整理",
    { report: withoutFlag },
    withoutFlag.update === 0 && withoutFlag.add === 0,
  );

  // ---------- derived summaries do not follow the correction ----------
  // The rolling summary is a per-session anchor. Nothing links it to a semantic
  // update, so an old session keeps carrying the corrected fact forever.
  dbRun(
    "INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)",
    [a.id, JSON.stringify({ summary: OLD_SUMMARY, tokenWatermark: 100, timestamp: Date.now() })],
  );
  const anchorsAfter = dbRows("SELECT session_id, anchor_type, payload FROM resume_anchors WHERE anchor_type = 'rolling_summary'");
  record(
    "Q3-6",
    "纠错后，旧会话的滚动摘要仍然保留已被纠正的事实（派生摘要传播缺口）",
    {
      anchors: anchorsAfter,
      staleSummaryStillInjectable: JSON.stringify(anchorsAfter).includes("10:00-21:00"),
    },
    !JSON.stringify(anchorsAfter).includes("10:00-21:00"),
  );

  // ---------- provenance survives ----------
  record(
    "Q3-7",
    "来源 ID、写入时间与更新关系（valid_until）都保留",
    {
      newRow: live[0],
      closedRow: closed[0],
      episodeCount: dbRows("SELECT COUNT(*) AS n FROM retrieval_results")[0].n,
      semanticEpisodeLinks: dbRows("SELECT id, source_episode_ids FROM semantic_memories"),
    },
    !!live[0]?.created_at && !!live[0]?.source_episode_ids && !!closed[0]?.valid_until,
  );
} finally {
  try { store.close?.(); } catch {}
  if (process.env.PROBE_KEEP !== "1") {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log("kept " + workDir);
  }
}

const fs = await import("node:fs");
fs.mkdirSync(join(HERE, "out"), { recursive: true });
fs.writeFileSync(
  join(HERE, "out", "probe-consolidate-scope.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), inputSource: "real SQLite store; scripted summarize/classify seams", findings }, null, 2),
);
console.log("\nwrote out/probe-consolidate-scope.json");
console.log("SUMMARY " + JSON.stringify(findings.map((f) => [f.id, f.ok])));
