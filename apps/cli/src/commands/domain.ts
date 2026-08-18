// ans domain: switch or show Active Domain (cc-persona TOML, ADR-0002).
// ADR-0006 decision 4A: loads TOML from domains/<name>.toml convention directory.

import { loadDomainByName } from "@anysearch/store";
import type { DomainConfigPort } from "@anysearch/kernel";

export async function runDomain(args: string[]): Promise<number> {
  const current = process.env.ANS_DOMAIN || "default";
  if (args.length === 0) {
    console.log("Active Domain: " + current);
    // List available domains from convention directory.
    try {
      const { readdirSync } = require("node:fs");
      const { join } = require("node:path");
      const dir = join(process.cwd(), "domains");
      const files = readdirSync(dir).filter((f: string) => f.endsWith(".toml"));
      if (files.length > 0) {
        console.log("Available: " + files.map((f: string) => f.replace(/\.toml$/, "")).join(", "));
      }
    } catch { /* no domains dir */ }
    console.log("Set with: ANS_DOMAIN=<name> or ans domain <name>");
    return 0;
  }
  const newDomain = args[0];
  // ADR-0006 decision 4A: load TOML and display resolved config.
  console.log("Switching Active Domain to: " + newDomain);
  try {
    const schema = loadDomainByName(newDomain) as DomainConfigPort;
    console.log("  sources: " + schema.sources.enabled.join(", "));
    console.log("  skills: " + schema.skills.active.join(", "));
    console.log("  hooks: " + schema.hooks.toolWhitelist.join(", "));
    console.log("  rag: " + schema.rag.adapter);
    console.log("Set ANS_DOMAIN=" + newDomain + " for persistence.");
  } catch (e: any) {
    console.log("Note: " + e.message);
    console.log("No TOML found — domain name only (no config loaded).");
  }
  return 0;
}
