#!/usr/bin/env tsx
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

const VERSION = "0.0.0";

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
  "  chat      Interactive retrieval-augmented chat session",
  "  recommend Get recommendations from the active domain",
  "  domain    Switch Active Domain (cc-persona TOML, ADR-0002)",
"  mcp       Start the anysearch MCP server (stdio or HTTP transport)",
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

const known = new Set(["doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain", "mcp"]);
if (!known.has(cmd)) {
  process.stderr.write("ans: unknown command " + String.fromCharCode(39) + cmd + String.fromCharCode(39) + "\n" + "See " + String.fromCharCode(39) + "ans --help" + String.fromCharCode(39) + ".\n");
  process.exit(2);
}

// Composition root: dispatch to command implementation.
// Each command receives remaining args and returns exit code.
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
};

const handler = handlers[cmd];
handler(cmdArgs)
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write("ans: " + cmd + " failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(1);
  });
