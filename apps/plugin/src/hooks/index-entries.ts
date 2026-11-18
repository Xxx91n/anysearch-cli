// Shared "index this tool output" call for every host adapter.
//
// One IPC body for every host: project root, tool name, distilled entries,
// session id, and (dsh) the task this write belongs to. A project-less hook
// behaves the same everywhere because the shape lives here.
import { callServer, type HookDecision } from "./core.js";
import { resolveServerEndpoint } from "../server/token.js";

type IndexEntries = NonNullable<HookDecision["indexEntries"]>;

/**
 * How long an index write may hold up its caller.
 *
 * The 5-second IPC default is a budget for the hook itself, not for a write
 * that rides inside a host's tool call. #307 made this write awaited (it used
 * to be fire-and-forget), so the ceiling became visible as a tail on every
 * `ans_*` call; 2 seconds is enough for the INSERT + rows + UPDATE the service
 * does, and a slower write still lands server-side (fail-open means the caller
 * stops waiting, not that the write is abandoned).
 */
const INDEX_WRITE_TIMEOUT_MS = 2000;

export async function indexToProject(
  projectRoot: string | null,
  toolName: string,
  entries: IndexEntries | undefined,
  sessionId: string,
  parentTaskId?: string,
): Promise<void> {
  if (!projectRoot || !entries || entries.length === 0) return;
  const endpoint = resolveServerEndpoint();
  await callServer(endpoint.url + "/index", endpoint.token, {
    projectPath: projectRoot,
    toolName,
    entries,
    ...(parentTaskId ? { parentTaskId } : {}),
  }, { sessionId, timeoutMs: INDEX_WRITE_TIMEOUT_MS }).catch(() => null);
}
