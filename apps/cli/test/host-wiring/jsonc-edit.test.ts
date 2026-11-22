// JSONC 保留式编辑器测试。
// 材料形态取自线上 Context7 的 mcp-writer 测试场景（带注释 + 其他工具条目），
// 断言核心：注释、其他工具条目原样保留；语法坏 → 明确失败、原文不动。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonc, readJsoncPath, writeJsoncPath, removeJsoncPath,
  appendJsoncItem, removeJsoncItem, findOurItems, hookEntryIsOurs,
} from "../../src/host-wiring/jsonc-edit.js";

test("归属判定只看 command：手写条目 args 里带 anysearch 也不算我们的", () => {
  // 以前还有一条「脚本路径在 args 里」的宽判定，留给 Cursor 那种写法；副作用是
  // 用户自己的钩子只要 args 里出现 anysearch 字样，ans host remove 就会当成本工
  // 具的条目删掉。现在只认 command 里的 bin。
  assert.equal(hookEntryIsOurs({ command: "node", args: ["./my-anysearch-helper.js"] }), false);
  assert.equal(hookEntryIsOurs({ command: "node", args: ["-y", "anysearch"] }), false);
  assert.equal(hookEntryIsOurs({ command: "ans-hook-claude" }), true);
  assert.equal(hookEntryIsOurs({ command: "ans-hook-antigravity PreToolUse" }), true);
});

test("带注释和其他工具的 mcp.json：接入后注释与 context7 条目原样保留", () => {
  // Context7 材料风格：JSONC（行注释）+ 已有 context7 条目。
  const before = [
    "{",
    "  // Upstash context7",
    "  \"mcpServers\": {",
    "    \"context7\": {",
    "      \"command\": \"npx\",",
    "      \"args\": [\"-y\", \"@upstash/context7-mcp\"]",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const result = writeJsoncPath(before, ["mcpServers", "anysearch"], { command: "ans-mcp", args: [], env: {} });
  assert.ok(result.ok, "edit should succeed");
  const after = result.text;
  // 注释原样保留。
  assert.ok(after.includes("// Upstash context7"), "comment survives");
  // 其他工具条目原样保留（整段文本精确出现）。
  assert.ok(after.includes("\"context7\": {"), "other tool's key survives");
  assert.ok(after.includes("\"command\": \"npx\""), "other tool's command survives");
  assert.ok(after.includes("\"args\": [\"-y\", \"@upstash/context7-mcp\"]"), "other tool's args survive");
  // 我们的条目在，且值正确。
  const parsed = parseJsonc(after);
  assert.ok(parsed.ok);
  const ours = (parsed.value as any).mcpServers.anysearch;
  assert.deepEqual(ours, { command: "ans-mcp", args: [], env: {} });
  // 其他工具的条目值没被碰。
  const theirs = (parsed.value as any).mcpServers.context7;
  assert.deepEqual(theirs, { command: "npx", args: ["-y", "@upstash/context7-mcp"] });
});

test("块注释、尾随逗号风格、CRLF 都能保住", () => {
  const before = "{\r\n  /* block comment */\r\n  \"mcpServers\": {\r\n    \"context7\": {\"command\": \"npx\"}\r\n  }\r\n}\r\n";
  const result = writeJsoncPath(before, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(result.ok);
  assert.ok(result.text.includes("/* block comment */"));
  assert.ok(result.text.includes("\r\n"), "CRLF survives");
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).mcpServers.anysearch, { command: "ans-mcp" });
});

test("空对象展开填入，缩进对齐", () => {
  const before = "{\n}";
  const result = writeJsoncPath(before, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).mcpServers.anysearch, { command: "ans-mcp" });
});

test("空文件（含纯注释）→ 根对象展开", () => {
  const before = "// top comment\n";
  const result = writeJsoncPath(before, ["anysearch"], { a: 1 });
  assert.ok(result.ok);
  assert.ok(result.text.includes("// top comment"));
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).anysearch, { a: 1 });
});

test("已存在的键：只替换值范围，其他成员不动", () => {
  const before = "{\n  \"alpha\": 1,\n  \"anysearch\": { \"old\": true },\n  \"omega\": 2\n}";
  const result = writeJsoncPath(before, ["anysearch"], { new: "value" });
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.equal((parsed.value as any).alpha, 1);
  assert.equal((parsed.value as any).omega, 2);
  assert.deepEqual((parsed.value as any).anysearch, { new: "value" });
  // alpha/omega 行原样（含换行排版）。
  assert.ok(result.text.includes("\"alpha\": 1,"));
  assert.ok(result.text.includes("\"omega\": 2"));
});

test("中间层不存在时逐层补齐（嵌套键插入）", () => {
  const before = "{}";
  const result = writeJsoncPath(before, ["hooks", "PreToolUse"], [{ matcher: ".*" }]);
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).hooks.PreToolUse, [{ matcher: ".*" }]);
});

test("语法坏 → 明确失败，不返回任何文本", () => {
  const bad = "{ \"mcpServers\": ";
  const result = writeJsoncPath(bad, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(!result.ok);
  assert.equal(result.ok === false && result.error.reason, "parse");
});

test("父层形状不对（字符串占位）→ 明确失败", () => {
  const bad = "{ \"mcpServers\": \"not an object\" }";
  const result = writeJsoncPath(bad, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(!result.ok);
  assert.equal(result.ok === false && result.error.reason, "shape");
});

test("读路径：不存在 → undefined；形状不对 → 失败", () => {
  const text = "{ \"a\": { \"b\": 1 } }";
  assert.equal(readJsoncPath(text, ["a", "b"]).ok && (readJsoncPath(text, ["a", "b"]) as any).value, 1);
  assert.equal((readJsoncPath(text, ["a", "c"]) as any).value, undefined);
  const bad = readJsoncPath(text, ["a", "b", "c"]);
  assert.ok(!bad.ok);
});

test("数组追加元素：已有其他工具条目 → 我们的追加在后面，人家的不动", () => {
  const before = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: "readme", hooks: [{ type: "command", command: "someone-else-tool", timeout: 3 }] },
      ],
    },
  }, null, 2);
  const ours = { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }] };
  const result = appendJsoncItem(before, ["hooks", "PreToolUse"], ours);
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  const arr = (parsed.value as any).hooks.PreToolUse;
  assert.equal(arr.length, 2);
  assert.deepEqual(arr[0], { matcher: "readme", hooks: [{ type: "command", command: "someone-else-tool", timeout: 3 }] });
  assert.deepEqual(arr[1], ours);
  // 原文第一元素整段保留。
  assert.ok(result.text.includes("\"matcher\": \"readme\""));
});

test("数组不存在 → 先建数组再插入", () => {
  const before = "{}";
  const ours = { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }] };
  const result = appendJsoncItem(before, ["hooks", "SessionStart"], ours);
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.value as any).hooks.SessionStart, [ours]);
});

test("findOurItems 认得出我们的 bin、认不出别人的", () => {
  const text = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: "x", hooks: [{ type: "command", command: "someone-else", timeout: 3 }] },
        { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }] },
        { matcher: "y", hooks: [{ type: "command", command: "ans-mcp", timeout: 5 }] },
      ],
    },
  });
  const ours = findOurItems(text, ["hooks", "PreToolUse"]) as number[];
  assert.deepEqual(ours, [1, 2]);
  // 别的数组没有我们的条目。
  const none = findOurItems(text, ["hooks", "SessionStart"]);
  assert.equal(none, null);
});

test("删数组元素：只删指定的，其他不动", () => {
  const before = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: "x", hooks: [{ type: "command", command: "someone-else", timeout: 3 }] },
        { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }] },
      ],
    },
  }, null, 2);
  const result = removeJsoncItem(before, ["hooks", "PreToolUse"], 1);
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  const arr = (parsed.value as any).hooks.PreToolUse;
  assert.equal(arr.length, 1);
  assert.deepEqual(arr[0], { matcher: "x", hooks: [{ type: "command", command: "someone-else", timeout: 3 }] });
});

test("删键：没了我们的键，其他键和注释不动；不存在 → 幂等", () => {
  const before = [
    "{",
    "  // keep me",
    "  \"anysearch\": { \"command\": \"ans-mcp\" },",
    "  \"context7\": { \"command\": \"npx\" }",
    "}",
  ].join("\n");
  const removed = removeJsoncPath(before, ["anysearch"]);
  assert.ok(removed.ok);
  assert.ok(removed.text.includes("// keep me"));
  assert.ok(removed.text.includes("\"context7\""));
  assert.ok(!removed.text.includes("\"anysearch\""));
  const again = removeJsoncPath(removed.text, ["anysearch"]);
  assert.ok(again.ok);
  assert.equal(again.text, removed.text); // 幂等：再删一次什么都不变
  const missing = removeJsoncPath(before, ["nonexistent"]);
  assert.ok(missing.ok);
  assert.equal(missing.text, before);
});

test("字符串里的注释符号和括号不会骗到扫描器", () => {
  const before = JSON.stringify({
    note: "has // slash and { bracket } inside",
    mcpServers: { context7: { command: "npx" } },
  }, null, 2);
  const result = writeJsoncPath(before, ["mcpServers", "anysearch"], { command: "ans-mcp" });
  assert.ok(result.ok);
  const parsed = parseJsonc(result.text);
  assert.ok(parsed.ok);
  assert.equal((parsed.value as any).note, "has // slash and { bracket } inside");
  assert.deepEqual((parsed.value as any).mcpServers.anysearch, { command: "ans-mcp" });
});
