// 宿主接线流程测试。
// 材料：本仓宿主模板形态 + Context7 场景（注释、其他工具条目当「别人家的东西」）。
// 断言核心：
//   接入只动自家条目（注释/换行/别人条目保留）、幂等、预览不落盘、解析不安全
//   明确失败、冲突保留现场、写后验证进操作日志、密钥全程不看。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHostOperation, runHostStatus } from "../../src/host-wiring/run.js";
import { parseJsonc } from "../../src/host-wiring/jsonc-edit.js";
import { parseTomlSafe } from "../../src/host-wiring/toml-edit.js";
import { fixture, writeProjectFile, MCP_JSON_WITH_COMMENT, SETTINGS_WITH_FOREIGN_HOOK } from "./materials.js";

// 材料：带注释 + context7 条目（其他工具）的 mcp.json。
test("claude 接入：注释、别的工具条目原样保留，自家条目就位，写后验证过", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, f.lines.join("\n"));
  // mcp.json：context7 原样 + anysearch 新增。
  const mcp = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  assert.ok(mcp.includes("// Upstash context7"), "comment survives");
  assert.ok(mcp.includes('"context7"'), "other tool survives");
  const mcpParsed = parseJsonc(mcp);
  assert.ok(mcpParsed.ok);
  assert.deepEqual((mcpParsed.value as any).mcpServers.anysearch, { command: "ans-mcp", args: [], env: {} });
  assert.deepEqual((mcpParsed.value as any).mcpServers.context7, {
    command: "npx", args: ["-y", "@upstash/context7-mcp"],
  });
  // settings.json：别人的 hook 保留 + 我们三个事件就位 + permissions 保留。
  const settings = readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8");
  assert.ok(settings.includes("// project settings"), "comment survives");
  const sp = parseJsonc(settings);
  assert.ok(sp.ok);
  const hooks = (sp.value as any).hooks;
  assert.equal(hooks.PreToolUse.length, 2);
  assert.deepEqual(hooks.PreToolUse[0], {
    matcher: "read_file", hooks: [{ type: "command", command: "lint-before", timeout: 30 }],
  });
  assert.deepEqual(hooks.PreToolUse[1], {
    matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }],
  });
  assert.deepEqual(hooks.PostToolUse, [
    { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 10 }] },
  ]);
  assert.deepEqual(hooks.SessionStart, [
    { matcher: "startup", hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }] },
  ]);
  assert.deepEqual((sp.value as any).permissions, { allow: ["Bash(git:*)"] });
  // journal：done + verified。
  const journal = readFileSync(join(f.projectRoot, ".ans/host-wiring/journal.jsonl"), "utf8");
  const lastLine = journal.trimEnd().split("\n").pop()!;
  const entry = JSON.parse(lastLine);
  assert.equal(entry.status, "done");
  assert.ok(entry.files.every((r: any) => r.written && r.verified));
  // 备份：两份原文字节。
  const mcpBackup = entry.files.find((r: any) => r.path.endsWith("mcp.json")).backup;
  assert.ok(mcpBackup && existsSync(mcpBackup));
  assert.equal(readFileSync(mcpBackup, "utf8"), MCP_JSON_WITH_COMMENT);
  const settingsBackup = entry.files.find((r: any) => r.path.endsWith("settings.json")).backup;
  assert.equal(readFileSync(settingsBackup, "utf8"), SETTINGS_WITH_FOREIGN_HOOK);
  // 输出收尾：待办 + 不冒充宿主跑过。
  const text = f.lines.join("\n");
  assert.ok(text.includes("待办"), "todo listed");
  assert.ok(text.includes("配置写入不代表宿主已生效"));
});

test("接入幂等：第二次什么都不动，文件字节不变", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  const afterFirst = {
    mcp: readFileSync(join(f.projectRoot, "mcp.json"), "utf8"),
    settings: readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"),
  };
  const lines2: string[] = [];
  const result2 = await runHostOperation("connect", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(result2.code, 0);
  assert.ok(lines2.join("\n").includes("幂等"), "idempotent message");
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), afterFirst.mcp, "mcp.json untouched");
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), afterFirst.settings, "settings untouched");
});

test("预览：不落盘一个字节，输出会改什么", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = await runHostOperation("preview", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0);
  const text = f.lines.join("\n");
  assert.ok(text.includes("本次不会写任何文件"));
  assert.ok(text.includes("mcp:anysearch"));
  assert.ok(text.includes("hook:PreToolUse"));
  // 文件字节不动。
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), MCP_JSON_WITH_COMMENT);
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), SETTINGS_WITH_FOREIGN_HOOK);
  // journal 都不该出现（预览不算操作）。
  assert.ok(!existsSync(join(f.projectRoot, ".ans/host-wiring/journal.jsonl")));
});

test("codex 接入（用户级 TOML）：别的 mcp_servers、别的 hooks 段、注释都保留", async () => {
  const f = fixture();
  const config = [
    "# user config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
    'args = ["-y", "@upstash/context7-mcp"]',
    "startup_timeout_sec = 30",
    "",
    "[[hooks.SessionStart]]",
    'matcher = "startup"',
    'hooks = [{ type = "command", command = "my-other-tool --hook", timeout = 5 }]',
  ].join("\n") + "\n";
  mkdirSync(join(f.home, ".codex"), { recursive: true });
  writeFileSync(join(f.home, ".codex/config.toml"), config, "utf8");
  const result = await runHostOperation("connect", "codex", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, f.lines.join("\n"));
  const after = readFileSync(join(f.home, ".codex/config.toml"), "utf8");
  assert.ok(after.includes("# user config"), "comment survives");
  assert.ok(after.includes("[mcp_servers.context7]"), "other tool's table survives");
  assert.ok(after.includes('command = "my-other-tool --hook"'), "other tool's hook survives");
  const parsed = parseTomlSafe(after);
  assert.ok(parsed.ok);
  const v = parsed.value as any;
  assert.deepEqual(v.mcp_servers.context7, { command: "npx", args: ["-y", "@upstash/context7-mcp"], startup_timeout_sec: 30 });
  assert.deepEqual(v.mcp_servers.anysearch, { command: "ans-mcp", startup_timeout_sec: 60 });
  // SessionStart：别人 1 段 + 我们 1 段。
  assert.equal(v.hooks.SessionStart.length, 2);
  // PreToolUse/PostToolUse：我们的段。
  assert.deepEqual(v.hooks.PreToolUse, [
    { matcher: ".*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$",
      hooks: [{ type: "command", command: "ans-hook-codex", timeout: 5 }] },
  ]);
  // journal 在用户级 wiring root。
  assert.ok(existsSync(join(f.home, ".ans/host-wiring/journal.jsonl")));
  // 待办里如实说 [features].hooks 开关不替宿主动。
  const text = f.lines.join("\n");
  assert.ok(text.includes("[features].hooks"));
});

test("语法坏的 TOML → 接入明确失败，文件一个字节不动", async () => {
  const f = fixture();
  const broken = "[mcp_servers.context7\ncommand = oops\n";
  mkdirSync(join(f.home, ".codex"), { recursive: true });
  writeFileSync(join(f.home, ".codex/config.toml"), broken, "utf8");
  const result = await runHostOperation("connect", "codex", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1);
  const text = f.lines.join("\n");
  assert.ok(text.includes("语法解析失败"), "explicit unsafe failure");
  assert.ok(text.includes("没有动任何文件"), "no writes");
  assert.equal(readFileSync(join(f.home, ".codex/config.toml"), "utf8"), broken, "file untouched");
});

test("语法坏的 JSONC → 接入明确失败，文件一个字节不动", async () => {
  const f = fixture();
  const broken = "{ \"mcpServers\": ";
  writeProjectFile(f.projectRoot, "mcp.json", broken);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1);
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), broken, "file untouched");
  // 另一个没毛病的文件也一个字节没动（整体退出，不半途写）。
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), SETTINGS_WITH_FOREIGN_HOOK);
});

test("结构不对（mcpServers 是字符串）→ 明确失败，不整份覆盖", async () => {
  const f = fixture();
  const weird = '{ "mcpServers": "someone put a string here" }';
  writeProjectFile(f.projectRoot, "mcp.json", weird);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1);
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), weird, "file untouched");
});

test("手写过 anysearch 条目（没有我们写过的记录）→ 冲突保留现场", async () => {
  const f = fixture();
  const handwritten = [
    "{",
    '  "mcpServers": {',
    '    "anysearch": { "command": "user-wrote-this-by-hand" }',
    "  }",
    "}",
  ].join("\n");
  writeProjectFile(f.projectRoot, "mcp.json", handwritten);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1);
  const text = f.lines.join("\n");
  assert.ok(text.includes("没有我们写过的记录"), "conflict explained");
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), handwritten, "现场保留");
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), SETTINGS_WITH_FOREIGN_HOOK, "别的文件也没动");
});

test("接入后用户改过我们的条目 → 修复报冲突、保留现场、不套旧备份", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  // 用户后来手改我们的条目。
  const afterConnect = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(afterConnect.ok);
  const mutated = structuredClone(afterConnect.value as Record<string, unknown>);
  (mutated.mcpServers as Record<string, unknown>).anysearch = {
    command: "ans-mcp-custom-edited", args: [], env: {},
  };
  writeFileSync(join(f.projectRoot, "mcp.json"), JSON.stringify(mutated, null, 2), "utf8");
  const beforeRepair = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  const lines2: string[] = [];
  const result = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1);
  const text = lines2.join("\n");
  assert.ok(text.includes("改过"), "modified detected");
  assert.ok(text.includes("保留现场"), "现场保留 explained");
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), beforeRepair, "文件没动");
});

test("接入后我们升级了候选（老条目还是基线）→ 修复更新成新候选", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  // 修复：什么都不变时是幂等（没有 add/replace）。
  const lines2: string[] = [];
  const r2 = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r2.code, 0);
  assert.ok(lines2.join("\n").includes("幂等"));
  const afterRepair = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  const parsed = parseJsonc(afterRepair);
  assert.ok(parsed.ok);
  assert.equal((parsed.value as any).mcpServers.anysearch.command, "ans-mcp");
});

test("密钥没配也照常接入（接线全程不看密钥）", async () => {
  const f = fixture();
  // 刻意清空环境里的 key 类变量（模拟没配任何密钥的机器）。
  const saved: Record<string, string | undefined> = {};
  for (const key of ["ANS_LLM_API_KEY", "EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY", "ANS_LLM_PROVIDER", "ANS_LLM_MODEL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
    writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
    const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
    assert.equal(result.code, 0, "connect succeeds with no keys configured");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("status：分层报告（安装/接线/宿主验证），宿主验证如实说未验证", () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const result = runHostStatus(["claude"], { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0);
  const text = f.lines.join("\n");
  assert.ok(text.includes("[安装]"), "install layer");
  assert.ok(text.includes("[接线]"), "wiring layer");
  assert.ok(text.includes("[宿主验证] 未验证"), "verification layer says unverified");
  assert.ok(text.includes("[能力]"), "capability layer");
  assert.ok(text.includes("不读密钥值"), "keys explicitly out of scope");
});

test("antigravity 接入（用户级 named-hook map）→ 顶层 anysearch 键就位", async () => {
  const f = fixture();
  const existing = [
    "{",
    "  // someone else's hook",
    '  "their-tool": {',
    '    "PreToolUse": [{ "type": "command", "command": "their-cmd", "timeout": 5 }]',
    "  }",
    "}",
  ].join("\n");
  mkdirSync(join(f.home, ".gemini/antigravity-cli"), { recursive: true });
  writeFileSync(join(f.home, ".gemini/antigravity-cli/hooks.json"), existing, "utf8");
  const result = await runHostOperation("connect", "antigravity", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, f.lines.join("\n"));
  const after = readFileSync(join(f.home, ".gemini/antigravity-cli/hooks.json"), "utf8");
  assert.ok(after.includes("// someone else's hook"), "comment survives");
  const parsed = parseJsonc(after);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any)["their-tool"], {
    PreToolUse: [{ type: "command", command: "their-cmd", timeout: 5 }],
  });
  const ours = (parsed.value as any).anysearch;
  assert.equal(ours.PreToolUse[0].hooks[0].command, "ans-hook-antigravity PreToolUse");
  assert.equal(ours.Stop[0].command, "ans-hook-antigravity Stop");
});

test("codebuddy 接入（项目级）→ settings 三个事件就位，命令走完整安装自带的钩子 bin", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  const result = await runHostOperation("connect", "codebuddy", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, f.lines.join("\n"));
  const settings = readFileSync(join(f.projectRoot, ".codebuddy/settings.json"), "utf8");
  const sp = parseJsonc(settings);
  assert.ok(sp.ok);
  const hooks = (sp.value as any).hooks;
  assert.equal(hooks.PreToolUse[0].matcher, "search_web|research_web|recall_memory|query_knowledge|ans_chat");
  // 完整安装带齐钩子 bin（ans-hook-codebuddy），不要求另装插件包、不写
  // node "$(npm root -g)/..." 这种依赖全局插件包的手抄路径。
  assert.equal(hooks.PreToolUse[0].hooks[0].command, "ans-hook-codebuddy");
  assert.equal(hooks.SessionStart[0].hooks[0].command, "ans-hook-codebuddy");
});
