// #301 acceptance — `ans auth` stores a key once and never shows it back.
//
// Driven through the real command function with a piped stdin (the documented
// scripted path), so the assertions cover what a user actually runs. The typed
// path is covered by readSecret's own logic, which is exercised through the pipe
// branch here plus the raw-mode branch in the manual smoke step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAuth, AUTH_INTERNALS, AUTH_IO } from "../src/commands/auth";
import { readUserCredentials, resolveLlmConfig, userCredentialsPath } from "../src/config-llm";
import { credentialProtectionSeam } from "@anysearch-cli/store";

const KEY = "sk-cli-entered-key-0123456789abcdef";

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ans-301-cli-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/**
 * Capture the command's output while running fn, with the secret fed through the
 * command's own IO seam. `input` stands for what a pipe would deliver.
 *
 * The sinks are the command's seam, not process.stdout/process.stderr: patching
 * those globals inside a node --test file desyncs the reporter, and later test
 * results disappear from the output entirely (#442 found this file reporting 7
 * of its 13 tests).
 */
async function capture(
  fn: () => Promise<number>,
  input?: string,
): Promise<{ code: number; out: string }> {
  let out = "";
  const previous = { input: AUTH_IO.input, output: AUTH_IO.output, stdout: AUTH_IO.stdout, stderr: AUTH_IO.stderr };
  AUTH_IO.stdout = (text) => { out += text; };
  AUTH_IO.stderr = (text) => { out += text; };

  const { PassThrough } = await import("node:stream");
  if (input !== undefined) {
    const prompt = new PassThrough();
    prompt.on("data", (chunk) => { out += String(chunk); });
    AUTH_IO.output = prompt as typeof AUTH_IO.output;
    const stream = new PassThrough();
    stream.end(input);
    AUTH_IO.input = stream as typeof AUTH_IO.input;
  } else {
    AUTH_IO.output = undefined;
    AUTH_IO.input = undefined;
  }
  try {
    const code = await fn();
    return { code, out };
  } finally {
    AUTH_IO.input = previous.input;
    AUTH_IO.output = previous.output;
    AUTH_IO.stdout = previous.stdout;
    AUTH_IO.stderr = previous.stderr;
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

test("ans auth list shows the binding and nothing of the key", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await capture(() => runAuth(["set", "anthropic"]), KEY + "\n");
    const { code, out } = await capture(() => runAuth(["list"]));
    assert.equal(code, 0, out);
    // Spec S2: a secret must not appear in terminal output — not even a suffix
    // of it, which is still part of the secret.
    assert.ok(!out.includes(KEY), "list never prints the whole key");
    assert.ok(!out.includes(KEY.slice(-4)), "list does not print a suffix of the key either");
    assert.match(out, /anthropic/);
    assert.match(out, /provider default endpoint/, "the binding is what the user needs to see");
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("ans auth list 打印文件里的 provider 时也过一遍清洗，控制字符和长度都挡住（#550）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const esc = String.fromCharCode(27);
      const nasty = "exa" + esc + "[2K" + "x".repeat(200);
      writeCredentials(home, JSON.stringify({ bindings: [{ provider: nasty, apiKey: KEY }] }));

      const { code, out } = await capture(() => runAuth(["list"]));
      assert.equal(code, 0, out);
      // Every byte below 0x20 except the line feed that ends each printed line.
      const control = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(9) +
        String.fromCharCode(11) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]");
      assert.ok(!control.test(out), "no control characters reached the terminal：" + JSON.stringify(out));
      const line = out.split("\n").find((l) => l.includes("exa")) ?? "";
      assert.ok(line.length <= 60, "the label is bounded：" + JSON.stringify(line));
    });
  } finally {
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
    assert.equal(userCredentialsPath(), join(home, ".ans", "credentials.json"));

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

test("a broken credential file is one line in `ans auth status`, not a [config] and a [WARN]", async () => {
  // #357: status used to read the file three times - the search resolver, the
  // model resolver and the report itself - so the same fault printed a
  // `[config] …` line and a `[WARN] …` line. Now the command parses once and
  // says the fault itself, once.
  const { home, cleanup } = tempHome();
  const saved: Record<string, string | undefined> = {};
  for (const key of ["HOME", "USERPROFILE", "EXA_API_KEY", "ANS_LLM_API_KEY", "ANS_LLM_PROVIDER", "ANS_LLM_MODEL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(join(home, ".ans", "credentials.json"), "not json", "utf8");

    const { code, out } = await capture(() => runAuth([]));
    // #537: a broken file is a failure. Exit 0 made a script unable to tell it
    // from a healthy run, while `ans doctor` and `set`/`remove` already failed.
    assert.equal(code, 1, out);
    const faultLines = out.split("\n").filter((line) => line.includes("not valid JSON"));
    assert.equal(faultLines.length, 1, "同一份文件故障只说一次：" + out);
    assert.match(faultLines[0]!, /^\[WARN\] /);

    // `list` says it next to the file block instead of in the status block, and
    // still only once.
    const listed = await capture(() => runAuth(["list"]));
    assert.equal(listed.code, 1, listed.out);
    assert.equal(
      listed.out.split("\n").filter((line) => line.includes("not valid JSON")).length,
      1,
      "list 不再把同一句说两遍：" + listed.out,
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    cleanup();
  }
});

/**
 * Every env name a provider key can arrive under. Sweeping all of them keeps the
 * status table honest on a machine that happens to export one: a leaked
 * `EXA_API_KEY` would turn an `[EMPTY]`/`[BROKEN]` row into `[SET] env …` and the
 * assertion would be about the operator's shell, not about the file (#537).
 */
const CREDENTIAL_ENV_KEYS = [
  "HOME", "USERPROFILE", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
  "TAVILY_API_KEY", "EXA_API_KEY", "ANYSEARCH_API_KEY",
  "ANS_LLM_API_KEY", "ANS_LLM_PROVIDER", "ANS_LLM_MODEL",
];

async function withoutCredentialEnv<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of CREDENTIAL_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // Set the config root AFTER the sweep: HOME is in the list above, so assigning
  // it before the loop would delete the very override the test needs.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

/** A file that holds one usable key and one record that cannot be trusted. */
const MIXED_FILE = JSON.stringify({
  bindings: [
    { provider: "openai", apiKey: KEY },
    { provider: "anthropic" },
  ],
});

function writeCredentials(home: string, content: string): string {
  mkdirSync(join(home, ".ans"), { recursive: true });
  const path = join(home, ".ans", "credentials.json");
  writeFileSync(path, content, "utf8");
  return path;
}

test("ans auth 坏文件时，文件里还有 key 的那家不再报 not set（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      writeCredentials(home, MIXED_FILE);

      const { code, out } = await capture(() => runAuth([]));
      assert.equal(code, 1, out);
      // The lie this ticket is about: the openai key is still in the file, so
      // "not set" describes a state nobody observed.
      assert.doesNotMatch(out, /\[EMPTY\]/, "坏文件时不能说某家没配：" + out);
      assert.match(out, /\[BROKEN\]\s+openai\s+unknown/, out);
      // One sentence, one place: the read no longer repeats its own advice. The
      // count ignores case, because the duplicate that shipped was the capitalised
      // "Fix or remove..." printed beside store's lowercase one.
      assert.equal((out.match(/fix or remove/gi) ?? []).length, 1, "同一句只说一次：" + out);

      // An env key is a fact that does not depend on the file, so it survives.
      process.env.EXA_API_KEY = "exa-from-env";
      const withEnv = await capture(() => runAuth([]));
      assert.equal(withEnv.code, 1, withEnv.out);
      assert.match(withEnv.out, /\[SET\]\s+exa\s+env EXA_API_KEY/, withEnv.out);
      assert.match(withEnv.out, /\[BROKEN\]\s+openai/, withEnv.out);
    });
  } finally {
    cleanup();
  }
});

test("ans auth set 在读文件那一步就失败，不提示输入、不联网验 key（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const path = writeCredentials(home, MIXED_FILE);

      const { code, out } = await capture(() => runAuth(["set", "exa"]), "sk-should-never-be-read\n");
      assert.equal(code, 1, out);
      assert.match(out, /not valid JSON|has no apiKey/, "报错要点名文件：" + out);
      assert.equal(out.includes("credentials.json"), true, out);
      // Neither the prompt nor the free-surface probe happens: a rejected key
      // would otherwise be blamed for a fault that belongs to the file.
      assert.doesNotMatch(out, /typing is hidden/, "坏文件时不该先问 key：" + out);
      assert.doesNotMatch(out, /against its free surface/, "坏文件时不该联网验 key：" + out);
      assert.equal(readFileSync(path, "utf8"), MIXED_FILE, "nothing was written");
    });
  } finally {
    cleanup();
  }
});

test("ans auth remove 在坏文件上说一次修法就停，不动文件（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const path = writeCredentials(home, MIXED_FILE);

      const { code, out } = await capture(() => runAuth(["remove", "exa"]));
      assert.equal(code, 1, out);
      assert.equal((out.match(/fix or remove/gi) ?? []).length, 1, "同一句只出现一次：" + out);
      // The store's own sentence carries the way out; the command adds the outcome
      // once and never a second wording of the same advice.
      assert.match(out, /removing it now would rebuild the file and drop the record it cannot read/, out);
      assert.match(out, /ans auth repair/, "the way out is named where the user reads it：" + out);
      assert.equal((out.match(/Nothing was changed/g) ?? []).length, 1, "文件没动只说一次：" + out);
      assert.equal(readFileSync(path, "utf8"), MIXED_FILE, "nothing was removed");
    });
  } finally {
    cleanup();
  }
});

test("ans auth repair 只丢坏条目，其他 key 一个不少，且不打印 key（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      writeCredentials(home, MIXED_FILE);

      const { code, out } = await capture(() => runAuth(["repair"]));
      assert.equal(code, 0, out);
      assert.match(out, /kept 1 key\(s\), dropped 1/, out);
      assert.match(out, /dropped: entry 2 \(anthropic\) has no apiKey/, out);
      assert.equal(out.includes(KEY), false, "repair 从不回显 key：" + out);

      const repaired = readUserCredentials({ home });
      assert.equal(repaired.error, undefined, "修完就不该再有 error");
      assert.equal(repaired.bindings.length, 1);
      assert.equal(repaired.bindings[0]?.provider, "openai");
      assert.equal(repaired.bindings[0]?.apiKey, KEY, "能读的 key 还在");

      // Repair on a healthy file is a no-op, byte for byte.
      const before = readFileSync(userCredentialsPath(home), "utf8");
      const again = await capture(() => runAuth(["repair"]));
      assert.equal(again.code, 0, again.out);
      assert.match(again.out, /nothing to repair/, again.out);
      assert.equal(readFileSync(userCredentialsPath(home), "utf8"), before);
    });
  } finally {
    cleanup();
  }
});

test("ans auth repair 遇到不是 JSON 的文件不猜，只说删了重存（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const path = writeCredentials(home, "{ not json");

      const { code, out } = await capture(() => runAuth(["repair"]));
      assert.equal(code, 1, out);
      assert.match(out, /not valid JSON/, out);
      assert.match(out, /remove the file and store the keys again/, out);

      // And the status line offers no repair for this file, because there is
      // nothing left for repair to keep.
      const status = await capture(() => runAuth([]));
      assert.equal(status.code, 1, status.out);
      assert.match(status.out, /fix or remove the file, then retry/, status.out);
      assert.doesNotMatch(status.out, /ans auth repair/, status.out);
      assert.equal(readFileSync(path, "utf8"), "{ not json", "文件原样不动");
    });
  } finally {
    cleanup();
  }
});

test("带 BOM 的凭据文件照常读，不因为记事本加的那个字节判成坏文件（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      // Notepad and PowerShell redirection both add this; JSON.parse rejects it.
      writeCredentials(home, "\uFEFF" + JSON.stringify({ bindings: [{ provider: "exa", apiKey: KEY }] }));

      const { code, out } = await capture(() => runAuth([]));
      assert.equal(code, 0, out);
      assert.match(out, /\[SET\]\s+exa\s+stored file/, out);
      assert.doesNotMatch(out, /BROKEN/, out);
    });
  } finally {
    cleanup();
  }
});

// The `statusLines` helper is the one piece of `runAuth` a test needs directly:
// it is what decides "where does this provider's key come from", and the point
// of that report is that it stays true for every source. It takes the config
// root as an argument, so a test gives it an empty one and no key can leak in
// from the operator's own home directory.
test("statusLines names the source for each provider and shows no key", () => {
  const { home, cleanup } = tempHome();
  try {
    const lines = AUTH_INTERNALS.statusLines({
      EXA_API_KEY: "exa-from-env",
      ANS_LLM_API_KEY: "sk-override",
      ANS_LLM_PROVIDER: "openai",
      ANS_LLM_MODEL: "gpt-5",
    }, home, readUserCredentials({ home }));
    const joined = lines.join("\n");
    assert.match(joined, /\[SET\]\s+exa\s+env EXA_API_KEY/);
    // The effective model key came from ANS_LLM_API_KEY, not from OPENAI_API_KEY,
    // and the report must not claim the wrong variable.
    assert.match(joined, /\[SET\]\s+openai\s+env ANS_LLM_API_KEY/);
    assert.match(joined, /\[EMPTY\]\s+anthropic/);
    assert.ok(!joined.includes("exa-from-env") && !joined.includes("sk-override"),
      "the status lines never carry a key value");
  } finally {
    cleanup();
  }
});

test("statusLines distinguishes the provider's own env var from the override", () => {
  const { home, cleanup } = tempHome();
  try {
    const lines = AUTH_INTERNALS.statusLines({
      OPENAI_API_KEY: "sk-provider-own",
      ANS_LLM_PROVIDER: "openai",
      ANS_LLM_MODEL: "gpt-5",
    }, home, readUserCredentials({ home }));
    assert.match(lines.join("\n"), /\[SET\]\s+openai\s+env OPENAI_API_KEY/);
  } finally {
    cleanup();
  }
});

test("--endpoint with an empty value is refused, not silently treated as the default", async () => {
  // Silently falling back would store the key bound somewhere the user did not
  // ask for, and they would find out only when auth stopped working elsewhere.
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    for (const args of [["set", "openai", "--endpoint="], ["set", "openai", "--endpoint", ""]]) {
      const { code, out } = await capture(() => runAuth(args), KEY + "\n");
      assert.equal(code, 2, "args " + JSON.stringify(args) + ": " + out);
      assert.match(out, /must not be empty/);
    }
    assert.equal(readUserCredentials().bindings.length, 0, "nothing was stored");
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("--endpoint followed by another flag is refused", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code, out } = await capture(() => runAuth(["set", "openai", "--endpoint", "--foo"]), KEY + "\n");
    assert.equal(code, 2, out);
    assert.match(out, /requires a URL/);
    assert.equal(readUserCredentials().bindings.length, 0);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

test("the endpoint shown on write and on remove carries no credentials", async () => {
  const { home, cleanup } = tempHome();
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const secretEndpoint = "https://user:s3cret@gw.example/v1?api_key=sk-in-url";
    const setRun = await capture(() => runAuth(["set", "openai", "--endpoint", secretEndpoint]), KEY + "\n");
    assert.equal(setRun.code, 0, setRun.out);
    assert.ok(!setRun.out.includes("s3cret"), "the password is not echoed: " + setRun.out);
    assert.ok(!setRun.out.includes("sk-in-url"), "the query secret is not echoed: " + setRun.out);

    const listed = await capture(() => runAuth(["list"]));
    assert.ok(!listed.out.includes("s3cret") && !listed.out.includes("sk-in-url"),
      "list shows the host, not the credentials: " + listed.out);

    const removed = await capture(() => runAuth(["remove", "openai", "--endpoint", secretEndpoint]));
    assert.equal(removed.code, 0, removed.out);
    assert.ok(!removed.out.includes("s3cret") && !removed.out.includes("sk-in-url"), removed.out);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
    cleanup();
  }
});

// ── #442: 存之前先验这把 key ────────────────────────────────────────────
//
// 只有 anysearch 有一个真产品杠杆（ANYSEARCH_ENDPOINT）能把探针指到本地假端点，
// 所以下面几条都打这条腿；tavily / exa 抄同一个函数的另一格，映射由
// packages/retriever/test/provider-probes.test.ts 钉着。

interface McpSeen {
  method: string;
  args?: Record<string, unknown>;
}

type AnySearchSurface = { callText: string } | { status: number };

/** 假 anysearch MCP：握手和 tools/list 都正常，空参数 tools/call 用 callText 说话。 */
async function withAnySearchMcp(
  surface: AnySearchSurface,
  run: (base: string, seen: McpSeen[]) => Promise<void>,
): Promise<void> {
  const seen: McpSeen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        id?: number;
        method?: string;
        params?: { arguments?: Record<string, unknown> };
      };
      seen.push({
        method: payload.method ?? "",
        ...(payload.params?.arguments === undefined ? {} : { args: payload.params.arguments }),
      });
      const reply = (body: unknown) =>
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      if ("status" in surface) {
        res.writeHead(surface.status, { "content-type": "application/json" }).end("{}");
        return;
      }
      if (payload.method === "initialize") {
        return reply({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-11-25" } });
      }
      if (payload.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      if (payload.method === "tools/list") {
        return reply({
          jsonrpc: "2.0",
          id: payload.id,
          result: { tools: [{ name: "search", inputSchema: { properties: { query: {} } } }] },
        });
      }
      if (payload.method === "tools/call") {
        return reply({
          jsonrpc: "2.0",
          id: payload.id,
          result: { isError: true, content: [{ type: "text", text: surface.callText }] },
        });
      }
      reply({ jsonrpc: "2.0", id: payload.id, result: {} });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run("http://127.0.0.1:" + port, seen);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** 一个临时家目录 + 一个能指到假端点的 anysearch 环境。 */
async function withSearchSandbox(run: (home: string) => Promise<void>): Promise<void> {
  const { home, cleanup } = tempHome();
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ANYSEARCH_ENDPOINT: process.env.ANYSEARCH_ENDPOINT,
    ANYSEARCH_API_KEY: process.env.ANYSEARCH_API_KEY,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.ANYSEARCH_API_KEY;
  try {
    await run(home);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanup();
  }
}

test("ans auth set：上游拒了这把 key 就不存 (#442)", async () => {
  await withSearchSandbox(async () => {
    await withAnySearchMcp({ callText: "invalid_api_key" }, async (base, seen) => {
      process.env.ANYSEARCH_ENDPOINT = base;
      const { code, out } = await capture(() => runAuth(["set", "anysearch"]), "ans-bad-key\n");

      assert.equal(code, 1, out);
      assert.match(out, /rejected this key \(permanent-auth\)/);
      assert.match(out, /--no-verify/, "离线的人还得知道逃逸口在哪");
      assert.equal(readUserCredentials().bindings.length, 0, "坏 key 不落盘");
      assert.ok(!out.includes("ans-bad-key"), "key 不回显");
      // 认证结论来自空参数 tools/call（#442），不是坏 key 也 200 的 /health。
      assert.ok(
        seen.some((call) => call.method === "tools/call" && Object.keys(call.args ?? {}).length === 0),
        "要发一次空参数 tools/call：" + JSON.stringify(seen),
      );
    });
  });
});

test("ans auth set --no-verify：离线也存得进去，一个请求都不发 (#442)", async () => {
  await withSearchSandbox(async () => {
    await withAnySearchMcp({ callText: "invalid_api_key" }, async (base, seen) => {
      process.env.ANYSEARCH_ENDPOINT = base;
      // 顺手钉住参数顺序：--no-verify 写在 provider 前面也不能被当成 provider 名。
      const { code, out } = await capture(() => runAuth(["set", "--no-verify", "anysearch"]), "ans-offline-key\n");

      assert.equal(code, 0, out);
      assert.equal(seen.length, 0, "--no-verify 不该联网");
      const stored = readUserCredentials();
      assert.equal(stored.bindings.length, 1);
      assert.equal(stored.bindings[0]?.apiKey, "ans-offline-key");
    });
  });
});

test("ans auth set：上游抽风只警告，key 照存 (#442)", async () => {
  await withSearchSandbox(async () => {
    await withAnySearchMcp({ status: 503 }, async (base) => {
      process.env.ANYSEARCH_ENDPOINT = base;
      const { code, out } = await capture(() => runAuth(["set", "anysearch"]), "ans-maybe-good\n");

      assert.equal(code, 0, out);
      assert.match(out, /\[warn\] could not check the key \(transient: HTTP 503\)/);
      // 警告只说「没验成」；「存了」由后面那行 Stored 说 —— 写盘失败时不能自相矛盾。
      assert.equal(/stored anyway/.test(out), false, out);
      assert.match(out, /Stored the anysearch key/);
      assert.equal(readUserCredentials().bindings[0]?.apiKey, "ans-maybe-good", "抽风不是拒存的理由");
    });
  });
});

test("ans auth set：好 key 存进去，并说一句验过了 (#442)", async () => {
  await withSearchSandbox(async () => {
    await withAnySearchMcp({ callText: "query is required" }, async (base) => {
      process.env.ANYSEARCH_ENDPOINT = base;
      const { code, out } = await capture(() => runAuth(["set", "anysearch"]), "ans-good-key\n");

      assert.equal(code, 0, out);
      assert.match(out, /Checked: anysearch's free surface accepted this key/);
      assert.equal(readUserCredentials().bindings[0]?.apiKey, "ans-good-key");
      assert.ok(!out.includes("ans-good-key"), "key 不回显");
    });
  });
});

test("ans auth set：写进去但没通过访问保护核对时，说的是这件事，不是「没变」（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const previous = credentialProtectionSeam.verify;
      // The check that runs AFTER the rename is the one that fails: the file is
      // already replaced, so "nothing was changed" would be a lie.
      let calls = 0;
      credentialProtectionSeam.verify = () => {
        calls++;
        if (calls > 1) throw new Error("it is group-readable");
      };
      try {
        const { code, out } = await capture(() => runAuth(["set", "openai"]), KEY + "\n");
        assert.equal(code, 1, out);
        assert.match(out, /failed its access check/, out);
        assert.match(out, /hold the new key/, "说的是这把 key 的去向：" + out);
        assert.doesNotMatch(out, /Nothing was changed/, "写已经落地，不能再这么说：" + out);
        assert.doesNotMatch(out, /not clear whether/, "这里的事实是确定的：" + out);
      } finally {
        credentialProtectionSeam.verify = previous;
      }
    });
  } finally {
    cleanup();
  }
});

test("ans auth repair：写回失败时说的是修好的条目在不在（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      writeCredentials(home, MIXED_FILE);
      const previous = credentialProtectionSeam.verify;
      let calls = 0;
      credentialProtectionSeam.verify = () => {
        calls++;
        if (calls > 1) throw new Error("it is group-readable");
      };
      try {
        const { code, out } = await capture(() => runAuth(["repair"]));
        assert.equal(code, 1, out);
        assert.match(out, /hold the repaired entries/, "repair 没有「新 key」这回事：" + out);
        assert.doesNotMatch(out, /new key/, out);
        assert.doesNotMatch(out, /not clear whether/, out);
      } finally {
        credentialProtectionSeam.verify = previous;
      }
    });
  } finally {
    cleanup();
  }
});

test("ans auth set：写之前就被拒时，说「没变」，不说「不确定」（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      const previous = credentialProtectionSeam.verify;
      // The FIRST check runs before the secret is written, so nothing on disk
      // moved - the refusal knows that, and the command must not hedge.
      credentialProtectionSeam.verify = () => { throw new Error("no ACL tool"); };
      try {
        const { code, out } = await capture(() => runAuth(["set", "openai"]), KEY + "\n");
        assert.equal(code, 1, out);
        assert.match(out, /Nothing was changed/, out);
        assert.doesNotMatch(out, /not clear whether/, "没有发生的事不能含糊：" + out);
      } finally {
        credentialProtectionSeam.verify = previous;
      }
    });
  } finally {
    cleanup();
  }
});

test("ans auth remove：坏文件被拒时说一次「没变」，不说「不确定」（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      writeCredentials(home, MIXED_FILE);
      const { code, out } = await capture(() => runAuth(["remove", "exa"]));
      assert.equal(code, 1, out);
      // The refusal says why; the command says the outcome, once, and the two do
      // not restate each other (#550).
      assert.equal((out.match(/Nothing was changed/g) ?? []).length, 1, out);
      assert.doesNotMatch(out, /not clear whether/, "同一句里不能既说没变又说不确定：" + out);
    });
  } finally {
    cleanup();
  }
});

test("ans auth：凭据文件读不出来时，不劝人删文件，也不提 repair（#537）", async () => {
  const { home, cleanup } = tempHome();
  try {
    await withoutCredentialEnv(home, async () => {
      // A directory where the file should be: readFileSync throws EISDIR on every
      // platform, and the file itself may be perfectly fine (a full disk does this).
      mkdirSync(join(home, ".ans", "credentials.json"), { recursive: true });

      const { code, out } = await capture(() => runAuth([]));
      assert.equal(code, 1, out);
      assert.match(out, /EISDIR/, out);
      assert.match(out, /ans auth set/, "the way forward is storing the key again：" + out);
      assert.doesNotMatch(out, /ans auth repair/, "repair reads the same file, so it cannot help：" + out);
      assert.doesNotMatch(out, /remove the file/, "on a full disk the file is fine：" + out);
    });
  } finally {
    cleanup();
  }
});
