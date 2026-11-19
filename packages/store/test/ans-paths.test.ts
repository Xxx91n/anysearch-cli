import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ansConfigEnvPath,
  ansCredentialsPathFor,
  ansDbPath,
  ansHomeDir,
  ansProjectConfigPath,
  ansProjectDir,
  ansProjectHitlPath,
  ansProjectIndexDbPath,
  ansProjectPolicyPath,
  ansProjectRoutingCardPath,
  ansProjectSkillsDir,
  ansServerTokenPath,
  ansSessionPath,
  ansUserConfigPathFor,
  ansUserSkillsDirFor,
  legacyHomeDirs,
  legacyProjectDirs,
} from "../src/ans-paths";

function sandbox(): { home: string; cwd: string; env: NodeJS.ProcessEnv; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ans-paths-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return {
    home,
    cwd,
    env: { USERPROFILE: home, HOME: home },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("a fresh install resolves every file under .ans, user and project", () => {
  const box = sandbox();
  try {
    assert.equal(ansHomeDir(box.env), join(box.home, ".ans"));
    assert.equal(ansProjectDir(box.cwd), join(box.cwd, ".ans"));
    assert.equal(ansDbPath(box.env), join(box.home, ".ans", "anysearch.db"));
    assert.equal(ansProjectIndexDbPath(box.env), join(box.home, ".ans", "project-index.db"));
    assert.equal(ansConfigEnvPath(box.env), join(box.home, ".ans", "config.env"));
    assert.equal(ansUserConfigPathFor(box.home), join(box.home, ".ans", "config.toml"));
    assert.equal(ansCredentialsPathFor(box.home), join(box.home, ".ans", "credentials.json"));
    assert.equal(ansServerTokenPath(box.env), join(box.home, ".ans", "server-token"));
    assert.equal(ansSessionPath(box.env), join(box.home, ".ans", "session"));
    assert.equal(ansUserSkillsDirFor(box.home), join(box.home, ".ans", "skills"));
    assert.equal(ansProjectConfigPath(box.cwd), join(box.cwd, ".ans", "config.toml"));
    assert.equal(ansProjectSkillsDir(box.cwd), join(box.cwd, ".ans", "skills"));
    assert.equal(ansProjectPolicyPath(box.cwd), join(box.cwd, ".ans", "policy.json"));
    assert.equal(ansProjectHitlPath(box.cwd), join(box.cwd, ".ans", "hitl.pending"));
    assert.equal(ansProjectRoutingCardPath(box.cwd), join(box.cwd, ".ans", "routing-card.json"));
  } finally { box.done(); }
});

test("a file that only exists under the pre-#323 name is still read", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch", "anysearch.db"), "");
    writeFileSync(join(box.home, ".anysearch", "config.env"), "ANS_DOMAIN=research\n");
    mkdirSync(join(box.home, ".anysearch-cli"), { recursive: true });
    writeFileSync(join(box.home, ".anysearch-cli", "server-token"), "old-token\n");
    writeFileSync(join(box.home, ".anysearch-cli", "config.toml"), "");
    mkdirSync(join(box.cwd, ".anysearch"), { recursive: true });
    writeFileSync(join(box.cwd, ".anysearch", "config.toml"), "");
    mkdirSync(join(box.cwd, ".anysearch-cli"), { recursive: true });
    writeFileSync(join(box.cwd, ".anysearch-cli", "policy.json"), "{}");

    assert.equal(ansDbPath(box.env), join(box.home, ".anysearch", "anysearch.db"));
    assert.equal(ansConfigEnvPath(box.env), join(box.home, ".anysearch", "config.env"));
    assert.equal(ansServerTokenPath(box.env), join(box.home, ".anysearch-cli", "server-token"));
    assert.equal(ansUserConfigPathFor(box.home), join(box.home, ".anysearch-cli", "config.toml"));
    assert.equal(ansProjectConfigPath(box.cwd), join(box.cwd, ".anysearch", "config.toml"));
    assert.equal(ansProjectPolicyPath(box.cwd), join(box.cwd, ".anysearch-cli", "policy.json"));
  } finally { box.done(); }
});

test("the new name wins once both exist, so a finished move is not undone", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, ".ans"), { recursive: true });
    mkdirSync(join(box.home, ".anysearch"), { recursive: true });
    writeFileSync(join(box.home, ".ans", "anysearch.db"), "new");
    writeFileSync(join(box.home, ".anysearch", "anysearch.db"), "old");
    assert.equal(ansDbPath(box.env), join(box.home, ".ans", "anysearch.db"));
  } finally { box.done(); }
});

test("the legacy roots are the two pre-#323 families, data first", () => {
  const box = sandbox();
  try {
    assert.deepEqual(legacyHomeDirs(box.env), [
      join(box.home, ".anysearch"),
      join(box.home, ".anysearch-cli"),
    ]);
    assert.deepEqual(legacyProjectDirs(box.cwd), [
      join(box.cwd, ".anysearch"),
      join(box.cwd, ".anysearch-cli"),
    ]);
  } finally { box.done(); }
});
