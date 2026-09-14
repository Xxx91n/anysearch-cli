#!/usr/bin/env node
// anysearch-cli entry - vertical agent for information retrieval.
// Seam 5: CLI composition root. Packages are wired here.
// Composition root: provider registry + store + engine injected per command.

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
import { rehydrateConfigEnv } from "./config-env";
import { runTeardown, unrefPendingHandles } from "./teardown";

// ponytail: single source of truth for CLI version, same pattern as apps/mcp
// (ADR-0020 D3). tsup injects __PACKAGE_VERSION__ at build time.
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
  "  auth      Show provider API key configuration status",
  "  llm       Configure LLM providers (via @earendil-works/pi-ai)",
  "  skill     Manage Agent Skills (install / list / remove)",
  "  search    Run a retrieval query through the Retroaererd Engine",
  "            options: --json (structured envelope) · --fail-on-abstain (exit 3 on abstain)",
  "  chat      Interactive retrieval-augmented chat session",
  "  recommend Get recommendations from the active domain",
  "  domain    Switch Active Domain (cc-persona TOML, ADR-0002)",
  "  mcp       Start the anysearch MCP server (stdio or HTTP transport)",
  "  pref      Manage T0 durable preferences (/remember, pref review - ADR-0024/0025)",
  "  memory    Memory embeddings maintenance (backfill-vectors, ADR-0033)",
  "  access-chain  Access-events tamper-evidence chain bootstrap (ADR-0040)",
  "  switch-state Read switch governance state (S0-S4, ADR-0043)",
  "  entity    Entity merge / unmerge / review belt (ADR-0032)",
  "  relation  Entity relation edges: list + backfill-relations (ADR-0035 KG-lite arm)",
  "  consolidate Episodic->semantic consolidation with fidelity gate (ADR-0037)",
  "  hitl      HITL review queue for blocked retrieved-derived URLs (ADR-0054)",
  "",
  "Options:",
  "  --version, -v     Print version",
  "  --help, -h        Print this help",
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

const known = new Set(["switch-state", "doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain", "mcp", "pref", "memory", "entity", "relation", "consolidate", "access-chain", "hitl"]);
if (!known.has(cmd)) {
  process.stderr.write("ans: unknown command " + String.fromCharCode(39) + cmd + String.fromCharCode(39) + "\n" + "See " + String.fromCharCode(39) + "ans --help" + String.fromCharCode(39) + ".\n");
  process.exit(2);
}

// Composition root: dispatch to command implementation.
// Each command receives remaining args and returns exit code.
// ADR-0061 B1: `ans domain <name>` persists to ~/.anysearch/config.env — rehydrate
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
};

const handler = handlers[cmd];
// R62 D-003 (T4): exit path — explicit native teardown BEFORE exit. The old
// process.exit(code) raced libuv teardown against live sqlite/onnx handles
// (F1 macOS libc++abi abort family). close() first, then let the loop drain;
// unrefPendingHandles is the D3a backstop for handles we cannot close, and
// the watchdog preserves the old guaranteed-exit semantics if anything still
// keeps the loop alive.
const exit = (code: number): void => {
  try { runTeardown(); } finally {
    process.exitCode = code;
    unrefPendingHandles();
    setTimeout(() => process.exit(code), 5000).unref();
  }
};
handler(cmdArgs)
  .then(exit)
  .catch((e) => {
    process.stderr.write("ans: " + cmd + " failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
    exit(1);
  });
