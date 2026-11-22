// Native-backed packages the plugin's bundles leave external: bundling them
// breaks at load time, so the installed package has to provide them. The CLI and
// MCP packages keep their own longer external lists, and both already name these
// two; adding a third native dependency still means touching all of them.
export const NATIVE_EXTERNALS = ["better-sqlite3", "@anysearch-cli/embedding"];
