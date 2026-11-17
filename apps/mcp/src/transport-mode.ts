// Which transport this MCP process is running.
//
// Design: only stdio carries a per-connection workspace (the host's cwd). A
// long-running HTTP server can serve several workspaces, so its start
// directory must not stand in for every caller's project (S3). The HTTP entry
// marks itself here; without an explicit projectPaths list the project-index
// fallback then reports itself unavailable instead of handing one workspace's
// records to another.
let httpTransport = false;

export function markHttpTransport(): void {
  httpTransport = true;
}

export function hasPerConnectionWorkspace(): boolean {
  return !httpTransport;
}
