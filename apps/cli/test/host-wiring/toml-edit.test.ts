// TOML 保留式编辑器测试。
// 材料形态：Codex config.toml 的真实样子（其他工具的 mcp_servers、已有 hooks 段、
// 注释）+ Context7 toml-editor 场景（注释与其他表段保留）。断言核心：别的表、
// 注释、换行原样保留；语法坏 → 明确失败、原文不动。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTomlSafe, scanTomlSegments, setTomlNamedTable, removeTomlNamedTable,
  appendTomlArrayTable, removeTomlArrayTable, findOurArrayTables,
  codexHookSegmentIsOurs, canonicalJson,
} from "../../src/host-wiring/toml-edit.js";

test("表头扫描：普通注释、多行字符串、跨行数组里的 [ 都不会误判成表头", () => {
  const text = [
    "# 注释里提到 [mcp_servers.fake] 不算表头",
    'model = "gpt-5"',
    "note = \"\"\"多行字符串",
    "[fake.header.inside.string]",
    "还在字符串里",
    "\"\"\"",
    "values = [", // 跨行数组
    "  \"x\",",
    "  [1, 2],",
    "]",
    "[mcp_servers.context7]",
    "command = \"npx\"",
    "[[hooks.SessionStart]]",
    "matcher = \"startup\"",
    "hooks = [{ type = \"command\", command = \"other-tool\", timeout = 5 }]",
  ].join("\n");
  const segments = scanTomlSegments(text);
  const names = segments.map((s) => `${s.isArray ? "[[" : "["}${s.name}${s.isArray ? "]]" : "]"}`);
  assert.deepEqual(names, ["[mcp_servers.context7]", "[[hooks.SessionStart]]"]);
});

test("追加 [mcp_servers.anysearch]：其他工具的表和注释原样保留", () => {
  const before = [
    "# user config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
    'args = ["-y", "@upstash/context7-mcp"]',
    "startup_timeout_sec = 30",
  ].join("\n") + "\n";
  const result = setTomlNamedTable(before, "mcp_servers.anysearch", { command: "ans-mcp", startup_timeout_sec: 60 });
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  const after = result.text;
  // 注释和其他工具的表原样保留。
  assert.ok(after.includes("# user config"));
  assert.ok(after.includes("[mcp_servers.context7]"));
  assert.ok(after.includes('args = ["-y", "@upstash/context7-mcp"]'));
  // 我们的表追加成功。
  assert.ok(after.includes("[mcp_servers.anysearch]"));
  assert.ok(after.includes('command = "ans-mcp"'));
  const parsed = parseTomlSafe(after);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).mcp_servers.context7, {
    command: "npx", args: ["-y", "@upstash/context7-mcp"], startup_timeout_sec: 30,
  });
  assert.deepEqual((parsed.value as any).mcp_servers.anysearch, { command: "ans-mcp", startup_timeout_sec: 60 });
});

test("已存在的 [mcp_servers.anysearch]：替换该段，其他段不动", () => {
  const before = [
    "[mcp_servers.anysearch]",
    'command = "old-thing"',
    'startup_timeout_sec = 30',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
  ].join("\n") + "\n";
  const result = setTomlNamedTable(before, "mcp_servers.anysearch", { command: "ans-mcp", startup_timeout_sec: 60 });
  assert.ok(result.ok);
  const parsed = parseTomlSafe(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).mcp_servers.anysearch, { command: "ans-mcp", startup_timeout_sec: 60 });
  assert.deepEqual((parsed.value as any).mcp_servers.context7, { command: "npx" });
});

test("追加 [[hooks.X]] 段：与已有其他工具的 [[hooks.X]] 段并列共存", () => {
  const before = [
    "[[hooks.SessionStart]]",
    'matcher = "startup"',
    'hooks = [{ type = "command", command = "my-other-tool --hook", timeout = 5 }]',
  ].join("\n") + "\n";
  const ours = { matcher: "startup", hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }] };
  const result = appendTomlArrayTable(before, "hooks.SessionStart", ours);
  assert.ok(result.ok);
  const parsed = parseTomlSafe(result.text);
  assert.ok(parsed.ok);
  const arr = (parsed.value as any).hooks.SessionStart;
  assert.equal(arr.length, 2);
  // 其他工具的段原样。
  assert.deepEqual(arr[0], { matcher: "startup", hooks: [{ type: "command", command: "my-other-tool --hook", timeout: 5 }] });
  assert.deepEqual(arr[1], ours);
  // 段间文本保留。
  assert.ok(result.text.includes('command = "my-other-tool --hook"'));
});

test("findOurArrayTables 认得出我们的段；别人的段不动", () => {
  const text = [
    "[[hooks.PreToolUse]]",
    'matcher = "someone"',
    'hooks = [{ type = "command", command = "other-tool", timeout = 5 }]',
    "",
    "[[hooks.PreToolUse]]",
    'matcher = ".*(search_web)$"',
    'hooks = [{ type = "command", command = "ans-hook-codex", timeout = 5 }]',
  ].join("\n") + "\n";
  const ours = findOurArrayTables(text, "hooks.PreToolUse", codexHookSegmentIsOurs);
  assert.ok(Array.isArray(ours));
  assert.equal(ours!.length, 1);
  assert.deepEqual(ours![0].values, {
    matcher: ".*(search_web)$",
    hooks: [{ type: "command", command: "ans-hook-codex", timeout: 5 }],
  });
});

test("删 [[hooks.X]] 里我们的段：只删我们的，别人的段原样", () => {
  const text = [
    "[[hooks.PreToolUse]]",
    'matcher = "someone"',
    'hooks = [{ type = "command", command = "other-tool", timeout = 5 }]',
    "",
    "[[hooks.PreToolUse]]",
    'matcher = ".*(search_web)$"',
    'hooks = [{ type = "command", command = "ans-hook-codex", timeout = 5 }]',
  ].join("\n") + "\n";
  const result = removeTomlArrayTable(text, "hooks.PreToolUse", {
    matcher: ".*(search_web)$",
    hooks: [{ type: "command", command: "ans-hook-codex", timeout: 5 }],
  });
  assert.ok(result.ok);
  const parsed = parseTomlSafe(result.text);
  assert.ok(parsed.ok);
  const arr = (parsed.value as any).hooks.PreToolUse;
  assert.equal(arr.length, 1);
  assert.deepEqual(arr[0], { matcher: "someone", hooks: [{ type: "command", command: "other-tool", timeout: 5 }] });
  // 我们的段整段没了。
  assert.ok(!result.text.includes("ans-hook-codex"));
});

test("删命名表：该表没了，其他表和注释原样；不存在 → 幂等", () => {
  const before = [
    "# keep",
    "[mcp_servers.anysearch]",
    'command = "ans-mcp"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
  ].join("\n") + "\n";
  const result = removeTomlNamedTable(before, "mcp_servers.anysearch");
  assert.ok(result.ok);
  assert.ok(result.text.includes("# keep"));
  assert.ok(result.text.includes("[mcp_servers.context7]"));
  assert.ok(!result.text.includes("[mcp_servers.anysearch]"));
  const again = removeTomlNamedTable(result.text, "mcp_servers.anysearch");
  assert.ok(again.ok);
  assert.equal(again.text, result.text);
});

test("语法坏 → 明确失败、原文不动", () => {
  const bad = "[mcp_servers.anysearch\ncommand = oops\n";
  const r1 = setTomlNamedTable(bad, "mcp_servers.anysearch", { command: "x" });
  assert.ok(!r1.ok);
  const r2 = removeTomlNamedTable(bad, "mcp_servers.anysearch");
  assert.ok(!r2.ok);
  const r3 = appendTomlArrayTable(bad, "hooks.PreToolUse", { matcher: "x" });
  assert.ok(!r3.ok);
});

test("编辑产物写坏了（比如造成重复定义）→ 写前校验拦下", () => {
  // mcp_servers 已被 dotted-key 定义成别的值，再追加表头会重复定义——
  // 编辑器必须在校验时失败，而不是交出坏文件。
  const before = 'mcp_servers = "not a table"\n';
  const result = setTomlNamedTable(before, "mcp_servers.anysearch", { command: "ans-mcp" });
  assert.ok(!result.ok, "expected shape/parse failure for dotted-key collision");
});

test("canonicalJson 忽略排版差异（换行数组 vs 单行数组）", () => {
  const a = canonicalJson({ hooks: [{ type: "command", command: "x", timeout: 5 }] });
  const b = canonicalJson({ hooks: [{ timeout: 5, command: "x", type: "command" }] });
  assert.equal(a, b);
  const c = canonicalJson({ hooks: [{ timeout: 9, command: "x", type: "command" }] });
  assert.notEqual(a, c);
});
