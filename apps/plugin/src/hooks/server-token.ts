// Re-export the server credential + address helpers for bundle targets that
// need them outside the server entry (e.g. the dsh in-process adapter).
export {
  resolveServerToken,
  resolveServerEndpoint,
  readServerRegistry,
  serverTokenPath,
  serverRegistryPath,
  projectIndexDbPath,
  DEFAULT_SERVER_URL,
  type ResolvedToken,
  type ServerEndpoint,
  type ServerRegistryEntry,
} from "../server/token.js";
