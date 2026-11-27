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
import type { MemoryExpandErrorCode, MemoryExpandRequest } from "@anysearch-cli/store";

const MAX_SECTIONS_PER_HIT = 20;

/** What the model should do about an expansion it cannot complete. */
const EXPAND_ERROR_HINT: Record<MemoryExpandErrorCode, string> = {
  knowledge_row: "a negative rowid names a long-term knowledge row and has no page body; expand only a positive material rowid from a recall hit",
  offset_out_of_range: "offset is outside this page's body; use an offset below totalChars",
  no_content: "this row has only a snippet and no page body; search or fetch the page first",
  section_not_found: "one of the sectionIds is not a section of this page; use the section list on the recall hit",
  not_found: "no material row has this rowid",
};

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
      return withMcpTask(eng, "recall_memory", () => observeTool(eng, "recall_memory", ctx, async (span) => {
      try {
        const { query, limit, projectPaths, expand } = args as {
          query: string; limit?: number; projectPaths?: string[]; expand?: MemoryExpandRequest;
        };
        if (expand) {
          const read = eng.store.expandMemory;
          if (typeof read !== "function") {
            return toolError("recall_memory", "this store cannot read page sections");
          }
          const result = read.call(eng.store, expand);
          span.addEvent("memory.expand", {
            "memory.rowid": expand.rowid,
            "memory.sectionIds": Array.isArray(expand.sectionId)
              ? expand.sectionId.join(",")
              : expand.sectionId === undefined ? "" : String(expand.sectionId),
            "memory.role": result.ok ? result.role : "",
            "memory.offset": expand.offset ?? 0,
            "memory.returnedChars": result.ok ? result.returnedChars : 0,
            "memory.hasMore": result.ok ? result.hasMore : false,
            "memory.error": result.ok ? "" : result.error,
          });
          if (!result.ok) {
            // A correction the model can act on, not a protocol fault (#204).
            return {
              isError: true as const,
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  rowid: result.rowid,
                  error: result.error,
                  ...(result.totalChars === undefined ? {} : { totalChars: result.totalChars }),
                  ...(result.sectionIds === undefined ? {} : { sectionIds: result.sectionIds }),
                  message: EXPAND_ERROR_HINT[result.error] ?? "the section could not be read",
                }, null, 2),
              }],
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                rowid: result.rowid,
                role: result.role,
                url: result.url,
                fetchedAt: result.fetchedAt,
                trust: "untrusted_web",
                totalChars: result.totalChars,
                offset: result.offset,
                returnedChars: result.returnedChars,
                hasMore: result.hasMore,
                nextOffset: result.nextOffset,
                truncatedBy: result.truncatedBy,
                text: result.text,
              }, null, 2),
            }],
          };
        }
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
            rank: h.rank ?? null,
            sessionId: h.sessionId,
            // The archive row this hit came from. A summary records
            // its dependencies by id, so the material the model actually read
            // can be bound to the summary that used it. Positive rowid = archive
            // material, negative = knowledge row (SessionStore's semantic arm).
            rowid: h.rowid,
            provenance: "internal",
            // Every hit carries the same fields: url/fetchedAt are null when
            // absent, rank is null when the arm has no score (a page found only
            // by its body, or an entity/relation hit), hasContent is false and
            // sections is []. sectionsTotal is the full count before the
            // 20-section cut — the list itself is cut from the top. Field
            // meanings live in docs/mcp-server.md.
            url: h.url ?? null,
            fetchedAt: h.fetchedAt ?? null,
            hasContent: h.hasContent === true,
            sections: (h.sections ?? []).slice(0, MAX_SECTIONS_PER_HIT),
            sectionsTotal: h.sections?.length ?? 0,
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
