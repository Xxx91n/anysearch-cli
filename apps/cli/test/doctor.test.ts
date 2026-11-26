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
import { openDatabase, SqliteSessionStore } from "@anysearch-cli/store";
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

test("ans doctor：信息源按各家没配 key 时的真实行为写，provider 行只验构造器（#441 / #459）", async () => {
  const empty = await doctorInHome(
    {
      env: {
        TAVILY_API_KEY: undefined,
        EXA_API_KEY: undefined,
        ANYSEARCH_API_KEY: undefined,
        ANYSEARCH_ENDPOINT: undefined,
      },
    },
    ["--json"],
  );
  // 没配 key 的三家现在都能用免费额度跑（有上限，所以仍报 unconfigured）。
  // 三家同一句：exa 的免费额度臂也是「能跑，但不是稳定可用」，跟 tavily / anysearch 一个说法。
  // 后半句明写「没验」：没 key 的源 --live 也不探（#534），「用免费额度跑」不是「验过」。
  assert.equal(
    empty.entries.find((entry) => entry.name === "信息源 tavily")?.detail,
    "没配 key，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
  );
  assert.equal(
    empty.entries.find((entry) => entry.name === "信息源 anysearch")?.detail,
    "没配 key，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
  );
  assert.equal(
    empty.entries.find((entry) => entry.name === "信息源 exa")?.detail,
    "没配 key，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
  );
  for (const provider of ["tavily", "exa", "anysearch"]) {
    assert.equal(
      empty.entries.find((entry) => entry.name === "信息源 " + provider)?.state,
      "unconfigured",
      provider + " has no key",
    );
  }

  // provider 行只按「构造器能不能建」如实报：三家不带 key 现在都建得起来（exa 走免费
  // 额度臂，#500），所以三行都是 ready。这一行从不联网，也不验 key 好不好。
  assert.equal(
    empty.entries.find((entry) => entry.name === "provider tavily")?.state,
    "ready",
  );
  assert.equal(
    empty.entries.find((entry) => entry.name === "provider anysearch")?.state,
    "ready",
  );
  assert.equal(
    empty.entries.find((entry) => entry.name === "provider exa")?.state,
    "ready",
    "exa 没配 key 也能建起来（免费额度臂）",
  );

  const keyed = await doctorInHome(
    {
      env: {
        TAVILY_API_KEY: "test-tavily-key",
        EXA_API_KEY: "test-exa-key",
        ANYSEARCH_API_KEY: "test-anysearch-key",
      },
    },
    ["--json"],
  );
  for (const provider of ["tavily", "exa", "anysearch"]) {
    assert.equal(
      keyed.entries.find((entry) => entry.name === "信息源 " + provider)?.state,
      "ready",
      provider + " key in env is ready",
    );
    // 来源那句话由 describeCredentialSource 说；后面那半句是 #442 加的，因为默认
    // 模式不联网，一个「OK」不能让人以为 key 已经验过了。
    assert.equal(
      keyed.entries.find((entry) => entry.name === "信息源 " + provider)?.detail,
      "key 来自环境变量（auth 没验；--live 才打免费面）",
    );
    assert.equal(
      keyed.entries.find((entry) => entry.name === "provider " + provider)?.state,
      "ready",
      provider + " constructor built",
    );
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

// 一次诊断只解析一次凭据文件之后，「坏文件只报一条」是结构保证，不是文字比对：
// 文件读坏了这条由读取的那一处说一次，两个解析器都不再说。下面几条各自钉住一头。
type DoctorRun = {
  /** --json 时的结构化结果；文字模式是 null。 */
  payload: DiagJson | null;
  entries: Array<{ name: string; state: string; detail?: string }>;
  /** 原样收下的输出，文字模式就靠它断言「只出现一次」。 */
  text: string;
  code: number;
};

async function doctorInHome(
  config: {
    credentials?: string;
    credentialsAsDir?: boolean;
    configToml?: string;
    configAsDir?: boolean;
    projectToml?: string;
    projectAsDir?: boolean;
    env: Record<string, string | undefined>;
  },
  args: string[],
): Promise<DoctorRun> {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-cred-"));
  const projectDir = join(home, "project");
  const originalCwd = process.cwd();
  const keys = ["HOME", "USERPROFILE", "ANS_DB_PATH", ...Object.keys(config.env)];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  const lines: string[] = [];
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    if (config.credentialsAsDir) {
      mkdirSync(join(home, ".ans", "credentials.json"), { recursive: true });
    } else if (config.credentials !== undefined) {
      writeFileSync(join(home, ".ans", "credentials.json"), config.credentials, "utf8");
    }
    if (config.configAsDir) {
      mkdirSync(join(home, ".ans", "config.toml"), { recursive: true });
    } else if (config.configToml !== undefined) {
      writeFileSync(join(home, ".ans", "config.toml"), config.configToml, "utf8");
    }
    if (config.projectAsDir || config.projectToml !== undefined) {
      mkdirSync(join(projectDir, ".ans"), { recursive: true });
      if (config.projectAsDir) {
        mkdirSync(join(projectDir, ".ans", "config.toml"), { recursive: true });
      } else {
        writeFileSync(join(projectDir, ".ans", "config.toml"), config.projectToml!, "utf8");
      }
      // 项目级配置、领域目录和宿主计划都从 cwd 算；测试里就把进程挪过去，
      // 免得只换了一半路径。
      process.chdir(projectDir);
    }
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    for (const [key, value] of Object.entries(config.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const code = await runDoctor(args, { stdout: (line) => lines.push(line) });
    const text = lines.join("\n");
    const payload = args.includes("--json") ? (JSON.parse(text) as DiagJson) : null;
    return {
      payload,
      text,
      code,
      entries: payload ? payload.layers.flatMap((layer) => layer.entries) : [],
    };
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

async function runInHome(config: {
  credentials?: string;
  credentialsAsDir?: boolean;
  configToml?: string;
  configAsDir?: boolean;
  projectToml?: string;
  projectAsDir?: boolean;
  env: Record<string, string | undefined>;
}): Promise<DoctorRun & { payload: DiagJson }> {
  const run = await doctorInHome(config, ["--json"]);
  return { ...run, payload: run.payload! };
}

test("ans doctor：凭据文件读坏了只报一条失败", async () => {
  // 票面要求原样保留的守卫：文件读坏了只出一条失败，失败数不多算。
  const { payload, entries } = await runInHome({
    credentials: "not json",
    env: { ANS_LLM_API_KEY: undefined, ANS_LLM_PROVIDER: undefined, ANS_LLM_MODEL: undefined },
  });

  const credentialRows = entries.filter((entry) => entry.name === "user credential file");
  assert.equal(credentialRows.length, 1, "同一份文件只报一条");
  assert.equal(credentialRows[0]!.state, "failed");
  const fileRows = entries.filter((entry) => entry.name.startsWith("配置文件"));
  assert.equal(fileRows.length, 2, "两份配置文件各一行，不因为凭据坏了少一行");
  assert.equal(
    fileRows.some((entry) => (entry.detail ?? "").includes("not valid JSON")),
    false,
    "同一句故障不要再挂到配置文件行",
  );
  assert.equal(payload.summary.failed, 1, "失败数不能多算");
});

test("ans doctor：凭据文件坏了，信息源行说的是文件坏了，不是没配 key", async () => {
  // describeUnconfiguredSource 本身有单测；这条钉的是 doctor 真的把坏文件传给了它。
  const { entries } = await runInHome({
    credentials: "not json",
    env: {
      TAVILY_API_KEY: undefined,
      EXA_API_KEY: undefined,
      ANYSEARCH_API_KEY: undefined,
      ANS_LLM_API_KEY: undefined,
      ANS_LLM_PROVIDER: undefined,
      ANS_LLM_MODEL: undefined,
    },
  });

  for (const provider of ["tavily", "exa", "anysearch"]) {
    assert.equal(
      entries.find((entry) => entry.name === "信息源 " + provider)?.detail,
      "凭据文件坏了，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
      provider + " 不能把读不出的文件说成没配 key",
    );
  }
});

test("ans doctor：凭据文件坏了又有 endpoint 时，也不说没配 key", async () => {
  // endpoint 设了、key 读不出来：原因仍然是文件，不是「从没配过」。
  const { entries } = await runInHome({
    credentials: "not json",
    env: {
      ANYSEARCH_ENDPOINT: "http://127.0.0.1:9",
      ANYSEARCH_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      EXA_API_KEY: undefined,
      ANS_LLM_API_KEY: undefined,
      ANS_LLM_PROVIDER: undefined,
      ANS_LLM_MODEL: undefined,
    },
  });

  assert.equal(
    entries.find((entry) => entry.name === "信息源 anysearch")?.detail,
    "endpoint 设了；凭据文件坏了，这条臂的 key 读不出来",
  );
});

test("ans doctor：凭据文件坏了，文字输出里只说一条", async () => {
  // 验收第二条的文字那一半：用户看到的就是这些行，所以直接数行。--json 那一半由
  // 上面那条守卫用例钉着，这里不再重复跑一遍 --json。
  const printed = await doctorInHome(
    {
      credentials: "not json",
      env: { ANS_LLM_API_KEY: undefined, ANS_LLM_PROVIDER: undefined, ANS_LLM_MODEL: undefined },
    },
    [],
  );

  const faultLines = printed.text.split("\n").filter((line) => line.includes("not valid JSON"));
  assert.equal(faultLines.length, 1, "文字输出里只出现一次：\n" + printed.text);
  assert.match(faultLines[0]!, /user credential file/);
  const fileLines = printed.text.split("\n").filter((line) => line.includes("配置文件"));
  assert.equal(fileLines.length, 2, "两份配置文件各一行：\n" + printed.text);
  assert.equal(
    fileLines.some((line) => line.includes("not valid JSON")),
    false,
    "同一句故障没有再挂到配置文件行",
  );
});

test("ans doctor：模型 key 绑在别的 endpoint 上要报出来", async () => {
  const stored = "https://a.example/v1";
  const effective = "https://b.example/v1";
  const { entries, code, payload } = await runInHome({
    credentials: JSON.stringify({ bindings: [{ provider: "openai", apiKey: "sk-not-a-real-key", endpoint: stored }] }),
    configToml: [
      "[llm]",
      // Stored provider ids are lowercased by the store; the detail must still
      // find this binding when the config spells the provider with a capital.
      'provider = "OpenAI"',
      'model = "gpt-4o"',
      'api = "chat"',
      'base_url = "' + effective + '"',
      "",
    ].join("\n"),
    env: { ANS_LLM_API_KEY: undefined, ANS_LLM_PROVIDER: undefined, ANS_LLM_MODEL: undefined, ANS_LLM_BASE_URL: undefined },
  });

  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.ok(keyRow, "绑定对不上要挂在「模型密钥」行");
  assert.equal(keyRow!.state, "unconfigured", "值没生效是没配，不是文件坏了");
  assert.match(keyRow!.detail ?? "", /endpoint/);
  assert.ok((keyRow!.detail ?? "").includes(stored), "要说清 key 绑在哪：" + keyRow!.detail);
  assert.ok((keyRow!.detail ?? "").includes(effective), "要说清当前生效的是哪个：" + keyRow!.detail);
  assert.equal(code, 0, "值问题不抬退出码");
  assert.equal(payload.summary.failed, 0);
});

const LLM_ENV_CLEAR = {
  ANS_LLM_API_KEY: undefined,
  ANS_LLM_PROVIDER: undefined,
  ANS_LLM_MODEL: undefined,
  ANS_LLM_BASE_URL: undefined,
  ANS_LLM_API: undefined,
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  GOOGLE_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
};

const FILE_STATUS_CASES: Array<{
  label: string;
  config: { configToml?: string; configAsDir?: true; projectToml?: string; projectAsDir?: true };
  state: "ready" | "unconfigured" | "failed";
  detail: RegExp;
}> = [
  { label: "missing", config: {}, state: "unconfigured", detail: /^没有这个文件：/ },
  { label: "empty", config: { configToml: "" }, state: "unconfigured", detail: /^文件在，里面是空的：/ },
  {
    label: "no-llm",
    config: { configToml: '[other]\nx = "y"\n' },
    state: "unconfigured",
    detail: /^文件在，但没有 \[llm\]：/,
  },
  {
    label: "half",
    config: { configToml: '[llm]\nprovider = "openai"\n' },
    state: "unconfigured",
    detail: /^有 \[llm\]，设了 provider，缺 model：/,
  },
  {
    label: "ok",
    config: { configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' },
    state: "ready",
    detail: /^provider、model 都在：/,
  },
  {
    label: "invalid TOML",
    config: { configToml: '[llm\nprovider = "openai"\n' },
    state: "failed",
    detail: /^TOML 坏了：.*（第 \d+ 行第 \d+ 列）/,
  },
  { label: "unreadable", config: { configAsDir: true }, state: "failed", detail: /^读不出来：/ },
];

test("ans doctor：用户级 config.toml 六种状态各一行，坏的退 1", async () => {
  for (const item of FILE_STATUS_CASES) {
    const { entries, code } = await runInHome({ ...item.config, env: LLM_ENV_CLEAR });
    const rows = entries.filter((entry) => entry.name === "配置文件（用户级）");
    assert.equal(rows.length, 1, item.label + ": 每份文件最多一条");
    assert.equal(rows[0]!.state, item.state, item.label);
    assert.match(rows[0]!.detail ?? "", item.detail, item.label);
    assert.ok((rows[0]!.detail ?? "").includes("~/.ans/config.toml"), item.label + ": 用户级路径用 ~");
    assert.equal(entries.filter((entry) => entry.name.startsWith("配置文件")).length, 2, "固定两行");
    assert.equal(code, item.state === "failed" ? 1 : 0, item.label + " 退出码");
  }
});

test("ans doctor：项目级 config.toml 六种状态各一行，坏的退 1", async () => {
  const cases: typeof FILE_STATUS_CASES = [
    { label: "project missing", config: {}, state: "unconfigured", detail: /^没有这个文件：/ },
    {
      label: "project empty",
      config: { projectToml: "" },
      state: "unconfigured",
      detail: /^文件在，里面是空的：/,
    },
    {
      label: "project no-llm",
      config: { projectToml: '[other]\nx = "y"\n' },
      state: "unconfigured",
      detail: /^文件在，但没有 \[llm\]：/,
    },
    {
      label: "project half",
      config: { projectToml: '[llm]\nprovider = "openai"\n' },
      state: "unconfigured",
      detail: /^有 \[llm\]，设了 provider，缺 model：/,
    },
    {
      label: "project ok",
      config: { projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n' },
      state: "ready",
      detail: /^provider、model 都在：/,
    },
    {
      label: "project invalid TOML",
      config: { projectToml: '[llm\nprovider = "openai"\n' },
      state: "failed",
      detail: /^TOML 坏了：.*（第 \d+ 行第 \d+ 列）/,
    },
    { label: "project unreadable", config: { projectAsDir: true }, state: "failed", detail: /^读不出来：/ },
  ];
  for (const item of cases) {
    const { entries, code } = await runInHome({ ...item.config, env: LLM_ENV_CLEAR });
    const rows = entries.filter((entry) => entry.name === "配置文件（项目级）");
    assert.equal(rows.length, 1, item.label + ": 每份文件最多一条");
    assert.equal(rows[0]!.state, item.state, item.label);
    assert.match(rows[0]!.detail ?? "", item.detail, item.label);
    assert.ok((rows[0]!.detail ?? "").includes(".ans/config.toml"), item.label + ": 项目级路径用相对路径");
    assert.equal(entries.filter((entry) => entry.name.startsWith("配置文件")).length, 2, "固定两行");
    assert.equal(code, item.state === "failed" ? 1 : 0, item.label + " 退出码");
  }
});

test("ans doctor：明文 key、未知键、项目白名单外键只在文件行说明，退 0", async () => {
  const secret = "sk-FILE-SECRET-SENTINEL";
  const cases = [
    {
      label: "user plaintext key",
      config: { configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi_key = "' + secret + '"\n' },
      row: "配置文件（用户级）",
      note: /忽略 \[llm\]\.api_key：配置文件不存密钥/,
    },
    {
      label: "user unknown key",
      config: { configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nwho_knows = "x"\n' },
      row: "配置文件（用户级）",
      note: /忽略 \[llm\]\.who_knows：不认识的键/,
    },
    {
      label: "project not allowed key",
      config: { projectToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://project-SENTINEL.example/v1"\n' },
      row: "配置文件（项目级）",
      note: /忽略 \[llm\]\.base_url：项目级只认 provider、model/,
    },
  ] as const;
  for (const item of cases) {
    const { entries, code, text } = await runInHome({ ...item.config, env: LLM_ENV_CLEAR });
    const row = entries.find((entry) => entry.name === item.row);
    assert.equal(row?.state, "ready", item.label + ": 值问题不改文件状态");
    assert.match(row?.detail ?? "", item.note, item.label);
    assert.equal(code, 0, item.label + ": 值问题不抬退出码");
    assert.equal(text.includes(secret), false, item.label + ": 不能打印 key 值");
    assert.equal(text.includes("project-SENTINEL"), false, item.label + ": 不能打印被拒的地址");
  }
});

test("ans doctor：env_key 没导出、绑错 provider 只挂模型密钥行，退 0", async () => {
  const unset = await runInHome({
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MISSING_MODEL_KEY"\n',
    env: LLM_ENV_CLEAR,
  });
  const unsetRow = unset.entries.find((entry) => entry.name === "模型密钥");
  assert.equal(unsetRow?.state, "unconfigured");
  assert.match(unsetRow?.detail ?? "", /MISSING_MODEL_KEY 没导出/);
  assert.equal(unset.code, 0);

  const wrongProvider = await runInHome({
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nenv_key = "MY_MODEL_KEY"\n',
    env: { ...LLM_ENV_CLEAR, ANS_LLM_PROVIDER: "anthropic" },
  });
  const keyRow = wrongProvider.entries.find((entry) => entry.name === "模型密钥");
  assert.equal(keyRow?.state, "unconfigured");
  assert.match(keyRow?.detail ?? "", /MY_MODEL_KEY 绑的是别的 provider/);
  assert.equal(wrongProvider.code, 0, "绑定不对是没配，不是机器坏了");
});

test("ans doctor：api 值非法只说明，模型配置仍可用、退 0", async () => {
  const { entries, code } = await runInHome({
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi = "grpc"\n',
    env: LLM_ENV_CLEAR,
  });
  const modelRow = entries.find((entry) => entry.name === "模型配置");
  assert.equal(modelRow?.state, "ready", "provider/model 都在，api 坏了不拦配置");
  assert.match(modelRow?.detail ?? "", /api 值非法（来源：用户级配置文件）/);
  assert.equal(code, 0);
});

test("ans doctor：base_url 缺合法 api，模型配置失败、退 1", async () => {
  const { entries, code, payload } = await runInHome({
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\nbase_url = "https://endpoint-SENTINEL.example/v1"\n',
    env: LLM_ENV_CLEAR,
  });
  const modelRow = entries.find((entry) => entry.name === "模型配置");
  assert.equal(modelRow?.state, "failed");
  assert.equal(modelRow?.detail, "自定义地址没写 api（要 chat / messages / responses），模型起不来");
  assert.equal(code, 1);
  assert.equal(payload.exitCode, code, "JSON 里的退出码和返回值一致");
  assert.equal(payload.summary.failed, 1, "只有模型配置这一条失败");
});

test("ans doctor：base_url 的 api 值非法时，失败句说 api 非法，不再说没写 api", async () => {
  const { entries } = await runInHome({
    configToml: [
      "[llm]",
      'provider = "openai"',
      'model = "gpt-5"',
      'base_url = "https://endpoint-SENTINEL.example/v1"',
      'api = "grpc"',
      "",
    ].join("\n"),
    env: LLM_ENV_CLEAR,
  });
  const modelRow = entries.find((entry) => entry.name === "模型配置");
  assert.equal(modelRow?.state, "failed");
  assert.equal(modelRow?.detail, "自定义地址的 api 值非法，模型起不来");
  assert.equal((modelRow?.detail ?? "").includes("没写 api"), false, "不能把非法值说成没写");
  assert.equal((modelRow?.detail ?? "").includes("api 值非法（来源"), false, "失败句已经说明，不再重复");
});

test("ans doctor：存着的 key 绑在自定义地址、当前是默认地址时，修法绑默认地址", async () => {
  const stored = "https://stored-sentinel.example/v1";
  const { entries } = await runInHome({
    credentials: JSON.stringify({ bindings: [{ provider: "openai", apiKey: "sk-not-a-real-key", endpoint: stored }] }),
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi = "chat"\n',
    env: LLM_ENV_CLEAR,
  });
  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.equal(keyRow?.state, "unconfigured");
  assert.match(keyRow?.detail ?? "", /绑到当前 provider 默认地址/);
  assert.ok((keyRow?.detail ?? "").includes(stored), "仍要说清 key 原来的绑定：" + (keyRow?.detail ?? ""));
});

test("ans doctor：存着的 key 在默认地址、当前是自定义地址时，默认地址用中文", async () => {
  const effective = "https://effective.example/v1";
  const { entries } = await runInHome({
    credentials: JSON.stringify({ bindings: [{ provider: "openai", apiKey: "sk-not-a-real-key", endpoint: null }] }),
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi = "chat"\nbase_url = "' + effective + '"\n',
    env: LLM_ENV_CLEAR,
  });
  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.match(keyRow?.detail ?? "", /绑在 provider 默认地址/);
  assert.equal((keyRow?.detail ?? "").includes("provider default endpoint"), false, "不能中英混排");
  assert.ok((keyRow?.detail ?? "").includes(effective));
});

test("ans doctor：生效地址不能打印时，修法给完整地址来源和占位符", async () => {
  const effective = "https://user:pass@effective.example/v1";
  const stored = "https://stored.example/v1";
  const { entries, text } = await runInHome({
    credentials: JSON.stringify({ bindings: [{ provider: "openai", apiKey: "sk-not-a-real-key", endpoint: stored }] }),
    configToml: '[llm]\nprovider = "openai"\nmodel = "gpt-5"\napi = "chat"\nbase_url = "' + effective + '"\n',
    env: LLM_ENV_CLEAR,
  });
  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.match(keyRow?.detail ?? "", /完整地址在 用户级配置文件/);
  assert.match(keyRow?.detail ?? "", /--endpoint '<地址>'/);
  assert.equal((keyRow?.detail ?? "").includes("user:pass"), false, "不能打印地址里的凭据");
  assert.equal(text.includes("user:pass"), false);
});

test("ans doctor：坏文件 + env 补齐但 base_url 缺 api 时，不说「能用」", async () => {
  const { entries, code } = await runInHome({
    configToml: '[llm\nprovider = "openai"\n',
    env: {
      ...LLM_ENV_CLEAR,
      ANS_LLM_PROVIDER: "openai",
      ANS_LLM_MODEL: "gpt-5",
      ANS_LLM_BASE_URL: "https://endpoint-SENTINEL.example/v1",
    },
  });
  const fileRow = entries.find((entry) => entry.name === "配置文件（用户级）");
  assert.equal(fileRow?.state, "failed");
  assert.equal((fileRow?.detail ?? "").includes("能用"), false, "模型起不来就不能说值能用");
  const modelRow = entries.find((entry) => entry.name === "模型配置");
  assert.equal(modelRow?.state, "failed");
  assert.equal(code, 1);
});

test("ans doctor：坏文件 + 环境变量补齐，文件行仍失败退 1，模型配置可用", async () => {
  const { entries, code, text } = await runInHome({
    configToml: '[llm\nprovider = "openai"\nmodel = "gpt-5"\n',
    env: { ...LLM_ENV_CLEAR, ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5", ANS_LLM_API_KEY: "test-key" },
  });
  const fileRow = entries.find((entry) => entry.name === "配置文件（用户级）");
  assert.equal(fileRow?.state, "failed");
  assert.match(fileRow?.detail ?? "", /值来自环境变量，能用；env 没了就会坏/);
  const modelRow = entries.find((entry) => entry.name === "模型配置");
  assert.equal(modelRow?.state, "ready");
  assert.equal(code, 1, "文件坏了就退 1，env 能跑也不盖掉");
  assert.equal(text.includes("gpt-5"), true, "模型名可以出现在来源里");
});

test("ans doctor：两份文件都坏 + 环境变量补齐时，那句话只说一次", async () => {
  const { entries } = await runInHome({
    configToml: '[llm\nprovider = "openai"\n',
    projectToml: "[llm\nmodel = \"gpt-5\"\n",
    env: { ...LLM_ENV_CLEAR, ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5", ANS_LLM_API_KEY: "test-key" },
  });
  const fileRows = entries.filter((entry) => entry.name.startsWith("配置文件"));
  assert.equal(fileRows.filter((entry) => entry.state === "failed").length, 2);
  const notes = fileRows.filter((entry) => (entry.detail ?? "").includes("值来自环境变量，能用"));
  assert.equal(notes.length, 1, "同一句话只挂在一行");
});

test("ans doctor：坏文件只补 provider/model、没有 key 时，不说「能用」", async () => {
  const { entries } = await runInHome({
    configToml: '[llm\nprovider = "openai"\n',
    env: { ...LLM_ENV_CLEAR, ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" },
  });
  const fileRow = entries.find((entry) => entry.name === "配置文件（用户级）");
  assert.equal(fileRow?.state, "failed");
  assert.equal((fileRow?.detail ?? "").includes("能用"), false, "没有 key 不能说模型能用");
  assert.equal(entries.find((entry) => entry.name === "模型密钥")?.state, "unconfigured");
});

test("ans doctor：坏 TOML 不回显原文或 key，只给路径、类型和行列号", async () => {
  const secret = "sk-TOML-SECRET-SENTINEL";
  const { text } = await doctorInHome(
    {
      configToml: '[llm]\napi_key = "' + secret + '"\nprovider = "openai"\nbroken =',
      env: LLM_ENV_CLEAR,
    },
    [],
  );
  assert.equal(text.includes(secret), false, "不能回显 key");
  assert.equal(text.includes("broken ="), false, "不能回显 TOML 原文");
  assert.match(text, /TOML 坏了：.*（第 \d+ 行第 \d+ 列）/);
});

test("ans doctor：项目级坏 TOML 同样不回显原文或 key", async () => {
  const secret = "sk-PROJECT-TOML-SENTINEL";
  const { text } = await doctorInHome(
    {
      projectToml: '[llm]\napi_key = "' + secret + '"\nprovider = "openai"\nbroken =',
      env: LLM_ENV_CLEAR,
    },
    [],
  );
  assert.equal(text.includes(secret), false, "项目级坏文件也不能回显 key");
  assert.equal(text.includes("broken ="), false, "项目级坏文件也不能回显 TOML 原文");
  assert.match(text, /配置文件（项目级）.*TOML 坏了：.*（第 \d+ 行第 \d+ 列）/);
});

test("ans doctor：`[llm]` 不是表时按没有 [llm] 说清原因", async () => {
  const { entries } = await runInHome({
    configToml: 'llm = "not a table"\n',
    env: LLM_ENV_CLEAR,
  });
  const row = entries.find((entry) => entry.name === "配置文件（用户级）");
  assert.equal(row?.state, "unconfigured");
  assert.match(row?.detail ?? "", /文件在，但没有 \[llm\]：.*（\[llm\] 不是表，整段被忽略）/);
});

test("ans doctor：空表 [llm] 算半配置，说清两个字段都没写", async () => {
  const { entries } = await runInHome({
    configToml: "[llm]\n",
    env: LLM_ENV_CLEAR,
  });
  const row = entries.find((entry) => entry.name === "配置文件（用户级）");
  assert.equal(row?.state, "unconfigured");
  assert.match(row?.detail ?? "", /^有 \[llm\]，但 provider、model 都没写：/);
});

test("ans doctor：env_key 绑错 endpoint 只挂模型密钥行，退 0", async () => {
  const bound = "https://bound-SENTINEL.example/v1";
  const effective = "https://effective-SENTINEL.example/v1";
  const { entries, code } = await runInHome({
    configToml: [
      "[llm]",
      'provider = "openai"',
      'model = "gpt-5"',
      'api = "chat"',
      'base_url = "' + bound + '"',
      'env_key = "CUSTOM_MODEL_KEY"',
      "",
    ].join("\n"),
    env: { ...LLM_ENV_CLEAR, ANS_LLM_BASE_URL: effective },
  });
  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.equal(keyRow?.state, "unconfigured");
  assert.match(keyRow?.detail ?? "", /CUSTOM_MODEL_KEY 绑的 endpoint 和当前生效的不一样/);
  assert.equal(code, 0, "env_key 绑错 endpoint 不抬退出码");
});

test("ans doctor：存着模型 key 但没配模型时，模型密钥行说一句", async () => {
  const secret = "sk-STORED-SENTINEL";
  const { entries, code, text } = await runInHome({
    credentials: JSON.stringify({ bindings: [{ provider: "openai", apiKey: secret, endpoint: null }] }),
    env: LLM_ENV_CLEAR,
  });
  const keyRow = entries.find((entry) => entry.name === "模型密钥");
  assert.equal(keyRow?.state, "unconfigured");
  assert.match(keyRow?.detail ?? "", /凭据文件 .* 里存着模型 key，但没生效/);
  assert.equal(code, 0);
  assert.equal(text.includes(secret), false, "提示里不能出现 key 值");
});

test("ans doctor：provider/model 里的控制字符不进输出", async () => {
  const { entries, text } = await runInHome({
    configToml: '[llm]\nprovider = "openai\\u001b[2K"\nmodel = "gpt-5\\u001b[2K"\n',
    env: LLM_ENV_CLEAR,
  });
  assert.equal(JSON.stringify(entries).includes("\u001b"), false, "事实和 JSON 都不能带 ESC");
  assert.equal(text.includes("\u001b"), false, "终端输出不能带 ESC");
  assert.match(entries.find((entry) => entry.name === "模型配置")?.detail ?? "", /openai \[2K/);
});

test("ans doctor：默认域（没配 toolRequires）不报 active 漏装，但报出已装却没在任何域里启用的 skill", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-skills-"));
  const keys = ["HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_DOMAIN"];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  const lines: string[] = [];
  try {
    const synced = join(home, ".ans", "skills", "synced");
    mkdirSync(join(synced, "ans"), { recursive: true });
    writeFileSync(
      join(synced, "ans", "SKILL.md"),
      "---\nname: ans\ndescription: bundled ans skill\n---\n\nBody.\n",
      "utf8",
    );
    writeFileSync(
      join(synced, "installed.json"),
      JSON.stringify({
        version: 1,
        skills: {
          ans: {
            name: "ans",
            source: join(home, "src", "ans"),
            commit: "0123456789abcdef0123456789abcdef01234567",
            dirty: false,
          },
        },
      }) + "\n",
      "utf8",
    );
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    process.env.ANS_DOMAIN = "default";

    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    assert.equal(code, 0);
    const payload = JSON.parse(lines.join("\n")) as DiagJson;
    const row = payload.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "领域 skills.active");

    assert.ok(row, "能力层要有「领域 skills.active」");
    assert.equal(row!.state, "ready");
    assert.equal(
      row!.detail,
      "search、doctor（装了但没在任何域里启用：ans，只供宿主直接读）",
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans doctor：一边 skill 清单损坏时报出清单读不出，且不吞掉另一边已装 skill 的提示", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-skills-err-"));
  const projectDir = mkdtempSync(join(tmpdir(), "ans-doctor-proj-"));
  const domainsDir = mkdtempSync(join(tmpdir(), "ans-doctor-domains-err-"));
  const keys = ["HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_DOMAIN", "ANS_DOMAINS_DIR"];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  const prevCwd = process.cwd();
  const lines: string[] = [];
  try {
    writeFileSync(
      join(domainsDir, "strict.toml"),
      [
        'name = "strict"',
        'description = "domain with toolRequires"',
        "",
        "[skills]",
        'active = ["search", "doctor"]',
        "",
        "[skills.toolRequires]",
        'search = ["search"]',
        'doctor = ["ctx_execute"]',
        "",
        "[sources]",
        'enabled = ["tavily"]',
        "",
        "[rag]",
        'adapter = "none"',
        "",
        "[hooks]",
        'toolWhitelist = ["search", "ctx_execute"]',
        "",
      ].join("\n"),
      "utf8",
    );
    const userSynced = join(home, ".ans", "skills", "synced");
    mkdirSync(join(userSynced, "ans"), { recursive: true });
    writeFileSync(
      join(userSynced, "ans", "SKILL.md"),
      "---\nname: ans\ndescription: bundled ans skill\n---\n\nBody.\n",
      "utf8",
    );
    writeFileSync(
      join(userSynced, "installed.json"),
      JSON.stringify({
        version: 1,
        skills: {
          ans: {
            name: "ans",
            source: join(home, "src", "ans"),
            commit: "0123456789abcdef0123456789abcdef01234567",
            dirty: false,
          },
        },
      }) + "\n",
      "utf8",
    );
    const projSynced = join(projectDir, ".ans", "skills", "synced");
    mkdirSync(projSynced, { recursive: true });
    writeFileSync(join(projSynced, "installed.json"), "{broken json\n", "utf8");

    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    process.env.ANS_DOMAINS_DIR = domainsDir;
    process.env.ANS_DOMAIN = "strict";
    process.chdir(projectDir);

    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    assert.equal(code, 0);
    const payload = JSON.parse(lines.join("\n")) as DiagJson;
    const row = payload.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "领域 skills.active");

    assert.ok(row, "能力层要有「领域 skills.active」");
    const detail = row!.detail ?? "";
    assert.match(detail, /项目级清单读不出/, "损坏的那一边要报出清单读不出：" + detail);
    assert.match(detail, /装了但没在任何域里启用：ans，只供宿主直接读/, "完好的用户级已装 skill 仍要被报出：" + detail);
    assert.equal(detail.includes("清单里没这几个名字"), false, "有一边清单读不出时不能断言另一侧没记：" + detail);
  } finally {
    process.chdir(prevCwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(domainsDir, { recursive: true, force: true });
  }
});

test("ans doctor：域 TOML 配了 [skills.toolRequires] 时，解释「域里写了但没装」（覆盖全部未装、部分未装、全部已装）", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-skills-tr-"));
  const domainsDir = mkdtempSync(join(tmpdir(), "ans-doctor-domains-tr-"));
  const keys = ["HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_DOMAIN", "ANS_DOMAINS_DIR"];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  try {
    writeFileSync(
      join(domainsDir, "strict.toml"),
      [
        'name = "strict"',
        'description = "domain with toolRequires"',
        "",
        "[skills]",
        'active = ["search", "doctor"]',
        "",
        "[skills.toolRequires]",
        'search = ["search"]',
        'doctor = ["ctx_execute"]',
        "",
        "[sources]",
        'enabled = ["tavily"]',
        "",
        "[rag]",
        'adapter = "none"',
        "",
        "[hooks]",
        'toolWhitelist = ["search", "ctx_execute"]',
        "",
      ].join("\n"),
      "utf8",
    );
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = join(home, "anysearch.db");
    process.env.ANS_DOMAINS_DIR = domainsDir;
    process.env.ANS_DOMAIN = "strict";

    // 1. 一个都没装
    const linesAll: string[] = [];
    const codeAll = await runDoctor(["--json"], { stdout: (line) => linesAll.push(line) });
    assert.equal(codeAll, 0);
    const payloadAll = JSON.parse(linesAll.join("\n")) as DiagJson;
    const rowAll = payloadAll.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "领域 skills.active");
    assert.ok(rowAll);
    const detailAll = rowAll!.detail ?? "";
    assert.equal(
      detailAll,
      "search、doctor（清单里没这几个名字：search、doctor，筛工具只看域 TOML，不读 skills/synced/）",
    );

    // 2. 只装了一部分（装了 doctor，没装 search）
    const synced = join(home, ".ans", "skills", "synced");
    mkdirSync(join(synced, "doctor"), { recursive: true });
    writeFileSync(
      join(synced, "doctor", "SKILL.md"),
      "---\nname: doctor\ndescription: doctor skill\n---\n\nBody.\n",
      "utf8",
    );
    writeFileSync(
      join(synced, "installed.json"),
      JSON.stringify({
        version: 1,
        skills: {
          doctor: {
            name: "doctor",
            source: join(home, "src", "doctor"),
            commit: "0123456789abcdef0123456789abcdef01234567",
            dirty: false,
          },
        },
      }) + "\n",
      "utf8",
    );
    const linesSub: string[] = [];
    const codeSub = await runDoctor(["--json"], { stdout: (line) => linesSub.push(line) });
    assert.equal(codeSub, 0);
    const payloadSub = JSON.parse(linesSub.join("\n")) as DiagJson;
    const rowSub = payloadSub.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "领域 skills.active");
    assert.ok(rowSub);
    const detailSub = rowSub!.detail ?? "";
    assert.equal(
      detailSub,
      "search、doctor（清单里没这几个名字：search，筛工具只看域 TOML，不读 skills/synced/）",
    );

    // 3. 全部装齐时不挂多余说明
    mkdirSync(join(synced, "search"), { recursive: true });
    writeFileSync(
      join(synced, "search", "SKILL.md"),
      "---\nname: search\ndescription: search skill\n---\n\nBody.\n",
      "utf8",
    );
    writeFileSync(
      join(synced, "installed.json"),
      JSON.stringify({
        version: 1,
        skills: {
          doctor: {
            name: "doctor",
            source: join(home, "src", "doctor"),
            commit: "0123456789abcdef0123456789abcdef01234567",
            dirty: false,
          },
          search: {
            name: "search",
            source: join(home, "src", "search"),
            commit: "0123456789abcdef0123456789abcdef01234567",
            dirty: false,
          },
        },
      }) + "\n",
      "utf8",
    );
    const linesNone: string[] = [];
    const codeNone = await runDoctor(["--json"], { stdout: (line) => linesNone.push(line) });
    assert.equal(codeNone, 0);
    const payloadNone = JSON.parse(linesNone.join("\n")) as DiagJson;
    const rowNone = payloadNone.layers
      .flatMap((layer) => layer.entries)
      .find((entry) => entry.name === "领域 skills.active");
    assert.ok(rowNone);
    assert.equal(rowNone!.detail, "search、doctor");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(domainsDir, { recursive: true, force: true });
  }
});

test("ans doctor：坏文件给的建议跟着故障档走，repair 只出现在能修的那档", async () => {
  const env = { ANS_LLM_API_KEY: undefined, ANS_LLM_PROVIDER: undefined, ANS_LLM_MODEL: undefined };

  // A file that does not parse has nothing for repair to keep.
  const parseFault = await runInHome({ credentials: "not json", env });
  const parseRow = parseFault.entries.find((entry) => entry.name === "user credential file")!;
  assert.equal(parseRow.state, "failed");
  assert.doesNotMatch(parseRow.detail ?? "", /ans auth repair/, parseRow.detail);
  // The fault sentence store built already ends with the fix, so doctor adds
  // nothing beside it and the row says it once (#550).
  assert.match(parseRow.detail ?? "", /fix or remove the file, then retry/, parseRow.detail);
  assert.equal(((parseRow.detail ?? "").match(/fix or remove/gi) ?? []).length, 1, parseRow.detail);

  // A record inside a readable file is the one case it fixes.
  const recordFault = await runInHome({
    credentials: JSON.stringify({
      bindings: [{ provider: "openai", apiKey: "[redacted]" }, { provider: "anthropic" }],
    }),
    env,
  });
  const recordRow = recordFault.entries.find((entry) => entry.name === "user credential file")!;
  assert.equal(recordRow.state, "failed");
  assert.match(recordRow.detail ?? "", /ans auth repair/, recordRow.detail);
});

test("ans doctor：凭据文件读不出来时，建议只解决读的问题，不提 repair、不劝删（#537）", async () => {
  const { entries } = await runInHome({
    credentialsAsDir: true,
    env: { ANS_LLM_API_KEY: undefined, ANS_LLM_PROVIDER: undefined, ANS_LLM_MODEL: undefined },
  });
  const row = entries.find((entry) => entry.name === "user credential file")!;
  assert.equal(row.state, "failed");
  assert.match(row.detail ?? "", /EISDIR/, row.detail);
  // The advice is the errno's own remedy, not a generic "fix or remove": a
  // directory where the file should be is moved aside, not deleted.
  assert.match(row.detail ?? "", /move the directory at that path aside/, row.detail);
  assert.doesNotMatch(row.detail ?? "", /ans auth repair/, "repair reads the same file：" + row.detail);
  assert.doesNotMatch(row.detail ?? "", /fix or remove/i, "on a read fault the file is fine：" + row.detail);
});

test("ans doctor：有正文没块报 unconfigured，不抬退出码", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-noblocks-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ANS_DB_PATH: process.env.ANS_DB_PATH };
  const dbPath = join(home, "anysearch.db");
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = dbPath;
    const store = new SqliteSessionStore(dbPath);
    store.close();
    const raw = openDatabase(dbPath);
    try {
      raw.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("doctor", "research");
      raw.prepare(
        "INSERT INTO retrieval_results (session_id, url, title, snippet, content, fetched) VALUES (?, ?, ?, ?, ?, 1)",
      ).run("doctor", "example.com/body-only", "正文页", "摘要", "## 安装\n\n这里是安装说明。");
    } finally {
      raw.close();
    }
    const lines: string[] = [];
    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    const payload = JSON.parse(lines.join("\n")) as DiagJson;
    const entry = payload.layers.flatMap((layer) => layer.entries).find((e) => e.name === "正文块向量");
    assert.ok(entry, "数据层要报一条「正文块向量」");
    assert.equal(entry.state, "unconfigured", "缺块是待补能力，不是坏掉");
    assert.match(entry.detail ?? "", /跑 ans memory backfill-vectors/, "detail 要给修法");
    assert.equal(code, 0, "缺块不该让 doctor 退出码变 1");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("ans doctor：正文块向量的补齐进度与积压看得见（#609）", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-doctor-chunks-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ANS_DB_PATH: process.env.ANS_DB_PATH };
  const dbPath = join(home, "anysearch.db");
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.ANS_DB_PATH = dbPath;
    // Build the schema through the store, then seed a page + blocks without
    // vectors directly: what doctor must report is the durable backlog, not
    // whether this process managed to load an embedding model.
    const store = new SqliteSessionStore(dbPath);
    store.close();
    const raw = openDatabase(dbPath);
    try {
      raw.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("doctor", "research");
      const page = raw.prepare(
        "INSERT INTO retrieval_results (session_id, url, title, snippet, content, fetched) VALUES (?, ?, ?, ?, ?, 1) RETURNING id",
      ).get("doctor", "example.com/guide", "指南", "这里是安装说明。", "## 安装\n\n这里是安装说明。") as { id: number };
      const insertChunk = raw.prepare(
        "INSERT INTO retrieval_chunks (page_id, parent_id, level, ord, start_offset, end_offset, heading_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const section = insertChunk.run(page.id, null, 0, 0, 14, 22, "指南 > 安装") as { lastInsertRowid: number };
      insertChunk.run(page.id, section.lastInsertRowid, 1, 0, 14, 22, "指南 > 安装");
      insertChunk.run(page.id, section.lastInsertRowid, 1, 1, 24, 32, "指南 > 安装");
    } finally {
      raw.close();
    }

    const lines: string[] = [];
    const code = await runDoctor(["--json"], { stdout: (line) => lines.push(line) });
    const payload = JSON.parse(lines.join("\n")) as DiagJson;
    const entry = payload.layers.flatMap((layer) => layer.entries).find((e) => e.name === "正文块向量");
    assert.ok(entry, "数据层要报一条「正文块向量」");
    assert.equal(entry.state, "ready", "积压不是故障，只是还没补完");
    assert.match(entry.detail ?? "", /已补 \d+ 块 \/ 待补 [1-9]\d* 块/, "detail 里必须能看出还剩多少没补");
    assert.equal(code, 0, "有积压也不该让 doctor 退出码变 1");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
