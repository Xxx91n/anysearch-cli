// recall_memory tool: FTS5 with time decay + project index fallback (two-stage).
// input validated by AJV from KernelToolSchemas; handler reads typed args.

import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { KernelJsonSchemas, KernelToolDescriptions } from "@anysearch-cli/kernel";
import { observeTool } from "./observation.js";
import { withMcpTask } from "../mcp-task.js";
import { toolError } from "./failure.js";
import { recallProjectIndex } from "../project-index.js";

export function registerRecallMemory(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "recall_memory",
    {
      description: KernelToolDescriptions.recall_memory,
      inputSchema: fromJsonSchema(KernelJsonSchemas.recall_memory),
    },
    async (args: unknown, ctx?: ServerContext) => {
      // #304: every MCP tool call is one task. This tool bills no model call,
      // but the task id in its closeout is what lets the hook's post-work
      // (index writes) say which request caused it (#307).
      return withMcpTask(eng, "recall_memory", () => observeTool(eng, "recall_memory", ctx, async () => {
      try {
        const { query, limit, projectPaths } = args as { query: string; limit?: number; projectPaths?: string[] };
        const lim = limit ?? 5;
        // FTS5 memory recall with time decay.
        const { isTimeSensitive, isEvergreen } = await import("@anysearch-cli/store");
        // search the research archive (retrieval_results_fts), not messages.
        const hits = await eng.store.searchMemory(query, lim);
        // #277: which object the query named, and whether that could be told.
        // The store already holds the knowledge lane to the object; this is the
        // honest report the caller needs, because "object undetermined" and
        // "nothing found" call for different next steps. Hand-built store mocks
        // do not implement the resolver, so an absent method means "no object
        // report" rather than a failed call.
        const objectResolution = typeof eng.store.resolveQueryObject === "function"
          ? eng.store.resolveQueryObject(query)
          : undefined;
        const objectState = objectResolution?.kind === "ambiguous"
          ? {
              status: "undetermined" as const,
              note: "the query names more than one known object in different writing systems, and nothing says whether they are the same one; no knowledge row is offered rather than guessing",
              candidates: objectResolution.matches.map((m) => m.name),
            }
          : objectResolution?.kind === "resolved"
            ? { status: "resolved" as const, name: objectResolution.name }
            : undefined;
        const ts = isTimeSensitive(query);
        const eg = isEvergreen(query);
        // Two-stage recall pipeline.
        // Stage 2: project index fallback (if internal hits insufficient).
        // provenance tagged, no cross-layer score mixing. The plugin server owns
        // the index and answers only for the project roots named here; an
        // unknown project or an absent server is reported, not guessed around.
        let projectHits: Array<{ title: string; url: string; snippet: string; source: string; rank: number; createdAt: string; projectPath?: string }> = [];
        let projectIndexNote: string | undefined;
        let projectScope: string[] = [];
        if (hits.length < lim) {
          const projectRecall = await recallProjectIndex(query, lim - hits.length, projectPaths ?? []);
          projectHits = projectRecall.hits.map((hit) => ({
            title: hit.title,
            url: hit.url,
            snippet: hit.snippet,
            source: hit.source,
            rank: hit.rank,
            createdAt: hit.createdAt ?? "",
            ...(hit.projectPath ? { projectPath: hit.projectPath } : {}),
          }));
          projectIndexNote = projectRecall.note;
          projectScope = projectRecall.projects;
        }
        // no attribution — recall_memory reads from memory store, not provider envelopes.
        const summary = JSON.stringify({
          query,
          qdfClassification: ts ? "time-sensitive" : eg ? "evergreen" : "standard",
          decayActive: !eg,
          ...(objectState ? { object: objectState } : {}),
          hitsCount: hits.length + projectHits.length,
          internal: hits.map((h) => ({
            role: h.role,
            content: h.content.slice(0, 200),
            rank: h.rank,
            sessionId: h.sessionId,
            // The archive row this hit came from. A summary records
            // its dependencies by id, so the material the model actually read
            // can be bound to the summary that used it. Positive rowid = archive
            // material, negative = knowledge row (SessionStore's semantic arm).
            rowid: h.rowid,
            provenance: "internal",
            // The four fields always appear: url/fetchedAt are null when absent,
            // hasContent is false, sections is []. Field meanings live in
            // docs/mcp-server.md.
            url: h.url ?? null,
            fetchedAt: h.fetchedAt ?? null,
            hasContent: h.hasContent === true,
            sections: (h.sections ?? []).slice(0, 20),
          })),
          projectIndex: projectHits.map((h) => ({
            title: h.title,
            url: h.url,
            snippet: (h.snippet || "").slice(0, 200),
            source: h.source,
            rank: h.rank,
            provenance: "project-index",
            ...(h.projectPath ? { project: h.projectPath } : {}),
          })),
          ...(projectIndexNote ? { projectIndexNote } : {}),
          ...(projectScope.length ? { projectIndexScope: projectScope } : {}),
        }, null, 2);
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (e) {
        return toolError("recall_memory", e instanceof Error ? e.message : String(e));
      }
      }));
    }
  );
}
