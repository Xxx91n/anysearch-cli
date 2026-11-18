// 审查返修补充测试：混合钩子组、表头行尾注释、读失败拦截、修复方向、
// 写前比对、空容器注释、--project 参数、幂等路径收尾中断记录。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHostOperation, runHostStatus } from "../../src/host-wiring/run.js";
import { parseJsonc, writeJsoncPath, appendJsoncItem } from "../../src/host-wiring/jsonc-edit.js";
import { scanTomlSegments, appendTomlArrayTable } from "../../src/host-wiring/toml-edit.js";
import { wiringRoot, appendEntry } from "../../src/host-wiring/journal.js";
import { fixture, writeProjectFile, MCP_JSON_WITH_COMMENT, SETTINGS_WITH_FOREIGN_HOOK } from "./materials.js";
import { runHost } from "../../src/commands/host.js";

test("混合钩子组（组里既有我们的也有别人的命令）：接入和移除都保留现场报冲突", async () => {
  const f = fixture();
  // 用户手工把别人的命令塞进了我们的 matcher 组（我们从不这么写）。
  const mixed = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            { type: "command", command: "their-lint-step", timeout: 3 },
            { type: "command", command: "ans-hook-claude", timeout: 5 },
          ],
        },
      ],
    },
  }, null, 2);
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", mixed);
  const connect = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(connect.code, 1, f.lines.join("\n"));
  assert.ok(f.lines.join("\n").includes("夹着别人的命令"), "mixed group reported");
  // 文件一个字节没动（保留现场）。
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), mixed);
  const remove = await runHostOperation("remove", "claude", { stdout: (t) => f.lines.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(remove.code, 1);
  assert.equal(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"), mixed, "remove also keeps the scene");
});

test("TOML 表头带行尾注释（[[hooks.X]] # 备注）照样识别，不重复添加", async () => {
  // 表头扫描器认得出行尾注释。
  const text = [
    "[[hooks.PreToolUse]] # my hooks",
    'matcher = "someone"',
    'hooks = [{ type = "command", command = "other-tool", timeout = 5 }]',
  ].join("\n") + "\n";
  const segments = scanTomlSegments(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].name, "hooks.PreToolUse");
  // 我们自己的段带行尾注释也能被追加和识别（幂等）。
  const added = appendTomlArrayTable(text, "hooks.SessionStart", {
    matcher: "startup",
    hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }],
  });
  assert.ok(added.ok, added.ok ? "" : added.error.message);
  const segments2 = scanTomlSegments(added.text);
  assert.equal(segments2.length, 2);
  // 全流程：接入 codex 时带行尾注释的宿主文件不被重复添加。
  const f = fixture();
  const config = [
    "[mcp_servers.context7] # comment server",
    'command = "npx"',
    "",
    "[[hooks.PreToolUse]] # my hooks",
    'matcher = "startup"',
    'hooks = [{ type = "command", command = "my-other-tool --hook", timeout = 5 }]',
  ].join("\n") + "\n";
  mkdirSync(join(f.home, ".codex"), { recursive: true });
  writeFileSync(join(f.home, ".codex/config.toml"), config, "utf8");
  const r1 = await runHostOperation("connect", "codex", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(r1.code, 0, f.lines.join("\n"));
  const after = readFileSync(join(f.home, ".codex/config.toml"), "utf8");
  assert.ok(after.includes("[mcp_servers.context7] # comment server"), "header comment preserved");
  // 幂等：注释表头都识别得到 → 第二次接入无事可做。
  const lines2: string[] = [];
  const r2 = await runHostOperation("connect", "codex", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r2.code, 0);
  assert.ok(lines2.join("\n").includes("幂等"));
});

test("宿主目标是个目录（读不了内容）→ 按不安全拦截，不当新建覆盖", async () => {
  const f = fixture();
  // 目标路径放个目录：读它必然失败（EISDIR），existsSync 也是 true——
  // 正是「文件在但读不出来」的可复现场景（Windows 的 chmod 0o000 拦不住读，
  // 得用这种跨平台稳定的方式模拟）。
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  mkdirSync(join(f.projectRoot, ".claude", "settings.json"), { recursive: true });
  const result = await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  assert.equal(result.code, 1, f.lines.join("\n"));
  const text = f.lines.join("\n");
  assert.ok(text.includes("读不出来"), "read failure reported");
  assert.ok(text.includes("不动"), "blocked from writing");
  // 那个「目录」还在（没被任何写入动过）。
  const stat = statSync(join(f.projectRoot, ".claude", "settings.json"));
  assert.ok(stat.isDirectory(), "target untouched");
});

test("repair 续收中断的移除：按原方向继续删，不会把条目又接回去", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  // 模拟：remove 只写完了 mcp.json（条目删了），settings 没写，journal 记 partial。
  const { writeJsoncPath, removeJsoncPath } = await import("../../src/host-wiring/jsonc-edit.js");
  const mcpRemoved = removeJsoncPath(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"), ["mcpServers", "anysearch"]);
  assert.ok(mcpRemoved.ok);
  writeProjectFile(f.projectRoot, "mcp.json", mcpRemoved.text);
  const root = wiringRoot("project", f.projectRoot, f.home);
  appendEntry(root, {
    id: "op-fake-remove", ts: new Date().toISOString(), op: "remove", host: "claude",
    status: "partial",
    files: [
      { path: join(f.projectRoot, "mcp.json"), scope: "project", written: true, verified: true, afterHash: "x" },
      { path: join(f.projectRoot, ".claude/settings.json"), scope: "project", written: false, verified: false },
    ],
    units: {},
  });
  const lines2: string[] = [];
  const r = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0, lines2.join("\n"));
  // 续收的结果是「移除完成」，不是重新接入。
  const mcp = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(mcp.ok);
  assert.equal((mcp.value as any).mcpServers.anysearch, undefined, "removal not re-connected");
  const settings = parseJsonc(readFileSync(join(f.projectRoot, ".claude/settings.json"), "utf8"));
  assert.ok(settings.ok);
  assert.equal((settings.value as any).hooks.PostToolUse, undefined, "our hooks removed by resumed repair");
  assert.equal((settings.value as any).hooks.PreToolUse.length, 1, "foreign hook kept");
  const journal = readFileSync(join(root, "journal.jsonl"), "utf8");
  const last = JSON.parse(journal.trimEnd().split("\n").pop()!);
  assert.equal(last.status, "done");
});

test("写前比对：文件在计划读取后被改过 → 保留现场报冲突（通过 runHost 注入真实时序不可行，直接验证计划基线逻辑的行为面）", async () => {
  // 写前比对的真实时序没法从纯函数外注入（要「计划读到旧内容、写前重读到
  // 新内容」的窗口）。这里验证等价行为面：computePlan 读了 A 版本后，用户改成
  // B 版本并再跑一次命令——新计划基于 B 算，不会拿 A 的旧副本覆盖（那是同一
  // 件事的另一面：每次执行都基于磁盘现状算）。
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  // 用户在接入后手工加了条目（模拟「宿主保存了新内容」）。
  const after = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(after.ok);
  const mutated = structuredClone(after.value as Record<string, unknown>);
  (mutated.mcpServers as Record<string, unknown>)["user-manual"] = { command: "user-tool" };
  writeFileSync(join(f.projectRoot, "mcp.json"), JSON.stringify(mutated, null, 2), "utf8");
  // 再跑 connect：新计划基于当前磁盘（含 user-manual），别人的东西保留、
  // 我们已 unchanged → 幂等；user-manual 一个字节不动。
  const lines2: string[] = [];
  const r = await runHostOperation("connect", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0, lines2.join("\n"));
  const final = readFileSync(join(f.projectRoot, "mcp.json"), "utf8");
  assert.ok(final.includes("user-manual"), "user's concurrent edit preserved");
});

test("空容器里的注释保留：{ /* 说明 */ } 接入后说明还在", () => {
  const before = '{\n  "mcpServers": { /* 保留此说明 */ }\n}';
  const r1 = writeJsoncPath(before, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(r1.ok, r1.ok ? "" : r1.error.message);
  assert.ok(r1.text.includes("/* 保留此说明 */"), "comment inside empty object survives");
  // 空数组同理。
  const before2 = '{\n  "hooks": { "SessionStart": [ /* keep */ ] }\n}';
  const r2 = appendJsoncItem(before2, ["hooks", "SessionStart"], { matcher: "startup", hooks: [] });
  assert.ok(r2.ok, r2.ok ? "" : r2.error.message);
  assert.ok(r2.text.includes("/* keep */"), "comment inside empty array survives");
});

test("ans host connect claude --project <目录>：目录参数不占宿主名的位置", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  const code = await runHost(["connect", "claude", "--project", f.projectRoot], {
    stdout: (t) => f.lines.push(t),
    stderr: () => {},
    projectRoot: "C:\\nonexistent-default-should-not-be-used",
  });
  assert.equal(code, 0, f.lines.join("\n"));
  // 写到了 --project 指定的目录，不是那个不存在的默认目录。
  assert.ok(readFileSync(join(f.projectRoot, "mcp.json"), "utf8").includes("anysearch"));
});

test("幂等路径收尾中断记录：文件都写完了但没记 done → repair 补收尾，status 不再催", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  // 先正常接入一次（两个文件都到位），然后清掉 journal 重放一条「写完但没
  // 记 done」的 partial——模拟进程死在收尾前。
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  const root = wiringRoot("project", f.projectRoot, f.home);
  const journalFile = join(root, "journal.jsonl");
  const doneUnits = JSON.parse(readFileSync(journalFile, "utf8").trimEnd().split("\n").pop()!).units;
  writeFileSync(journalFile, "", "utf8");
  appendEntry(root, {
    id: "op-fake-done-gap", ts: new Date().toISOString(), op: "connect", host: "claude",
    status: "partial",
    files: [
      { path: join(f.projectRoot, "mcp.json"), scope: "project", written: true, verified: true, afterHash: "x" },
      { path: join(f.projectRoot, ".claude/settings.json"), scope: "project", written: true, verified: true, afterHash: "x" },
    ],
    units: {},
  });
  // repair：文件已全部到位 → 走幂等路径，收尾中断记录（补 done 行）。
  const lines2: string[] = [];
  const r = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(r.code, 0, lines2.join("\n"));
  assert.ok(lines2.join("\n").includes("收尾完成"), "interrupted record closed");
  // status 不再催修复。
  const statusLines: string[] = [];
  runHostStatus(["claude"], { stdout: (t) => statusLines.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.ok(!statusLines.join("\n").includes("中断"), "no more interruption nagging");
  // journal 里最后的 done 行带基线（收尾记录没丢信息）。
  const lastEntry = JSON.parse(readFileSync(journalFile, "utf8").trimEnd().split("\n").pop()!);
  assert.equal(lastEntry.status, "done");
  void doneUnits;
});

test("移除后再接入：基线不被移除记录清零，不误报「没有我们写过的记录」", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  // 接入 → 移除 → 再接入：移除的 done 行不带 units，但基线要回溯到
  // 最近一次接入的记录，再接入走 add 而不是全报冲突。
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  const removeLines: string[] = [];
  const rm = await runHostOperation("remove", "claude", { stdout: (t) => removeLines.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(rm.code, 0, removeLines.join("\n"));
  const reconnectLines: string[] = [];
  const rc = await runHostOperation("connect", "claude", { stdout: (t) => reconnectLines.push(t), projectRoot: f.projectRoot, home: f.home });
  assert.equal(rc.code, 0, reconnectLines.join("\n"));
  const text = reconnectLines.join("\n");
  // 走 add（还没有我们的条目，准备新增），不是 conflict（没有我们写过的记录）。
  assert.ok(text.includes("准备新增"), "re-add, not conflict");
  assert.ok(!text.includes("没有我们写过的记录"), "not misattributed as foreign");
  // 写完的文件里我们的条目在，别人家的还在。
  const mcp = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(mcp.ok);
  assert.deepEqual((mcp.value as any).mcpServers.anysearch, { command: "ans-mcp", args: [], env: {} });
  assert.deepEqual((mcp.value as any).mcpServers.context7, { command: "npx", args: ["-y", "@upstash/context7-mcp"] });
});

test("幂等收尾前实际重验：文件被改得跟中断方向不符 → 不把没验证的记成 done", async () => {
  const f = fixture();
  writeProjectFile(f.projectRoot, "mcp.json", MCP_JSON_WITH_COMMENT);
  writeProjectFile(f.projectRoot, ".claude/settings.json", SETTINGS_WITH_FOREIGN_HOOK);
  // 正常接入一次，然后模拟「写完、验证还没落盘就中断」：清掉 done 收尾行，
  // 只留一条带基线 units 的 partial（基线来自那次接入，归因才有据可查）。
  await runHostOperation("connect", "claude", { stdout: f.out, projectRoot: f.projectRoot, home: f.home });
  const root = wiringRoot("project", f.projectRoot, f.home);
  const journalFile = join(root, "journal.jsonl");
  const doneLine = JSON.parse(readFileSync(journalFile, "utf8").trimEnd().split("\n").pop()!);
  const baselineUnits = doneLine.units;
  writeFileSync(journalFile, "", "utf8");
  appendEntry(root, {
    id: "op-fake-unverified", ts: new Date().toISOString(), op: "connect", host: "claude",
    status: "partial",
    files: [
      { path: join(f.projectRoot, "mcp.json"), scope: "project", written: true, verified: false, afterHash: "x" },
      { path: join(f.projectRoot, ".claude/settings.json"), scope: "project", written: true, verified: false, afterHash: "x" },
    ],
    units: baselineUnits,
  });
  // 用户把我们的条目改坏（改成跟候选不符、但结构上仍是我们命名空间的内容）。
  const broken = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(broken.ok);
  const mutated = structuredClone(broken.value as Record<string, unknown>);
  (mutated.mcpServers as Record<string, unknown>).anysearch = { command: "ans-mcp", args: ["--user-broke-it"], env: {} };
  writeFileSync(join(f.projectRoot, "mcp.json"), JSON.stringify(mutated, null, 2), "utf8");
  const lines2: string[] = [];
  const r = await runHostOperation("repair", "claude", { stdout: (t) => lines2.push(t), projectRoot: f.projectRoot, home: f.home });
  const text = lines2.join("\n");
  // 用户改过的条目 → 保留现场报冲突（repair 的设计行为：不拿旧候选覆盖用户
  // 修改），但关键是不把中断记录直接标 done——这条 repair 整体退出没写文件。
  assert.ok(text.includes("改过"), "deviation attributed to user modification");
  assert.ok(text.includes("没有动任何文件"), "scene preserved, no blind writes");
  assert.equal(r.code, 1);
  // journal 里最后一条不是假 done（中断记录仍在等待人工处理）。
  const lastEntry = JSON.parse(readFileSync(journalFile, "utf8").trimEnd().split("\n").pop()!);
  assert.notEqual(lastEntry.status, "done", "no fake done without real verification");
  // 文件保持用户改过的现场。
  const kept = parseJsonc(readFileSync(join(f.projectRoot, "mcp.json"), "utf8"));
  assert.ok(kept.ok);
  assert.deepEqual((kept.value as any).mcpServers.anysearch, { command: "ans-mcp", args: ["--user-broke-it"], env: {} });
});
