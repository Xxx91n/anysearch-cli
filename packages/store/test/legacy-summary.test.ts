// #265: the confirmed Acme old-format input, through the public store seam.
// Controlled failure states complement the real-MCP A-D cases; they do not
// claim anything about a real provider's judgement or price.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";

const TASK = "Find out when Acme support is reachable. Keep the answer short.";
const OLD = "Acme support runs weekdays 9:00-17:00.";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ans-265-"));
  const path = join(root, "memory.db");
  const store = new SqliteSessionStore(path);
  const sessionId = "legacy-acme";
  await store.ensureSession(sessionId, "acme");
  await store.append(sessionId, { role: "user", content: TASK });
  const [sourceId] = await store.saveResultsWithIds(sessionId, [{
    url: "https://acme.example/hours-v1", title: "acme hours v1", snippet: OLD, source: "tavily",
  }]);
  assert.equal(typeof sourceId, "number");
  await store.append(sessionId, { role: "tool", content: JSON.stringify({
    results: [{ archiveRowId: sourceId, url: "https://acme.example/hours-v1", snippet: OLD }],
  }) });
  await store.saveAnchor(sessionId, "rolling_summary", { summary: OLD });
  const anchorId = (await store.getAnchors(sessionId)).at(-1)!.id;
  // Seed an old-format archive with an unambiguous record order, as in sample A.
  const db = new Database(path);
  db.prepare("UPDATE messages SET created_at = '2026-10-01 00:00:00' WHERE session_id = ?").run(sessionId);
  db.prepare("UPDATE resume_anchors SET created_at = '2026-10-01 00:00:02' WHERE id = ?").run(anchorId);
  return { root, path, store, db, sessionId, anchorId, sourceId: sourceId as number };
}

test("failed recovery can retry after its cooldown, preserving each attempt and reported usage", async () => {
  const f = await fixture();
  try {
    const prepared = f.store.prepareLegacySummary(f.sessionId, f.anchorId)!;
    assert.equal(prepared.status, "ready");
    assert.equal(f.store.claimLegacySummary(f.sessionId, f.anchorId, prepared.evidenceKey), true);
    const usage = { input: 60, output: 8, totalTokens: 68 };
    f.store.finishLegacySummary(f.sessionId, f.anchorId, prepared.evidenceKey, {
      outcome: "generation-failed", reasons: ["the provider response was cut off"], newAnchorId: null, usage,
    });
    const failed = f.store.prepareLegacySummary(f.sessionId, f.anchorId)!;
    assert.equal(failed.status, "failed");
    assert.ok(failed.retryAfter! > Date.now());
    assert.equal(f.store.claimLegacySummary(f.sessionId, f.anchorId, failed.evidenceKey), false);
    f.store.close();
    const reopened = new SqliteSessionStore(f.path);
    try {
      assert.equal(reopened.prepareLegacySummary(f.sessionId, f.anchorId)!.status, "failed");
      // Simulate elapsed time, not a different input or changed source.
      f.db.prepare("UPDATE legacy_summary_states SET retry_after = 0 WHERE anchor_id = ?").run(f.anchorId);
      const retry = reopened.prepareLegacySummary(f.sessionId, f.anchorId)!;
      assert.equal(retry.status, "ready");
      assert.equal(retry.evidenceKey, prepared.evidenceKey);
      assert.equal(reopened.claimLegacySummary(f.sessionId, f.anchorId, retry.evidenceKey), true);
      const plan = reopened.planSummaryRebuild({ sessionId: f.sessionId, anchorId: f.anchorId });
      const write = reopened.writeRebuiltSummaryAnchor({
        sessionId: f.sessionId, rebuildOfAnchorId: f.anchorId, text: OLD,
        sources: plan.facts.map(({ kind, id }) => ({ kind, id })), taskRecordIds: plan.taskRecords.map((r) => r.messageId),
      });
      assert.equal(write.cleared, true);
      reopened.finishLegacySummary(f.sessionId, f.anchorId, retry.evidenceKey, {
        outcome: "rebuilt", reasons: [], newAnchorId: write.anchorId, usage,
      });
      assert.equal(reopened.prepareLegacySummary(f.sessionId, f.anchorId)!.status, "rebuilt");
      const history = f.db.prepare("SELECT outcome, usage FROM legacy_summary_attempts WHERE anchor_id = ? ORDER BY id")
        .all(f.anchorId) as Array<{ outcome: string; usage: string }>;
      assert.deepEqual(history.map((r) => r.outcome), ["generation-failed", "rebuilt"]);
      assert.deepEqual(history.map((r) => JSON.parse(r.usage)), [usage, usage]);
      const old = (await reopened.getAnchors(f.sessionId)).find((a) => a.id === f.anchorId)!;
      assert.deepEqual(old.payload, { summary: OLD });
    } finally { reopened.close(); }
  } finally { f.store.close(); f.db.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a partially unreadable old source list is incomplete, even when a valid source survives", async () => {
  const f = await fixture();
  try {
    // The malformed-reference values are the existing #263 parser regression
    // inputs, not new task text or a new semantic migration story.
    const malformed = [{ kind: "material", id: 0 }, { kind: "material", id: -3 },
      { kind: "material", id: 1.5 }, { kind: "material", id: "9" }, { kind: "wrong", id: 4 }, null];
    for (const invalid of malformed) {
      f.db.prepare("UPDATE resume_anchors SET payload = ? WHERE id = ?").run(JSON.stringify({
        summary: OLD, sources: [{ kind: "material", id: f.sourceId }, invalid],
      }), f.anchorId);
      const state = f.store.prepareLegacySummary(f.sessionId, f.anchorId)!;
      assert.equal(state.status, "incomplete");
      assert.ok(state.reasons.some((r) => r.includes("unreadable references")));
      assert.equal(f.store.claimLegacySummary(f.sessionId, f.anchorId, state.evidenceKey), false);
      assert.equal(f.store.planSummaryRebuild({ sessionId: f.sessionId, anchorId: f.anchorId }).complete, false);
    }
  } finally { f.store.close(); f.db.close(); rmSync(f.root, { recursive: true, force: true }); }
});
