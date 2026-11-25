// Shared LLM config resolver — now lives in @anysearch-cli/store so CLI and
// MCP use the same rules (issue #300). This module stays as a thin re-export so
// existing CLI imports and tests keep their paths. The implementation, the
// project whitelist, the provider/secret binding guard, the per-field source
// report and the source labels all live in the store module — there is exactly
// one copy. #301: the user credential file accessors are re-exported the same way.

export {
  BASE_URL_SOURCE,
  bindingCommand,
  bindingRetarget,
  displayEndpoint,
  formatLlmConfigGap,
  KEY_SOURCE_LABELS,
  LLM_API_VALUES,
  llmKeyLabel,
  needsLlmSetupHint,
  normalizeBindingEndpoint,
  parseLlmFlags,
  parseLlmToml,
  PROJECT_LLM_KEYS,
  projectConfigPath,
  providerLabel,
  readUserCredentials,
  REQUIRED_LLM_KEYS,
  resolveConfigHome,
  resolveLlmConfig,
  STORE_KEY_COMMAND,
  storeKeyCommand,
  userConfigPath,
  userCredentialsPath,
  writeUserCredential,
  writeUserLlmConfig,
} from "@anysearch-cli/store";

export type {
  CredentialFileContents,
  LlmConfigFileState,
  LlmConfigFileStatus,
  LlmFileDiagnostic,
  LlmFileDiagnosticKind,
  LlmFileFault,
  LlmLayer,
  LlmValueDiagnostic,
  LlmValueDiagnosticKind,
  ResolvedLlmConfig,
} from "@anysearch-cli/store";
