// Q20 probe: real model, the four confirmed samples A1-A4.
//
// Inputs are frozen in SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed by the user
// with "样例确认"). Every case gets its own temporary database; the formal
// experiment data is never touched. summarize / classify / verify all come from
// the real endpoint — no scripted sameFact / reliable answers.
//
// Run (env holds the credentials, never the file):
//   ANS_LLM_PROVIDER=openai ANS_LLM_MODEL=deepseek-v4.1-flash \
//   ANS_LLM_BASE_URL=https://amr-link.open-design.ai/v1 ANS_LLM_API=chat \
//   ANS_LLM_API_KEY=... node --import tsx prototype/pi-q20-q21-lock-recovery/probe-q20-real-model.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createLlmSession } from "../../packages/kernel/src/llm-init";
import { createConsolidationSeams } from "../../packages/kernel/src/consolidation";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const provider = process.env.ANS_LLM_PROVIDER ?? "";
const modelName = process.env.ANS_LLM_MODEL ?? "";
const baseUrl = process.env.ANS_LLM_BASE_URL;
const api = process.env.ANS_LLM_API as "chat" | "messages" | "responses" | undefined;
const apiKey = process.env.ANS_LLM_API_KEY;
if (!provider || !modelName) {
  console.error("missing ANS_LLM_PROVIDER / ANS_LLM_MODEL");
  process.exit(2);
}
if (baseUrl && !api) {
  console.error("ANS_LLM_BASE_URL requires ANS_LLM_API");
  process.exit(2);
}

type Verdict = Record<string, unknown>;
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

const prompts: Array<{ label: string; prompt: string }> = [];
function loggedStream(inner: any, label: string) {
  return (model: any, context: any, options: any) => {
    try {
      const messages = context?.messages ?? [];
      const last = messages.slice().reverse().find((m: any) => m?.role === "user");
      const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      prompts.push({ label, prompt: String(text).slice(0, 3000) });
    } catch { /* logging must not break the call */ }
    return inner(model, context, options);
  };
}

// Chinese sentences that still present the old 9-5 schedule as current. A
// sentence may mention it if it is explicitly marked as replaced / former.
function restatesOldHours(text: string): boolean {
  return text
    .replace(/[—–]/g, "-")
    .split(/[。！？\n]+/)
    .filter((s) => /9[:：]00/.test(s) || /17[:：]00/.test(s))
    .some((s) => !/替代|取代|原|改|曾|之前|历史|不再|已不是|旧/.test(s));
}

interface CaseInput {
  id: string;
  oldContent: string;
  oldEntity: string;
  oldUrls: string[];
  oldTitlePrefix: string;
  oldSnippet: string;
  newEntity: string;
  newUrl: string;
  newTitle: string;
  newSnippet: string;
}

const A1: CaseInput = {
  id: "A1",
  oldContent: "A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。",
  oldEntity: "a-support-hours",
  oldUrls: ["https://a.example/support-hours-v1", "https://a.example/support-hours-v2", "https://a.example/support-hours-v3"],
  oldTitlePrefix: "A 公司客服时间（原官网页面",
  oldSnippet: "A 公司官网客服页面写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com。",
  newEntity: "a-support-hours",
  newUrl: "https://a.example/notice-2026-11-01",
  newTitle: "A 公司客服时间更新通知（官方）",
  newSnippet: "A 公司官方通知（2026-11-01 生效）：在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。",
};

const A2: CaseInput = {
  id: "A2",
  oldContent: "A 公司门店营业时间为每天 10:00—20:00。",
  oldEntity: "a-store-hours",
  oldUrls: ["https://a.example/store-v1", "https://a.example/store-v2", "https://a.example/store-v3"],
  oldTitlePrefix: "A 公司门店营业时间",
  oldSnippet: "A 公司官网门店页面写明：门店营业时间为每天 10:00—20:00。",
  newEntity: "a-support-hours",
  newUrl: "https://a.example/support-now",
  newTitle: "A 公司在线客服时间说明",
  newSnippet: "A 公司在线客服自 2026-11-01 起提供 7×24 小时全天候服务。",
};

const A3: CaseInput = {
  ...A1,
  id: "A3",
  newEntity: "a-support-hours",
  newUrl: "https://forum.example/thread-123",
  newTitle: "论坛帖子：A 公司客服是不是改时间了",
  newSnippet: "论坛帖子称：听说 A 公司在线客服可能已改成全天在线，但发帖人不确定，也没有给出官方链接。",
};

const A4: CaseInput = {
  id: "A4",
  oldContent: "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。",
  oldEntity: "a-support-hours",
  oldUrls: ["https://a.example/support-facts-v1", "https://a.example/support-facts-v2", "https://a.example/support-facts-v3"],
  oldTitlePrefix: "A 公司客服说明",
  oldSnippet: "A 公司官网写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com，公共假期暂停人工客服、仅保留自助服务。",
  newEntity: "a-support-hours",
  newUrl: "https://a.example/notice-2026-11-01b",
  newTitle: "A 公司客服时间更新通知（官方）",
  newSnippet: "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。",
};

async function runCase(c: CaseInput, llm: any) {
  const root = mkdtempSync(join(tmpdir(), "ans-q20-" + c.id + "-"));
  const dbPath = join(root, "anysearch.db");
  const store = new SqliteSessionStore(dbPath);
  const oldSession = await store.createSession("chat");
  await store.saveResults(oldSession.id, c.oldUrls.map((url, i) => ({
    url,
    title: c.oldTitlePrefix + " v" + (i + 1) + "）",
    snippet: c.oldSnippet,
    source: "tavily",
    score: 1,
    entity: c.oldEntity,
  })));
  const oldIds = store.dbQuery<{ id: number }>("SELECT id FROM retrieval_results ORDER BY id").map((r) => r.id);

  const raw = new Database(dbPath);
  const oldInfo = raw.prepare(
    "INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, NULL)",
  ).run(c.oldContent, JSON.stringify(oldIds), 0.8, 0.95);
  const oldId = Number(oldInfo.lastInsertRowid);
  raw.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)")
    .run(oldSession.id, JSON.stringify({ summary: "会话备注：" + c.oldContent, timestamp: Date.now() }));
  raw.close();

  const newSession = await store.createSession("chat");
  await store.saveResults(newSession.id, [{
    url: c.newUrl,
    title: c.newTitle,
    snippet: c.newSnippet,
    source: "tavily",
    score: 1,
    entity: c.newEntity,
  }]);
  const newEpisodeId = store.dbQuery<{ id: number }>(
    "SELECT id FROM retrieval_results WHERE url = ?", c.newUrl)[0].id;

  const seams = createConsolidationSeams({ ...llm, streamFn: loggedStream(llm.streamFn, c.id) } as any);
  store.setConsolidationSeams({ summarize: seams.summarize, classify: seams.classify, verify: seams.verify });

  const report = await store.consolidateMemory({
    memoryIds: [newEpisodeId],
    allowSingleEvidence: true,
    thetaDup: 0.999,
    preserveOnUpdate: true,
  });

  const sem = store.dbQuery<any>("SELECT id, content, valid_until, superseded_by FROM semantic_memories ORDER BY id");
  const oldAfter = sem.find((r) => r.id === oldId) ?? null;
  const live = sem.filter((r) => r.valid_until === null);
  const newSemantic = live.find((r) => r.id !== oldId) ?? null;
  const oldEpisodes = store.dbQuery<any>(
    "SELECT id, url, superseded_by, valid_until FROM retrieval_results WHERE id IN (" + oldIds.join(",") + ") ORDER BY id");
  const newEpisode = store.dbQuery<any>(
    "SELECT id, url, snippet, superseded_by, valid_until FROM retrieval_results WHERE id = ?", newEpisodeId)[0];
  const anchors = store.dbQuery<any>(
    "SELECT payload FROM resume_anchors WHERE session_id = ? AND anchor_type = 'anchor_status' ORDER BY id",
    oldSession.id);

  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });

  return {
    case: c.id,
    report: {
      add: report.add, update: report.update, skip: report.skip, conflict: report.conflict,
      noop: report.noop, singleEvidenceSkipped: report.singleEvidenceSkipped,
      staleUpdates: report.staleUpdates, retriedAfterStale: report.retriedAfterStale,
      concurrentConflicts: report.concurrentConflicts,
      verifyRejected: report.verifyRejected,
      updates: report.updates, verifyDetails: report.verifyDetails,
      verifiedCorrections: report.verifiedCorrections,
      summariesNeedingRefresh: report.summariesNeedingRefresh,
    },
    usage: seams.usage,
    knowledge: {
      oldId,
      oldContent: oldAfter?.content ?? null,
      oldStillLive: oldAfter?.valid_until === null,
      oldSupersededBy: oldAfter?.superseded_by ?? null,
      liveRows: live.map((r) => ({ id: r.id, content: r.content })),
      newSemanticId: newSemantic?.id ?? null,
      newContent: newSemantic?.content ?? null,
      oldEpisodes,
      newEpisode,
      anchorStatuses: anchors.map((a) => a.payload),
    },
  };
}

const evidence: any = {
  probe: "q20-real-model",
  startedAt: new Date().toISOString(),
  samples: "SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed)",
  model: {
    provider, model: modelName, baseUrlPresent: !!baseUrl, api: api ?? null,
    apiKeyLength: apiKey?.length ?? 0,
    temperature: "endpoint default (not set)",
    note: "custom endpoint: provider returns no USD; cost is unknown, never free",
  },
  cases: [] as Verdict[],
  checks: findings as unknown[],
  prompts,
};

try {
  const llm = await createLlmSession({ provider, model: modelName, baseUrl, api, apiKey } as any);

  for (const c of [A1, A2, A3, A4]) {
    const r = await runCase(c, llm);
    evidence.cases.push(r as Verdict);
    console.log("case " + c.id + " done (update=" + (r as any).report.update +
      ", reject=" + (r as any).report.verifyRejected + ", conflict=" + (r as any).report.conflict + ")");
  }
  const got = (id: string) => evidence.cases.find((c: any) => c.case === id)!;

  // A1: explicit correction of the same fact.
  {
    const r = got("A1");
    const cur = r.knowledge.newContent ?? "";
    record("A1", "同一事实的官方更正落地一次，旧版本关闭并指向新版本",
      r.report.update === 1 && r.knowledge.oldStillLive === false &&
        r.knowledge.oldSupersededBy === r.knowledge.newSemanticId &&
        /7×24|24\/7|全天候/.test(cur) &&
        !restatesOldHours(cur) &&
        cur.includes("help@example.com"),
      { report: r.report, content: cur });
    record("A1-archive", "旧材料和新材料都还在归档，旧材料只标记被谁取代",
      r.knowledge.oldEpisodes.length === 3 &&
        r.knowledge.oldEpisodes.every((e: any) => e.superseded_by === r.knowledge.newSemanticId) &&
        r.knowledge.newEpisode && r.knowledge.newEpisode.superseded_by === null,
      { oldEpisodes: r.knowledge.oldEpisodes, newEpisode: r.knowledge.newEpisode });
    record("A1-evidence", "报告带着“同事实/可靠/明确更正”的真实模型判断，不是关键词命中",
      Array.isArray(r.report.verifiedCorrections) && r.report.verifiedCorrections.length >= 1 &&
        r.report.verifiedCorrections[0].sameFact === true &&
        r.report.verifiedCorrections[0].reliable === true &&
        r.report.verifiedCorrections[0].candidate.includes("7×24"),
      { verifiedCorrections: r.report.verifiedCorrections });
  }

  // A2: different object (store hours vs online support).
  {
    const r = got("A2");
    record("A2", "对象不同（门店 vs 在线客服）不覆盖门店旧知识",
      r.report.update === 0 && r.knowledge.oldStillLive === true &&
        r.knowledge.oldContent === A2.oldContent,
      { report: r.report, knowledge: r.knowledge });
    const d = (r.report.verifyDetails ?? [])[0] ?? null;
    record("A2-report", "拒绝报告带回旧知识原文、新材料原文/来源和模型理由",
      r.report.verifyRejected === 1 && d !== null &&
        typeof d.oldContent === "string" && d.oldContent.includes("门店") &&
        typeof d.candidate === "string" && d.candidate.includes("在线客服") &&
        Array.isArray(d.evidence) && d.evidence.some((e: any) => e.url === A2.newUrl) &&
        typeof d.reason === "string" && d.reason.length > 0 &&
        d.sameFact === false,
      { verifyDetails: r.report.verifyDetails });
    record("A2-material", "新材料留在归档，没被删掉也没被当成门店结论",
      r.knowledge.newEpisode && r.knowledge.newEpisode.superseded_by === null &&
        r.knowledge.newEpisode.snippet.includes("7×24") &&
        !r.knowledge.liveRows.some((x: any) => x.id !== r.knowledge.oldId),
      { newEpisode: r.knowledge.newEpisode, liveRows: r.knowledge.liveRows });
  }

  // A3: hearsay.
  {
    const r = got("A3");
    const refused = r.report.verifyRejected >= 1 || r.report.skip >= 1 || r.report.conflict >= 1;
    record("A3", "论坛“听说/可能”不覆盖确定知识",
      r.report.update === 0 && r.knowledge.oldStillLive === true && refused,
      { report: r.report });
    const verdict = (r.report.verifyDetails ?? [])[0] ?? null;
    record("A3-reason", "拒绝理由可见（不可靠或对应关系不足）",
      verdict !== null && (verdict.reliable === false || (typeof verdict.reason === "string" && verdict.reason.length > 0)),
      { verifyDetails: r.report.verifyDetails });
    record("A3-material", "论坛材料仍在归档，不被删除也不被当成事实",
      r.knowledge.newEpisode !== null && r.knowledge.newEpisode.superseded_by === null,
      { newEpisode: r.knowledge.newEpisode });
  }

  // A4: several facts in one old claim, one corrected.
  {
    const r = got("A4");
    const cur = r.knowledge.newContent ?? "";
    record("A4", "多事实旧知识只替换被纠正的一条，邮箱和假期安排保留",
      r.report.update === 1 &&
        /7×24|24\/7|全天候/.test(cur) &&
        cur.includes("help@example.com") &&
        /公共假期|假期/.test(cur) && /自助/.test(cur) &&
        !restatesOldHours(cur),
      { report: r.report, content: cur });
  }

  // Q19 cost basis.
  {
    const usage = got("A1").usage;
    record("Q19", "费用如实报未知，不当成免费",
      usage.costBasis === "unknown" &&
        usage.missing.some((m: string) => m.includes("price unknown")),
      { costBasis: usage.costBasis, costUsd: usage.costUsd, missing: usage.missing });
  }

  // No credential material in evidence.
  {
    const text = JSON.stringify(evidence);
    record("SEC", "证据文件不含密钥材料",
      !apiKey || !text.includes(apiKey), { apiKeyLength: apiKey?.length ?? 0 });
  }

  const totals = evidence.cases.reduce((a: any, r: any) => ({
    calls: a.calls + r.usage.calls,
    inputTokens: a.inputTokens + r.usage.inputTokens,
    outputTokens: a.outputTokens + r.usage.outputTokens,
    cacheReadTokens: a.cacheReadTokens + r.usage.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + r.usage.cacheWriteTokens,
    totalTokens: a.totalTokens + r.usage.totalTokens,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
  evidence.usageTotals = { ...totals, costBasis: "unknown", note: "costUsd would be a false zero; price table absent" };
  writeFileSync(join(OUT, "q20-real-model.json"), JSON.stringify(evidence, null, 2) + "\n");

  const failed = findings.filter((f) => !f.pass);
  for (const f of failed) console.log("  FAIL DETAIL " + f.id + " " + JSON.stringify(f.evidence).slice(0, 1200));
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q20-real-model.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exitCode = 2;
}
