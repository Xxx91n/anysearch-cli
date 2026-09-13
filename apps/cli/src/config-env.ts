// ~/.anysearch/config.env — the CLI's persisted key=value config (G016).
// ADR-0061 B1: shared module + entry-point rehydrate so `ans domain <name>`
// actually takes effect for search/chat/etc. across sessions (was write-only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function configPath(): string {
  return join(homedir(), ".anysearch", "config.env");
}

// Read persisted config (KEY=value format).
export function readConfig(): Record<string, string> {
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
export function writeConfig(key: string, value: string): void {
  const dir = join(homedir(), ".anysearch");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readConfig();
  existing[key] = value;
  const content =
    Object.entries(existing)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n";
  // SECURITY: restrict config file permissions to owner-only (CWE-312).
  writeFileSync(configPath(), content, { encoding: "utf8", mode: 0o600 });
}

// Rehydrate persisted keys into env where the key is not already defined.
// Never overwrites explicit env — including an explicitly empty value
// (verify-observation.mjs scrubs ANS_DOMAIN="" to test env-less boot).
export function rehydrateConfigEnv(env: NodeJS.ProcessEnv = process.env): void {
  const persisted = readConfig();
  for (const [k, v] of Object.entries(persisted)) {
    if (env[k] === undefined) env[k] = v;
  }
}
