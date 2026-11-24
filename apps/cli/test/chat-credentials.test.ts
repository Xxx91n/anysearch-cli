// #370 — one `ans chat` parses the user credential file once.
//
// The command needs that file for two jobs: the search arms' keys and the model
// key. Before #370 it parsed the file at both, so ONE broken file printed the
// same fault twice — the kernel's `[anysearch] …` line followed by the LLM
// resolver's `[config] …` line. This drives the real `runChat` against a broken
// file and counts the sentences, which is the behaviour the user sees.
//
// It imports `runChat` directly, which chat-memory-wiring.test.ts avoids for its
// own reasons; under this package's tsx test lane the ESM-only pi runtime loads
// fine, and the command fails before anything that needs a live model.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChat } from "../src/commands/chat.js";
import { createPersistentEngine } from "../src/db.js";
import { readUserCredentials } from "@anysearch-cli/store";

const dir = mkdtempSync(join(tmpdir(), "ans-370-chat-"));
mkdirSync(join(dir, ".ans"), { recursive: true });
writeFileSync(join(dir, ".ans", "credentials.json"), "not json", "utf8");

// One list per purpose, and the restore list is their union: a key added in one
// place cannot leave the other behind.
//
// PINNED keeps this run on the temp root and gives the model resolver a
// provider/model without a key — exactly the state that makes it consult the
// credential file. REMOVED takes away everything that would let a resolver find
// a key (or a domain setting) somewhere else instead.
const PINNED: Record<string, string> = {
  USERPROFILE: dir,
  HOME: dir,
  ANS_DB_PATH: join(dir, "anysearch.db"),
  ANS_LLM_PROVIDER: "anthropic",
  ANS_LLM_MODEL: "claude-sonnet-4-6",
};
const REMOVED = [
  "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANS_LLM_API_KEY", "ANS_LLM_BASE_URL", "ANS_LLM_API",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY",
  // pi-ai reads these two as well, and any usable key would stop the model
  // resolver from consulting the credential file at all.
  "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN",
];
const TOUCHED = [...Object.keys(PINNED), ...REMOVED];
const previousEnv: Record<string, string | undefined> = {};
for (const key of TOUCHED) previousEnv[key] = process.env[key];
Object.assign(process.env, PINNED);
for (const key of REMOVED) delete process.env[key];

test.after(() => {
  for (const key of TOUCHED) {
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
    // No model key anywhere and no registered task, so the run stops at its
    // task-budget gate without a provider call. That is enough: both places that
    // used to parse the credential file are behind this point.
    await runChat(["-p", "hello"]);
  } finally {
    (process.stderr as any).write = realErr;
  }
  const reports = err.split("not valid JSON").length - 1;
  assert.equal(reports, 1, `凭据文件的故障应当只说一次，实际说了 ${reports} 次:\n${err}`);
});

// The half the chat test cannot see: the search arms must take the caller's
// parse, not read the file again behind it. The key below exists ONLY in the
// handed-in result, so an arm that shows up as "user" proves the injection; the
// file on disk is still the broken one, so a second read would also print its
// fault here.
test("the engine's search arms use the caller's parse, not a second read", () => {
  const realErr = process.stderr.write.bind(process.stderr);
  let err = "";
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  let engine;
  try {
    engine = createPersistentEngine(undefined, {
      domainDeclared: false,
      credentialsFile: { bindings: [{ provider: "exa", endpoint: null, apiKey: "only-in-the-parsed-result" }] },
    });
  } finally {
    (process.stderr as any).write = realErr;
  }
  assert.equal(engine.credentialSources?.exa, "user");
  assert.equal(err.split("not valid JSON").length - 1, 0, `引擎不该自己去读那份坏文件:
${err}`);
});

test("a pre-parsed broken file still reaches the engine record", () => {
  // #533: chat hands the engine the parse it already made, so the resolver stays
  // silent (which the test above pins). Silence must not extend to the record:
  // the fault is the only thing that tells a host the three `none` labels are
  // not "never configured".
  const file = readUserCredentials({ home: dir });
  assert.equal(file.fault?.kind, "not-json", "the fixture really is a broken file");
  const engine = createPersistentEngine(undefined, { domainDeclared: false, credentialsFile: file });
  const sources = engine.credentialSources;
  assert.equal(sources?.status, "resolved");
  assert.equal(
    sources?.status === "resolved" ? sources.credentialFileFault?.kind : undefined,
    "not-json",
    "the pre-parsed path carries the classified fault",
  );
});
