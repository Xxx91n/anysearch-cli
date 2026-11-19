#!/usr/bin/env node
// anysearch-cli entry - vertical agent for information retrieval.
// CLI wiring: packages are wired here.
// CLI wiring: provider registry + store + engine injected per command.

import { runDoctor } from "./commands/doctor";
import { runSearch } from "./commands/search";
import { runDomain } from "./commands/domain";
import { runAuth } from "./commands/auth";
import { runLlm } from "./commands/llm";
import { runSkill } from "./commands/skill";
import { runChat } from "./commands/chat";
import { runRecommend } from "./commands/recommend";
import { runMcp } from "./commands/mcp";
import { runMemoryPreference } from "./commands/memory-preference";
import { runMemory } from "./commands/memory";
import { runEntity } from "./commands/entity";
import { runRelation } from "./commands/relation";
import { runConsolidate } from "./commands/consolidate";
import { runAccessChain } from "./commands/access-chain";
import { runSwitchState } from "./commands/switch-state";
import { runHitl } from "./commands/hitl";
import { runHost } from "./commands/host";
import { describeAdmissionRefusal, runUpgrade } from "./commands/upgrade";
import { rehydrateConfigEnv } from "./config-env";
import { runTeardown, unrefPendingHandles } from "./teardown";
import { trackCliCommand } from "./cli-task-tracking";

// ponytail: single source of truth for CLI version, same pattern as apps/mcp
//. tsup injects __PACKAGE_VERSION__ at build time.
declare const __PACKAGE_VERSION__: string | undefined;
const VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__
    ? __PACKAGE_VERSION__
    : "0.0.0";

const argv = process.argv.slice(2);

const help = [
  "Usage: ans <command> [options]",
  "",
  "Commands:",
  "  doctor    Run smoke tests: provider ping + store check + domain validate",
  "  auth      Provider API keys: status, or store one once (ans auth set <provider>)",
  "  llm       Configure LLM providers (via @earendil-works/pi-ai)",
  "  skill     Install / validate / list / uninstall Agent Skills (installation ≠ activation)",
  "  search    Run a retrieval query",
  "            options: --json (structured envelope) · --fail-on-abstain (exit 3 on abstain)",
  "  chat      新建对话；--continue 续当前项目最近会话；--session ID 续指定会话；--list 查看",
  "            -p 只输出答案和来源；-c 接着问被打断的那轮",
  "            两种模式的进度写到标准错误，失败时退出非零",
  "  recommend Suggest a domain for a free-text task (top-3 + confidence, never auto-switches)",
  " domain Switch Active Domain (cc-persona TOML)",
  "  mcp       Start the anysearch MCP server (stdio or HTTP transport)",
  "  host      接入/修复/移除宿主接线（claude·codebuddy·codex·antigravity；只动自家条目）",
  " pref Manage T0 durable preferences (remember, pref review - /0025)",
  " memory Memory embeddings maintenance (backfill-vectors)",
  " access-chain Access-events tamper-evidence chain bootstrap",
  " switch-state Read switch governance state (S0-S4)",
  " entity Entity merge / unmerge / review list",
  " relation Entity relation edges: list + backfill-relations",
  " consolidate Turn selected materials into long-term knowledge (needs --session or --memory)",
  " hitl HITL review queue for blocked retrieved-derived URLs",
  "  upgrade  升级预检：status 看还有谁在干 · wait 暂拒新任务等收尾 · cancel 恢复准入",
  "",
  "Options:",
  "  --version, -v     Print version",
  "  --installation   Print build commit, installation path and entry role (installed command)",
  "  --help, -h        Print this help",
  "",
  "Exit codes:",
  "  0 ok   1 failure   2 usage   3 abstain (--fail-on-abstain)",
  "  4 refused: an upgrade paused new tasks (ans upgrade cancel reopens admission)",
  "",
  "Env:",
  "  ANS_DOMAIN        Active Domain name (overrides TOML selection)",
  "  ANS_LOG_LEVEL     trace | debug | info | warn | error (default: info)",
  "  TAVILY_API_KEY    Tavily provider API key",
  "  EXA_API_KEY       Exa provider API key",
].join("\n") + "\n";

if (argv.length === 0) {
  process.stdout.write(help);
  process.exit(0);
}

const cmd = argv[0];
if (cmd === "--version" || cmd === "-v") {
  process.stdout.write(VERSION + "\n");
  process.exit(0);
}
if (cmd === "--help" || cmd === "-h") {
  process.stdout.write(help);
  process.exit(0);
}

const known = new Set(["switch-state", "doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain", "mcp", "pref", "memory", "entity", "relation", "consolidate", "access-chain", "hitl", "host", "upgrade"]);
if (!known.has(cmd)) {
  process.stderr.write("ans: unknown command" + String.fromCharCode(39) + cmd + String.fromCharCode(39) + "\n" + "See" + String.fromCharCode(39) + "ans --help" + String.fromCharCode(39) + ".\n");
  process.exit(2);
}

// CLI wiring: dispatch to command implementation.
// Each command receives remaining args and returns exit code.
// B1: `ans domain <name>` persists to ~/.anysearch/config.env — rehydrate
// it into env (only where unset) so the active domain actually reaches search/chat/etc.
rehydrateConfigEnv();

const cmdArgs = argv.slice(1);
const handlers: Record<string, (args: string[]) => Promise<number>> = {
  doctor: runDoctor,
  search: runSearch,
  domain: runDomain,
  auth: runAuth,
  llm: runLlm,
  skill: runSkill,
  chat: runChat,
  recommend: runRecommend,
  mcp: runMcp,
  pref: runMemoryPreference,
  memory: runMemory,
  entity: runEntity,
  relation: runRelation,
  consolidate: runConsolidate,
  "access-chain": runAccessChain,
  "switch-state": runSwitchState,
  hitl: runHitl,
  host: runHost,
  upgrade: runUpgrade,
};

const handler = handlers[cmd];

// #302: the main program registers this invocation — a process record for the
// CLI process, and (unless the command is itself a host process, e.g. `mcp`)
// a task record with a role, so a command added to the dispatch table tomorrow
// is automatically visible to upgrade admission (#309). A broken registry
// warns on stderr and the command still runs; the one place that then stops is
// a chat whose domain declares [budget] (a declared budget that cannot be
// established must not turn into uncontrolled calls — see
// commands/chat-task-budget.ts).
const tracking = trackCliCommand(cmd);

// Exit path — explicit native teardown BEFORE exit. The old
// process.exit(code) raced libuv teardown against live sqlite/onnx handles
// (F1 macOS libc++abi abort family). close() first, then let the loop drain;
// unrefPendingHandles is the D3a backstop for handles we cannot close, and
// the watchdog preserves the old guaranteed-exit semantics if anything still
// keeps the loop alive.
const exit = (code: number): void => {
  // The process record ends before teardown closes the registry's connection:
  // the write needs that connection still open.
  try { tracking.endProcess(); } catch { /* best-effort record */ }
  try { runTeardown(); } finally {
    process.exitCode = code;
    unrefPendingHandles();
    setTimeout(() => process.exit(code), 5000).unref();
  }
};
// The handler runs inside the task context when one was registered, so the
// command (chat today) can read the task id it bills to.
const runCommand = (): Promise<number> =>
  tracking.task ? tracking.task.run(() => handler(cmdArgs)) : handler(cmdArgs);

// #309: an upgrade closes admission for BUSINESS commands. That refusal is not
// a broken registry (which warns and runs anyway) — it is a decision, so the
// command stops before its handler with its own message and exit code 4, and
// it is never queued or replayed. `upgrade` and the other management commands
// register with role='management' and keep working, which is what makes the
// pause navigable.
if (tracking.admissionRefusal) {
  process.stderr.write(describeAdmissionRefusal(tracking.admissionRefusal));
  exit(4);
} else runCommand()
  .then((code) => {
    // Success and failure both end a task; the exit code says which. Written
    // before exit closes the registry connection.
    tracking.task?.finish(code);
    exit(code);
  })
  .catch((e) => {
    process.stderr.write("ans: " + cmd + " failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
    tracking.task?.finish(1);
    exit(1);
  });
