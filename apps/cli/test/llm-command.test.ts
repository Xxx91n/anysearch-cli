// #357 — `ans llm` 和 `ans llm check` 也是「自己读过文件、又让解析器再读一遍」的
// 调用方：同一份凭据文件坏掉时，解析器打一句 `[config] …not valid JSON…`，列表再打
// 一句 `Credentials file: BROKEN - …`，一件事说两遍。现在整条命令读一次，这句话只由
// 列表自己说。
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLlm } from "../src/commands/llm";

/** Everything that could point the listing at a real key, so only the file matters. */
const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "ANS_LLM_API_KEY",
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
  "ANS_LLM_BASE_URL",
  "ANS_LLM_API",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
];

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let out = "";
  const sink = (chunk: unknown) => { out += String(chunk); return true; };
  process.stdout.write = sink as typeof process.stdout.write;
  process.stderr.write = sink as typeof process.stderr.write;
  try {
    const code = await fn();
    return { code, out };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("ans llm set 打出的命令名来自常量，占位符不会漏到输出里（#573）", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-llm-573-"));
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { code, out } = await capture(() => runLlm(["set", "openai"]));
    assert.equal(code, 0, out);
    assert.match(out, /ans auth set openai/, "the command is named for this provider：" + out);
    assert.doesNotMatch(out, /<provider>/, "the placeholder never reaches the user：" + out);
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans llm：坏凭据文件只说一句；清单退 0，check 仍退 1", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-llm-357-"));
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(join(home, ".ans", "credentials.json"), "not json", "utf8");

    for (const [args, expectedCode] of [[[], 0], [["check"], 1]] as const) {
      const { code, out } = await capture(() => runLlm([...args]));
      // #579: the listing reports state and always exits 0; `check` is the
      // command that asks "can I use this?" and still fails on the file.
      assert.equal(code, expectedCode, out);
      // One sentence carries the fault and the way out; the count ignores case,
      // which is how the duplicate this test missed got past it (#550).
      assert.match(out, /fix or remove the file, then retry/, "the way out：" + out);
      assert.equal((out.match(/fix or remove/gi) ?? []).length, 1, "修法只说一次：" + out);
      assert.doesNotMatch(out, /ans auth repair/, "repair cannot keep anything from a file that will not parse：" + out);
      const faultLines = out.split("\n").filter((line) => line.includes("not valid JSON"));
      assert.equal(faultLines.length, 1, "args " + JSON.stringify(args) + " 只能说一次：\n" + out);
      assert.match(faultLines[0]!, /Credentials file: BROKEN/);
      // The file is broken, so whether a provider has a key is unknown - "NO KEY"
      // is the same lie `ans auth` stopped telling (#537).
      assert.doesNotMatch(out, /NO KEY/, "坏文件时不能报没配：\n" + out);
      assert.match(out, /BROKEN \(the credential file could not be read\)/, out);
    }

    // A record fault is a different fact: the file was read, one entry was not,
    // and the repair path keeps the rest. Saying "could not be read" here would
    // hide it.
    writeFileSync(join(home, ".ans", "credentials.json"), JSON.stringify({
      bindings: [{ provider: "openai", apiKey: "[redacted]" }, { provider: "anthropic" }],
    }), "utf8");
    for (const [args, expectedCode] of [[[], 0], [["check"], 1]] as const) {
      const { code, out } = await capture(() => runLlm([...args]));
      assert.equal(code, expectedCode, out);
      assert.match(out, /BROKEN \(one record cannot be read\)/, out);
      assert.doesNotMatch(out, /NO KEY/, "坏记录时也不能报没配：\n" + out);
      // The way out rides on the `Credentials file: BROKEN` line; a per-provider
      // label that repeated it would say it once per provider.
      assert.equal((out.match(/ans auth repair/g) ?? []).length, 1, "修法只说一次：\n" + out);
    }

    // A healthy file still exits 0: the failure above comes from the file, not
    // from the command deciding to fail whenever it prints something.
    writeFileSync(join(home, ".ans", "credentials.json"), JSON.stringify({
      bindings: [{ provider: "openai", apiKey: "[redacted]" }],
    }), "utf8");
    for (const args of [[], ["check"]]) {
      const healthy = await capture(() => runLlm(args));
      assert.equal(healthy.code, 0, "args " + JSON.stringify(args) + "：" + healthy.out);
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans llm 的 Files: 行给两条路径、六个状态标签、ignored 和不是表说明", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-llm-579-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-llm-579-proj-"));
  const userPath = join(home, ".ans", "config.toml");
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const savedCwd = process.cwd();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.chdir(cwd);
  // macOS tmpdir is a symlink: the command resolves the project path from the
  // real cwd, so the expected path must be the real one too.
  const projectPath = join(process.cwd(), ".ans", "config.toml");
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    const cases: Array<[string, string | undefined]> = [
      ["missing", undefined],
      ["empty", ""],
      ["no [llm]", '[other]\nx = "y"\n'],
      ["half", '[llm]\nprovider = "openai"\n'],
      ["ok", '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n'],
      ["broken", '[llm\nprovider = "openai"\n'],
    ];
    for (const [label, toml] of cases) {
      if (toml === undefined) rmSync(userPath, { force: true });
      else writeFileSync(userPath, toml, "utf8");
      const { code, out } = await capture(() => runLlm([]));
      assert.equal(code, 0, label + " 的清单必须退 0：\n" + out);
      const line = out.split("\n").find((l) => l.startsWith("Files:"));
      assert.ok(line, "missing Files: line for " + label + "：\n" + out);
      assert.ok(line.includes("user " + userPath + " [" + label + "]"), label + "：\n" + line);
      assert.ok(line.includes("project " + projectPath + " [missing]"), "另一层同样要出现：\n" + line);
    }

    // A dropped key and a half-configured project file share the same line.
    writeFileSync(userPath, '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi_key = "sk-LIST-SENTINEL"\n', "utf8");
    mkdirSync(join(cwd, ".ans"), { recursive: true });
    writeFileSync(projectPath, '[llm]\nprovider = "google"\nbase_url = "https://project-only.example/v1"\n', "utf8");
    const okHalf = await capture(() => runLlm([]));
    assert.equal(okHalf.code, 0, okHalf.out);
    const ignoredLine = okHalf.out.split("\n").find((l) => l.startsWith("Files:"));
    assert.ok(ignoredLine?.includes("user " + userPath + " [ok]"), ignoredLine);
    assert.ok(ignoredLine?.includes("project " + projectPath + " [half]"), ignoredLine);
    assert.ok(ignoredLine?.includes('(ignored: user:"api_key", project:"base_url")'), ignoredLine);
    assert.ok(!okHalf.out.includes("sk-LIST-SENTINEL"), "清单不能打出 key 值：\n" + okHalf.out);

    // `[llm]` that is not a table keeps the `no [llm]` label and says why.
    writeFileSync(userPath, 'llm = "not a table"\n', "utf8");
    const notTable = await capture(() => runLlm([]));
    assert.equal(notTable.code, 0, notTable.out);
    const notTableLine = notTable.out.split("\n").find((l) => l.startsWith("Files:"));
    assert.ok(notTableLine?.includes("user " + userPath + " [no [llm]]"), notTableLine);
    assert.ok(notTableLine?.includes("([llm] is not a table: user)"), notTableLine);

    // A quoted TOML key can decode to an ANSI escape; the listing must not
    // forward it to the terminal.
    rmSync(projectPath, { force: true });
    writeFileSync(userPath, '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n"\\u001b[2Kpwn" = "x"\n', "utf8");
    const hostile = await capture(() => runLlm([]));
    assert.equal(hostile.code, 0, hostile.out);
    assert.ok(hostile.out.includes('(ignored: user:"[2Kpwn")'), hostile.out);
    assert.ok(!hostile.out.includes("\u001b"), "终端不能被配置里的键名注入控制符：\n" + hostile.out);
  } finally {
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("ans llm 的用法错误退 2", async () => {
  const { code } = await capture(() => runLlm(["not-a-subcommand"]));
  assert.equal(code, 2);
});
