// Shared LLM config resolver — now lives in @anysearch-cli/store so CLI and
// MCP use the same rules (issue #300). This module stays as a thin re-export so
// existing CLI imports and tests keep their paths. The implementation, the
// project whitelist, the provider/secret binding guard, the per-field source
// report and the source labels all live in the store module — there is exactly
// one copy. #301: the user credential file accessors are re-exported the same way.

export {
  displayEndpoint,
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

export type {
  CredentialBinding,
  CredentialFileContents,
  LlmFileConfig,
  LlmFlags,
  LlmLayer,
  ResolvedLlmConfig,
  ResolveLlmOpts,
} from "@anysearch-cli/store";
