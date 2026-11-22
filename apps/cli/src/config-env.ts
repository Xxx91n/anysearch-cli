// ~/.ans/config.env — the CLI's persisted key=value config (G016).
// B1: shared module + entry-point rehydrate so `ans domain <name>`
// actually takes effect for search/chat/etc. across sessions (was write-only).
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configEnvPath } from "@anysearch-cli/store/local-service";

export function configPath(): string {
  // One definition of where the CLI's persisted config lives; the plugin server
  // and the hook bundles read the same file through this helper's store home.
  return configEnvPath();
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

// Write a config key-value pair to ~/.ans/config.env.
//
// #306: the write goes through a temp file and a rename. `writeFileSync` in
// place truncates the file before it writes, so a fault mid-write (a full disk,
// a killed process) leaves an EMPTY config — and the previous domain selection
// with it. "A failed write keeps the old selection" only holds if the old file
// is never opened for truncation.
export function writeConfig(key: string, value: string): void {
  // The target's own directory, not a second guess at the home dir: the path
  // comes from configEnvPath() (USERPROFILE || HOME || homedir()), and homedir()
  // reads the passwd entry instead. When they disagree the file was written
  // into a directory nobody created.
  const target = configPath();
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readConfig();
  existing[key] = value;
  const content =
    Object.entries(existing)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n";
  const temp = target + ".tmp";
  try {
    // SECURITY: restrict config file permissions to owner-only (CWE-312). The
    // mode applies to the temp file, which the rename then publishes.
    writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
    // Plain rename, deliberately without fs-atomic's backoff: that policy waits up
    // to a minute on a permanent Windows sharing error, and a config switch that
    // hangs for a minute is worse than one that fails and keeps the old file.
    renameSync(temp, target);
  } catch (e) {
    // Never leave a half-written temp behind for the next write to trip over.
    try { unlinkSync(temp); } catch { /* already gone */ }
    throw e;
  }
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
