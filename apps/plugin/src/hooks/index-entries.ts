// Shared "index this tool output" call for every host adapter.
//
// Each host wraps hooks differently, but the IPC body is the same: the
// resolved project root, the tool name, the distilled entries, and the host
// session id. Keeping it here means a project-less hook behaves the same on
// every host, and there is one place to keep the request shape honest.
//
// #307: an optional parent task travels with the body, so a host that already
// holds a task id (dsh's own tool call) can say "this index write is the tail
// of THAT task". The service verifies the id and records "unknown" instead of
// a dangling link when the row is not in its database — the field is a
// best-effort attribution, never a promise.
import { callServer, type HookDecision } from "./core.js";
import { resolveServerEndpoint } from "../server/token.js";

type IndexEntries = NonNullable<HookDecision["indexEntries"]>;

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
  }, { sessionId }).catch(() => null);
}
