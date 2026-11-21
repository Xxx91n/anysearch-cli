// #312 — 分层诊断的说法：四层、四态、离线与实测分开，跳过不冒充通过。
//
// 这里钉的是 `ans doctor` 怎么说话，不是它能不能联网：
//  1. 每条结果只落在四种状态之一（ready / unconfigured / unchecked / failed），
//     层只有安装 / 能力 / 宿主 / 数据；
//  2. 需要真实调用的检查只能是 unchecked，不会因为“没跑”就报 ready；
//  3. 退出码：有 failed 是 1；没有 failed 但有 unchecked 且 --strict 是 5；其余 0；
//  4. --json 的输出能被解析，且不带任何密钥值；
//  5. unconfigured 不抬退出码——缺一个 provider 的 key 不等于整机坏了。
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagReport, type DiagJson } from "../src/diagnostics.js";
import { runDoctor } from "../src/commands/doctor.js";

const STATES = ["ready", "unconfigured", "unchecked", "failed"];
const LAYERS = ["install", "capability", "host", "data"];

test("DiagReport: 四种状态各自计数，退出码按约定给", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "install", name: "a", state: "ready", mode: "offline" });
  report.add({ layer: "capability", name: "b", state: "unconfigured", mode: "offline" });
  report.add({ layer: "host", name: "c", state: "unchecked", mode: "live" });
  report.add({ layer: "data", name: "d", state: "failed", mode: "offline" });

  assert.deepEqual(report.summary(), { ready: 1, unconfigured: 1, unchecked: 1, failed: 1 });

  // 有 failed 就一定是 1，strict 与否都一样。
  assert.equal(report.exitCode(false), 1);
  assert.equal(report.exitCode(true), 1);
});

test("DiagReport: 没有 failed 时，unchecked 只在 --strict 下抬退出码", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "install", name: "a", state: "ready", mode: "offline" });
  report.add({ layer: "host", name: "c", state: "unchecked", mode: "live" });

  assert.equal(report.exitCode(false), 0, "默认不因为未检查而失败");
  assert.equal(report.exitCode(true), 5, "--strict 把未检查当 5");
});

test("DiagReport: unconfigured 不抬退出码", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "capability", name: "provider", state: "unconfigured", mode: "offline" });

  assert.equal(report.exitCode(false), 0);
  assert.equal(report.exitCode(true), 0, "缺 key 是合法状态，不是失败");
});

test("DiagReport: 文字输出按层分组，并逐条标出状态与离线/实测", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "install", name: "版本", state: "ready", mode: "offline" });
  report.add({ layer: "host", name: "宿主 claude 实际连接", state: "unchecked", mode: "live" });

  const text = report.render().join("\n");
  assert.match(text, /\[安装\]/);
  assert.match(text, /\[宿主\]/);
  assert.match(text, /\[OK\] 版本/, "ready 打成 OK");
  assert.match(text, /\[未检查\] 宿主 claude 实际连接/, "unchecked 明确写成未检查");
  assert.match(text, /（离线）/);
  assert.match(text, /（实测）/);
  assert.match(text, /汇总：1 可用 · 0 未配置 · 1 未检查 · 0 失败/);
});

test("DiagReport: JSON 带层、状态与退出码", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "data", name: "durable DB path", state: "ready", mode: "offline" });

  const json = report.toJson(true);
  assert.equal(json.product, "ans");
  assert.equal(json.version, "9.9.9");
  assert.equal(json.strict, true);
  assert.equal(json.exitCode, 0);
  // JSON 里四层固定都在，空层给空数组，免得调用方还要猜层名。
  assert.deepEqual(json.layers.map((layer) => layer.layer), ["install", "capability", "host", "data"]);
  const data = json.layers.find((layer) => layer.layer === "data")!;
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0]!.state, "ready");
});

test("DiagReport: --strict 下汇总那句要说 5，不能再说只有失败才非 0", () => {
  const report = new DiagReport("ans", "9.9.9");
  report.add({ layer: "host", name: "宿主 claude 实际连接", state: "unchecked", mode: "live" });

  assert.match(report.render(false).join("\n"), /只有失败会让退出码变成 1/);
  assert.match(report.render(true).join("\n"), /--strict 下未检查也退 5/);
});

test("ans doctor：key 只在凭据文件里时，provider 不算失败", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-creds-"));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ANS_DB_PATH: process.env.ANS_DB_PATH,
    EXA_API_KEY: process.env.EXA_API_KEY,
  };
  const fileKey = "exa-file-only-7d2c-doctor-test";
  const lines: string[] = [];
  try {
    const configHome = join(home, ".ans");
    mkdirSync(configHome, { recursive: true });
    writeFileSync(
      join(configHome, "credentials.json"),
      JSON.stringify({ bindings: [{ provider: "exa", apiKey: fileKey }] }),
      "utf8",
    );
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    // 环境变量这一路必须空着，测的才是「只存在凭据文件里」。
    delete process.env.EXA_API_KEY;

    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    const raw = lines.join("\n");
    const payload = JSON.parse(raw) as DiagJson;
    const exa = payload.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "provider exa");

    assert.ok(exa, "能力层要报 provider exa");
    assert.equal(exa.state, "ready", "写进凭据文件的 key 是产品推荐做法，不能算失败");
    assert.equal(code, 0, "没有真故障就不该退 1");
    assert.equal(payload.summary.failed, 0);
    assert.equal(raw.includes(fileKey), false, "凭据文件里的 key 不能出现在输出里");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans doctor --json：四层都在，状态只四种，实测项绝不报 ready", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-"));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ANS_DB_PATH: process.env.ANS_DB_PATH,
    EXA_API_KEY: process.env.EXA_API_KEY,
    ANS_LLM_API_KEY: process.env.ANS_LLM_API_KEY,
  };
  const secret = "sk-doctor-test-SECRET-do-not-print-9f3a";
  const lines: string[] = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    process.env.EXA_API_KEY = secret;
    process.env.ANS_LLM_API_KEY = secret;

    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    const raw = lines.join("\n");
    const payload = JSON.parse(raw) as DiagJson;

    assert.deepEqual(
      payload.layers.map((layer) => layer.layer).sort(),
      [...LAYERS].sort(),
      "安装 / 能力 / 宿主 / 数据四层都要报",
    );
    for (const layer of payload.layers) {
      for (const entry of layer.entries) {
        assert.ok(STATES.includes(entry.state), "未知状态 " + entry.state);
        assert.ok(entry.mode === "offline" || entry.mode === "live", "未知来源 " + entry.mode);
        if (entry.mode === "live") {
          assert.equal(entry.state, "unchecked", "实测项只能报未检查，不能报 ready：" + entry.name);
        }
      }
    }

    const all = payload.layers.flatMap((layer) => layer.entries);
    const counted = {
      ready: all.filter((entry) => entry.state === "ready").length,
      unconfigured: all.filter((entry) => entry.state === "unconfigured").length,
      unchecked: all.filter((entry) => entry.state === "unchecked").length,
      failed: all.filter((entry) => entry.state === "failed").length,
    };
    assert.deepEqual(payload.summary, counted, "汇总要和逐条对得上");
    assert.ok(payload.summary.unchecked > 0, "至少要有真实调用类的未检查项");
    assert.equal(payload.exitCode, code, "JSON 里的退出码要和真实退出码一致");

    assert.equal(raw.includes(secret), false, "密钥值不能出现在输出里");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans doctor --strict：有未检查、没有失败时退出 5", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-strict-"));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ANS_DB_PATH: process.env.ANS_DB_PATH,
  };
  const lines: string[] = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");

    const code = await runDoctor(["--strict", "--json"], { stdout: (line) => lines.push(line) });
    const payload = JSON.parse(lines.join("\n")) as DiagJson;
    const expected = payload.summary.failed > 0 ? 1 : payload.summary.unchecked > 0 ? 5 : 0;
    assert.equal(code, expected, "--strict 的退出码要按失败/未检查/其余三档给");
    assert.equal(payload.exitCode, code);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
