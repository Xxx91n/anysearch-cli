// Shared LLM config resolver — now lives in @anysearch-cli/store so CLI and
// MCP use the same rules (issue #300). This module stays as a thin re-export so
// existing CLI imports and tests keep their paths. The implementation, the
// project whitelist, the provider/secret binding guard and the per-field
// source report all live in the store module — there is exactly one copy.
// #301: the user credential file accessors are re-exported the same way.

export {
  displayEndpoint,
  parseLlmFlags,
  parseLlmToml,
  projectConfigPath,
  readUserCredentials,
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
