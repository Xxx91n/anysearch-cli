// 共享测试材料：fixture、测试用宿主配置原文（带注释 + 其他工具条目当
// 「别人家的东西」）。两个流程测试文件共用一份，材料只有一个出处。

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function fixture() {
  const home = mkdtempSync(join(tmpdir(), "ans-home-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "ans-proj-"));
  const lines: string[] = [];
  const out = (text: string) => lines.push(text);
  return { home, projectRoot, lines, out };
}

export function writeProjectFile(projectRoot: string, rel: string, content: string): void {
  mkdirSync(join(projectRoot, rel.split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(join(projectRoot, rel), content, "utf8");
}

// 带「别人家条目」的 mcp.json：注释 + context7（其他工具）都在。
export const MCP_JSON_WITH_COMMENT = [
  "{",
  "  // Upstash context7",
  '  "mcpServers": {',
  '    "context7": {',
  '      "command": "npx",',
  '      "args": ["-y", "@upstash/context7-mcp"]',
  "    }",
  "  }",
  "}",
].join("\n");

// 带「别人家钩子」的 settings.json：已有的别的工具 hook + permissions。
export const SETTINGS_WITH_FOREIGN_HOOK = [
  "{",
  "  // project settings",
  '  "hooks": {',
  '    "PreToolUse": [',
  "      {",
  '        "matcher": "read_file",',
  '        "hooks": [{ "type": "command", "command": "lint-before", "timeout": 30 }]',
  "      }",
  "    ]",
  "  },",
  '  "permissions": { "allow": ["Bash(git:*)"] }',
  "}",
].join("\n");
