// 宿主接线「移除 / 中断续收」测试。
// 断言核心：
//   移除只摘本工具条目（资料/对话/账目/凭据一个不动）、幂等、用户改过照样按
//   归属删但说清楚；中断状态可诊断（status 报中断），repair 按当前文件现状
//   续收完成，不盲目套旧备份。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHostOperation, runHostStatus } from "../../src/host-wiring/run.js";
import { parseJsonc } from "../../src/host-wiring/jsonc-edit.js";
import { parseTomlSafe } from "../../src/host-wiring/toml-edit.js";
import { wiringRoot, appendEntry } from "../../src/host-wiring/journal.js";
import { fixture, writeProjectFile, MCP_JSON_WITH_COMMENT, SETTINGS_WITH_FOREIGN_HOOK } from "./materials.js";

async function connectedClaude(f: ReturnType<typeof fixture>): Promise<void> {
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const r = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0);
}

test("移除：只摘自家条目，别人家的东西、资料、对话、账目、凭据全不动", async () => {
  const f = await (async () => fixture())();
  await connectedClaude(f);
  // 用户数据：项目配置、研究资料库、项目索引（对话/账目在里面）、用户凭据。
  writeProjectFile(f.projectRoot, ".ans/config.toml", '[llm]\nprovider = "anthropic"\n');
  const dbBytes = "fake-fake-sqlite-bytes-research-data";
  writeProjectFile(f.projectRoot, ".ans/project-index.db", dbBytes);
  mkdirSync(join(f.home, ".ans"), { recursive: true });
  writeFileSync(join(f.home, ".ans/server-token"), "fake-token-not-a-secret-leak", "utf8");
  const journalBefore = readFileSync(join(f.projectRoot, ".ans/host-wiring/journal.jsonl"), "utf8");

  const lines2: string[] = [];
  const result = await runHostOperation("remove", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, lines2.join("\n"));
  const text = lines2.join("\n");
  assert.ok(text.includes("移除只摘了本工具在宿主配置里的条目"), "removal scope stated");
  assert.ok(text.includes("资料、对话、账目和凭据都没动"), "data untouched stated");
  // mcp.json：anysearch 没了，context7 和注释还在。
  const mcp = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  assert.ok(mcp.includes("// Upstash context7"), "comment survives");
  const mp = parseJsonc(mcp);
  assert.ok(mp.ok);
  assert.equal((mp.value as any).mcpServers.anysearch, undefined);
  assert.deepEqual((mp.value as any).mcpServers.context7, {
    command: "npx", args: ["-y", "@upstash/context7-mcp"],
  });
  // settings.json：我们的三个事件没了；别人的 hook 和 permissions 还在。
  const settings = readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8");
  const sp = parseJsonc(settings);
  assert.ok(sp.ok);
  assert.equal((sp.value as any).permissions.allow[0], "Bash(git:*)");
  assert.equal((sp.value as any).hooks.PreToolUse.length, 1);
  assert.equal((sp.value as any).hooks.PreToolUse[0].matcher, "read_file");
  assert.equal((sp.value as any).hooks.PostToolUse, undefined);
  assert.equal((sp.value as any).hooks.SessionStart, undefined);
  // 资料/对话/账目/凭据：字节不动。
  assert.equal(readFileSync(join(f.projectRoot, ".ans/config.toml"), "utf8"), '[llm]\nprovider = "anthropic"\n');
  assert.equal(readFileSync(join(f.projectRoot, ".ans/project-index.db"), "utf8"), dbBytes);
  assert.equal(readFileSync(join(f.home, ".ans/server-token"), "utf8"), "fake-token-not-a-secret-leak");
  // journal 只增不减（恢复依据保留）。
  const journalAfter = readFileSync(join(f.projectRoot, ".ans/host-wiring/journal.jsonl"), "utf8");
  assert.ok(journalAfter.length > journalBefore.length);
  assert.ok(journalAfter.startsWith(journalBefore), "old entries preserved");
});

test("移除幂等：再移除一次无事可做", async () => {
  const f = fixture();
  await connectedClaude(f);
  await runHostOperation("remove", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  const before = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  const lines2: string[] = [];
  const r2 = await runHostOperation("remove", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r2.code, 0);
  assert.ok(lines2.join("\n").includes("幂等"));
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), before);
});

test("移除时条目被用户改过 → 照样按归属删，输出里说清楚", async () => {
  const f = fixture();
  await connectedClaude(f);
  // 用户改了我们的条目（比如调了 timeout）。
  const parsed = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(parsed.ok);
  const mutated = structuredClone(parsed.value as Record<string, unknown>);
  (mutated.mcpServers as Record<string, unknown>).anysearch = {
    command: "ans-mcp", args: ["--user-added"], env: {},
  };
  writeFileSync(join(f.projectRoot, "mcp.json"), JSON.stringify(mutated, null, 2), "utf8");
  const lines2: string[] = [];
  const result = await runHostOperation("remove", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0);
  const text = lines2.join("\n");
  assert.ok(text.includes("你改过"), "modified state reported");
  const after = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(after.ok);
  assert.equal((after.value as any).mcpServers.anysearch, undefined, "removed by ownership");
});

test("codex 移除（用户级 TOML）：我们的表和段没了，别的表原样", async () => {
  const f = fixture();
  const config = [
    "# user config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
    "",
    "[mcp_servers.anysearch]",
    'command = "ans-mcp"',
    "startup_timeout_sec = 60",
    "",
    "[[hooks.SessionStart]]",
    'matcher = "startup"',
    'hooks = [{ type = "command", command = "my-other-tool --hook", timeout = 5 }]',
    "",
    "[[hooks.PreToolUse]]",
    'matcher = ".*(search_web)$"',
    'hooks = [{ type = "command", command = "ans-hook-codex", timeout = 5 }]',
  ].join("\n") + "\n";
  mkdirSync(join(f.home, ".codex"), { recursive: true });
  writeFileSync(join(f.home, ".codex/config.toml"), config, "utf8");
  const result = await runHostOperation("remove", "codex", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, f.lines.join("\n"));
  const after = readFileSync(join(f.home, ".codex/config.toml"), "utf8");
  assert.ok(after.includes("# user config"));
  assert.ok(after.includes("[mcp_servers.context7]"));
  assert.ok(after.includes('command = "my-other-tool --hook"'));
  assert.ok(!after.includes("mcp_servers.anysearch"));
  assert.ok(!after.includes("ans-hook-codex"));
  const parsed = parseTomlSafe(after);
  assert.ok(parsed.ok);
});

test("中断可诊断：journal 落了 planned 没写文件 → status 报中断，repair 续收完成", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  // 手工模拟「journal 已落 planned、文件还没写」的中断状态。
  const root = wiringRoot("project", f.projectRoot, f.home);
  appendEntry(root, {
    id: "op-fake-interrupt", ts: new Date().toISOString(), op: "connect", host: "claude",
    status: "planned",
    files: [
      { path: join(f.projectRoot, "mcp.json"), scope: "project", written: false, verified: false },
      { path: join(f.projectRoot, ".claude/settings.json"), scope: "project", written: false, verified: false },
    ],
    units: {},
  });
  // status：报中断。
  const linesStatus: string[] = [];
  runHostStatus(["claude"], { stdout: (t) => linesStatus.push(t), projectRoot: f.projectRoot, home: f.home });
  const statusText = linesStatus.join("\n");
  assert.ok(statusText.includes("中断"), "interruption diagnosed");
  assert.ok(statusText.includes("没写"), "unwritten files listed");
  assert.ok(statusText.includes("repair"), "repair hint given");
  // repair：续上（文件还没写过 → 全部 add）→ 完成。
  const linesRepair: string[] = [];
  const r = await runHostOperation("repair", "claude", { stdout: (t) => linesRepair.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0, linesRepair.join("\n"));
  assert.ok(linesRepair.join("\n").includes("没做完"), "interruption acknowledged");
  const mp = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(mp.ok);
  assert.deepEqual((mp.value as any).mcpServers.anysearch, { command: "ans-mcp", args: [], env: {} });
  assert.ok(readFileSync(join(f.projectRoot, "mcp.json"), "utf8").includes("// Upstash context7"), "other tool's comment survives the resumed repair");
  // journal 收尾为 done。
  const journal = readFileSync(join(root, "journal.jsonl"), "utf8");
  const last = JSON.parse(journal.trimEnd().split("\n").pop()!);
  assert.equal(last.status, "done");
});

test("中断在半个文件（partial）：repair 只补没写的，已写的不重写", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  // 模拟：第一个文件已按接入后状态写好、第二个没写；journal 记 partial。
  // 用编辑器写出「接入后」的第一文件（跟真实流程一致的形态）。
  const { writeJsoncPath } = await import("../../src/host-wiring/jsonc-edit.js");
  const seeded = writeJsoncPath(MCP_JSON_WITH_COMMENT, ["mcpServers", "anysearch"], { command: "ans-mcp", args: [], env: {} });
  assert.ok(seeded.ok);
  writeProjectFile(f.projectRoot, "mcp.json", seeded.text);
  const root = wiringRoot("project", f.projectRoot, f.home);
  appendEntry(root, {
    id: "op-fake-partial", ts: new Date().toISOString(), op: "connect", host: "claude",
    status: "partial",
    files: [
      { path: join(f.projectRoot, "mcp.json"), scope: "project", written: true, verified: true,
        afterHash: "x" },
      { path: join(f.projectRoot, ".claude/settings.json"), scope: "project", written: false, verified: false },
    ],
    units: { "mcp:anysearch": JSON.stringify({ command: "ans-mcp", args: [], env: {} }) },
  });
  const lines2: string[] = [];
  const r = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0, lines2.join("\n"));
  // 已写的文件字节不变（repair 没重写它——unchanged）。
  assert.equal(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), seeded.text);
  // 没写的文件补齐。
  const sp = parseJsonc(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"));
  assert.ok(sp.ok);
  const hooks = (sp.value as any).hooks;
  assert.equal(hooks.PreToolUse.length, 2);
  assert.deepEqual(hooks.SessionStart, [
    { matcher: "startup", hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }] },
  ]);
  // 续收完的 done 行记全单元基线（含本次没动的 mcp:anysearch）。
  const journalAfter = readFileSync(join(root, "journal.jsonl"), "utf8");
  const doneEntry = journalAfter.trimEnd().split("\n").map((l) => JSON.parse(l)).at(-1) as any;
  assert.equal(doneEntry.status, "done");
  assert.ok(doneEntry.units["mcp:anysearch"], "unchanged unit recorded in baseline");
  assert.ok(doneEntry.units["hook:PreToolUse"], "acting unit recorded in baseline");
  // 用户续收后再改已写文件的条目 → repair 归因是「你改过」，不是「没有我们写过的记录」。
  const mutated = parseJsonc(seeded.text);
  assert.ok(mutated.ok);
  const cloned = structuredClone(mutated.value as Record<string, unknown>);
  (cloned.mcpServers as Record<string, unknown>).anysearch = { command: "ans-mcp", args: ["--user-edit"], env: {} };
  writeFileSync(join(f.projectRoot, "mcp.json"), JSON.stringify(cloned, null, 2), "utf8");
  const lines3: string[] = [];
  const r3 = await runHostOperation("repair", "claude", { stdout: (t) => lines3.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r3.code, 1, "conflict stops the repair");
  const text3 = lines3.join("\n");
  assert.ok(text3.includes("改过"), "attributed as user-modified");
  assert.ok(!text3.includes("没有我们写过的记录"), "not misattributed as no-record");
});

test("journal.ts 的 wiringRoot 与 journal 文件路径一致（项目级/用户级）", () => {
  const f = fixture();
  assert.equal(wiringRoot("project", f.projectRoot, f.home), join(f.projectRoot, ".ans/host-wiring"));
  assert.equal(wiringRoot("user", f.projectRoot, f.home), join(f.home, ".ans/host-wiring"));
});

test("移除手写的同名条目（没有我们写入记录）：照样按归属删，但输出说清楚", async () => {
  const f = fixture();
  // 用户手写了一个 anysearch 条目（从未经过 connect，journal 无记录）。
  const handwritten = JSON.stringify({
    mcpServers: {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      anysearch: { command: "ans-mcp", args: [], env: {} },
    },
  }, null, 2);
  writeProjectFile(f.projectRoot, "mcp.json", handwritten);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const lines2: string[] = [];
  const result = await runHostOperation("remove", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 0, lines2.join("\n"));
  const text = lines2.join("\n");
  assert.ok(text.includes("没有我们写过的记录"), "no-record removal explained");
  assert.ok(text.includes("手写"), "mentions handwritten possibility");
  // 手写的条目被按归属移除；context7 保留。
  const after = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(after.ok);
  assert.equal((after.value as any).mcpServers.anysearch, undefined);
  assert.deepEqual((after.value as any).mcpServers.context7, { command: "npx", args: ["-y", "@upstash/context7-mcp"] });
});

test("status 能力层：模型能力独立标未配置（只看设没设，不显示值）", () => {
  const f = fixture();
  const lines2: string[] = [];
  // 刻意注入空环境：一切未配置。
  runHostStatus(["claude"], { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home, env: {} });
  const text = lines2.join("\n");
  assert.ok(text.includes("[能力]"), "capability layer present");
  assert.ok(text.includes("ANS_LLM_API_KEY：未设置"), "env key marked 未设置");
  assert.ok(text.includes("模型 provider：未配置"), "provider marked 未配置");
  assert.ok(text.includes("不显示值"), "no-value claim stated");
  // 设上 provider/model 之后（用户级 TOML），能力层如实翻成已配置。
  mkdirSync(join(f.home, ".ans"), { recursive: true });
  writeFileSync(join(f.home, ".ans/config.toml"), '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-6"\n', "utf8");
  const lines3: string[] = [];
  runHostStatus(["claude"], { stdout: (t) => lines3.push(t), projectRoot: f.projectRoot, home: f.home, env: {} });
  const text3 = lines3.join("\n");
  assert.ok(text3.includes("模型 provider：已配置（user 层）"), "provider marked configured with layer");
  assert.ok(text3.includes("模型 model：已配置（user 层）"), "model marked configured with layer");
});
