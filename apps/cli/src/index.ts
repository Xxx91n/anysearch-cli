#!/usr/bin/env tsx
// anysearch-cli entry - vertical agent for information retrieval.
// Seam 5: CLI composition root. Packages are wired here.

import type { SearchProvider, FusedEnvelope } from "@anysearch/retriever";
import type { AgentRuntime, RetrieverPort, SessionStorePort, DomainConfigPort } from "@anysearch/kernel";
import type { SessionStore, DomainSchema } from "@anysearch/store";

const VERSION = "0.0.0";

const argv = process.argv.slice(2);

const help = [
  "Usage: ans <command> [options]",
  "",
  "Commands:",
  "  doctor    Run smoke tests: provider ping + ctx/codegraph probe + config check",
  "  auth      Configure provider API keys and anysearch channel credentials",
  "  llm       Configure LLM providers (via @earendil-works/pi-ai)",
  "  skill     Manage Agent Skills (install / list / remove)",
  "  search    Run a retrieval query through the Retroaererd Engine",
  "  chat      Interactive retrieval-augmented chat session",
  "  recommend Get recommendations from the active domain",
  "  domain    Switch Active Domain (cc-persona TOML, ADR-0002)",
  "",
  "Options:",
  "  --version, -v     Print version",
  "  --help, -h        Print this help",
  "",
  "Env:",
  "  ANS_DOMAIN        Active Domain name (overrides TOML selection)",
  "  ANS_LOG_LEVEL     trace | debug | info | warn | error (default: info)",
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

// ponytail: stub map for Step 3 - each command becomes one file under src/commands/<name>.ts
// Seam 5: composition root will inject real implementations here.
const known = new Set(["doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain"]);
if (!known.has(cmd)) {
  process.stderr.write("ans: unknown command " + String.fromCharCode(39) + cmd + String.fromCharCode(39) + "\n" + "See " + String.fromCharCode(39) + "ans --help" + String.fromCharCode(39) + ".\n");
  process.exit(2);
}
process.stderr.write("ans: " + String.fromCharCode(39) + cmd + String.fromCharCode(39) + " not implemented yet (kernel split seam 5 pending)\n");
process.exit(3);