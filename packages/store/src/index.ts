// @anysearch-cli/store: session store + domain schema
// #300: the shared LLM config resolver lives here so CLI and MCP read model
// settings through one set of rules (layers, whitelist, secret binding, sources).
export * from "./config-llm";
// #301: the user credential file — one plaintext, owner-only key store that the
// CLI and a GUI host (no shell env) both read, bound to provider + endpoint.
export * from "./credentials";
export * from "./domain-schema";
export * from "./session-store";
// #570: one pid-liveness reading for every lock, ledger and registry record
// in the product — only ESRCH proves a process is gone.
export * from "./process-liveness";
export * from "./budget-ledger";
// #302: the per-execution task budget (chat's new accounting form) and the
// process/task lifecycle registry the main program writes into.
export * from "./task-budget";
export * from "./task-registry";
// #311: one reading of "which build is this" for the CLI, the MCP launcher and
// the hook service, so a process record's build and an upgrade report's
// installed build can be compared instead of guessed.
export * from "./build-info";
// #310: pre-migration consistent snapshot + layout marker + read-side
// migration diagnostics (doctor). Backup happens inside the store
// constructors; this export is the seam tests and doctor consume.
export * from "./migration-backup";
// Work-file cleanup for killed runs, without the database binding: config
// writes and cross-volume copies both stage beside their target.
export * from "./stale-work-files";
export * from "./domain-loader";
// `ans recommend` engine: BM25 (FTS5) over domain metadata, the #125 CJK substring stage behind it,
// + peer-optional embedding arm (#110).
export * from "./domain-recommend";
export * from "./url-policy";

export * from "./time-decay";

// FTS5 query tokenizer + multi-query RRF fusion helpers.
export * from "./fts5";

// Page-body sections/blocks, block vectors, and block-level search. Only the
// read-only backlog reader is public; the writers stay inside the store.
export { readChunkVectorBacklogFile, type ChunkVectorBacklog } from "./retrieval-chunks";
// The active embedding model id — doctor compares the backlog against it.
export { embeddingModelId } from "./embedding-arm";

// entity-relation edge layer (fifth arm).
export * from "./relation";

// #277: cross-script entity correspondence — the evidence order, the review
// queue rows, and the query's "which object is this?" resolution.
export * from "./entity-alias";

// consolidation + reversible forgetting (sixth arm, serving at weight 0.5).
export * from "./consolidate";

// #263: summary provenance and the suspension a correction causes (D8/D9).
export * from "./summary-sources";

// #264: rebuilding a suspended summary from current sources, keeping the task
// the user actually stated (D9).
export * from "./summary-rebuild";
export * from "./legacy-summary";

// access_events tamper-evidence chain (writer side; verifier is independent).
export * from "./access-chain";

// -D5: local-first observation representation, SQLite trace store,
// and export mapping at the volatile OTel GenAI boundary.
export * from "./observation";

// The on-disk layout; ans-layout.ts moves the old directories into it.
export * from "./ans-paths";
export * from "./ans-layout";

// session_id persistence (.ans/session file + env override).
export * from "./session-id";

// owner-only DB permission helper (CWE-732 mitigation, shared by CLI/MCP/plugin).
export * from "./db-perms";

// #183: store-side exit teardown — the fd249d41 registry promoted out of the CLI
// the wiring, plus the tracked opener every store handle goes through, so
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

export * from "./project-context";
