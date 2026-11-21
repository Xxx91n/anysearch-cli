// #370 — one `ans chat` parses the user credential file once.
//
// The command needs that file for two jobs: the search arms' keys and the model
// key. Before #370 it parsed the file at both, so ONE broken file printed the
// same fault twice — the kernel's `[anysearch] …` line followed by the LLM
// resolver's `[config] …` line. This drives the real `runChat` against a broken
// file and counts the sentences, which is the behaviour the user sees.
//
// Run: node --import tsx --test test/chat-credentials.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChat } from "../src/commands/chat.js";

const dir = mkdtempSync(join(tmpdir(), "ans-370-chat-"));
mkdirSync(join(dir, ".ans"), { recursive: true });
writeFileSync(join(dir, ".ans", "credentials.json"), "not json", "utf8");

// A provider/model from the env is what makes the model resolver reach for the
// credential file at all: with a model key in the env it never reads the file.
const ENV_KEYS = [
  "USERPROFILE", "HOME", "ANS_DB_PATH", "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_API_KEY", "ANS_LLM_BASE_URL", "ANS_LLM_API",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
];
const previousEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
process.env.USERPROFILE = dir;
process.env.HOME = dir;
process.env.ANS_DB_PATH = join(dir, "anysearch.db");
process.env.ANS_LLM_PROVIDER = "anthropic";
process.env.ANS_LLM_MODEL = "claude-sonnet-4-6";
delete process.env.ANS_DOMAIN;
delete process.env.ANS_DOMAINS_DIR;
for (const key of ["ANS_LLM_API_KEY", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
  delete process.env[key];
}

test.after(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});

test("a broken credential file is reported once per `ans chat`", async () => {
  const realErr = process.stderr.write.bind(process.stderr);
  let err = "";
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    // No model key anywhere, so the run stops right after config resolution.
    // That is enough: every parse of the credential file happens before it, and
    // the run's later exit code is not what this test is about.
    await runChat(["-p", "hello"]);
  } finally {
    (process.stderr as any).write = realErr;
  }
  const reports = err.split("not valid JSON").length - 1;
  assert.equal(reports, 1, `凭据文件的故障应当只说一次，实际说了 ${reports} 次:\n${err}`);
});
