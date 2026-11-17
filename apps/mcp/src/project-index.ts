// Project-index recall for the MCP entry.
//
// Design: read through the plugin server instead of opening the index database
// here — the server already owns the writer, so this keeps one writer/reader
// pair and one place that enforces the project condition (S3).
//
// The project index is written by the plugin server, so MCP reads it from that
// same service instead of opening a second database handle. That keeps one
// writer/reader pair and one project condition: the server only answers for
// the project roots this call names, and every root is resolved as a real
// project on this machine first.
//
// Service identity (token file, published address) comes from the shared
// store module, so MCP and the hooks cannot drift on which port or token is
// in use. The client variant only reads; it never creates a token, because
// "no token" means no server has run for this installation.
//
// All of it is optional. No plugin server, no project identity, or a refused
// request means "project index unavailable", said plainly in the tool result;
// the shared research archive in the store is unaffected.
import { resolveProjectContext } from "@anysearch-cli/store";
import { readPublishedServerUrl, readServerToken } from "@anysearch-cli/store/local-service";

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

/**
 * Resolve the projects this recall may read. Without an explicit list the
 * current working directory is the project. An explicit list replaces it:
 * the caller named exactly the roots it wants, each one is validated, and one
 * bad path makes the whole scope unknown (the same answer the server gives)
 * rather than returning partial results.
 */
export function resolveRecallProjects(explicit: readonly string[] = []): { projects: string[]; notes: string[] } {
  const requested = explicit
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  if (requested.length > 0) {
    const projects: string[] = [];
    for (const candidate of requested) {
      const resolved = resolveProjectContext(candidate);
      if ("reason" in resolved) {
        return { projects: [], notes: ["project index unavailable: " + candidate + ": " + resolved.reason] };
      }
      if (!projects.includes(resolved.root)) projects.push(resolved.root);
    }
    return { projects, notes: [] };
  }

  const current = resolveProjectContext();
  if ("reason" in current) {
    return { projects: [], notes: ["project index unavailable: " + current.reason] };
  }
  return { projects: [current.root], notes: [] };
}

export async function recallProjectIndex(
  query: string,
  limit: number,
  explicitProjects: readonly string[] = [],
): Promise<ProjectIndexRecall> {
  const { projects, notes } = resolveRecallProjects(explicitProjects);
  if (projects.length === 0) return { hits: [], projects, note: notes.join("; ") };
  const token = readServerToken();
  if (!token) {
    return { hits: [], projects, note: "project index unavailable: the plugin server has not run for this installation" };
  }
  try {
    // An explicit list is always sent as a list, so "the current project" and
    // "the projects the caller named" stay distinguishable on the wire.
    const explicitScope = explicitProjects.some((value) => typeof value === "string" && value.trim().length > 0);
    const body: Record<string, unknown> = explicitScope
      ? { query, projects, limit }
      : { query, projectPath: projects[0], limit };
    const response = await fetch(readPublishedServerUrl() + "/recall", {
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
