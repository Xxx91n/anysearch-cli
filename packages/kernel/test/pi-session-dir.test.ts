// resolvePiSessionDir's three branches (#258):
//   D1 an explicit ANS_PI_SESSION_DIR wins over everything;
//   D2 a named database keeps its records beside it;
//   D3 otherwise the records live under the layout root.
// Plus the trim rule: a blank ANS_DB_PATH counts as unset, because it comes from
// the same shared resolver the layout uses.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ansPiSessionsDir } from "@anysearch-cli/store";
import { resolvePiSessionDir } from "../src/pi-session";

const home = { USERPROFILE: join("work", "home"), HOME: join("work", "home") };

test("an explicit session directory wins over the database", () => {
  const env = { ...home, ANS_PI_SESSION_DIR: join("work", "sessions"), ANS_DB_PATH: join("work", "db", "any.db") };
  assert.equal(resolvePiSessionDir(env), join("work", "sessions"));
});

test("a named database keeps its records beside it", () => {
  const env = { ...home, ANS_DB_PATH: join("work", "db", "any.db") };
  assert.equal(resolvePiSessionDir(env), join("work", "db", "pi-sessions"));
});

test("without either, the records live under the layout root", () => {
  assert.equal(resolvePiSessionDir(home), ansPiSessionsDir(home));
});

test("a blank database path counts as unset", () => {
  const env = { ...home, ANS_DB_PATH: "   " };
  assert.equal(resolvePiSessionDir(env), ansPiSessionsDir(env));
});
