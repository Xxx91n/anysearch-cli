// Shared LLM config resolver — now lives in @anysearch-cli/store so CLI and
// MCP use the same rules (issue #300). This module stays as a thin re-export so
// existing CLI imports and tests keep their paths. The implementation, the
// project whitelist, the provider/secret binding guard and the per-field
// source report all live in the store module — there is exactly one copy.

export {
  parseLlmFlags,
  parseLlmToml,
  projectConfigPath,
  resolveLlmConfig,
  userConfigPath,
  writeUserLlmConfig,
} from "@anysearch-cli/store";

export type {
  LlmFileConfig,
  LlmFlags,
  LlmLayer,
  ResolvedLlmConfig,
  ResolveLlmOpts,
} from "@anysearch-cli/store";
