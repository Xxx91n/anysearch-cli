// Shared LLM config resolver — now lives in @anysearch-cli/store so CLI and
// MCP use the same rules (issue #300). This module stays as a thin re-export so
// existing CLI imports and tests keep their paths. The implementation, the
// project whitelist, the provider/secret binding guard, the per-field source
// report and the source labels all live in the store module — there is exactly
// one copy. #301: the user credential file accessors are re-exported the same way.

export {
  displayEndpoint,
  formatLlmConfigFault,
  KEY_SOURCE_LABELS,
  parseLlmFlags,
  parseLlmToml,
  projectConfigPath,
  readUserCredentials,
  resolveConfigHome,
  resolveLlmConfig,
  userConfigPath,
  userCredentialsPath,
  writeUserCredential,
  writeUserLlmConfig,
} from "@anysearch-cli/store";

/**
 * The one line `ans auth` and `ans llm` print when they exit non-zero over a
 * broken credential file. It lives here so neither command has to import the
 * other, and so the exit-1 advice cannot drift between them (#537).
 */
export const REPAIR_HINT = "Fix the file: ans auth repair   (keeps the keys it can read)";

export type {
  CredentialBinding,
  CredentialFileContents,
  LlmConfigFaultKind,
  LlmFileConfig,
  LlmFlags,
  LlmLayer,
  ResolvedLlmConfig,
  ResolveLlmOpts,
} from "@anysearch-cli/store";
