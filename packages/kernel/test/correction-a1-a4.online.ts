// #261 — real-model evidence for the confirmed A1-A4 samples (spec D6/D7/D8,
// test T5).
//
// This file is NOT part of the regular test run (the *.online.ts suffix keeps
// it out of the "test/**/*.test.ts" glob). Run it explicitly:
//   node --import tsx --test test/correction-a1-a4.online.ts
//
// Inputs are the user-confirmed samples from the prototype round
// (SAMPLES-Q20-Q21-LOCK-COLDSTART.md, commit 7afa2d1d): the same four cases,
// verbatim. They run against the PRODUCTION code path — SqliteSessionStore +
// createConsolidationSeams — with every seam a real model call.
//
// What is asserted (mechanical, sample-confirmed):
//   A1/A4: update=1, old row closed with superseded_by -> new row, old
//          episodes superseded, merged content carries the correction AND the
//          preserved facts, correcting material live, checker verdict recorded.
//   A2/A3: update=0, verifyRejected=1, old knowledge stays live, refusal hands
//          back old content / candidate / sources / verdict / follow-up.
// What is recorded, not asserted: the checker's reasons, the merged text's
// phrasing, per-call usage. Single run, no accuracy claim — real models vary.
//
// Skip policy: the endpoint env must be present; a silent no-model run would
// fake a pass, so this skips loudly instead.
// Evidence: .scratch/correction-a1-a4-evidence.json (gitignored).
//
// UNCOVERED (real model) — #262 retry branches, deliberately not forced:
// The concurrent-collision retry branches are validated by CONTROLLED
// checkers only (packages/store/test/concurrent-correction.test.ts and
// packages/store/test/consolidate-race-processes.test.ts). Real-model
// coverage stays explicitly uncovered with these three labels, carried over
// from the confirmed prototype round (SAMPLES-Q20-Q21-LOCK-COLDSTART.md):
//   U1  B1 重试收敛：后提交方重读后识别"已有同样更正"、不制造第二个版本
//       —— 真实模型未覆盖。
//   U2  B2 重判后仍冲突：返回双方材料原文、来源、当前生效内容与差异
//       —— 真实模型未覆盖。B2 的首次真实模型判定拒绝了这次更正；按
//       Q21 这正是保守方向的预期行为，记录在案，但不把它当成重试分支
//       的真实模型结论。
//   U3  重试上限与入账：后提交方最多 2 次真实模型判断、不出现第三次
//       重试、额外调用如实计入预算 —— 真实模型未覆盖。

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { createLlmSession, createConsolidationSeams } from "../src/index";

const PROVIDER = process.env.ANS_LLM_PROVIDER;
const MODEL = process.env.ANS_LLM_MODEL;
const BASE_URL = process.env.ANS_LLM_BASE_URL;
// Same validation the MCP entry uses: an unknown wire id is not a kind.
const apiRaw = process.env.ANS_LLM_API;
const API = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
const API_KEY = process.env.ANS_LLM_API_KEY;

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

if (!PROVIDER || !MODEL || !API_KEY) {
  console.log("SKIP: correction-a1-a4 needs ANS_LLM_PROVIDER / ANS_LLM_MODEL / ANS_LLM_API_KEY set — no silent zero-model run.");
} else {
  const evidence: Record<string, unknown> = {
    provider: PROVIDER, model: MODEL,
    baseUrl: BASE_URL ? "(set, not recorded)" : "(catalog)",
    api: API ?? "(default)",
    samples: [] as unknown[],
  };

  const A1_OLD = "A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。";
  const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。";

  async function seedOld(dbDir: string, entity: string, oldContent: string, urlBase: string): Promise<{ store: SqliteSessionStore; oldIds: number[]; oldRowId: number }> {
    const store = new SqliteSessionStore(join(dbDir, "db.sqlite"));
    const session = await store.createSession("eval");
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const ra = await store.adjudicateMemory(session.id, [{
        url: urlBase + "-v" + i, title: entity + " v" + i, snippet: oldContent, source: "tavily", evidence: 0.9, entity,
      }]);
      if (ra[0]?.insertedId) ids.push(ra[0].insertedId);
    }
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
      { summarize: async () => oldContent, classify: () => ({ label: "supported", confidence: 0.95 }) },
    );
    if (rep.add !== 1) throw new Error("seed failed: batch run did not build the old knowledge row");
    const row = store.dbQuery<{ id: number }>("SELECT id FROM semantic_memories WHERE valid_until IS NULL")[0]!;
    return { store, oldIds: ids, oldRowId: row.id };
  }

  async function runSample(name: string, cases: {
    entity: string;
    oldContent: string;
    urlBase: string;
    newUrl: string;
    newTitle: string;
    newSnippet: string;
    newEntity: string;
    expect: "update" | "refuse";
    mustKeep?: string[];
    // Text that must NOT appear: the mirror of mustKeep for a fact whose loss is
    // an inversion rather than an omission. A merged line saying "公共假期也提供
    // 人工客服" still contains the words 公共假期, so mustKeep alone would pass
    // while the exception itself was reversed (#273 nitpick).
    mustNotContain?: string[];
  }): Promise<void> {
    const dbDir = mkdtempSync(join(tmpdir(), "ans-261-t5-"));
    const record: Record<string, unknown> = { sample: name, expect: cases.expect };
    try {
      const { store, oldIds, oldRowId } = await seedOld(dbDir, cases.entity, cases.oldContent, cases.urlBase);
      const session = await store.createSession("corr");
      const ra = await store.adjudicateMemory(session.id, [{
        url: cases.newUrl, title: cases.newTitle, snippet: cases.newSnippet, source: "tavily", evidence: 0.9, entity: cases.newEntity,
      }]);
      const newId = ra[0]?.insertedId;
      if (typeof newId !== "number") throw new Error("seed failed: new material not inserted");

      // Non-null: the loud skip guard above means these are all set here.
      const llm = await createLlmSession({
        provider: PROVIDER!, model: MODEL!, apiKey: API_KEY!,
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
        ...(API ? { api: API } : {}),
      });
      const seams = createConsolidationSeams(llm);
      const usageBefore = { ...seams.usage };
      const rep = await store.consolidateMemory(
        { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
        { summarize: seams.summarize, classify: seams.classify, verify: seams.verify, verifyFinal: seams.verifyFinal },
      );

      record.report = {
        update: rep.update, add: rep.add, noop: rep.noop,
        verifyRejected: rep.verifyRejected, correctionsIncomplete: rep.correctionsIncomplete,
        verifiedCorrections: rep.verifiedCorrections,
        verifyDetails: rep.verifyDetails,
        incompleteDetails: rep.incompleteDetails,
      };
      record.usage = {
        calls: seams.usage.calls - usageBefore.calls,
        inputTokens: seams.usage.inputTokens - usageBefore.inputTokens,
        outputTokens: seams.usage.outputTokens - usageBefore.outputTokens,
        cacheReadTokens: seams.usage.cacheReadTokens - usageBefore.cacheReadTokens,
        totalTokens: seams.usage.totalTokens - usageBefore.totalTokens,
        costBasis: seams.usage.costBasis,
        missing: seams.usage.missing,
      };

      const dbq = (sql: string, ...params: unknown[]): any => store.dbQuery(sql, ...params)[0];
      if (cases.expect === "update") {
        assert(rep.update === 1, name + ": the correction landed (update=" + rep.update + ")");
        assert(rep.verifyRejected === 0 && rep.correctionsIncomplete === 0,
          name + ": nothing refused or incomplete (verifyRejected=" + rep.verifyRejected + " incomplete=" + rep.correctionsIncomplete + ")");
        const up = rep.updates[0];
        assert(!!up, name + ": the report names the update");
        if (up) {
          const oldRow = dbq("SELECT valid_until, superseded_by FROM semantic_memories WHERE id = ?", up.oldId);
          assert(oldRow.valid_until !== null && oldRow.superseded_by === up.newId,
            name + ": the old row is closed and points at its successor");
          for (const id of oldIds) {
            const ep = dbq("SELECT superseded_by FROM retrieval_results WHERE id = ?", id);
            assert(ep.superseded_by === up.newId, name + ": old episode " + id + " points at the new row");
          }
          const newRow = dbq("SELECT content FROM semantic_memories WHERE id = ?", up.newId);
          record.mergedContent = newRow.content;
          assert(String(newRow.content).includes("7×24"), name + ": the live content states the corrected hours");
          for (const keep of cases.mustKeep ?? []) {
            assert(String(newRow.content).includes(keep), name + ": the merged content keeps \"" + keep + "\"");
          }
          for (const bad of cases.mustNotContain ?? []) {
            assert(!String(newRow.content).includes(bad),
              name + ": the merged content does not invert the kept fact (\"" + bad + "\" absent)");
          }
        }
        const newEp = dbq("SELECT superseded_by FROM retrieval_results WHERE id = ?", newId);
        assert(newEp.superseded_by === null, name + ": the correcting material stays live");
      } else {
        assert(rep.update === 0 && rep.add === 0, name + ": nothing was replaced or created (update=" + rep.update + " add=" + rep.add + ")");
        assert(rep.verifyRejected === 1, name + ": the correction was refused and reported (verifyRejected=" + rep.verifyRejected + ")");
        const d = rep.verifyDetails[0];
        assert(!!d, name + ": the refusal detail exists");
        if (d) {
          assert(d.oldContent === cases.oldContent, name + ": the refusal carries the old content");
          assert(d.evidence.length === 1 && d.evidence[0].url === cases.newUrl, name + ": the refusal carries the source");
          assert(typeof d.followUp === "string" && d.followUp.length > 0, name + ": the refusal says what to check next");
          record.verdict = { sameFact: d.sameFact, reliable: d.reliable, relation: d.relation, reason: d.reason };
        }
        const live = dbq("SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL");
        assert(live.c === 1, name + ": the old knowledge is still the only live row");
        const ep = dbq("SELECT superseded_by FROM retrieval_results WHERE id = ?", newId);
        assert(ep.superseded_by === null, name + ": the refused material is retained");
      }
      store.close();
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
      (evidence.samples as unknown[]).push(record);
    }
  }

  // A1 明确纠正同一事实（保留邮箱）
  await runSample("A1", {
    entity: "a-support-hours", oldContent: A1_OLD, urlBase: "https://a.example/support-hours",
    newUrl: "https://a.example/notice-2026-11-01",
    newTitle: "A 公司客服时间更新通知（官方）",
    newSnippet: "A 公司官方通知（2026-11-01 生效）：在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。",
    newEntity: "a-support-hours",
    expect: "update", mustKeep: ["help@example.com"],
  });

  // A2 对象不同（门店营业时间 vs 在线客服）
  await runSample("A2", {
    entity: "a-store-hours", oldContent: "A 公司门店营业时间为每天 10:00—20:00。", urlBase: "https://a.example/store",
    newUrl: "https://a.example/support-now",
    newTitle: "A 公司在线客服时间说明",
    newSnippet: "A 公司在线客服自 2026-11-01 起提供 7×24 小时全天候服务。",
    newEntity: "a-support-hours",
    expect: "refuse",
  });

  // A3 来源不足（论坛转述）
  await runSample("A3", {
    entity: "a-support-hours", oldContent: A1_OLD, urlBase: "https://a.example/support-hours",
    newUrl: "https://forum.example/thread-123",
    newTitle: "论坛帖子：A 公司客服是不是改时间了",
    newSnippet: "论坛帖子称：听说 A 公司在线客服可能已改成全天在线，但发帖人不确定，也没有给出官方链接。",
    newEntity: "a-support-hours",
    expect: "refuse",
  });

  // A4 一份旧材料多条事实，只改正其中一条（保留邮箱和假期例外）
  await runSample("A4", {
    entity: "a-support-hours", oldContent: A4_OLD, urlBase: "https://a.example/support-facts",
    newUrl: "https://a.example/notice-2026-11-01b",
    newTitle: "A 公司客服时间更新通知（官方）",
    newSnippet: "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。",
    newEntity: "a-support-hours",
    expect: "update", mustKeep: ["help@example.com", "公共假期"],
    // The inverted form is what must not appear; any wording that mentions the
    // holiday while claiming staff ARE available there is the failure.
    mustNotContain: ["公共假期也提供人工客服", "公共假期提供人工客服", "公共假期的人工客服正常"],
  });

  // Evidence: gitignored .scratch/, never the repo.
  try {
    mkdirSync(".scratch", { recursive: true });
    writeFileSync(".scratch/correction-a1-a4-evidence.json", JSON.stringify(evidence, null, 2), "utf8");
  } catch (e) {
    console.log("note: evidence file not written (" + (e instanceof Error ? e.message : String(e)) + ")");
  }
  if (!existsSync(".scratch/correction-a1-a4-evidence.json")) {
    console.log("note: evidence lives only in this run's stdout");
  }
}

console.log("correction-a1-a4: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
