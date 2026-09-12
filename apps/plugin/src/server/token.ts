// ADR-0059 D7 (T-6.3): server token resolution.
//
// The plugin server must never run open. When ANS_SERVER_TOKEN is unset, a 256-bit token is
// generated and persisted to <cwd>/.anysearch-cli/server-token (mode 0600) so the local hooks can
// read the same value; the server logs only the path it wrote, never the token itself.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function serverTokenPath(cwd: string = process.cwd()): string {
  return join(cwd, ".anysearch-cli", "server-token");
}

export interface ResolvedToken {
  token: string;
  generated: boolean;
  path: string;
}

export function resolveServerToken(cwd: string = process.cwd()): ResolvedToken {
  const path = serverTokenPath(cwd);
  const env = process.env.ANS_SERVER_TOKEN;
  if (env && env.trim()) return { token: env.trim(), generated: false, path };
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return { token: existing, generated: false, path };
  }
  const token = randomBytes(32).toString("hex"); // 256-bit
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token + "\n", { encoding: "utf8", mode: 0o600 });
  return { token, generated: true, path };
}
