// 宿主注册表：每个宿主的接线目标和候选条目。
// 候选命令用完整安装自带的 bin（装一次就全有，不用另装全局插件包），各宿主
// 的 schema、matcher、envelope 按真实协议保留，不做宿主间通用化。

import type { JsoncPath } from "./jsonc-edit.js";
import { accessSync } from "node:fs";

/** 一个写入单元：宿主配置文件里「归属本工具」的一块内容。 */
export type UnitDef =
  | {
    /** JSON 对象键：键名即归属（如 mcpServers.anysearch、顶层 anysearch）。 */
    type: "json-key";
    id: string;
    path: JsoncPath;
    candidate: unknown;
  }
  | {
    /** JSON hooks 数组元素：path 指向数组，条目按 command 认 bin 判归属。 */
    type: "json-hook-array";
    id: string;
    path: JsoncPath;
    candidate: unknown;
  }
  | {
    /** TOML 命名表：[mcp_servers.anysearch] 表名即归属。 */
    type: "toml-named-table";
    id: string;
    name: string;
    candidate: Record<string, unknown>;
  }
  | {
    /** TOML 数组表段：[[hooks.<Event>]]，段内 hooks[].command 认 bin 判归属。 */
    type: "toml-array-table";
    id: string;
    name: string;
    candidate: Record<string, unknown>;
  };

export interface HostFileDef {
  /** project=项目根下；user=用户主目录下。 */
  scope: "project" | "user";
  /** 相对 scope 根的路径。 */
  relPath: string;
  format: "jsonc" | "toml";
  units: UnitDef[];
}

export interface HostDef {
  id: string;
  title: string;
  /** 接入完成后列出的待办（信任/重启等）。 */
  todoAfterConnect: string[];
  files: HostFileDef[];
}

// ---------------------------------------------------------------------------
// 候选条目：与各宿主专文/仓库模板一致的固定形态
// ---------------------------------------------------------------------------

/** Claude/CodeBuddy 项目 mcp.json 里的 MCP 注册（空 env 是故意的：子进程继承宿主环境，密钥不落文件）。 */
const MCP_SERVER_CANDIDATE = { command: "ans-mcp", args: [], env: {} };

/** Claude Code 项目 .claude/settings.json 的三个 hook 事件（官方 schema；matcher 全量）。 */
const CLAUDE_HOOK_UNITS: UnitDef[] = [
  {
    type: "json-hook-array", id: "hook:PreToolUse", path: ["hooks", "PreToolUse"],
    candidate: { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 5 }] },
  },
  {
    type: "json-hook-array", id: "hook:PostToolUse", path: ["hooks", "PostToolUse"],
    candidate: { matcher: ".*", hooks: [{ type: "command", command: "ans-hook-claude", timeout: 10 }] },
  },
  {
    type: "json-hook-array", id: "hook:SessionStart", path: ["hooks", "SessionStart"],
    candidate: { matcher: "startup", hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }] },
  },
];

/** CodeBuddy 项目 .codebuddy/settings.json 的三个事件。
 * 命令用完整安装自带的 ans-hook-codebuddy bin（不用另装全局插件包）。 */
const CODEBUDDY_MATCHER = "search_web|research_web|recall_memory|query_knowledge|ans_chat";
const CODEBUDDY_HOOK_UNITS: UnitDef[] = [
  {
    type: "json-hook-array", id: "hook:PreToolUse", path: ["hooks", "PreToolUse"],
    candidate: { matcher: CODEBUDDY_MATCHER, hooks: [{ type: "command", command: "ans-hook-codebuddy", timeout: 5 }] },
  },
  {
    type: "json-hook-array", id: "hook:PostToolUse", path: ["hooks", "PostToolUse"],
    candidate: { matcher: CODEBUDDY_MATCHER, hooks: [{ type: "command", command: "ans-hook-codebuddy", timeout: 10 }] },
  },
  {
    type: "json-hook-array", id: "hook:SessionStart", path: ["hooks", "SessionStart"],
    candidate: { matcher: "*", hooks: [{ type: "command", command: "ans-hook-codebuddy", timeout: 5 }] },
  },
];

/** Codex 用户 config.toml：MCP 注册 + 三个 [[hooks.<Event>]] 段（官方 schema、全匹配正则）。 */
const CODEX_MATCHER = ".*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$";
const CODEX_FILES_UNITS: UnitDef[] = [
  {
    type: "toml-named-table", id: "mcp:anysearch", name: "mcp_servers.anysearch",
    candidate: { command: "ans-mcp", startup_timeout_sec: 60 },
  },
  {
    type: "toml-array-table", id: "hook:SessionStart", name: "hooks.SessionStart",
    candidate: { matcher: "startup", hooks: [{ type: "command", command: "ans-hook-session-start --envelope", timeout: 5 }] },
  },
  {
    type: "toml-array-table", id: "hook:PreToolUse", name: "hooks.PreToolUse",
    candidate: { matcher: CODEX_MATCHER, hooks: [{ type: "command", command: "ans-hook-codex", timeout: 5 }] },
  },
  {
    type: "toml-array-table", id: "hook:PostToolUse", name: "hooks.PostToolUse",
    candidate: { matcher: CODEX_MATCHER, hooks: [{ type: "command", command: "ans-hook-codex", timeout: 10 }] },
  },
];

/** Antigravity CLI 用户 hooks.json：named-hook map，顶层 anysearch 键即归属。 */
const ANTIGRAVITY_MATCHER = "call_mcp_tool|.*ans_.*|.*search_web|.*research_web|.*recall_memory|.*query_knowledge";
const ANTIGRAVITY_CANDIDATE = {
  PreToolUse: [{ matcher: ANTIGRAVITY_MATCHER, hooks: [{ type: "command", command: "ans-hook-antigravity PreToolUse", timeout: 5 }] }],
  PostToolUse: [{ matcher: ANTIGRAVITY_MATCHER, hooks: [{ type: "command", command: "ans-hook-antigravity PostToolUse", timeout: 10 }] }],
  PreInvocation: [{ type: "command", command: "ans-hook-antigravity PreInvocation", timeout: 5 }],
  PostInvocation: [{ type: "command", command: "ans-hook-antigravity PostInvocation", timeout: 10 }],
  Stop: [{ type: "command", command: "ans-hook-antigravity Stop", timeout: 5 }],
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

export const HOSTS: Record<string, HostDef> = {
  claude: {
    id: "claude",
    title: "Claude Code（项目级：mcp.json + .claude/settings.json）",
    todoAfterConnect: [
      "仓库验证过的用法是 headless 显式传 --mcp-config mcp.json；交互式 Claude Code 是否自动发现这个文件没验过，别当成已生效。",
      "在 Claude Code 里对项目配置确认信任（首次会弹确认）。",
      "重启 Claude Code 会话后 hooks 才生效。",
      "钩子命令走 PATH 上的 ans-hook-claude / ans-hook-session-start（完整安装提供）。",
    ],
    files: [
      {
        scope: "project", relPath: "mcp.json", format: "jsonc",
        units: [{ type: "json-key", id: "mcp:anysearch", path: ["mcpServers", "anysearch"], candidate: MCP_SERVER_CANDIDATE }],
      },
      {
        scope: "project", relPath: ".claude/settings.json", format: "jsonc",
        units: CLAUDE_HOOK_UNITS,
      },
    ],
  },
  codebuddy: {
    id: "codebuddy",
    title: "CodeBuddy Code（项目级：mcp.json + .codebuddy/settings.json）",
    todoAfterConnect: [
      "仓库验证过的用法是 headless 显式传 --mcp-config mcp.json --strict-mcp-config；交互式 CodeBuddy 是否自动发现这个文件没验过，别当成已生效。",
      "重启 CodeBuddy 会话后 hooks 才生效。",
      "hooks 命令走完整安装自带的 ans-hook-codebuddy bin（不要求另装插件包）。",
    ],
    files: [
      {
        scope: "project", relPath: "mcp.json", format: "jsonc",
        units: [{ type: "json-key", id: "mcp:anysearch", path: ["mcpServers", "anysearch"], candidate: MCP_SERVER_CANDIDATE }],
      },
      {
        scope: "project", relPath: ".codebuddy/settings.json", format: "jsonc",
        units: CODEBUDDY_HOOK_UNITS,
      },
    ],
  },
  codex: {
    id: "codex",
    title: "Codex CLI（用户级：~/.codex/config.toml 的 MCP 注册 + hooks）",
    todoAfterConnect: [
      "Codex 需要开启 [features].hooks 才执行 hooks；本工具不替宿主改这个开关，请自行确认。",
      "项目级 .codex/hooks.json 需要宿主信任该项目（[projects] trust_level）。",
      "重启 codex 后配置才生效。",
    ],
    files: [
      {
        scope: "user", relPath: ".codex/config.toml", format: "toml",
        units: CODEX_FILES_UNITS,
      },
    ],
  },
  antigravity: {
    id: "antigravity",
    title: "Antigravity CLI（用户级：~/.gemini/antigravity-cli/hooks.json 的 anysearch 命名钩子）",
    todoAfterConnect: [
      "重启 Antigravity CLI 后 hooks 才生效。",
      "规则兑底文件 .antigravity/rules/anysearch.mdc 由钩子运行时自动写，不用接线工具管。",
    ],
    files: [
      {
        scope: "user", relPath: ".gemini/antigravity-cli/hooks.json", format: "jsonc",
        units: [{ type: "json-key", id: "named:anysearch", path: ["anysearch"], candidate: ANTIGRAVITY_CANDIDATE }],
      },
    ],
  },
};

export function listHostIds(): string[] {
  return Object.keys(HOSTS);
}

export function getHost(id: string): HostDef | undefined {
  return HOSTS[id];
}

// ---------------------------------------------------------------------------
// 安装层探测：PATH 上找得到本工具的 bin 吗（只找文件，不执行进程）
// ---------------------------------------------------------------------------

/** 完整安装应该带齐的 bin（装一次全有，接线命令全从这里来）。 */
export const INSTALL_BINS = [
  "ans", "ans-mcp", "ans-plugin-server",
  "ans-hook-claude", "ans-hook-session-start", "ans-hook-codex",
  "ans-hook-antigravity", "ans-hook-codebuddy",
];

const EXE_SUFFIXES = ["", ".cmd", ".exe", ".bat", ".ps1"];
// PATH 分隔符：Windows 是分号，其余是冒号（Node 跨平台跑，status 两种都要对）。
const PATH_SEP = process.platform === "win32" ? ";" : ":";

/**
 * 在 PATH 里找 bin 文件（只做存在性检查，不执行）。找到 → true。
 * 用来回答「安装层：接线命令是不是当前完整安装提供的」，答不出就如实说未找到。
 * 路径分隔两种都试（Windows 接受正斜杠，POSIX 上反斜杠文件名不存在而已）。
 */
export function binOnPath(bin: string, pathEnv: string | undefined = process.env.PATH): boolean {
  if (!pathEnv) return false;
  for (const dir of pathEnv.split(PATH_SEP)) {
    if (!dir) continue;
    for (const suffix of EXE_SUFFIXES) {
      for (const sep of ["\\", "/"]) {
        try {
          accessSync(dir + sep + bin + suffix);
          return true;
        } catch {
          // 不存在就继续找。
        }
      }
    }
  }
  return false;
}
