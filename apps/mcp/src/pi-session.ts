// PI session-record location for the MCP server.
// The kernel reads no env, so the root resolves the directory here.
import { dirname, join } from "node:path";
import { resolveDbPath } from "@anysearch-cli/kernel";

export function resolvePiSessionDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_PI_SESSION_DIR?.trim();
  if (override) return override;
  return join(dirname(resolveDbPath()), "pi-sessions");
}

export function piCompactionFromEnv(env: NodeJS.ProcessEnv = process.env): { reserveTokens?: number; keepRecentTokens?: number } {
  const parse = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  return {
    reserveTokens: parse(env.ANS_PI_COMPACTION_RESERVE_TOKENS),
    keepRecentTokens: parse(env.ANS_PI_COMPACTION_KEEP_RECENT_TOKENS),
  };
}
