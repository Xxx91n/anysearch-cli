// Test seam for the config.toml write, kept out of the package entry point:
// index.ts re-exports config-llm with `export *`, and swapping the writer is
// not something a consumer of @anysearch-cli/store should be able to do.
// Production leaves both unset.

export const configWriteSeam: {
  write?: (path: string, content: string) => void;
  rename?: (from: string, to: string) => void;
} = {};
