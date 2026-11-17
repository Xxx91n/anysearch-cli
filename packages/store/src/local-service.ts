// Local service identity: where the plugin server keeps its token, which
// address it published, and where the shared project index lives.
//
// Design: one token and one published address per installation under
// ~/.anysearch-cli, plus one user-level index database — a per-project token
// and a cwd-derived port made every new directory a guessing game, and the
// server could not answer for a project other than its start directory (S3).
//
// This module is the single source for every entry point that talks to the
// local service (plugin hooks, the plugin server, dsh, and the MCP recall
// fallback). It uses only node builtins so hook bundles (esbuild) and the
// bundled apps can include it without pulling the store's native dependencies.
//
// Both the token and the address belong to the installation, not to a project
// directory: one file per user config root, read by every project's hooks.
// ANS_SERVER_URL and ANS_SERVER_TOKEN stay the explicit override channel.
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:33333";

/** User config root: ~/.anysearch-cli (USERPROFILE on Windows, HOME elsewhere). */
export function installConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE || env.HOME || ".";
  return join(home, ".anysearch-cli");
}

/** User data root: ~/.anysearch, where the databases live. */
export function installDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE || env.HOME || ".";
  return join(home, ".anysearch");
}

/** One token for this installation; every project's hooks read the same file. */
export function serverTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(installConfigDir(env), "server-token");
}

/** The address record the running server writes; ANS_SERVER_REGISTRY overrides (tests). */
export function serverRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_SERVER_REGISTRY?.trim();
  return override ? override : join(installConfigDir(env), "server.json");
}

/**
 * The project index lives in the user data root, so the server, the CLI and
 * every project's hooks read and write the same table. Per-project isolation
 * comes from the project_path column, not from a per-directory database.
 * ANS_PROJECT_DB stays the explicit override channel.
 */
export function projectIndexDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_PROJECT_DB?.trim();
  return override ? override : join(installDataDir(env), "project-index.db");
}

export interface ResolvedToken {
  token: string;
  generated: boolean;
  path: string;
}

/** Read the installation token without creating one (clients that must not write). */
export function readServerToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.ANS_SERVER_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const value = readFileSync(serverTokenPath(env), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Read the published address without creating anything or contacting the server. */
export function readPublishedServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ANS_SERVER_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const registry = readServerRegistry(env);
  if (registry) return registry.url;
  return DEFAULT_SERVER_URL;
}

export function resolveServerToken(env: NodeJS.ProcessEnv = process.env): ResolvedToken {
  const path = serverTokenPath(env);
  const fromEnv = env.ANS_SERVER_TOKEN;
  if (fromEnv && fromEnv.trim()) return { token: fromEnv.trim(), generated: false, path };
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return { token: existing, generated: false, path };
  }
  const token = randomBytes(32).toString("hex"); // 256-bit
  mkdirSync(dirname(path), { recursive: true });
  // Design: publish the first token with an exclusive hard link — two first-run
  // processes must not each mint a token and overwrite the other, or the losing
  // server keeps a token the shared file no longer matches (401 until restart).
  // The loser reads the winner's file.
  const tmp = join(dirname(path), ".server-token." + process.pid + "." + randomBytes(6).toString("hex"));
  writeFileSync(tmp, token + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    linkSync(tmp, path);
    return { token, generated: true, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
      // Hard links unsupported on some filesystems: fall back to exclusive create.
      try {
        writeFileSync(path, token + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
        return { token, generated: true, path };
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException)?.code !== "EEXIST") throw fallbackError;
      }
    }
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return { token: existing, generated: false, path };
    // An empty file is a crashed first write; replace it with this token.
    writeFileSync(path, token + "\n", { encoding: "utf8", mode: 0o600 });
    return { token, generated: true, path };
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

export interface ServerRegistryEntry {
  url: string;
  pid?: number;
  startedAt?: string;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function loopbackUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else; any other
    // error (ESRCH and friends) means it is gone.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** Read the published address, ignoring a record whose process is gone. */
export function readServerRegistry(env: NodeJS.ProcessEnv = process.env): ServerRegistryEntry | null {
  try {
    const raw = JSON.parse(readFileSync(serverRegistryPath(env), "utf8")) as Partial<ServerRegistryEntry>;
    const url = typeof raw.url === "string" ? loopbackUrl(raw.url) : null;
    if (!url) return null;
    if (typeof raw.pid === "number" && !pidAlive(raw.pid)) return null;
    return {
      url,
      ...(typeof raw.pid === "number" ? { pid: raw.pid } : {}),
      ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
    };
  } catch {
    return null;
  }
}

/** Publish the address the server actually bound. Returns the file path. */
export function writeServerRegistry(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const origin = loopbackUrl(url);
  if (!origin) throw new Error("server registry only accepts a loopback http(s) URL");
  const path = serverRegistryPath(env);
  const entry: ServerRegistryEntry = { url: origin, pid: process.pid, startedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

/** Remove our own record; leave a record another process published. */
export function clearServerRegistry(env: NodeJS.ProcessEnv = process.env): void {
  const path = serverRegistryPath(env);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ServerRegistryEntry>;
    if (typeof raw.pid === "number" && raw.pid !== process.pid) return;
    unlinkSync(path);
  } catch {
    // Already gone or unreadable: nothing to clean up.
  }
}

export interface ServerEndpoint {
  url: string;
  token: string;
  source: "env" | "registry" | "default";
}

/** Explicit env wins, then the published address, then the documented default. */
export function resolveServerEndpoint(env: NodeJS.ProcessEnv = process.env): ServerEndpoint {
  const { token } = resolveServerToken(env);
  const fromEnv = env.ANS_SERVER_URL?.trim();
  if (fromEnv) return { url: fromEnv.replace(/\/+$/, ""), token, source: "env" };
  const registry = readServerRegistry(env);
  if (registry) return { url: registry.url, token, source: "registry" };
  return { url: DEFAULT_SERVER_URL, token, source: "default" };
}
