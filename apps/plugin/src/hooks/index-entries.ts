// Shared "index this tool output" call for every host adapter.
//
// One IPC body for every host: project root, tool name, distilled entries,
// session id, and (dsh) the task this write belongs to. A project-less hook
// behaves the same everywhere because the shape lives here.
import { callServer, type HookDecision } from "./core.js";
import { resolveServerEndpoint } from "../server/token.js";

type IndexEntries = NonNullable<HookDecision["indexEntries"]>;

export interface IndexOptions {
  /** The task this write belongs to (dsh passes its own tool-call task). */
  parentTaskId?: string;
  /**
   * How long this write may hold up the CALLER.
   *
   * Defaults to the IPC budget (5s, see core.ts). Pass a shorter value only
   * where the write sits inside a host's own tool call and the caller has
   * promised the user a snappy turn — dsh's awaited post-execute does that, and
   * 2s is enough for the INSERT + rows + UPDATE the service performs. A write
   * that outlives the caller's patience still lands server-side; the timeout
   * stops the wait, not the work.
   */
  timeoutMs?: number;
}

export async function indexToProject(
  projectRoot: string | null,
  toolName: string,
  entries: IndexEntries | undefined,
  sessionId: string,
  opts: IndexOptions = {},
): Promise<void> {
  if (!projectRoot || !entries || entries.length === 0) return;
  const endpoint = resolveServerEndpoint();
  await callServer(endpoint.url + "/index", endpoint.token, {
    projectPath: projectRoot,
    toolName,
    entries,
    ...(opts.parentTaskId ? { parentTaskId: opts.parentTaskId } : {}),
  }, {
    sessionId,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  }).catch(() => null);
}
