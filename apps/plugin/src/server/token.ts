// Server token and address discovery are shared with the MCP recall fallback,
// so the implementation lives in @anysearch-cli/store/local-service (node
// builtins only, safe for the hook bundles). This module keeps the plugin-side
// import path stable.
export {
  DEFAULT_SERVER_URL,
  installConfigDir,
  installDataDir,
  serverTokenPath,
  serverRegistryPath,
  projectIndexDbPath,
  resolveServerToken,
  readServerToken,
  readPublishedServerUrl,
  readServerRegistry,
  writeServerRegistry,
  clearServerRegistry,
  resolveServerEndpoint,
  type ResolvedToken,
  type ServerRegistryEntry,
  type ServerEndpoint,
} from "@anysearch-cli/store/local-service";
