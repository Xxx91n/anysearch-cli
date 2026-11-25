// #579: every config.toml gets its own closed state, and the diagnostics are
// structured facts. The resolver stays the one reader; `warn` stays the human
// sentence beside them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveLlmConfig, type LlmConfigFileStatus, type LlmFileDiagnostic } from "../src/config-llm.js";

function makeBox() {
  const home = mkdtempSync(join(tmpdir(), "ans-status-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ans-status-proj-"));
  const warnings: string[] = [];
  return {
    home,
    cwd,
    userPath: join(home, ".ans", "config.toml"),
    projectPath: join(cwd, ".ans", "config.toml"),
    warnings,
    resolve: () => resolveLlmConfig({
      home, cwd, env: {}, credentials: false, warn: (m: string) => warnings.push(m),
    }),
  };
}

function writeToml(path: string, toml: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toml, "utf8");
}

test("六种文件状态：用户级", () => {
  const box = makeBox();
  const cases: Array<[LlmConfigFileStatus, string | undefined, string[], LlmFileDiagnostic[]]> = [
    ["missing", undefined, [], []],
    ["empty", "", [], []],
    ["no-llm", '[other]\nx = "y"\n', [], []],
    ["half", "[llm]\n", [], []],
    ["half", '[llm]\nprovider = "openai"\n', ["provider"], []],
    ["ok", '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n', ["provider", "model"], []],
    ["broken", '[llm\nprovider = "openai"\n', [], [{ kind: "invalid-toml" }]],
  ];
  for (const [status, toml, present, diagnostics] of cases) {
    if (toml === undefined) rmSync(box.userPath, { force: true });
    else writeToml(box.userPath, toml);
    const file = box.resolve().configFiles.user;
    assert.equal(file.layer, "user");
    assert.equal(file.status, status, "toml: " + JSON.stringify(toml));
    assert.deepEqual(file.present, present, "toml: " + JSON.stringify(toml));
    assert.deepEqual(file.diagnostics, diagnostics, "toml: " + JSON.stringify(toml));
  }
});

test("六种文件状态：项目级", () => {
  const box = makeBox();
  const cases: Array<[LlmConfigFileStatus, string | undefined, string[], LlmFileDiagnostic[]]> = [
    ["missing", undefined, [], []],
    ["empty", "\n \n", [], []],
    ["no-llm", '[other]\nx = "y"\n', [], []],
    ["half", "[llm]\n", [], []],
    ["half", '[llm]\nprovider = "google"\n', ["provider"], []],
    ["ok", '[llm]\nprovider = "google"\nmodel = "gemini-2.5-flash"\n', ["provider", "model"], []],
    ["broken", '[llm\nprovider = "google"\n', [], [{ kind: "invalid-toml" }]],
  ];
  for (const [status, toml, present, diagnostics] of cases) {
    if (toml === undefined) rmSync(box.projectPath, { force: true });
    else writeToml(box.projectPath, toml);
    const file = box.resolve().configFiles.project;
    assert.equal(file.layer, "project");
    assert.equal(file.status, status, "toml: " + JSON.stringify(toml));
    assert.deepEqual(file.present, present, "toml: " + JSON.stringify(toml));
    assert.deepEqual(file.diagnostics, diagnostics, "toml: " + JSON.stringify(toml));
    assert.equal(file.present.includes("provider"), present.includes("provider"));
  }
});

test("[llm] 写成字符串、数组或 datetime 都算 no-llm，附带 llm-not-table", () => {
  const box = makeBox();
  for (const toml of [
    'llm = "not a table"\n',
    'llm = ["not", "a", "table"]\n',
    "llm = 1979-05-27\n",
    "llm = 07:32:00\n",
    "llm = 1979-05-27T07:32:00\n",
    'llm = 1979-05-27T07:32:00Z\n',
    'llm = 1979-05-27T07:32:00-07:00\n',
    "[[llm]]\nprovider = \"openai\"\n",
  ]) {
    writeToml(box.userPath, toml);
    const file = box.resolve().configFiles.user;
    assert.equal(file.layer, "user");
    assert.equal(file.status, "no-llm", toml);
    assert.deepEqual(file.present, [], toml);
    assert.deepEqual(file.diagnostics, [{ kind: "llm-not-table" }], toml);
  }
});

test("broken 文件不贡献任何模型字段，另一个文件仍照常生效", () => {
  const box = makeBox();
  // User file is broken; the project file is complete and supplies both fields.
  writeToml(box.userPath, '[llm]\nprovider = "google"\nmodel =\n');
  writeToml(box.projectPath, '[llm]\nprovider = "openai"\nmodel = "gpt-5"\n');
  const cfg = box.resolve();
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "gpt-5");
  assert.equal(cfg.sources.provider, "project");
  assert.equal(cfg.sources.model, "project");
  assert.equal(cfg.configFiles.user.status, "broken");
  assert.deepEqual(cfg.configFiles.user.present, []);

  // The reverse: the project file is broken, so only the user file's fields count.
  writeToml(box.userPath, '[llm]\nprovider = "anthropic"\n');
  writeToml(box.projectPath, '[[llm]]\nmodel = "gpt-5"\n');
  const reversed = box.resolve();
  assert.equal(reversed.provider, "anthropic");
  assert.equal(reversed.model, undefined);
  assert.equal(reversed.sources.provider, "user");
  assert.equal(reversed.configFiles.project.status, "no-llm");
  assert.deepEqual(reversed.configFiles.project.present, []);
});

test("half 的合法字段照常参与逐字段覆盖", () => {
  const box = makeBox();
  writeToml(box.userPath, '[llm]\nmodel = "claude-haiku-4-5"\nbase_url = "https://user.example/v1"\napi = "messages"\n');
  writeToml(box.projectPath, '[llm]\nprovider = "anthropic"\n');
  const cfg = box.resolve();
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.sources.provider, "project");
  assert.equal(cfg.model, "claude-haiku-4-5");
  assert.equal(cfg.sources.model, "user");
  assert.equal(cfg.baseUrl, "https://user.example/v1");
  assert.equal(cfg.sources.baseUrl, "user");
  assert.equal(cfg.api, "messages");
  assert.equal(cfg.configFiles.user.status, "half");
  assert.deepEqual(cfg.configFiles.user.present, ["model", "base_url", "api"]);
});

test("诊断 kind：文件读不出来（config.toml 是目录）", () => {
  const box = makeBox();
  mkdirSync(box.userPath, { recursive: true });
  const file = box.resolve().configFiles.user;
  assert.equal(file.layer, "user");
  assert.equal(file.status, "broken");
  assert.deepEqual(file.diagnostics, [{ kind: "unreadable" }]);
  assert.deepEqual(file.present, []);
  assert.ok(!JSON.stringify(file).includes(box.userPath), "事实里不能有路径");
});

test("诊断 kind：TOML 坏", () => {
  const box = makeBox();
  writeToml(box.userPath, "[llm\nprovider = \"openai\"\n");
  const file = box.resolve().configFiles.user;
  assert.equal(file.layer, "user");
  assert.deepEqual(file.diagnostics, [{ kind: "invalid-toml" }]);
  assert.ok(!JSON.stringify(file).includes(box.userPath), "事实里不能有路径");
});

test("诊断 kind：项目级键被白名单拒绝，带键名不带 endpoint", () => {
  const box = makeBox();
  writeToml(box.projectPath, '[llm]\nprovider = "openai"\nbase_url = "https://endpoint-SENTINEL.example/v1"\n');
  const cfg = box.resolve();
  const file = cfg.configFiles.project;
  assert.equal(file.layer, "project");
  assert.deepEqual(file.diagnostics, [{ kind: "not-allowed-key", key: "base_url" }]);
  assert.equal(cfg.baseUrl, undefined, "被拒的键不生效");
  assert.ok(!JSON.stringify(file).includes("endpoint-SENTINEL"), "事实里不能有 endpoint");
  assert.ok(!JSON.stringify(file).includes(box.projectPath), "事实里不能有路径");
});

test("诊断 kind：疑似密钥，带键名不带值", () => {
  const box = makeBox();
  writeToml(box.userPath, '[llm]\nprovider = "openai"\napi_key = "sk-SECRET-SENTINEL"\n');
  const file = box.resolve().configFiles.user;
  assert.equal(file.layer, "user");
  assert.deepEqual(file.diagnostics, [{ kind: "secret-looking-key", key: "api_key" }]);
  assert.ok(!JSON.stringify(file).includes("sk-SECRET-SENTINEL"), "事实里不能有值");
  assert.ok(!box.warnings.some((w) => w.includes("sk-SECRET-SENTINEL")), "warning 里也不能有值");
});

test("诊断 kind：用户级未知键", () => {
  const box = makeBox();
  writeToml(box.userPath, '[llm]\nprovider = "openai"\nwho_knows = "value-SENTINEL"\n');
  const file = box.resolve().configFiles.user;
  assert.equal(file.layer, "user");
  assert.deepEqual(file.diagnostics, [{ kind: "unknown-key", key: "who_knows" }]);
  assert.ok(!JSON.stringify(file).includes("value-SENTINEL"), "事实里不能有值");
});

test("诊断键名去掉控制字符，warn 和事实都不带 ESC", () => {
  const box = makeBox();
  // A quoted TOML key can decode to an ANSI escape; `ans llm` prints the name.
  writeToml(box.userPath, '[llm]\nprovider = "openai"\n"\\u001b[2Kpwn" = "x"\n');
  const file = box.resolve().configFiles.user;
  const diagnostic = file.diagnostics[0];
  assert.equal(diagnostic?.kind, "unknown-key");
  assert.equal(diagnostic?.key, "[2Kpwn");
  assert.ok(!JSON.stringify(file).includes("\u001b"), "事实里不能有控制字符");
  assert.ok(!box.warnings.some((w) => w.includes("\u001b")), "warn 里也不能有控制字符");
});

test("诊断 kind：类型不对，带键名", () => {
  const box = makeBox();
  writeToml(box.projectPath, "[llm]\nprovider = 5\n");
  const file = box.resolve().configFiles.project;
  assert.equal(file.layer, "project");
  assert.equal(file.status, "half");
  assert.deepEqual(file.diagnostics, [{ kind: "invalid-type", key: "provider" }]);
  assert.deepEqual(file.present, []);
});

test("文件事实只带字段名：provider/model/base_url 的值都不出现", () => {
  const box = makeBox();
  writeToml(
    box.userPath,
    '[llm]\nprovider = "provider-VALUE-SENTINEL"\nmodel = "model-VALUE-SENTINEL"\n' +
    'base_url = "https://endpoint-VALUE-SENTINEL/v1"\napi = "chat"\n' +
    'extra = { note = "parse-TEXT-SENTINEL" }\n',
  );
  const cfg = box.resolve();
  assert.deepEqual(cfg.configFiles.user.present, ["provider", "model", "base_url", "api"]);
  const facts = JSON.stringify(cfg.configFiles);
  for (const sentinel of ["provider-VALUE-SENTINEL", "model-VALUE-SENTINEL", "endpoint-VALUE-SENTINEL", "parse-TEXT-SENTINEL"]) {
    assert.ok(!facts.includes(sentinel), "事实里不能有 " + sentinel);
  }
  assert.ok(!facts.includes(box.userPath), "事实里不能有路径");
  assert.ok(!facts.includes("ignoring [llm]"), "事实里不能有 warning 原文");
});

test("missing 文件也要有记录：两层永远都在", () => {
  const box = makeBox();
  const cfg = box.resolve();
  assert.equal(cfg.configFiles.user.layer, "user");
  assert.equal(cfg.configFiles.user.status, "missing");
  assert.deepEqual(cfg.configFiles.user.present, []);
  assert.deepEqual(cfg.configFiles.user.diagnostics, []);
  assert.equal(cfg.configFiles.project.layer, "project");
  assert.equal(cfg.configFiles.project.status, "missing");
});

test("displayPath 来自 resolver 的 home/cwd，旧布局也指对文件", () => {
  const box = makeBox();
  const cfg = box.resolve();
  assert.equal(cfg.configFiles.user.displayPath, "~/.ans/config.toml");
  assert.equal(cfg.configFiles.project.displayPath, ".ans/config.toml");

  // A resolver given another cwd must report THAT project's file, not the
  // process cwd's. Legacy layout is the case where the two names differ.
  const legacyCwd = mkdtempSync(join(tmpdir(), "ans-status-legacy-"));
  const legacyPath = join(legacyCwd, ".anysearch", "config.toml");
  writeToml(legacyPath, "[llm\n");
  const legacyCfg = resolveLlmConfig({
    home: box.home, cwd: legacyCwd, env: {}, credentials: false, warn: () => {},
  });
  assert.equal(legacyCfg.configFiles.project.displayPath, ".anysearch/config.toml");
  assert.equal(legacyCfg.configFiles.project.status, "broken");
});
