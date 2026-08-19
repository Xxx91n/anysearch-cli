// ans domain: switch or show Active Domain (cc-persona TOML, ADR-0002).
// ADR-0006 decision 4A: loads TOML from domains/<name>.toml convention directory.
// G016: persists domain to ~/.anysearch/config.env for cross-session recall.

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadDomainByName } from "@anysearch/store";
import type { DomainConfigPort } from "@anysearch/kernel";

// Config file path: ~/.anysearch/config.env
function configPath(): string {
  return join(homedir(), ".anysearch", "config.env");
}

// Read persisted config (KEY=value format).
function readConfig(): Record<string, string> {
  try {
    const content = readFileSync(configPath(), "utf8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) result[match[1]] = match[2];
    }
    return result;
  } catch {
    return {};
  }
}

// Write a config key-value pair to ~/.anysearch/config.env.
function writeConfig(key: string, value: string): void {
  const dir = join(homedir(), ".anysearch");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readConfig();
  existing[key] = value;
  const content = Object.entries(existing)
    .map(([k, v]) => k + "=" + v)
    .join("\n") + "\n";
  // SECURITY: restrict config file permissions to owner-only (CWE-312).
  writeFileSync(configPath(), content, { encoding: "utf8", mode: 0o600 });
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
    try {
      const dir = join(process.cwd(), "domains");
      const files = readdirSync(dir).filter((f: string) => f.endsWith(".toml"));
      if (files.length > 0) {
        console.log("Available: " + files.map((f: string) => f.replace(/\.toml$/, "")).join(", "));
      }
    } catch { /* no domains dir */ }
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
    const schema = loadDomainByName(newDomain) as DomainConfigPort;
    console.log("  sources: " + schema.sources.enabled.join(", "));
    console.log("  skills: " + schema.skills.active.join(", "));
    console.log("  hooks: " + schema.hooks.toolWhitelist.join(", "));
    console.log("  rag: " + schema.rag.adapter);
  } catch (e: any) {
    console.log("  Note: " + e.message);
    console.log("  No TOML found - domain name persisted (no config loaded).");
  }
  console.log("");
  console.log("Domain will persist across sessions via " + configPath() + ".");
  return 0;
}
