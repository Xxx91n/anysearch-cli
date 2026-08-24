// ADR-0023 D4 (Q3=A): write-path adjudication — MemTX-simplified three checks.
// Evidence >= 0.6 / temporal supersede (valid_until set, excluded from searchMemory) / equal-weight conflict → quarantine.
// Uses OS temp dir for SQLite (WAL needs a file, not :memory:).

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-adj-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("code");

    // 1) Accept path: evidence >= 0.6 — row inserted, no quarantine flag, discoverable via searchMemory.
    const r1 = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/accept", title: "accept fact", snippet: "high confidence fact",
      source: "exa", evidence: 0.9,
    }]);
    assert(r1[0].action === "accept", `evidence>=0.6 → accept (got ${r1[0].action})`);
    await new Promise((r) => setTimeout(r, 10));
    const foundAccept = await store.searchMemory("accept fact", 5);
    assert(foundAccept.length >= 1, "accepted memory discoverable via searchMemory");

    // 2) Direct-user trust channel (source='user') bypasses evidence threshold.
    const rUser = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/user", title: "user said", snippet: "user-stated preference",
      source: "user", evidence: 0.1,
    }]);
    assert(rUser[0].action === "accept", "source='user' bypasses evidence gate (MemTX authority channel)");

    // 3) Temporal supersede: same-entity new write closes old record's valid_until; searchMemory excludes it.
    await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/v1", title: "api v1 docs", snippet: "old api", source: "exa", evidence: 0.9, entity: "api-doc",
    }]);
    const r2 = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/v2", title: "api v2 docs", snippet: "new api", source: "exa", evidence: 0.9, entity: "api-doc",
    }]);
    assert(r2[0].action === "supersede", `same-entity second write → supersede (got ${r2[0].action})`);
    assert(typeof r2[0].supersededId === "number", "supersede returns supersededId");
    // Old row must have valid_until set
    const raw = new Database(dbPath, { readonly: true });
    const oldRow = raw.prepare("SELECT valid_until FROM retrieval_results WHERE id = ?").get(r2[0].supersededId) as { valid_until: string | null };
    assert(oldRow.valid_until !== null, "superseded row has valid_until set (bi-temporal)");
    await new Promise((r) => setTimeout(r, 10));
    const hitsApi = await store.searchMemory("api v1 docs", 5);
    assert(!hitsApi.some((h) => h.rowid === r2[0].supersededId), "superseded memory NOT returned by searchMemory");
    const hitsNew = await store.searchMemory("api v2 docs", 5);
    assert(hitsNew.some((h) => h.rowid === r2[0].insertedId), "new memory returned by searchMemory");

    // 4) Equal-weight conflict / low-evidence → quarantine, excluded from searchMemory.
    const r3 = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/maybe", title: "maybe fact", snippet: "uncertain claim",
      source: "exa", evidence: 0.3,
    }]);
    assert(r3[0].action === "quarantine", `evidence<0.6 → quarantine (got ${r3[0].action})`);
    const qRow = raw.prepare("SELECT quarantine FROM retrieval_results WHERE id = ?").get(r3[0].insertedId) as { quarantine: string | null };
    assert(qRow.quarantine !== null, "quarantined row has quarantine flag set");
    await new Promise((r) => setTimeout(r, 10));
    const hitsQ = await store.searchMemory("maybe fact", 5);
    assert(!hitsQ.some((h) => h.rowid === r3[0].insertedId), "quarantined memory NOT returned by searchMemory");

    raw.close();
    console.log(`adjudication.test.ts: ${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
    store.close?.();
  } finally {
    // Windows WAL lock: tolerate EPERM
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
