// ans domain: switch or show Active Domain (cc-persona TOML, ADR-0002).
// ADR-0006 decision 4A: loads TOML from domains/<name>.toml convention directory.
// G016: persists domain to ~/.anysearch/config.env for cross-session recall.

import { loadDomainByNameIn, listDomainTomls } from "@anysearch-cli/store";
import { configPath, readConfig, writeConfig } from "../config-env";
import { domainSearchDirs } from "../db";
import type { DomainConfigPort } from "@anysearch-cli/kernel";

// Domain names discoverable on the resolution chain (shared lister; one
// implementation for both call sites).
function listDomains(): Set<string> {
  return new Set([...listDomainTomls(domainSearchDirs()).keys()].map((f) => f.replace(/\.toml$/, "")));
}

export async function runDomain(args: string[]): Promise<number> {
  // Check persisted config first, then env var.
  const persisted = readConfig();
  const current = process.env.ANS_DOMAIN || persisted.ANS_DOMAIN || "default";
  if (args.length === 0) {
    console.log("Active Domain: " + current);
    if (persisted.ANS_DOMAIN) {
      console.log("  (persisted in " + configPath() + ")");
    }
    {
      const names = listDomains();
      if (names.size > 0) console.log("Available: " + [...names].join(", "));
    }

    console.log("Set with: ans domain <name>");
    return 0;
  }
  const newDomain = args[0];
  // G016: persist domain to config file.
  console.log("Switching Active Domain to: " + newDomain);
  try {
    writeConfig("ANS_DOMAIN", newDomain);
    console.log("  [persisted] " + configPath());
  } catch (e: any) {
    console.log("  [warn] could not persist: " + (e?.message || String(e)));
  }
  // Also set for current process.
  process.env.ANS_DOMAIN = newDomain;
  // ADR-0006 decision 4A: load TOML and display resolved config.
  try {
    const schema = loadDomainByNameIn(newDomain, domainSearchDirs()) as DomainConfigPort;
    console.log("  sources: " + schema.sources.enabled.join(", "));
    console.log("  skills: " + schema.skills.active.join(", "));
    console.log("  hooks: " + schema.hooks.toolWhitelist.join(", "));
    console.log("  rag: " + schema.rag.adapter);
  } catch (e: any) {
    console.log("  Note: " + e.message);
    const names = listDomains();
    console.log("  No TOML found - domain name persisted but resolves to silent full-fanout.");
    if (names.size > 0) console.log("  Available domains: " + [...names].join(", "));
    console.log("  Remediation: ans domain <listed name>, or set ANS_DOMAINS_DIR to the dir holding " + newDomain + ".toml");
  }
  console.log("");
  console.log("Domain will persist across sessions via " + configPath() + ".");
  return 0;
}
