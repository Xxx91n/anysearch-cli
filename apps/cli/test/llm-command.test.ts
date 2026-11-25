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

test("ans llm / ans llm check：坏凭据文件只说一句", async () => {
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

    for (const args of [[], ["check"]]) {
      const { code, out } = await capture(() => runLlm(args));
      // #537: the same file makes `ans auth` and `ans doctor` fail, so this
      // command cannot keep reporting success for it.
      assert.equal(code, 1, out);
      // One sentence carries the fault and the way out; the count ignores case,
      // which is how the duplicate this test missed got past it (#550).
      assert.match(out, /fix or remove the file, then retry/, "exit 1 comes with the way out：" + out);
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
