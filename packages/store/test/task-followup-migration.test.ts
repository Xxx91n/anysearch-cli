// #307: an existing database's task_records gains the follow-up shape.
//
// Two openers can be the FIRST process to touch a file (the CLI/MCP task
// registry, and the session store once a command builds an engine), so both
// must apply the same column set. What this file pins:
// - an old table (no origin / parent_task_id) opens, and every row that was
//   already there reads as 'independent' — that is what those rows were, not
//   a guess;
// - the shape really works afterwards: a follow-up links to a real parent row;
// - the database refuses a parent id that names no row, so a dangling link can
//   never be written even by a caller that bypasses the registry's own check;
// - the layout marker is written only AFTER the migration, so the next open
//   does not read "nothing to do" over a table missing the columns.

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTaskRegistry, migrateTaskFollowupColumns } from "../src/task-registry";
import { beginInit, endInit } from "../src/sqlite-init";
import { SqliteSessionStore } from "../src/session-store";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

/** The pre-#307 task_records: exactly the columns #302 shipped. */
const OLD_TASK_TABLE = `
CREATE TABLE task_records (
  task_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('business', 'management')),
  entry TEXT NOT NULL,
  owner_pid INTEGER NOT NULL CHECK (owner_pid > 0),
  owner_host TEXT NOT NULL,
  session_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  exit_code INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

/** A minimal file with an old task table and one row already in it. */
function seedOldDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(OLD_TASK_TABLE);
    db.prepare(
      "INSERT INTO task_records (task_id, kind, role, entry, owner_pid, owner_host) VALUES ('cli-old-1', 'cli.chat', 'business', 'cli', 4242, 'old-host')",
    ).run();
  } finally {
    db.close();
  }
}

function columns(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("PRAGMA table_info(task_records)").all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "ans-task-followup-"));

  try {
    // ---- A. the registry as the first opener of an old file ----------------
    {
      const dbPath = join(dir, "registry-old.db");
      seedOldDatabase(dbPath);
      check("A: the fixture really lacks the new columns", !columns(dbPath).includes("origin"));

      const registry = openTaskRegistry(dbPath);
      try {
        const cols = columns(dbPath);
        check("A: origin was added", cols.includes("origin"));
        check("A: parent_task_id was added", cols.includes("parent_task_id"));

        const old = registry.taskById("cli-old-1");
        check("A: an old row still exists", old !== null);
        check("A: an old row reads as independent work (the truth, not a guess)",
          old?.origin === "independent" && old?.parentTaskId === null,
          JSON.stringify(old));

        const root = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
        const tail = registry.registerTask({
          kind: "server.project_index", role: "business", entry: "server",
          origin: "follow-up", parentTaskId: root.taskId,
        });
        check("A: a follow-up links to a real parent after the migration",
          tail.parentLink === "linked" && registry.taskById(tail.taskId)!.parentTaskId === root.taskId);
        tail.finish({ exitCode: 0 });
        root.finish({ exitCode: 0 });
      } finally {
        registry.close();
      }
    }

    // ---- B. the session store as the first opener of the same old file -----
    {
      const dbPath = join(dir, "store-old.db");
      seedOldDatabase(dbPath);
      const store = new SqliteSessionStore(dbPath);
      try {
        const cols = columns(dbPath);
        check("B: the session store applies the same column set",
          cols.includes("origin") && cols.includes("parent_task_id"), JSON.stringify(cols));
        // The registry seam over this store's connection sees the same shape.
        const registry = store.createTaskRegistry();
        const row = registry.taskById("cli-old-1");
        check("B: the old row is readable through the borrowed registry", row?.origin === "independent");

        const db = (store as unknown as { db: Database.Database }).db;
        const meta = db.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
        check("B: the layout marker is written only after the columns are in place", meta?.value === "1");
      } finally {
        store.close();
      }
    }

    // ---- C. migration is replayable (the idempotent-replay path) -----------
    {
      const dbPath = join(dir, "replay.db");
      seedOldDatabase(dbPath);
      const db = new Database(dbPath);
      try {
        db.pragma("foreign_keys = ON");
        const deadline = beginInit(db);
        migrateTaskFollowupColumns(db, deadline);
        // A second run must absorb "duplicate column name" and change nothing.
        migrateTaskFollowupColumns(db, deadline);
        endInit(db);
        const rows = db.prepare("SELECT COUNT(*) AS n FROM task_records WHERE origin = 'independent'").get() as { n: number };
        check("C: a replay adds no rows and leaves the data alone", rows.n === 1, JSON.stringify(rows));
      } finally {
        db.close();
      }
    }

    // ---- D. the database refuses a dangling parent -------------------------
    // The registry checks the parent before writing; this proves the schema
    // backs that check, so a direct writer cannot invent a link either.
    {
      const dbPath = join(dir, "fk.db");
      const registry = openTaskRegistry(dbPath);
      registry.close();
      const db = new Database(dbPath);
      try {
        db.pragma("foreign_keys = ON");
        let refused = false;
        try {
          db.prepare(
            "INSERT INTO task_records (task_id, kind, role, entry, owner_pid, owner_host, origin, parent_task_id) VALUES ('x-1', 'server.project_index', 'business', 'server', 1, 'h', 'follow-up', 'no-such-task')",
          ).run();
        } catch {
          refused = true;
        }
        check("D: a parent id that names no row is refused by the schema", refused);
      } finally {
        db.close();
      }
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\ntask follow-up migration tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main();
