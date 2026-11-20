import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ANS_DIR_NAME,
  LEGACY_CONFIG_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  ansAttributionRoot,
  ansDbPath,
  ansUserSkillsDirFor,
} from "../src/ans-paths";

// The release scripts cannot import TypeScript, so `scripts/ans-home.mjs` is a
// hand-kept copy of the same two rules. A copy nobody checks is a second answer:
// a rename on one side and not the other would have the gate inspect one
// database while the product reads another. This recomputes both sides in one
// sandbox, so drift fails here instead of in production.
interface AnsHomeModule {
  resolveHome(env: NodeJS.ProcessEnv): string;
  ansDbPath(env: NodeJS.ProcessEnv): string;
  ansDataDirPath(name: string, env: NodeJS.ProcessEnv): string;
  ansAttributionRoot(env: NodeJS.ProcessEnv): string;
  NEW_DIR: string;
  LEGACY_DATA_DIR: string;
  LEGACY_CONFIG_DIR: string;
}

const modulePath = new URL("../../../scripts/ans-home.mjs", import.meta.url).href;
const ansHome = (await import(modulePath)) as AnsHomeModule;

function sandbox(): { home: string; env: NodeJS.ProcessEnv; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ans-home-parity-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return {
    home,
    env: { USERPROFILE: home, HOME: home },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("the scripts' directory names are the product's", () => {
  assert.equal(ansHome.NEW_DIR, ANS_DIR_NAME);
  assert.equal(ansHome.LEGACY_DATA_DIR, LEGACY_DATA_DIR_NAME);
  assert.equal(ansHome.LEGACY_CONFIG_DIR, LEGACY_CONFIG_DIR_NAME);
});

test("both sides answer the database path the same way, in every layout", () => {
  const box = sandbox();
  try {
    assert.equal(ansHome.ansDbPath(box.env), ansDbPath(box.env), "fresh install");

    mkdirSync(join(box.home, LEGACY_DATA_DIR_NAME), { recursive: true });
    writeFileSync(join(box.home, LEGACY_DATA_DIR_NAME, "anysearch.db"), "legacy");
    assert.equal(ansHome.ansDbPath(box.env), ansDbPath(box.env), "before the move");

    mkdirSync(join(box.home, ANS_DIR_NAME), { recursive: true });
    writeFileSync(join(box.home, ANS_DIR_NAME, "anysearch.db"), "new");
    assert.equal(ansHome.ansDbPath(box.env), ansDbPath(box.env), "after the move");
    assert.equal(ansHome.ansDbPath(box.env), join(box.home, ".ans", "anysearch.db"));
  } finally { box.done(); }
});

test("a data-root directory falls back to the data root only", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, LEGACY_DATA_DIR_NAME, "attribution-gold-revisions"), { recursive: true });
    assert.equal(
      ansHome.ansDataDirPath("attribution-gold-revisions", box.env),
      join(box.home, ".anysearch", "attribution-gold-revisions"),
    );

    // Nothing the product reads lives under `.anysearch-cli` for this name, so a
    // copy there must be ignored rather than preferred.
    rmSync(join(box.home, LEGACY_DATA_DIR_NAME), { recursive: true, force: true });
    mkdirSync(join(box.home, LEGACY_CONFIG_DIR_NAME, "attribution-gold-revisions"), { recursive: true });
    assert.equal(
      ansHome.ansDataDirPath("attribution-gold-revisions", box.env),
      join(box.home, ".ans", "attribution-gold-revisions"),
      "the config family's old root is not this directory's old home",
    );
  } finally { box.done(); }
});

test("the attribution root agrees, including its legacy fallback", () => {
  const box = sandbox();
  try {
    assert.equal(ansHome.ansAttributionRoot(box.env), ansAttributionRoot(box.env));

    mkdirSync(join(box.home, LEGACY_DATA_DIR_NAME, "attribution-gold-revisions"), { recursive: true });
    assert.equal(ansHome.ansAttributionRoot(box.env), ansAttributionRoot(box.env));
    assert.equal(
      ansHome.ansAttributionRoot(box.env),
      join(box.home, ".anysearch", "attribution-gold-revisions"),
      "the old location is read while it is the only one",
    );

    // `.anysearch-cli/attribution-gold-revisions` is not a location the product
    // ever used; a copy there must not become the scripts' answer.
    rmSync(join(box.home, LEGACY_DATA_DIR_NAME), { recursive: true, force: true });
    mkdirSync(join(box.home, LEGACY_CONFIG_DIR_NAME, "attribution-gold-revisions"), { recursive: true });
    assert.equal(ansHome.ansAttributionRoot(box.env), ansAttributionRoot(box.env));
    assert.equal(ansHome.ansAttributionRoot(box.env), join(box.home, ".ans", "attribution-gold-revisions"));
  } finally { box.done(); }
});