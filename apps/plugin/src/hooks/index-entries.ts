// Shared "index this tool output" call for every host adapter.
//
// Each host wraps hooks differently, but the IPC body is the same: the
// resolved project root, the tool name, the distilled entries, and the host
// session id. Keeping it here means a project-less hook behaves the same on
// every host, and there is one place to keep the request shape honest.
import { callServer, type HookDecision } from "./core.js";
import { resolveServerEndpoint } from "../server/token.js";

type IndexEntries = NonNullable<HookDecision["indexEntries"]>;

export async function indexToProject(
  projectRoot: string | null,
  toolName: string,
  entries: IndexEntries | undefined,
  sessionId: string,
): Promise<void> {
  if (!projectRoot || !entries || entries.length === 0) return;
  const endpoint = resolveServerEndpoint();
  await callServer(endpoint.url + "/index", endpoint.token, {
    projectPath: projectRoot,
    toolName,
    entries,
  }, { sessionId }).catch(() => null);
}
