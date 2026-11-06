// @anysearch-cli/store: session store + domain schema
export * from "./domain-schema";
export * from "./session-store";
export * from "./budget-ledger";
export * from "./domain-loader";
// `ans recommend` engine: BM25 (FTS5) over domain metadata, the #125 CJK substring stage behind it,
// + peer-optional embedding arm (#110).
export * from "./domain-recommend";
export * from "./url-policy";

export * from "./time-decay";

// FTS5 Query Tokenization + multi-query RRF fusion helpers.
export * from "./fts5";

// KG-lite entity-relation edge layer (fifth arm).
export * from "./relation";

// consolidation + reversible forgetting (sixth arm, Phase-1 shadow).
export * from "./consolidate";

// access_events tamper-evidence chain (writer side; verifier is independent).
export * from "./access-chain";

// -D5: local-first observation representation, SQLite trace store,
// and export mapping at the volatile OTel GenAI boundary.
export * from "./observation";

// session_id persistence (.anysearch-cli/session file + env override).
export * from "./session-id";

// owner-only DB permission helper (CWE-732 mitigation, shared by CLI/MCP/plugin).
export * from "./db-perms";

// #183: store-side exit teardown — the fd249d41 registry promoted out of the CLI
// composition root, plus the tracked opener every store handle goes through, so
// store-side process exits (eval runner, test processes) close native handles
// instead of letting libuv reap them at exit (macOS F-16 libc++abi abort).
export * from "./teardown";
export * from "./db";

// consumed/synthetic switch governance (state machine + chain evidence).
export * from "./eval/switch-machine";
export * from "./eval/switch-run";

// skip-ledger @3 read surface for ans switch-state.
export * from "./eval/skip-ledger";

// -D13: pure calibration revision lifecycle surface.
export * from "./eval/revision-core";

// independent attribution-gold binary claim label line.
export * from "./eval/attribution-gold";
export * from "./eval/attribution-calibration";
// per-instance observability (audit-only, never gates).
export * from "./eval/attribution-instance-report";
