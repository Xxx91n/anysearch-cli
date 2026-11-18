// ans host：宿主接入/修复/移除命令。
// 选择哪些宿主、在哪个项目里接线，都由用户明确指定；工具只动选定目标。
// 密钥全程不看——接线不依赖任何 API key 配置。

import { runHostOperation, runHostStatus } from "../host-wiring/run.js";
import { listHostIds } from "../host-wiring/hosts.js";

export interface HostCommandOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  projectRoot?: string;
}

const HELP = `Usage: ans host <command> [host] [options]

Commands:
  list                     列出支持的宿主
  status [host]            看接线状态（安装/接线/宿主验证分层；密钥不看）
  preview <host>           只看会改什么，不动任何文件
  connect <host>           接入选定宿主（幂等；写前备份；写后验证）
  repair <host>            修复：续上中断的操作 / 补缺失 / 更新老条目
  remove <host>            移除本工具条目（只摘配置条目；资料/对话/账目/凭据不动）

Hosts:
  claude                   Claude Code（项目级：mcp.json + .claude/settings.json）
  codebuddy                CodeBuddy Code（项目级：mcp.json + .codebuddy/settings.json）
  codex                    Codex CLI（用户级：~/.codex/config.toml）
  antigravity              Antigravity CLI（用户级：~/.gemini/antigravity-cli/hooks.json）

Options:
  --project <dir>          项目目录（默认当前目录）
  --help, -h               Show this help

说明：配置写入不代表宿主已生效——信任、重启等待办见每条命令的输出。
Exit codes: 0 成功（含幂等无事可做） · 1 有冲突/没写完 · 2 用法错误
`;

/** 分发 ans host 子命令。 */
export async function runHost(args: string[], opts: HostCommandOptions = {}): Promise<number> {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const err = opts.stderr ?? ((text: string) => process.stderr.write(text));
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    out(HELP);
    return 0;
  }
  const [command, ...rest] = args;
  let projectRoot: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--project") {
      // 带下标消费下一个参数（目录值本身别进 positional）。
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        err("ans host: --project 需要一个目录参数\n");
        return 2;
      }
      projectRoot = next;
      i++;
    } else if (arg.startsWith("--project=")) {
      projectRoot = arg.slice("--project=".length);
    } else if (arg.startsWith("-")) {
      err(`ans host: 不认识的参数 ${arg}\n${HELP}`);
      return 2;
    } else {
      positional.push(arg);
    }
  }
  const merged = { stdout: out, projectRoot };

  if (command === "list") {
    out(`支持的宿主：${listHostIds().join("、")}\n`);
    out("说明：每个宿主的目标文件、格式和归属判定见 ans host preview 的输出。\n");
    return 0;
  }
  if (command === "status") {
    if (positional.length > 1) { err("ans host: status 只接一个宿主名（或不传看全部）\n"); return 2; }
    const hosts = positional.length === 1 ? positional : listHostIds();
    const result = runHostStatus(hosts, merged);
    return result.code;
  }
  if (command === "preview" || command === "connect" || command === "repair" || command === "remove") {
    if (positional.length !== 1) {
      err(`ans host: ${command} 需要且只需要一个宿主名\n${HELP}`);
      return 2;
    }
    const result = await runHostOperation(command, positional[0], merged);
    return result.code;
  }
  err(`ans host: 不认识的子命令 ${command}\n${HELP}`);
  return 2;
}
