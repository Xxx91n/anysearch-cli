// Re-export the server token resolver for bundle targets that need the shared
// credential outside the server entry (e.g. the dsh in-process adapter).
export { resolveServerToken, serverTokenPath, type ResolvedToken } from "../server/token.js";
