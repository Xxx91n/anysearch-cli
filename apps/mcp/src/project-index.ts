// Project-index recall for the MCP entry.
//
// The project index is written by the plugin server, so MCP reads it from that
// same service instead of opening a second database handle. That keeps one
// writer/reader pair and one project condition: the server only answers for
// the project roots this call names, and every root is resolved as a real
// project on this machine first.
//
// All of it is optional. No plugin server, no project identity, or a refused
// request means "project index unavailable", said plainly in the tool result;
// the shared research archive in the store is unaffected.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectContext } from "@anysearch-cli/store";

export interface ProjectIndexHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
  createdAt?: string;
  projectPath?: string;
}

export interface ProjectIndexRecall {
  hits: ProjectIndexHit[];
  projects: string[];
  note?: string;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:33333";

function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE || env.HOME || ".";
  return join(home, ".anysearch-cli");
}

function loopbackUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!loopback.has(url.hostname.toLowerCase())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Read the shared token without creating one: a missing token means no server
 * has run for this installation, so there is nothing to call.
 */
function sharedToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.ANS_SERVER_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const value = readFileSync(join(configDir(env), "server-token"), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function sharedServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ANS_SERVER_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const registry = JSON.parse(readFileSync(join(configDir(env), "server.json"), "utf8")) as { url?: unknown };
    const url = typeof registry.url === "string" ? loopbackUrl(registry.url) : null;
    if (url) return url;
  } catch { /* no published address */ }
  return DEFAULT_SERVER_URL;
}

/**
 * Resolve the projects this recall may read. The current working directory is
 * the explicit project of this MCP process; extra roots are the caller's
 * deliberate cross-project choice and are validated one by one.
 */
export function resolveRecallProjects(explicit: readonly string[] = []): { projects: string[]; notes: string[] } {
  const projects: string[] = [];
  const notes: string[] = [];
  const current = resolveProjectContext();
  const currentReason = current.root ? "" : current.reason;
  if (current.root) projects.push(current.root);
  for (const raw of explicit) {
    const candidate = typeof raw === "string" ? raw.trim() : "";
    if (!candidate) continue;
    const resolved = resolveProjectContext(candidate);
    if (!resolved.root) {
      notes.push("ignored project path " + candidate + ": " + resolved.reason);
      continue;
    }
    if (!projects.includes(resolved.root)) projects.push(resolved.root);
  }
  if (projects.length === 0) {
    notes.push("project index unavailable: " + currentReason);
  }
  return { projects, notes };
}

export async function recallProjectIndex(
  query: string,
  limit: number,
  explicitProjects: readonly string[] = [],
): Promise<ProjectIndexRecall> {
  const { projects, notes } = resolveRecallProjects(explicitProjects);
  if (projects.length === 0) return { hits: [], projects, note: notes.join("; ") };
  const token = sharedToken();
  if (!token) {
    return { hits: [], projects, note: "project index unavailable: the plugin server has not run for this installation" };
  }
  try {
    const body: Record<string, unknown> = projects.length === 1
      ? { query, projectPath: projects[0], limit }
      : { query, projects, limit };
    const response = await fetch(sharedServerUrl() + "/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { hits: [], projects, note: "project index unavailable: plugin server returned HTTP " + response.status };
    }
    const parsed = await response.json() as { hits?: unknown };
    const hits = Array.isArray(parsed.hits)
      ? (parsed.hits as ProjectIndexHit[]).filter((hit) => hit && typeof hit.title === "string")
      : [];
    return { hits, projects, ...(notes.length ? { note: notes.join("; ") } : {}) };
  } catch (error) {
    return {
      hits: [],
      projects,
      note: "project index unavailable: " + (error instanceof Error ? error.message : String(error)),
    };
  }
}
