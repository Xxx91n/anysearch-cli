# MCP server reference

Canonical reference for the `@anysearch-cli/mcp` server (`ans-mcp`): the five
tools, result semantics, both transports, environment and auth, the `ans_chat`
session handle, dual-era protocol behavior, and the upstream provider matrix.
Known limitations and their history live in
[limitations.md](limitations.md).

## Start the server

```bash
ans-mcp                                            # stdio transport (default)
ans-mcp --transport http --port 3001               # Streamable HTTP
```

From a source checkout the same entry is
`node apps/mcp/dist/index.cjs [--transport http] [--port <n>]`; `ans mcp`
forwards to that sibling build (the CLI does not bundle the server, so the
installed `ans-mcp` bin remains the normal entry). `--help` prints the two
flags.

`ANS_DOMAIN` is read from the process environment. The `ans` CLI first
rehydrates `~/.anysearch/config.env` (where `ans domain <name>` persists the
Active Domain) and the forwarded child inherits it, so `ans mcp` sees the
persisted choice. A directly launched `ans-mcp` does not read that file: export
`ANS_DOMAIN` explicitly when a domain must apply.

- **stdio** — one process-wide server and engine. JSON-RPC frames are
  newline-delimited on stdin/stdout; diagnostics go to stderr only, because
  stdout is the protocol channel. The ready line is
  `anysearch MCP server: stdio transport ready`.
- **Streamable HTTP** — `POST /mcp` only, stateless: a fresh `McpServer` per
  request, no `Mcp-Session-Id`, JSON responses (`enableJsonResponse: true`,
  `keepAliveMs: 0`). `GET /health` returns
  `{ "status": "ok", "server": "anysearch-mcp", "version": <pkg version> }`.
- HTTP binds `127.0.0.1` only; it is not reachable from other hosts.
- Server identity is name `anysearch`, version = the MCP package version.

The engine is a process-level resource: DB handles open once, and the Active
Domain's provider set and source weights are fixed when the engine is
constructed. An existing domain TOML keeps hot-reloading its schema (URL
policy and vertical default), but a domain created after startup is never
picked up, and a different `ANS_DOMAIN` or provider set needs a process
restart.

## Tools

Five tools are registered by name, with input schemas sourced from the kernel
(`packages/kernel/src/tool-schemas.ts`). Rows below are the shipped surface.

| Tool | Arguments | Behavior |
|------|-----------|----------|
| `search_web` | `query` (required); `mode` = `fast` (default) \| `index` \| `deep` \| `answer`; `verticalDomain`, `verticalSubDomain`, `verticalParams` | One fanout search through the engine. Results are fused (RRF) and domain-gated. `maxResults` is absent from the public schema: each provider adapter's own default (10 per arm) applies, and the tool displays the top 10 of the fused set while `totalResults` still reports the full count. |
| `research_web` | `question` (required); `depth` = `brief` (1 round) \| `standard` (2) \| `deep` (3, default); same three vertical args | Repeats the deep search per round, dedupes URLs across rounds, and stops early when the sufficiency verdict is `correct`. Returns the merged result set (last 10 shown) and the top 5 citations. |
| `recall_memory` | `query` (required); `limit` (default 5, integer ≥ 1) | FTS5 recall over store-level Research Memory (the same range `query_knowledge` reads), with QDF classification and time-edge decay. When internal hits are short of `limit` and `ANS_PROJECT_DB` is set, falls back to the project index; that fallback is optional and fail-open. |
| `query_knowledge` | `query` (required) | Dispatches through the Active Domain's `rag.adapter`. Only `fts` retrieves; `none` and `note` return an explicit empty result; an unknown adapter id fails open to `none` with a stderr warning (deduped within the server instance, so stateless HTTP can repeat it once per request). |
| `ans_chat` | `message` (required); `sessionId` (optional) | Runs the `PiAgentRuntime` agent loop. Requires `ANS_LLM_PROVIDER` and `ANS_LLM_MODEL`; missing configuration is an error result, not a successful-looking message. Returns a session handle (see below). |

Vertical routing (`verticalDomain` / `verticalSubDomain` / `verticalParams`)
replaces the domain TOML `sources.vertical` default wholesale — it is never
deep-merged. Only providers that declare `verticalDomainSupported` receive the
wire fields; the others are named in the `retrieval.vertical.pre` audit event's
degraded list (a lost hint, never an abstain). See
[vertical-domains.md](vertical-domains.md) for the vocabulary snapshot.

`mode = "answer"` asks the provider for a generated answer; it is never
synthesized locally. AnySearch degrades an `answer` request to a plain search;
Exa and Tavily support it. Provider answers are first-class fields, not local
synthesis: `answers` carries the text, and `providerAnswers` carries
`{provider, text, verified: false, citations?}`. When no provider supports
answer mode, `answersAvailable` is `false`.

### Result shape

Every tool returns MCP `content: [{type:"text", ...}]`. Search results are a
pretty-printed JSON document in that text block; for the search tools,
`structuredContent` carries only machine-readable metadata (sufficiency,
attribution, abstain, and provider-failure fields) — never the result list
itself. `ans_chat` returns the
answer text plus, when a handle exists, a trailing text block
`{"sessionId": "..."}` and `structuredContent.sessionId`.

## `isError` vs empty vs abstain

The server follows the MCP rule that an execution failure is an
`isError: true` *result*, while a protocol fault stays a JSON-RPC error.

| Case | `isError` | `structuredContent` |
|------|-----------|---------------------|
| Handler exception (the SDK converts an uncaught throw to an `isError` result); vertical-guard rejection (`verticalSubDomain`/`verticalParams` without `verticalDomain`); `ans_chat` runtime error or missing LLM configuration | `true` | absent — text content only |
| Invalid tool arguments: empty `query`/`message`, unknown property, wrong type (schema validation) | `true` | absent — `Input validation error` text |
| Zero results with no arm answering where provider failures are the reason | `true` | absent — text names `providersFailed` and their error classes |
| Search returned zero hits but at least one arm answered | absent (success) | optional metadata; abstain only if the domain gate emptied the pool |
| Domain gate emptied the pool (abstain) | absent (success) | `abstain: {abstain: true, reason: "domain_filter_empty", domain?, preFiltered, postFiltered, gate: "pre"\|"post"}` |
| Partial provider failure with ≥ 1 arm answering | absent (success) | `providersFailed`, `providerErrorClasses`, `providerBuildErrors` |
| `recall_memory` finds nothing; `query_knowledge` has `adapter = "none"`/`"note"` | absent (success) | absent — explicit empty result |
| Protocol fault: unknown tool, malformed JSON-RPC envelope | JSON-RPC error | n/a |

Rules behind the table:

- **Error results carry no `structuredContent`.** The error channel and the
  output schema stay separate. Error text is actionable and names the tool:
  the search/recall paths prefix `<tool> error: `, while `ans_chat`'s
  missing-configuration branch starts `ans_chat: `.
- **Empty is not error; an outage is.** For a search that actually queried
  providers, `search_web` returns an error when every queried arm is in
  `providersFailed`; `research_web` returns an error when no arm answered across
  any round and at least one arm failed. Partial and cancelled outcomes keep
  the empty result a success.
- **Cancelled arms are neither failures nor outages.** A cancelled provider is
  recorded as `providersCancelled` in the engine metadata (the MCP tool result
  does not surface that field), zero queried arms is not an outage, and a
  cancelled arm never counts as an answered arm.
- **Partial failures ride the successful result.** `providersFailed`,
  `providerErrorClasses` (`transient` / `permanent-auth` / `permanent-protocol`
  / `session-expired` / `unknown`) and construction-time `providerBuildErrors` appear in
  both the content JSON and `structuredContent`.
- **Abstain is a successful policy outcome.** It keeps `isError` absent and
  exposes the marker in `structuredContent.abstain`. For `research_web`, the
  marker describes the **last round only**: results merged from earlier rounds
  stay in the response, so a non-null marker does not mean the whole result set
  is empty.
- `query_knowledge` has no handler-level catch: adapter resolution and
  retrieval are fail-open by design, but an unexpected exception is surfaced by
  the SDK as an `isError` result (raw message), not as a fail-open empty result.

## Cancellation

The MCP request signal is the single cancellation seam for `search_web`,
`research_web`, and `ans_chat` (apps/mcp/src/tools/signal.ts).

- **stdio** — the SDK handler context signal (`notifications/cancelled` on the
  same connection).
- **Stateless HTTP** — a fresh server per POST has no same-connection
  notification channel, so a client disconnect (response stream close) aborts
  the per-request `AbortController`; the handler reads that signal from
  request-scoped storage.
- `search_web` skips its post-search session write when cancelled;
  `research_web` stops after the aborted round; `ans_chat` aborts the agent
  loop and skips LLM construction, session minting, and budget settlement for a
  request that was already cancelled.
- `recall_memory` and `query_knowledge` do not read the request signal.
- Cancellation is a transport outcome, not a new user-visible error envelope.

Upstream cancellation differs per provider: AnySearch aborts each POST (but
concurrent searches share one MCP handshake, so it follows the first caller's
signal); Exa forwards the signal as a trailing request option (#216); Tavily's
SDK exposes none (#32).

## Client identity

- A modern `2026-07-28` `tools/call` carrying
  `_meta["io.modelcontextprotocol/clientInfo"]` is read from the SDK request
  context and mapped to the observation trace's `client_id`.
- A legacy `2025-11-25` stateless HTTP tool call carries no per-request
  identity and records `mcp_unknown`. That is the expected value, not a lookup
  failure.
- The `initialize`-body extraction is a fallback, not a cross-request
  guarantee. The transport `session_id` stays empty on the MCP path; cross-call
  state uses the explicit `ans_chat` handle instead.

## Dual-era protocol behavior

The hand-wired server targets the stable `2025-11-25` revision and serves
modern clients through the SDK's legacy fallback.

- `initialize` claiming `2026-07-28` is answered with `2025-11-25`; legacy
  clients (`2024-10-07` … `2025-11-25`) get their own version echoed.
- Both eras get the five-tool `tools/list`.
- The server stays legacy-only: `server/discover` returns JSON-RPC `-32601`
  (`MethodNotFound`) even with a modern `_meta` envelope on stdio/in-memory,
  or on HTTP without the version header.
- On HTTP, a non-initialize request that sends
  `MCP-Protocol-Version: 2026-07-28` is rejected before dispatch with HTTP 400
  and JSON-RPC `-32000`; send the negotiated `2025-11-25` instead.
- Pinned by `apps/mcp/test/dual-era.test.ts` (including the discover and
  version-gate cases) and by the built-artifact smoke (negotiation plus the
  five-tool list).

## `ans_chat` session handle

A session id here is a resumption key (checkpoint) inside the store, not an MCP
transport session (the `2026-07-28` revision removed protocol-level sessions
and directs servers to explicit, server-minted handles — SEP-2567).

- The first call without `sessionId` mints `createSession("mcp")` and returns
  the id in `structuredContent.sessionId` and as a trailing text block, so
  content-only hosts still expose it to the model.
- A later call that threads the handle back as `sessionId` is `ensureSession()`-ed
  and reused; `MemoryPipeline` is then built with `store` + `sessionId`, so the
  session's L1 summary / L2 recall memory and RAG injection continue in that
  session. The handle carries session identity and available memory, **not the
  conversation transcript**: every call builds a fresh runtime, and the one-shot
  recovery digest is the resume unit. A follow-up that depends on the full
  prior message history can therefore lack context.
- Omitting the handle is the explicit single-shot mode: a fresh session per
  call, no cross-call continuity (and one session row minted per call). With an
  `fts` RAG adapter, that fresh session can still receive store-level shared
  Research Memory — single-shot describes conversation continuity, not an
  empty knowledge context.
- A malformed handle — anything that is not 1..128 visible ASCII characters —
  is ignored fail-open: the call runs single-shot, no fake handle is returned,
  and the answer still comes back. A non-string value is a wire type error
  before the handler.
- Memory wiring fails open: if the store cannot create or register the
  session, the call still answers but returns **no** `sessionId`. Clients must
  check for the handle before relying on continuity.
- The handle is **not** a security boundary; the store is (Store Principal).
  A client that can reach the server can already read the store-level Research
  Memory.
- Memory writes are not synchronous with the response: consolidation state is
  awaited, while the L1 rolling summary and L2 recall are background writes, so
  an immediate re-call can race them.

Within `ans_chat` runtime state, only the LLM client is process-shared, through
a process-level cache keyed by provider, model, base-URL fingerprint, API kind,
and context window; a rotated
`ANS_LLM_API_KEY` rebuilds the slot. Conversation state, session handles,
anchors, and budget state stay per call / per session.

## Environment and auth

Provider credentials are read from the process environment; nothing is written
to config files. Hosts that inherit their environment (the usual `mcp.json` /
`config.toml` registration) need no `env` block.

| Variable | Used by | Effect |
|----------|---------|--------|
| `ANS_DOMAIN` | engine construction | Selects the Active Domain (TOML allowlist + provider set). Unset = full fanout. An unknown/unresolvable name also falls back to full fanout **without the URL allowlist** — a typo silently disables domain filtering, so verify the TOML first. Snapshotted at startup. |
| `ANS_DB_PATH` | engine construction | Store path; default `~/.anysearch/anysearch.db`. The directory and DB are tightened to owner-only permissions on creation (best-effort). |
| `ANS_DOMAINS_DIR` | engine construction | Extra directory of domain TOMLs, prepended to the default search chain. |
| `EXA_API_KEY` / `TAVILY_API_KEY` / `ANYSEARCH_API_KEY` | provider adapters | Per-provider keys. Exa requires one; Tavily runs keyless by default and AnySearch has an anonymous tier. |
| `ANYSEARCH_ENDPOINT` | anysearch adapter | Upstream MCP endpoint override (default `https://api.anysearch.com/mcp`). A value ending in `/v1/search` is rewritten to `<base>/mcp` once per process with a stderr warning. |
| `ANS_MCP_KEY` | HTTP transport only | When set, every HTTP request must send `Authorization: Bearer <key>`; otherwise HTTP returns 401 with `{error:{code:-32001, message:"Unauthorized"}}` (an error object, not a full JSON-RPC envelope). Unset = no MCP-level auth; the listener is still bound to `127.0.0.1` (see Start the server). |
| `ANS_PROJECT_DB` | `recall_memory` | Project-index DB path for the two-stage recall fallback. Unset = internal FTS memory only. |
| `ANS_URL_ALLOWLIST` + `ANS_ALLOW_ENV_OVERRIDE` | engine URL gate | Dev-only append-only allowlist override: a comma-separated host list, applied only when `ANS_ALLOW_ENV_OVERRIDE` is `1`/`true` (`0`/`false`/empty keeps it off; any other value fails closed when the policy resolves). Domain TOML `urlAllowlist`/`urlDenylist` remain authoritative, and deny has no env override. |
| `ANS_LLM_PROVIDER` + `ANS_LLM_MODEL` | `ans_chat` | Required. Missing either makes the call an error result. |
| `ANS_LLM_API_KEY` | `ans_chat` with `ANS_LLM_BASE_URL` | Credential for the custom upstream; a rotation rebuilds the cached client. Catalog providers (no base URL) authenticate through pi-ai's provider env: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`. |
| `ANS_LLM_BASE_URL` + `ANS_LLM_API` | `ans_chat` | Custom upstream. `ANS_LLM_API` must be `chat`, `messages`, or `responses` whenever `ANS_LLM_BASE_URL` is set. |
| `ANS_LLM_CONTEXT_WINDOW` | `ans_chat` | Real model window for custom endpoints; drives request budgeting and the L0 watermark. A malformed value fails the call rather than silently defaulting. |

Auth layers are separate: provider keys authenticate upstream calls, `ANS_MCP_KEY`
guards the optional HTTP listener, and the LLM trio configures `ans_chat`.
stdio has no transport-level auth — it runs as the process that spawned it.

## Upstream provider transport matrix

Two different axes are easy to confuse: the **MCP server transport** (stdio or
Streamable HTTP, above) and the **upstream transport each retrieval adapter
uses** (below).

| Provider | Upstream transport | Wired search surface | Answer mode | Domain pre-filter | Vertical routing | Cancellation |
|----------|-------------------|----------------------|-------------|-------------------|------------------|--------------|
| anysearch | MCP Streamable HTTP (`POST /mcp`, hand-rolled JSON-RPC; not the official SDK) | `search` (fast / index / deep; an `answer` request degrades to a plain search) | no | no (post-filter only) | yes (`domain` / `sub_domain` / `sub_domain_params`) | yes, per POST (shared-handshake caveat) |
| exa | official `exa-js` SDK | `search` (fast / index / deep) + `answer` | yes (`answer()`, citations kept with `verified:false`; an answer failure degrades to results plus a stderr line) | yes (`includeDomains`, `search()` only) | no | yes (`signal` trailing option on `search()` / `answer()`) |
| tavily | official `@tavily/core` SDK | `search` (fast / index / deep) + `answer` | yes (`includeAnswer`) | yes (`include_domains`, hard filter) | no | no (SDK exposes no signal) |

Provider selection comes from the Active Domain's `sources.enabled`. A
provider that cannot be constructed is skipped and recorded in
`providerBuildErrors`; if no provider can register, the search is an error,
not an abstain. Exa and Tavily run on their official SDKs — their hosted
MCP servers are agent-facing tool surfaces, not server-side provider APIs —
so the adapter code does not use them.

Exa's `includeDomains` applies only to `search()`; its separate `answer()` call
does not receive the allowlist, and the kernel does not URL-gate answer text or
citations.

The AnySearch adapter wires `search` only: `get_sub_domains`, `batch_search`,
`extract`, and the live-but-undocumented `score` are not wired, and this client
does not pin the upstream tool count (official docs list four tools; the live
endpoint has also returned `score`). A successful `search` reply's
non-empty `_meta.request_id` is recorded as a diagnostic correlation id on the
observation span when a caller supplies one; it never enters results and is
never an idempotency key. Upstream REST `POST /v1/search` is live (only `GET`
returns 404); this adapter speaks MCP only, so the `/v1/search` → `/mcp`
rewrite is a compatibility shim, not a retirement notice.

## Verification

These commands are the repo's MCP verification ladder; the first two need no
provider or LLM keys.

| Command | What it proves |
|---------|----------------|
| `pnpm -C apps/mcp check` | TypeScript typecheck of the server source (`src/**/*.ts`); the test files run through `tsx` and are not part of this `tsc` pass. |
| `pnpm -C apps/mcp test` | Source-level suites: tool registration/schemas, abstain, failure semantics, dual-era negotiation, cancellation (search + `ans_chat`), shared LLM cache, client attribution, provider diagnostics, research depth. |
| `pnpm --filter @anysearch-cli/mcp build` then `node scripts/mcp-smoke.mjs` | The **built** `dist/index.cjs`, on both transports: stdio and stateless-HTTP `initialize`, `tools/list` with all five tools and their type descriptions, and dual-era negotiation (`2026-07-28` → `2025-11-25`, legacy echo). No provider or LLM keys required because it never calls a tool. Unset `ANS_MCP_KEY` first: the smoke's `/health` probe sends no auth header and would time out. CI runs `--help` separately before this script. |
| `node scripts/ship-gate.mjs` | The release gate: workspace check/test/build, pack + install verification, a real stdio `initialize`, the packaged CLI/MCP observation round-trip, stdout purity, and fail-open boot with a scrubbed environment (no provider backend). |
| `pnpm check` / `pnpm test` (root scripts; `pnpm -r check` / `pnpm -r test` also work) | Whole-workspace typecheck / test. The merge gate requires the full suite green locally; CI red is information, not a blocker (see AGENTS.md). |
| conformance heartbeat (`.github/workflows/conformance.yml`) | Scheduled `@modelcontextprotocol/conformance` run against the HTTP transport. It targets stable `2025-11-25`, expects no known failures, and is **non-blocking by design** (spec drift is surfaced, not gated). |
| `ans-mcp --help`; `curl 127.0.0.1:3001/health`; `curl -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -X POST 127.0.0.1:3001/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` | Manual liveness. The POST needs both content types in `Accept`, or the locked SDK returns 406. With `ANS_MCP_KEY` set, every request (including `/health`) needs the bearer header; a request without it returns 401. |

`node scripts/ship-gate.mjs` is the release verdict; a green `apps/mcp` suite
alone does not prove the packaged artifact boots or that the protocol channel
stays clean.

## Related docs

- [limitations.md](limitations.md) — full known-limitations record.
- [vertical-domains.md](vertical-domains.md) — vertical vocabulary snapshot and upstream semantics.
- [rag-adapters.md](rag-adapters.md) — `none` / `note` / `fts` adapters, injection shape, and budgets.
- [agents/domain.md](agents/domain.md) — single-context documentation convention.
- Host-specific registration and hooks: [claude-integration.md](claude-integration.md), [codex-integration.md](codex-integration.md), [codebuddy-integration.md](codebuddy-integration.md), [antigravity-integration.md](antigravity-integration.md), [deepseek-harness-integration.md](deepseek-harness-integration.md).
