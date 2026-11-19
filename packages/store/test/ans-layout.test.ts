import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db";
import { ansLayoutMarkerPath, ensureAnsLayout, readAnsLayoutRecord } from "../src/ans-layout";
import { ansPiSessionsDir } from "../src/ans-paths";

function sandbox(): { home: string; env: NodeJS.ProcessEnv; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ans-layout-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return {
    home,
    env: { USERPROFILE: home, HOME: home },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

function seedDatabase(path: string, value: string): void {
  const db = openDatabase(path);
  try {
    db.exec("CREATE TABLE marker (value TEXT NOT NULL)");
    db.prepare("INSERT INTO marker (value) VALUES (?)").run(value);
  } finally {
    db.close();
  }
}

function readMarkerValue(path: string): string {
  const db = openDatabase(path, { readonly: true });
  try {
    return (db.prepare("SELECT value FROM marker").get() as { value: string }).value;
  } finally {
    db.close();
  }
}

test("a fresh install has nothing to move and does not create ~/.ans", () => {
  const box = sandbox();
  try {
    assert.equal(ensureAnsLayout(box.env, () => {}), undefined);
    assert.equal(existsSync(join(box.home, ".ans")), false, "no marker directory for a no-op");
  } finally { box.done(); }
});

test("both pre-#323 families move into ~/.ans and the emptied directories go away", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=research\n");
    mkdirSync(join(box.home, ".anysearch-cli", "skills", "synced"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch-cli", "server-token"), "token-1\n");
    writeFileSync(join(box.home, ".anysearch-cli", "skills", "synced", "installed.json"), "{}\n");

    const record = ensureAnsLayout(box.env, () => {});
    assert.ok(record);
    assert.deepEqual(record.pending, []);
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=research\n");
    assert.equal(readFileSync(join(box.home, ".ans", "server-token"), "utf8"), "token-1\n");
    assert.equal(readFileSync(join(box.home, ".ans", "skills", "synced", "installed.json"), "utf8"), "{}\n");
    assert.equal(existsSync(join(box.home, ".anysearch")), false, "the emptied data root is gone");
    assert.equal(existsSync(join(box.home, ".anysearch-cli")), false, "the emptied config root is gone");
    assert.ok(existsSync(ansLayoutMarkerPath(box.env)), "the outcome is recorded on disk");
  } finally { box.done(); }
});

test("a database is copied with SQLite's own backup and the old file is kept", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    const legacyDb = join(box.home, ".anysearch", "anysearch.db");
    seedDatabase(legacyDb, "history");

    const record = ensureAnsLayout(box.env, () => {});
    assert.ok(record);
    assert.deepEqual(record.pending, []);
    assert.deepEqual(record.moved.map((m) => m.how), ["snapshot"]);
    assert.equal(readMarkerValue(join(box.home, ".ans", "anysearch.db")), "history");
    assert.ok(existsSync(legacyDb), "the pre-upgrade copy stays until the operator deletes it");
  } finally { box.done(); }
});

test("the kept pre-upgrade database copy is not reported as a conflict on later runs", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    seedDatabase(join(box.home, ".anysearch", "anysearch.db"), "history");
    ensureAnsLayout(box.env, () => {});

    const warnings: string[] = [];
    const second = ensureAnsLayout(box.env, (m) => warnings.push(m));
    assert.ok(second);
    assert.deepEqual(second.pending, [], "the old file is the copy we chose to keep");
    assert.deepEqual(warnings, [], "and it is not re-reported every run");
    assert.equal(second.moved.length, 1, "the record of what moved survives");
  } finally { box.done(); }
});

test("a database that cannot be copied does not take the rest of the move down with it", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch", "pi-sessions"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "pi-sessions", "record.jsonl"), "{}\n");
    // Not a database: VACUUM INTO cannot read it, so the copy must fail.
    writeFileSync(join(box.home, ".anysearch", "anysearch.db"), "not a database");

    const record = ensureAnsLayout(box.env, () => {});
    assert.ok(record);
    assert.equal(record.pending.length, 1, "the database is reported, not silently skipped");
    assert.match(record.pending[0]!.path, /anysearch\.db$/);
    assert.ok(existsSync(join(box.home, ".ans", "pi-sessions", "record.jsonl")), "the rest still moved");
    assert.equal(
      ansPiSessionsDir(box.env),
      join(box.home, ".ans", "pi-sessions"),
      "history is read from where it actually is, not from beside the database that stayed",
    );
  } finally { box.done(); }
});

test("a project's pre-#323 directories move on the first run in that project", () => {
  const box = sandbox();
  try {
    const cwd = join(box.home, "work");
    mkdirSync(join(cwd, ".anysearch"), { recursive: true });
    writeFileSync(join(cwd, ".anysearch", "config.toml"), "[llm]\n");
    mkdirSync(join(cwd, ".anysearch-cli"), { recursive: true });
    writeFileSync(join(cwd, ".anysearch-cli", "policy.json"), "{}\n");

    ensureAnsLayout(box.env, () => {}, cwd);
    assert.equal(readFileSync(join(cwd, ".ans", "config.toml"), "utf8"), "[llm]\n");
    assert.equal(readFileSync(join(cwd, ".ans", "policy.json"), "utf8"), "{}\n");
    assert.equal(existsSync(join(cwd, ".anysearch")), false);
    assert.equal(existsSync(join(cwd, ".anysearch-cli")), false);
  } finally { box.done(); }
});

test("a name that already exists in ~/.ans is kept and reported, never overwritten", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".ans"), { recursive: true });
    writeFileSync(join(box.home, ".ans", "config.env"), "ANS_DOMAIN=new\n");
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=old\n");

    const warnings: string[] = [];
    const record = ensureAnsLayout(box.env, (m) => warnings.push(m));
    assert.ok(record);
    assert.equal(record.pending.length, 1);
    assert.match(record.pending[0]!.path, /\.anysearch/);
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=new\n");
    assert.equal(readFileSync(join(box.home, ".anysearch", "config.env"), "utf8"), "ANS_DOMAIN=old\n");
    assert.ok(warnings.some((w) => w.includes("没能搬进")), "the operator is told, not left guessing");
  } finally { box.done(); }
});

test("run from the home directory, the database is snapshotted and not renamed", () => {
  const box = sandbox();
  try {
    // In the home directory the project roots ARE the user roots. If the project
    // pass handled it, the database would be renamed out from under its -wal.
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    seedDatabase(join(box.home, ".anysearch", "anysearch.db"), "history");
    ensureAnsLayout(box.env, () => {}, box.home);

    assert.equal(readMarkerValue(join(box.home, ".ans", "anysearch.db")), "history");
    assert.ok(existsSync(join(box.home, ".anysearch", "anysearch.db")), "the pre-upgrade copy stays");
  } finally { box.done(); }
});

test("the home directory in another case is still the home directory", { skip: process.platform !== "win32" }, () => {
  const box = sandbox();
  try {
    // Windows answers to several spellings of one directory: another drive-letter
    // case, an 8.3 short name, a junction. A string comparison calls those
    // different, so the project pass claims the user roots — it moves the file
    // instead of the user pass, and the run then records nothing at all.
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=research\n");

    const record = ensureAnsLayout(box.env, () => {}, box.home.toUpperCase());
    assert.ok(record, "the user pass handled the home directory");
    assert.deepEqual(record.pending, []);
    assert.ok(
      record.moved.some((m) => m.from.endsWith("config.env") && m.how === "moved"),
      "the user pass is the one that moved it",
    );
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=research\n");
  } finally { box.done(); }
});

test("a junction to the home directory is still the home directory", { skip: process.platform !== "win32" }, () => {
  const box = sandbox();
  try {
    // USERPROFILE may itself be a junction while the shell sits in the real
    // directory. Both spellings are the same place, so the user pass owns the
    // old roots. Get it wrong and the project pass claims them, then tells the
    // operator their only database is a leftover they can delete.
    const realHome = join(box.home, "real");
    const link = join(box.home, "link");
    mkdirSync(realHome, { recursive: true });
    symlinkSync(realHome, link, "junction");
    mkdirSync(join(realHome, ".anysearch"), { recursive: true });
    writeFileSync(join(realHome, ".anysearch", "config.env"), "ANS_DOMAIN=research\n");

    const said: string[] = [];
    const record = ensureAnsLayout({ USERPROFILE: link, HOME: link }, (m) => said.push(m), realHome);
    assert.ok(record, "the user pass handled the home directory");
    assert.deepEqual(record.moved.map((m) => m.how), ["moved"]);
    assert.doesNotMatch(said.join(""), /没有搬/, "nothing was reported as a leftover");
    assert.equal(readFileSync(join(realHome, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=research\n");
  } finally { box.done(); }
});

test("an entry that stays unmoved is reported on every run, not just the first", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".ans"), { recursive: true });
    writeFileSync(join(box.home, ".ans", "config.env"), "ANS_DOMAIN=new\n");
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=old\n");

    // The record stops changing after the first run, so a "nothing changed"
    // shortcut placed before the warning would report the conflict once and
    // then say nothing while the file was still sitting there unmoved.
    const runs = [1, 2, 3].map(() => {
      const said: string[] = [];
      ensureAnsLayout(box.env, (message) => said.push(message));
      return said.join("");
    });
    assert.match(runs[0], /config\.env/);
    assert.match(runs[1], /config\.env/, "the second run still names the entry");
    assert.match(runs[2], /config\.env/, "and so does the third");
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=new\n");
  } finally { box.done(); }
});

test("a second run is a no-op once everything moved", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=research\n");
    ensureAnsLayout(box.env, () => {});
    const first = readAnsLayoutRecord(box.env);
    assert.ok(first);

    // A file written after the move must not be re-migrated or reported.
    writeFileSync(join(box.home, ".ans", "config.env"), "ANS_DOMAIN=docs\n");
    assert.equal(ensureAnsLayout(box.env, () => {}), undefined, "nothing left to move");
    assert.deepEqual(readAnsLayoutRecord(box.env), first, "the recorded outcome is unchanged");
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=docs\n");
  } finally { box.done(); }
});

test("an entry left behind is retried on the next run", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".ans"), { recursive: true });
    writeFileSync(join(box.home, ".ans", "config.env"), "ANS_DOMAIN=new\n");
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=old\n");
    ensureAnsLayout(box.env, () => {});

    // The operator resolves the conflict by hand; the next run finishes the job.
    rmSync(join(box.home, ".ans", "config.env"));
    const record = ensureAnsLayout(box.env, () => {});
    assert.ok(record);
    assert.deepEqual(record.pending, []);
    assert.equal(readFileSync(join(box.home, ".ans", "config.env"), "utf8"), "ANS_DOMAIN=old\n");
  } finally { box.done(); }
});

test("a database that appears in the old root after the move is still snapshotted", () => {
  const box = sandbox();
  try {
    // An empty pre-#323 root records "nothing to do" — and that record is not a
    // promise the root stays empty.
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    const first = ensureAnsLayout(box.env, () => {});
    assert.ok(first);
    assert.deepEqual(first.moved, []);
    assert.ok(existsSync(ansLayoutMarkerPath(box.env)));

    // Something else on the machine writes a database there afterwards, such as
    // an older `ans` that still calls that directory home — it recreates the
    // directory the move deleted.
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    seedDatabase(join(box.home, ".anysearch", "anysearch.db"), "late");

    const record = ensureAnsLayout(box.env, () => {});
    assert.ok(record);
    assert.deepEqual(record.pending, []);
    assert.ok(record.moved.some((m) => m.how === "snapshot"), "the late database is carried over as a snapshot");
    assert.equal(readMarkerValue(join(box.home, ".ans", "anysearch.db")), "late");
    assert.equal(
      readMarkerValue(join(box.home, ".anysearch", "anysearch.db")),
      "late",
      "the old file stays where it is, as the pre-upgrade copy",
    );
  } finally { box.done(); }
});
