# MCP server reference

This page is the reference for the `@anysearch-cli/mcp` server (`ans-mcp`).
It covers the five tools, what results mean, both transports, environment
and auth, the `ans_chat` session handle, how the two protocol versions
behave, and the upstream provider matrix. Known limitations and their
history live in [limitations.md](limitations.md).

## Start the server

```bash
ans-mcp                                            # stdio transport (default)
ans-mcp --transport http --port 3001               # Streamable HTTP
```

From a source checkout, the same entry is
`node apps/mcp/dist/index.js [--transport http] [--port <n>]`. `ans mcp`
forwards to that sibling build. The CLI does not bundle the server, so the
installed `ans-mcp` bin stays the normal entry. `--help` prints the two
flags.

`ANS_DOMAIN` is read from the process environment. The `ans` CLI first
rehydrates `~/.anysearch/config.env` (where `ans domain <name>` saves the
current domain, code: `Active Domain`), and the child process inherits it.
So `ans mcp` sees the saved choice. A directly launched `ans-mcp` does not read that file. Export
`ANS_DOMAIN` explicitly when a domain must apply.

- **stdio** — one server and one engine for the whole process. JSON-RPC
  frames are newline-delimited on stdin/stdout. Diagnostics go to stderr
  only, because stdout is the protocol channel. The ready line is
  `anysearch MCP server: stdio transport ready`.
- **Streamable HTTP** — `POST /mcp` only, stateless. Each request gets a
  fresh `McpServer`, with no `Mcp-Session-Id` and JSON responses
  (`enableJsonResponse: true`, `keepAliveMs: 0`). `GET /health` returns
  `{ "status": "ok", "server": "anysearch-mcp", "version": <pkg version> }`.
- HTTP binds `127.0.0.1` only. Other hosts cannot reach it.
- The server identity is name `anysearch`, and the version is the MCP
  package version.

The engine lives for the whole process. DB handles open once, and the
current domain's provider set and `sources.weights` are fixed when the engine is
constructed. An existing domain TOML keeps hot-reloading its schema (URL
policy and vertical default). A domain created after startup is never picked
up. A different `ANS_DOMAIN` or provider set needs a process restart.

## Tools

Five tools are registered by name, with input schemas sourced from the kernel
(`packages/kernel/src/tool-schemas.ts`). The table shows the shipped surface.

| Tool | Arguments | Behavior |
|------|-----------|----------|
| `search_web` | `query` (required); `mode` = `fast` (default) \| `index` \| `deep` \| `answer`; `verticalDomain`, `verticalSubDomain`, `verticalParams` | One search sent to the enabled providers at once. Results are fused (RRF) and filtered by the domain filter. `maxResults` is absent from the public schema: each provider adapter's own default (10 per provider) applies, and the tool shows the top 10 of the fused set while `totalResults` still reports the full count. |
| `research_web` | `question` (required); `depth` = `brief` (1 round) \| `standard` (2) \| `deep` (3, default); same three vertical args | Repeats the deep search per round, dedupes URLs across rounds, and stops early when the `sufficiency` verdict is `correct`. Returns the merged result set (last 10 shown) and the top 5 citations. |
| `recall_memory` | `query` (required); `limit` (default 5, integer ≥ 1) | FTS5 recall over the store-level research archive (the same range `query_knowledge` reads), with a time-sensitivity tag (QDF) and time decay. When internal hits are short of `limit` and `ANS_PROJECT_DB` is set, it falls back to the project index. That fallback is optional and keeps going when it fails. |
| `query_knowledge` | `query` (required) | Dispatches through the current domain's `rag.adapter`. Only `fts` retrieves. `none` and `note` return an explicit empty result. An unknown adapter id falls back to `none` with a stderr warning (deduped within the server instance, so stateless HTTP can repeat it once per request). |
| `ans_chat` | `message` (required for chat); `sessionId` (optional); `operation` = `chat` (default) \| `consolidate`; `memoryIds`, `dryRun` (consolidate only) | Runs the `PiAgentRuntime` agent loop. Requires `ANS_LLM_PROVIDER` and `ANS_LLM_MODEL`. Missing configuration is an error result, not a successful-looking message. Returns a session handle (see below). With `operation = "consolidate"` it does not chat: it turns the materials selected by `sessionId` or `memoryIds` into long-term knowledge. See [Consolidation](#consolidation). |

Vertical routing (`verticalDomain` / `verticalSubDomain` / `verticalParams`)
replaces the domain TOML `sources.vertical` default wholesale. It is never
deep-merged. Only providers that declare `verticalDomainSupported` receive the
wire fields. The others are named in the `retrieval.vertical.pre` audit
event's degraded list. That is a lost hint, never an abstain. See
[vertical-domains.md](vertical-domains.md) for the vocabulary snapshot.

`mode = "answer"` asks the provider for a generated answer. It is never
synthesized locally. AnySearch degrades an `answer` request to a plain
search. Exa and Tavily support it. Provider answers are real fields, not local
synthesis: `answers` carries the text, and `providerAnswers` carries
`{provider, text, verified: false, citations?}`. When no provider supports
answer mode, `answersAvailable` is `false`.

### Result shape

Every tool returns MCP `content: [{type:"text", ...}]`. Search results are a
pretty-printed JSON document in that text block. For the search tools,
`structuredContent` carries only machine-readable metadata (the
`sufficiency` verdict, attribution, abstain, and provider-failure fields). It never
carries the result list itself. `ans_chat` returns the answer text plus, when
a handle exists, a trailing text block `{"sessionId": "..."}` and
`structuredContent.sessionId`. Alongside the handle it reports what the run
spent:

| Key | Meaning |
|-----|---------|
| `usage.run` | Calls, input/output tokens, cache reads/writes, total, `costUsd` with its `costSource`, PI compaction calls/tokens/cost, and a `missing[]` list naming every dimension the provider never reported. `costSource` is `provider` (the server sent the price), `estimated` (pi-ai's local rate card computed it), `mixed` (part of the total was server-priced and part estimated), or `unknown`. Nothing unknown is rendered as free. |
| `usage.memorySummary` | The same ledger shape for the memory pipeline's own summary calls, or `null` when no pipeline is wired. Same `costSource` rule: a summary price pi-ai computed from its rate card is `estimated`, not provider-sent. |
| `context` | PI's own view of the window: `{tokens, window, percent}`. `window` is the window the session actually runs with, so a declared `ANS_LLM_CONTEXT_WINDOW` is verifiable here. |
| `toolCalls` | Per-tool call counts for this run. Search work is counted here, apart from model usage. |

### Consolidation

`ans_chat` with `operation = "consolidate"` runs the same consolidation path as
the `ans consolidate` CLI command. The two share the scope rule, the summarize
prompt, the fidelity gate and the usage accounting, so they cannot drift apart.

The scope is required. `memoryIds` selects exactly those stored materials;
`sessionId` selects one session's materials. Both may be given, but the list is
the scope: the session does not widen it. With neither, the call is rejected and
nothing is consolidated — there is no fallback to the whole archive, because a
forgotten argument and "everything" would otherwise be indistinguishable. An
empty `memoryIds` list, a non-positive id, or a `sessionId` that is not 1..128
visible ASCII characters is an error.

`dryRun: true` runs the same path inside a transaction that is rolled back:
no knowledge, no material state, no version relation and no summary change is
saved. The model can still be called and does cost money. The preview describes
the state read at that moment; a concurrent write before an apply can make the
apply differ.

The result reports the scope it really used, not the one the caller thinks it
passed:

| Key | Meaning |
|-----|---------|
| `scope.by` | `memory` (the explicit list), `session` (one session's materials), or `archive` (internal only; no product surface can request it). |
| `scope.materialsRead` / `scope.requestedMaterials` | Rows actually read after the archived/quarantined/no-entity filters, and how many the caller asked for. |
| `scope.sessionIdNotApplied` | `true` when a `sessionId` accompanied `memoryIds` and was therefore not the scope. |
| `counts` | `add`, `update`, `skip` (no-op reruns), `conflict` (the fidelity gate refused a claim), `failure` (no summary available), `budgetRejected`. Each event lands in exactly one bucket. |
| `usage` | The same honest ledger the chat path uses, with these consolidation-specific bases: `not-called`, `unknown`, `price-estimate`, `provider-reported`, `mixed`. `missing[]` names every dimension that never arrived. A custom endpoint's zero price table reports `unknown`; its `costUsd` of 0 is not a claim of a free run. A call that reported no usage still books its reserved estimate against the cap, so a silent provider cannot slip past a budget. |
| `budgetUnmetered` | Present when the run could not be metered: a memory-list scope has no owning session to charge, several session owners cannot share one run's spend, the Active Domain declares no `[budget]` caps, or the budget row/caps could not be registered. `budgetUnmeteredReason` names which. Both entry points follow the same rule — a `sessionId` given alongside `memoryIds` is echoed but never billed. |

Consolidation is triggered explicitly by the user or the host agent. There is no
background consolidation loop.

## `isError` vs empty vs abstain

The server follows the MCP rule that an execution failure is an
`isError: true` *result*, while a protocol fault stays a JSON-RPC error.

| Case | `isError` | `structuredContent` |
|------|-----------|---------------------|
| Handler exception (the SDK turns an uncaught throw into an `isError` result); vertical-guard rejection (`verticalSubDomain`/`verticalParams` without `verticalDomain`); `ans_chat` runtime error or missing LLM configuration | `true` | absent — text content only |
| Invalid tool arguments: empty `query`/`message`, unknown property, wrong type (schema validation) | `true` | absent — `Input validation error` text |
| Zero results, no provider answered, and provider failures are the reason | `true` | absent — text names `providersFailed` and their error classes |
| Search returned zero hits but at least one provider answered | absent (success) | optional metadata; abstain only if the domain filter emptied the pool |
| Domain gate emptied the pool (abstain) | absent (success) | `abstain: {abstain: true, reason: "domain_filter_empty", domain?, preFiltered, postFiltered, gate: "pre"\|"post"}` |
| Partial provider failure with ≥ 1 provider answering | absent (success) | `providersFailed`, `providerErrorClasses`, `providerBuildErrors` |
| `recall_memory` finds nothing; `query_knowledge` has `adapter = "none"`/`"note"` | absent (success) | absent — explicit empty result |
| Protocol fault: unknown tool, malformed JSON-RPC frame | JSON-RPC error | n/a |

Rules behind the table:

- **Error results carry no `structuredContent`.** The error channel and the
  output schema stay separate. Error text names the tool and says what to
  do: search/recall paths prefix `<tool> error: `, while `ans_chat`'s
  missing-configuration branch starts `ans_chat: `.
- **Empty is not error; an outage is.** For a search that actually queried
  providers, `search_web` returns an error when every queried provider is in
  `providersFailed`. `research_web` returns an error when no provider answered
  in any round and at least one failed. Partial and cancelled
  outcomes keep the empty result a success.
- **Cancelled providers are neither failures nor outages.** A cancelled
  provider is recorded as `providersCancelled` in the engine metadata (the
  MCP tool result does not show that field). Zero queried providers is not an
  outage. A cancelled provider never counts as an answered one.
- **Partial failures come with the successful result.** `providersFailed`,
  `providerErrorClasses` (`transient` / `permanent-auth` /
  `permanent-protocol` / `session-expired` / `unknown`) and construction-time
  `providerBuildErrors` appear in both the content JSON and
  `structuredContent`.
- **Abstain is a successful policy outcome.** It leaves `isError` absent and
  exposes the marker in `structuredContent.abstain`. For `research_web`, the
  marker describes the **last round only**. Results merged from earlier
  rounds stay in the response, so a non-null marker does not mean the whole
  result set is empty.
- `query_knowledge` has no handler-level catch. Adapter resolution and
  retrieval are designed to keep going when something fails. But an
  unexpected exception reaches the SDK, which returns it as an `isError`
  result (raw message). It does not become a normal empty result.

## Cancellation

The MCP request signal is the one cancellation path for `search_web`,
`research_web`, and `ans_chat` (apps/mcp/src/tools/signal.ts).

- **stdio** — the SDK handler context signal (`notifications/cancelled` on
  the same connection).
- **Stateless HTTP** — a fresh server per POST has no same-connection
  notification channel. So a client disconnect (response stream close) aborts
  the per-request `AbortController`, and the handler reads that signal from
  request-scoped storage.
- `search_web` skips its post-search session write when cancelled.
  `research_web` stops after the aborted round. `ans_chat` aborts the agent
  loop and skips LLM construction, session minting, and budget settlement for
  a request that was already cancelled.
- `recall_memory` and `query_knowledge` do not read the request signal.
- Cancellation is a transport outcome, not a new error shape that users see.

Upstream cancellation differs per provider. AnySearch aborts each POST, but
concurrent searches share one MCP handshake, so it follows the first caller's
signal. Exa forwards the signal as a trailing request option (#216). Tavily's
SDK exposes none (#32).

## Client identity

- A modern `2026-07-28` `tools/call` carrying
  `_meta["io.modelcontextprotocol/clientInfo"]` is read from the SDK request
  context and mapped to the observation trace's `client_id`.
- A legacy `2025-11-25` stateless HTTP tool call carries no per-request
  identity and records `mcp_unknown`. That is the expected value, not a
  lookup failure.
- The `initialize`-body extraction is a fallback, not a cross-request
  guarantee. The transport `session_id` stays empty on the MCP path.
  Cross-call state uses the explicit `ans_chat` handle instead.

## Both protocol versions

The hand-written server targets the stable `2025-11-25` revision and serves
modern clients through the SDK's legacy fallback.

- `initialize` claiming `2026-07-28` is answered with `2025-11-25`. Legacy
  clients (`2024-10-07` … `2025-11-25`) get their own version echoed.
- Both protocol versions get the five-tool `tools/list`.
- The server stays legacy-only. `server/discover` returns JSON-RPC `-32601`
  (`MethodNotFound`) even with a modern `_meta` field on stdio/in-memory,
  or on HTTP without the version header.
- On HTTP, a non-initialize request that sends
  `MCP-Protocol-Version: 2026-07-28` is rejected before dispatch with HTTP 400
  and JSON-RPC `-32000`. Send the negotiated `2025-11-25` instead.
- Pinned by `apps/mcp/test/dual-era.test.ts` (including the discover and
  version-gate cases) and by the built-artifact smoke (negotiation plus the
  five-tool list).

## `ans_chat` session handle

A session id here is a resume key inside the store, not an MCP transport
session. The `2026-07-28` revision removed protocol-level sessions and
tells servers to use explicit, server-minted handles (SEP-2567).

- The first call without `sessionId` mints `createSession("mcp")` and returns
  the id in `structuredContent.sessionId` and as a trailing text block, so
  content-only hosts still show it to the model.
- A later call that passes the handle back as `sessionId` goes through
  `ensureSession()` and is reused. `MemoryPipeline` is then built with
  `store` + `sessionId`, so the session's L1 summary / L2 recall memory and
  domain retrieval injection continue in that session. The conversation
  transcript also continues: PI keeps its own append-only session record under
  `ANS_PI_SESSION_DIR` (default `pi-sessions/` beside the durable DB), keyed by a
  hash of the handle, so a follow-up request carries the earlier turns — and
  still does after a process restart. The record is the source of truth for
  history; the store holds the research archive and the memory anchors.
- One session record has one writer, so same-session requests serialize —
  within a process and across processes (#266). The cross-process lock lives
  in a `locks/` folder inside `ANS_PI_SESSION_DIR`: the holder records its
  pid/host and refreshes a heartbeat, a live local holder is never
  preempted, and once the holder's process is confirmed dead the next
  waiter takes over at once instead of waiting the 10-minute stale window
  (which only governs owners this machine cannot confirm, e.g. on another
  host). A same-session caller that waits longer than the 120-second cap
  gets an explicit "session busy" error result and is expected to retry;
  different sessions still run in parallel. No evidence exists for
  network-filesystem session directories; same machine only.
- Omitting the handle is the explicit single-shot mode: a fresh session per
  call, no cross-call continuity, and one session row minted per call. With
  the domain retrieval adapter set to `fts`, that fresh session can still
  receive the store-level shared research archive. Single-shot describes conversation continuity, not
  an empty knowledge context.
- A malformed handle — anything that is not 1..128 visible ASCII characters
  — is ignored and the call keeps going: it runs single-shot, no fake handle is
  returned, and the answer still comes back. A non-string value is a wire
  type error before the handler.
- Memory wiring keeps going when it fails. If the store cannot create or
  register the session, the call still answers but returns **no**
  `sessionId`. Clients must check for the handle before relying on
  continuity.
- The handle is **not** a security boundary. The store is the isolation unit.
  A client that can reach the server can already
  read the store-level research archive.
- Memory writes are not synchronous with the response. Consolidation state
  is awaited, while the L1 rolling summary and L2 recall are background
  writes, so an immediate re-call can race them.

Within `ans_chat` runtime state, only the LLM client is shared across the
process. It lives in a process-level cache keyed by provider, model, base-URL
fingerprint, API kind, and context window. A rotated `ANS_LLM_API_KEY`
rebuilds the cached client. Conversation state, session handles, restore
points, and budget state stay per call / per session.

## Environment and auth

Provider credentials are read from the process environment. Nothing is
written to config files. Hosts that inherit their environment (the usual
`mcp.json` / `config.toml` registration) need no `env` block.

| Variable | Used by | Effect |
|----------|---------|--------|
| `ANS_DOMAIN` | engine construction | Selects the current domain (TOML allowlist + provider set). Unset = search all providers. An unknown/unresolvable name also falls back to searching all providers **without the URL allowlist** — a typo silently turns off domain filtering, so check the TOML first. Snapshotted at startup. |
| `ANS_DB_PATH` | engine construction | Store path; default `~/.anysearch/anysearch.db`. The directory and DB get owner-only permissions when created (best-effort). |
| `ANS_DOMAINS_DIR` | engine construction | Extra directory of domain TOMLs, prepended to the default search chain. |
| `EXA_API_KEY` / `TAVILY_API_KEY` / `ANYSEARCH_API_KEY` | provider adapters | Per-provider keys. Exa requires one. Tavily runs without a key by default, and AnySearch has an anonymous tier. |
| `ANYSEARCH_ENDPOINT` | anysearch adapter | Upstream MCP endpoint override (default `https://api.anysearch.com/mcp`). A value ending in `/v1/search` is rewritten to `<base>/mcp` once per process with a stderr warning. |
| `ANS_MCP_KEY` | HTTP transport only | When set, every HTTP request must send `Authorization: Bearer <key>`. Otherwise HTTP returns 401 with `{error:{code:-32001, message:"Unauthorized"}}` (an error object, not a full JSON-RPC response). Unset = no MCP-level auth; the listener is still bound to `127.0.0.1` (see Start the server). |
| `ANS_PROJECT_DB` | `recall_memory` | Project-index DB path for the recall fallback. Unset = internal FTS memory only. |
| `ANS_URL_ALLOWLIST` + `ANS_ALLOW_ENV_OVERRIDE` | engine URL gate | Dev-only append-only allowlist override: a comma-separated host list, applied only when `ANS_ALLOW_ENV_OVERRIDE` is `1`/`true` (`0`/`false`/empty keeps it off; any other value makes the policy deny by default when it resolves). Domain TOML `urlAllowlist`/`urlDenylist` remain authoritative, and deny has no env override. |
| `ANS_LLM_PROVIDER` + `ANS_LLM_MODEL` | `ans_chat` | Required. Missing either makes the call an error result. |
| `ANS_LLM_API_KEY` | `ans_chat` with `ANS_LLM_BASE_URL` | Credential for the custom upstream; a rotation rebuilds the cached client. Catalog providers (no base URL) authenticate through pi-ai's provider env: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`. |
| `ANS_LLM_BASE_URL` + `ANS_LLM_API` | `ans_chat` | Custom upstream. `ANS_LLM_API` must be `chat`, `messages`, or `responses` whenever `ANS_LLM_BASE_URL` is set. |
| `ANS_LLM_CONTEXT_WINDOW` | `ans_chat` | The real model window. It drives request budgeting, the L0 low-water mark, PI's compaction trigger, and the window reported back in `structuredContent.context`. It overrides a catalog model's own window; a malformed value fails the call rather than silently defaulting to 128K. |
| `ANS_PI_SESSION_DIR` | `ans_chat` | Where PI keeps its append-only session records. Defaults to `pi-sessions/` beside the durable DB. Threading the same `sessionId` back resumes the conversation, including after a restart. |
| `ANS_PI_LOCK_STALE_MS` / `ANS_PI_LOCK_TIMEOUT_MS` | `ans_chat` | Override the cross-process session lock windows: how long a lock whose owner this machine cannot confirm is kept (default 600000), and the same-session wait cap before "session busy" (default 120000). Meant for observing expiry and recovery in seconds during a test run; an unparsable value keeps the default. |
| `ANS_PI_COMPACTION_RESERVE_TOKENS` / `ANS_PI_COMPACTION_KEEP_RECENT_TOKENS` | `ans_chat` | Override PI's compaction thresholds (defaults 16384 / 20000). Meant for forcing compaction on a small context during a test run; an unparsable value keeps PI's default. |

Auth layers are separate. Provider keys authenticate upstream calls.
`ANS_MCP_KEY` guards the optional HTTP listener. The LLM trio configures
`ans_chat`. stdio has no transport-level auth; it runs as the process that
spawned it.

## Upstream provider transport matrix

Two axes are easy to mix up: the **MCP server transport** (stdio or
Streamable HTTP, above) and the **upstream transport each provider adapter
uses** (below).

| Provider | Upstream transport | Wired search surface | Answer mode | Domain pre-filter | Vertical routing | Cancellation |
|----------|-------------------|----------------------|-------------|-------------------|------------------|--------------|
| anysearch | MCP Streamable HTTP (`POST /mcp`, hand-written JSON-RPC; not the official SDK) | `search` (fast / index / deep; an `answer` request degrades to a plain search) | no | no (post-filter only) | yes (`domain` / `sub_domain` / `sub_domain_params`) | yes, per POST (shared-handshake caveat) |
| exa | official `exa-js` SDK | `search` (fast / index / deep) + `answer` | yes (`answer()`, citations kept with `verified:false`; an answer failure degrades to results plus a stderr line) | yes (`includeDomains`, `search()` only) | no | yes (`signal` trailing option on `search()` / `answer()`) |
| tavily | official `@tavily/core` SDK | `search` (fast / index / deep) + `answer` | yes (`includeAnswer`) | yes (`include_domains`, hard filter) | no | no (SDK exposes no signal) |

Provider selection comes from the current domain's `sources.enabled`. A
provider that cannot be constructed is skipped and recorded in
`providerBuildErrors`. If no provider can register, the search is an error,
not an abstain. Exa and Tavily run on their official SDKs. Their hosted MCP
servers are agent-facing tool surfaces, not server-side provider APIs, so the
adapter code does not use them.

Exa's `includeDomains` applies only to `search()`. Its separate `answer()`
call does not receive the allowlist, and the kernel does not URL-gate answer
text or citations.

The AnySearch adapter wires `search` only. `get_sub_domains`,
`batch_search`, `extract`, and the live-but-undocumented `score` are not
wired, and this client does not pin the upstream tool count (official docs
list four tools; the live endpoint has also returned `score`). A successful
`search` reply's non-empty `_meta.request_id` is recorded as a diagnostic
correlation id on the observation span when a caller supplies one. It never
enters results and is never an idempotency key. Upstream REST
`POST /v1/search` is live (only `GET` returns 404). This adapter speaks MCP
only, so the `/v1/search` → `/mcp` rewrite is a compatibility shim, not a
retirement notice.

## Verification

These commands are the repo's MCP verification ladder. The first two need no
provider or LLM keys.

| Command | What it proves |
|---------|----------------|
| `pnpm -C apps/mcp check` | TypeScript typecheck of the server source (`src/**/*.ts`). The test files run through `tsx` and are not part of this `tsc` pass. |
| `pnpm -C apps/mcp test` | Source-level suites: tool registration/schemas, abstain, failure semantics, protocol-version negotiation, cancellation (search + `ans_chat`), shared LLM cache, client attribution, provider diagnostics, research depth. |
| `pnpm --filter @anysearch-cli/mcp build` then `node scripts/mcp-smoke.mjs` | The **built** `dist/index.js`, on both transports: stdio and stateless-HTTP `initialize`, `tools/list` with all five tools and their type descriptions, and protocol-version negotiation (`2026-07-28` → `2025-11-25`, legacy echo). No provider or LLM keys are required because it never calls a tool. Unset `ANS_MCP_KEY` first: the smoke's `/health` probe sends no auth header and would time out. CI runs `--help` separately before this script. |
| `node scripts/ship-gate.mjs` | The release gate: workspace check/test/build, pack + install verification, a real stdio `initialize`, the packaged CLI/MCP observation round-trip, stdout purity, and boot with a scrubbed environment and no provider backend (the boot still succeeds when providers fail). |
| `pnpm check` / `pnpm test` (root scripts; `pnpm -r check` / `pnpm -r test` also work) | Whole-workspace typecheck / test. The merge gate requires the full suite green locally; CI red is information, not a blocker (see AGENTS.md). |
| conformance heartbeat (`.github/workflows/conformance.yml`) | Scheduled `@modelcontextprotocol/conformance` run against the HTTP transport. It targets stable `2025-11-25`, expects no known failures, and is **non-blocking by design** (spec drift is surfaced, not gated). |
| `ans-mcp --help`; `curl 127.0.0.1:3001/health`; `curl -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -X POST 127.0.0.1:3001/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` | Manual liveness. The POST needs both content types in `Accept`, or the locked SDK returns 406. With `ANS_MCP_KEY` set, every request (including `/health`) needs the bearer header; a request without it returns 401. |

`node scripts/ship-gate.mjs` is the release verdict. A green `apps/mcp`
suite alone does not prove the packaged artifact boots or that the protocol
channel stays clean.

## Related docs

- [limitations.md](limitations.md) — full known-limitations record.
- [vertical-domains.md](vertical-domains.md) — vertical vocabulary snapshot and upstream semantics.
- [rag-adapters.md](rag-adapters.md) — `none` / `note` / `fts` adapters, injection shape, and budgets.
- [agents/domain.md](agents/domain.md) — single-context documentation convention.
- Host-specific registration and hooks: [claude-integration.md](claude-integration.md), [codex-integration.md](codex-integration.md), [codebuddy-integration.md](codebuddy-integration.md), [antigravity-integration.md](antigravity-integration.md), [deepseek-harness-integration.md](deepseek-harness-integration.md).
