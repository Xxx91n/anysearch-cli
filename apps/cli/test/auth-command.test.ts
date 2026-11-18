// #301 acceptance — `ans auth` stores a key once and never shows it back.
//
// Driven through the real command function with a piped stdin (the documented
// scripted path), so the assertions cover what a user actually runs. The typed
// path is covered by readSecret's own logic, which is exercised through the pipe
// branch here plus the raw-mode branch in the manual smoke step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAuth, AUTH_INTERNALS, AUTH_IO } from "../src/commands/auth";
import { readUserCredentials, resolveLlmConfig, userCredentialsPath } from "../src/config-llm";

const KEY = "sk-cli-entered-key-0123456789abcdef";

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ans-301-cli-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/**
 * Capture stdout/stderr while running fn, with the secret fed through the
 * command's stdin seam. `input` stands for what a pipe would deliver.
 */
async function capture(
  fn: () => Promise<number>,
  input?: string,
): Promise<{ code: number; out: string }> {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let out = "";
  const sink = (chunk: unknown) => { out += String(chunk); return true; };
  process.stdout.write = sink as typeof process.stdout.write;
  process.stderr.write = sink as typeof process.stderr.write;

  const { PassThrough } = await import("node:stream");
  const previous = AUTH_IO.input;
  if (input !== undefined) {
    const stream = new PassThrough();
    stream.end(input);
    AUTH_IO.input = stream as typeof AUTH_IO.input;
  } else {
    AUTH_IO.input = undefined;
  }
  try {
    const code = await fn();
    return { code, out };
  } finally {
    AUTH_IO.input = previous;
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("ans auth set stores the piped key and prints no part of it", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code, out } = await capture(() => runAuth(["set", "openai"]), KEY + "\n");
    assert.equal(code, 0, out);
    const stored = readUserCredentials();
    assert.equal(stored.bindings.length, 1);
    assert.equal(stored.bindings[0]?.apiKey, KEY);
    assert.equal(stored.bindings[0]?.provider, "openai");
    // The confirmation may name the file and the provider, never the key.
    assert.ok(!out.includes(KEY), "the key must not be echoed back");
    assert.ok(!out.includes(KEY.slice(-6)), "not even the tail is printed on write");
    assert.match(out, /PLAIN TEXT/);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("ans auth list shows the binding and only the last four characters", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await capture(() => runAuth(["set", "anthropic"]), KEY + "\n");
    const { code, out } = await capture(() => runAuth(["list"]));
    assert.equal(code, 0, out);
    assert.ok(!out.includes(KEY), "list never prints the whole key");
    assert.ok(out.includes(KEY.slice(-4)), "the tail helps tell two keys apart");
    assert.match(out, /provider default endpoint/);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("ans auth set --endpoint binds a model key to that endpoint", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code } = await capture(
      () => runAuth(["set", "openai", "--endpoint", "https://gw.example/v1"]),
      KEY + "\n",
    );
    assert.equal(code, 0);
    const stored = readUserCredentials();
    assert.equal(stored.bindings[0]?.endpoint, "https://gw.example/v1");

    // The resolver honours that binding: a config pointing at the same endpoint
    // gets the key, the default endpoint does not.
    const same = resolveLlmConfig({
      env: {}, home, cwd: home,
      flags: { provider: "openai", model: "m", baseUrl: "https://gw.example/v1/", api: "chat" },
      warn: () => {},
    });
    assert.equal(same.apiKey, KEY);
    const other = resolveLlmConfig({
      env: {}, home, cwd: home,
      flags: { provider: "openai", model: "m", baseUrl: "https://elsewhere.example/v1", api: "chat" },
      warn: () => {},
    });
    assert.equal(other.apiKey, undefined);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("a search provider cannot take an --endpoint binding", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code, out } = await capture(
      () => runAuth(["set", "tavily", "--endpoint", "https://x.example"]),
      KEY + "\n",
    );
    assert.equal(code, 2, out);
    assert.match(out, /only applies to model providers/);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("multi-line input is refused instead of stored", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code, out } = await capture(() => runAuth(["set", "openai"]), "sk-one\nsk-two\n");
    assert.equal(code, 2, out);
    assert.match(out, /more than one line/);
    assert.equal(readUserCredentials().bindings.length, 0, "nothing was written");
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("ans auth remove drops one key and reports when there was none", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await capture(() => runAuth(["set", "openai"]), KEY + "\n");
    const first = await capture(() => runAuth(["remove", "openai"]));
    assert.equal(first.code, 0, first.out);
    assert.equal(readUserCredentials().bindings.length, 0);
    assert.equal(userCredentialsPath(), join(home, ".anysearch-cli", "credentials.json"));

    const again = await capture(() => runAuth(["remove", "openai"]));
    assert.equal(again.code, 1, again.out);
    assert.match(again.out, /Nothing stored/);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("status names the effective source per provider without printing values", async () => {
  const { home, cleanup } = tempHome();
  const saved: Record<string, string | undefined> = {};
  for (const key of ["HOME", "USERPROFILE", "EXA_API_KEY", "ANS_LLM_API_KEY"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await capture(() => runAuth(["set", "exa"]), KEY + "\n");
    process.env.EXA_API_KEY = "exa-from-env";
    const { out } = await capture(() => runAuth([]));
    assert.match(out, /\[SET\]\s+exa\s+env EXA_API_KEY/);
    // The stored exa key is still there, but env wins and the output says so.
    assert.ok(!out.includes(KEY));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    cleanup();
  }
});

test("maskTail never reveals a short key", () => {
  assert.equal(AUTH_INTERNALS.maskTail("short"), "…");
  assert.equal(AUTH_INTERNALS.maskTail("0123456789ab"), "…");
  const masked = AUTH_INTERNALS.maskTail(KEY);
  assert.ok(masked.endsWith(KEY.slice(-4)));
  assert.ok(!masked.includes(KEY.slice(0, 8)));
});
