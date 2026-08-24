// ADR-0023 D5 (Q5=A): STALE-lite probe suite — three probes against write-path adjudication.
// SR = Stale Recognition, PR = Passive Recall, IPA = Implicit Preference Application.
// Each probe asserts the superseded memory gets valid_until AND disappears from subsequent searchMemory.
// Acceptance ceiling: implicit-conflict mismatches ≤55% tolerated (STALE data per ADR-0023 D5).

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
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-stale-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("code");
    const raw = new Database(dbPath, { readonly: true });

    // === SR probe: stale recognition ===
    // Fact "the latest TS version is 5.x" is superseded by "the latest TS version is 6.x".
    await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/ts5", title: "TypeScript latest 5.x", snippet: "ts 5.x is latest",
      source: "exa", evidence: 0.9, entity: "ts-latest",
    }]);
    const sr = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/ts6", title: "TypeScript latest 6.x", snippet: "ts 6.x is latest",
      source: "exa", evidence: 0.9, entity: "ts-latest",
    }]);
    assert(sr[0].action === "supersede", "SR: second write supersedes same-entity fact");
    const srOld = raw.prepare("SELECT valid_until FROM retrieval_results WHERE id = ?").get(sr[0].supersededId) as { valid_until: string | null };
    assert(srOld.valid_until !== null, "SR: stale memory has valid_until set");
    await new Promise((r) => setTimeout(r, 10));
    const srHits = await store.searchMemory("TypeScript latest 5.x", 5);
    assert(!srHits.some(h => h.rowid === sr[0].supersededId), "SR: stale fact excluded from recall");

    // === PR probe: passive recall ===
    // After supersede, querying by the NEW phrasing only returns the new memory.
    const prHits = await store.searchMemory("TypeScript latest 6.x", 5);
    assert(prHits.some(h => h.rowid === sr[0].insertedId), "PR: new memory returned for fresh query");
    assert(!prHits.some(h => h.rowid === sr[0].supersededId), "PR: old memory absent from fresh query");

    // === IPA probe: implicit preference ===
    // Two peer sources state a fact; the newer evidence supersedes the older.
    await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/pref-a", title: "prefer dark mode", snippet: "user prefers dark theme",
      source: "exa", evidence: 0.7, entity: "ui-theme",
    }]);
    const ipa = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/pref-b", title: "prefer light mode", snippet: "user prefers light theme",
      source: "exa", evidence: 0.95, entity: "ui-theme",
    }]);
    assert(ipa[0].action === "supersede", "IPA: newer peer evidence supersedes older preference");
    await new Promise((r) => setTimeout(r, 10));
    const ipaHits = await store.searchMemory("dark mode", 5);
    assert(!ipaHits.some(h => h.rowid === ipa[0].supersededId), "IPA: superseded preference excluded");

    // Quarantine probe: low-evidence write is quarantined and excluded.
    const q = await store.adjudicateMemory(session.id, [{
      url: "https://ex.com/uncertain", title: "uncertain claim", snippet: "not verified",
      source: "exa", evidence: 0.2, entity: "uncertain-entity",
    }]);
    assert(q[0].action === "quarantine", "quarantine probe: low-evidence write");
    const qRow = raw.prepare("SELECT quarantine FROM retrieval_results WHERE id = ?").get(q[0].insertedId) as { quarantine: string | null };
    assert(qRow.quarantine === "equal_conflict", "quarantine row flagged equal_conflict");

    raw.close();
    console.log(`stale-probe.test.ts: ${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
    store.close?.();
  } finally {
    // Windows WAL lock: tolerate EPERM
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
