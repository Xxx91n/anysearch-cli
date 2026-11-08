# Known limitations

- **Plugin server on ≤0.0.3 needs a manual start** — `@anysearch-cli/plugin@0.0.3`
  ships no bin. Run
  `node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"` once per
  machine. Fixed in 0.0.4 as the `ans-plugin-server` bin.
- **Hook templates on ≤0.0.3 point at library files** — `configs/*/hooks.json`
  Pre/PostToolUse entries reference `dist/hooks/{preheat,distill}.cjs`
  (decision libraries with no stdin main) instead of `adapters/<host>.cjs`.
  Wire hooks per `docs/codebuddy-integration.md` / `docs/claude-integration.md`.
  Fixed in 0.0.4 (0067).
- **Hook adapters before this fix read `stdin.event`** — real hosts inject
  `hook_event_name`. On ≤0.0.3 the hooks install but do nothing, so the check
  looks green when it is not. Fixed in 0.0.4 with
  `hook_event_name ?? event` on all four adapters + session-start.
- **Claude drops the output keys on ≤0.0.3** — `claude.ts` and
  `session-start.ts` put `additionalContext` / `updatedToolOutput` at the top
  level. Claude Code drops every bare top-level decision key (proven with a
  marker check on 2.1.251). Fixed in 0.0.4: all keys sit inside
  `hookSpecificOutput`.
- **Claude hook template on ≤0.0.3 has the wrong shape** —
  `configs/claude/hooks.json` `{name,command,args}` entries silently poison the
  whole event column on Claude Code (0 hooks fire, no error). Fixed in 0.0.4:
  the official `{matcher, hooks:[{type:"command", command}]}` + `ans-hook-*`
  bin commands.
- **0.0.4 session-start default output is unsafe on Codex** — published 0.0.4
  `session-start.cjs` emits bare top-level `additionalContext` unless
  `--envelope` is passed. codex 0.142.5 drops the bare form about 80% of the
  time (measured). Fixed in 0.0.5: the shipped Codex config passes
  `--envelope`.
- **Codex hook config on ≤0.0.4 is a dead file** — `configs/codex/hooks.json`
  used `{name,command,args}` entries. Codex registers zero hooks from that
  shape, with no error. Fixed in 0.0.5: official schema + `ans-hook-codex` /
  `ans-hook-session-start --envelope` bin commands, generated from one source
  by `scripts/gen-claude-configs.mjs`.
- **Codex adapter output on ≤0.0.4 is dropped, often silently** — bare
  top-level `additionalContext` lands about 20% of the time on codex 0.142.5,
  and `decision.permission` was never emitted. So a URL-policy deny did not
  stop the tool: it ran anyway. Fixed in 0.0.5: all output inside
  `hookSpecificOutput`, with `permissionDecision(Reason)` passthrough.
- **Antigravity hook config + adapter on ≤0.0.5 do not work on real agy** —
  `configs/antigravity/hooks.json` used the Gemini-legacy `{hooks:{...}}`
  wrapper, which agy rejects (`command hook must specify 'command'`, so zero
  hooks load). The adapter read snake_case fields that agy never sends
  (`tool_name`/`session_id`/`hook_event_name`; the real payload is camelCase
  `toolCall`/`conversationId`, and the event comes through argv). Any
  `additionalContext` it emitted would fail protojson and turn the tool call
  into an ERROR. Fixed in 0.0.6: named-hook schema +
  `ans-hook-antigravity <Event>` + camelCase mapping +
  `{decision:"allow"}`/`{}`/injectSteps outputs.
- **Antigravity PostToolUse delivers no tool output (0.0.6)** — the host
  stdin carries `toolCall{name,args}` + `error` only, so distill sees the args
  but not the results on this host. `/index` still collects data on the
  server side, and distilled context rides `injectSteps.ephemeralMessage`
  through a per-conversation pending file.
- **Codex surfaces not yet verified (0.0.5)** — on codex 0.142.5, PostToolUse
  `additionalContext` injection varies within the same turn (the `/index`
  side effect is the durable path). `[hooks.state]` trust-hash persistence has
  not been verified headless. The out-of-domain (`OOD`) `abstain=null` shape
  is noted under allowlist routing.
- **The `anysearch` provider cannot pre-filter** — its MCP `domain` param is a
  vertical routing value (academic..travel), not a hostname allowlist.
  `includeDomains` cannot ride on it. Under a domain allowlist, this provider
  can only be filtered after it returns. This is a real limit, recorded in the
  `retrieval.domain_filter.pre` audit event. Passing vertical values through
  is a change to the contract surface (R83 ticket).
- **Tavily does not forward `AbortSignal` (#32)** — provider-side timeouts
  cannot be cancelled through the SDK. The budget guard limits spend, not wall
  time. The grace window only aborts stragglers once enough results arrive, so
  a slow call can still overrun the budget.
- **macOS exit-time `libc++abi` aborts (F-16) — root-caused, fixed, macOS CI
  job restored (#183, after #16 / PR #174).** The family is **not**
  "better-sqlite3 leaks a handle". It is `process.exit()` running C++ static
  destructors while Node's threadpool/native state is still alive. On Apple's
  libc++ the resulting lock on a destroyed mutex is fatal (`EINVAL` →
  `std::system_error` → `std::terminate` → SIGABRT). That is why Linux never
  showed it, and why closing handles alone was not enough.

  Evidence chain: the first promotion (PR #174) was reversed by run
  41913304226 / job 126866247252 (5/76 store test files aborted after their
  assertions passed, zero failures, plus the eval runner child killed by
  signal). After the handle-side fix (registry promoted to
  `@anysearch-cli/store`, tracked/idempotent opener, test-process
  close-on-exit), diag run 42031513303 still lost 4 files: access-chain-telemetry,
  access-chain-verify, eval-abstain, fusion-registry-memory. **Every one was a
  `process.exit(...)` file.** Meanwhile `eval-gate.test.ts` flipped green in the
  same run, purely because `packages/store/src/eval/cli.ts` stopped calling
  `process.exit()`.

  What changed: (a) `packages/store/src/teardown.ts` + `src/db.ts` now use a
  drain-once registry. A teardown whose close throws stays queued for the
  next drain. A tracked handle keeps its registration until the native close
  succeeds. Every store handle is opened through a tracked, idempotent
  close. The eval runner also exits with `exitCode` + unref + a 5s watchdog
  instead of `process.exit()`.
  (b) Store test processes preload `test/helpers/exit-teardown.mjs`, which
  defers `process.exit()` to a natural exit (a recorded nonzero code stays
  sticky). It deliberately does *not* try to track raw test handles. Under
  tsx, an ESM import of better-sqlite3 does not observe a patched CJS
  `module.exports` (proved in CI, diag run 42043443737). Closing handles was
  never what stopped the aborts: the first attempt did close them, and the
  suite still aborted. The preload still keeps a 5s unref'd watchdog for a
  process that refuses to drain. When
  it fires, it names the surviving resources on stderr, so a forced exit is
  always auditable in the CI log.

  Evidence for restoring the macOS CI job: only a full green gate counts.
  There were
  **three consecutive macOS full-gate greens** (9 steps including the store
  suite) on PR #191 — run 42032463918 (head `9d172d3`), run 42034443431
  (head `ef6fda5`), run 42035956744 (head `5acf577`) — after diag run
  42032450895 had confirmed the fix surface (`[pass] turbo run test`,
  `SHIP_GATE_EXIT=0`). `macos-latest` is back in the blocking matrix and
  `REQUIRED_LEGS` mirrors it. A later run on the CodeRabbit-repaired head adds
  confirmation, but does not count toward the three green runs.

  The remaining risk: anything that still force-exits a process with live
  native state can abort again. The `macos-spillover-probe` job stays
  as a non-blocking early-warning reporter, and `apps/mcp` / `apps/plugin`
  close per connection without draining the registry on their own exit paths
  (wire the same contract there if a crash is ever observed).
- **`process.exit()` in tests is no longer a synchronous kill (#183)** — the
  `packages/store` test preload defers it to a natural exit (exit code
  preserved, 5s unref'd watchdog as the backstop). Code placed after
  `process.exit(...)` in a store test file now keeps running in that process.
  All 51 existing call sites are terminal statements or already-failing
  branches.
- **An exit-time `libc++abi` crash can overwrite the abstain exit code** — seen
  on Windows: the teardown crash may replace the `3` that `--fail-on-abstain`
  produced. Automation must read the structured abstain marker (the `--json`
  `abstain` field / MCP `structuredContent.abstain`), not the exit code alone.
- **macOS probe data point #1 was a registration-step red (probe defect,
  closed)** — the 20-run red streak (first: 34927388026) failed at the
  `better-sqlite3` registration check. The check ran from the repo root under
  pnpm's strict layout (`MODULE_NOT_FOUND`, a load-time family, different from
  the exit-time family under probe, and it never reached it). This was a probe
  defect, not the F-16 family. Fixed by #121 (`working-directory:
  packages/store`). The promotion clock linked to it fired (PR #174) and was
  reversed by the first full-gate run. See the prune entry above.
- **Page-level assertions use page families, not exact pages** — providers
  rotate URL paths (`/zh/` locale, `/10.x` version, dated
  `/specification/<date>/` variants). So live golden entries assert
  `mustHitPaths` (pathname substring + explicit `tolerate` classes +
  `mustNotHitPaths` negative pins) rather than byte-exact paths. Three
  byte-exact `mustHitUrls` legs survive on frozen dated MCP spec snapshots.
  The 10 entries held back for drift were approved in R64 to return to the
  live set. Each golden entry recorded `migration` provenance. The ledger
  `packages/store/eval-quarantine.json` is empty. Watch-marked entries go back
  into quarantine through the same TTL path when a CI run changes.
- **FTS-only installs dedupe by word overlap** — without the optional
  `@anysearch-cli/embedding` peer, memory consolidation falls back to a
  Jaccard similarity floor (θ=0.80). Near-verbatim duplicates are still
  skipped (noop), but paraphrase-level duplicates are not caught (degraded,
  counted in `ConsolidateReport.embeddingAbsent`).
- **Tavily domain-filter probe: verified live** — `include_domains` held in
  default + filter modes, and subdomain direction works both ways
  (`scripts/probe-tavily-domains.mjs`; the `/research` endpoint call is
  INCONCLUSIVE — async handle, no URL fields).
- **`ans chat` / `ans llm` need an LLM key** (`OPENAI_API_KEY` etc. via
  `ans llm`). Retrieval itself only needs provider keys.
- **`query_knowledge` only retrieves when the current domain (code:
  `Active Domain`) enables `fts` (#155)** — the tool resolves the current
  domain's `rag.adapter` through `RagAdapterRegistry`. For `fts`, it calls `retrieve(query, RAG_DEFAULT_LIMIT)`
  over the store-level research archive, the same internal range
  `recall_memory` reads before its project-index fallback, per the #130 scope
  decision. With `adapter = "none"` or `"note"` it returns an explicit "no
  queryable knowledge adapter" empty result. It does not echo the static note,
  and it does not error. An unknown adapter id falls back to `none` with one
  deduped stderr warning. The input schema stays `{ query: string }`. Every
  shipped domain stays on `none`, so a default install answers empty until a
  domain opts into `fts`. To turn it on, set `adapter = "fts"` under `[rag]`
  in that domain's TOML (replace the existing `adapter = "none"` line),
  select it with `ANS_DOMAIN`, and restart the MCP server.
  `createDefaultEngine` snapshots the current domain at construction, so a
  running server does not see the edit.
- **`rag.adapter = "fts"` reads the store-level shared research archive (#130,
  superseding the #104 CWE-200 disclosure)** — this is a deliberate boundary,
  not an open question. The store is the isolation unit (code:
  `Store Principal`),
  and sessions/domains are retrieval sub-scopes. The #104 CWE-200 finding is
  accepted as this deliberate boundary rather than fixed by a session filter.
  A domain that enables `fts` can surface research saved by any session in the
  same store. All three default-store writers (CLI, MCP cold start, plugin
  server) call the shared `ensureOwnerOnlyDb` (`@anysearch-cli/store`). The
  directory is 0700 only when that call creates it. The main DB and its
  `-wal`/`-shm` sidecars are 0600 (#156). This is best-effort. Windows ignores
  POSIX modes, and a foreign-owned file never fails the command. This covers
  the default store only. The plugin server's project index (`POST /index`) is
  a separate store and is not tightened by this helper. Every shipped domain
  stays on `adapter = "none"`, so the `fts` prompt injection is opt-in. The
  same store-wide range is already read by `recall_memory` when it is called.
  A deployer that shares one store or one MCP server across users must isolate
  with separate stores and access-controlled HTTP servers (e.g.
  `ANS_MCP_KEY`). If multi-principal sharing ever appears, attribute origin at
  write time first, then filter reads. Evidence and rejected alternatives:
  `docs/rag-adapters.md`.
- **`ans_chat` (MCP) uses an explicit, server-minted session handle (#132)** —
  the tool mints `createSession("mcp")` on the first call and returns it as
  `structuredContent.sessionId` plus a trailing text block, so hosts that only
  forward content still make the handle visible to the model. A later call
  threads it back as `AnsChatInput.sessionId`, the server `ensureSession()`s
  it before reuse, and `MemoryPipeline` is then built with `store` +
  `sessionId`, so the L1/L2 restore points (and domain retrieval injection)
  continue in that session.
  Omitting the handle is the explicit single-shot mode: a fresh session per
  call, with no cross-call continuity. A malformed handle (anything that is
  not 1..128 visible ASCII characters — empty strings, spaces, control
  characters, and non-ASCII) is ignored for the same keep-going reason: the
  call runs single-shot, no fake handle is returned, and the answer still
  comes back. A non-string value is a wire type error before the handler; it
  is not treated as a malformed handle. This follows the MCP 2026-07-28
  revision, which removed protocol-level sessions and tells servers that need
  cross-call state to use explicit, server-minted handles passed as ordinary
  tool arguments (SEP-2567). The transport `session_id` therefore stays
  empty. A supplied handle is **not** a security boundary. The store is the
  boundary (`Store Principal`, #130), and a client that can reach the server can
  already read the store-level research archive.
- **`ans_chat` restore points are written in the background (#132)** — the handle
  guarantees session identity, not write timing. `consolidation_state` is
  awaited, but `rolling_summary` / `l2_recall` are fire-and-forget (up to the
  90s summary budget), and the MCP response does not wait for them. A later
  call normally reads them. An immediate re-call can race the previous
  background write.
- **Handle-less `ans_chat` calls mint a session row per call (#132)** — this
  is the same per-call pattern `search_web` auto-index already uses, and the
  store has no session GC. A long-lived client that never threads the handle
  therefore collects empty `sessions` rows. One that threads the returned
  handle reuses a single row and its restore points. Deployments that care
  about row growth can prune the table out of band.
- **A runtime without `store` + `sessionId` says what is missing (#129)** —
  a startup entry that supplies `store` without `sessionId`, `sessionId`
  without `store`, or neither now gets one stderr line. It names what is
  missing and states that domain retrieval / L1 / L2 injection are disabled
  for that runtime. It is deduped for each combination of missing parts for the
  process lifetime, because a stateless host (`ans_chat`) builds one runtime
  per request. This is what makes the `ans_chat` gap visible instead of
  silently doing nothing.
  The gate itself (`store && sessionId`) is unchanged; narrowing it would
  alter every startup entry.
- **MCP protocol versions: a `2026-07-28` client is negotiated down to
  `2025-11-25`** — both stdio and the stateless Streamable HTTP transport
  answer an `initialize` claiming `2026-07-28` with `2025-11-25` (the SDK's
  built-in legacy fallback), and the five tools still work. Legacy clients
  (`2024-10-07` … `2025-11-25`) get their own version echoed back. The
  hand-written server stays legacy-only: a modern `_meta` field does not
  unlock modern methods. So on stdio/in-memory (or HTTP without the
  `MCP-Protocol-Version` header) `server/discover` returns JSON-RPC `-32601`
  (`MethodNotFound`), while `tools/list` carrying the same field still
  returns the five-tool list (graceful legacy degradation). On HTTP, a
  non-initialize request that sends `MCP-Protocol-Version: 2026-07-28` is
  rejected by the transport before dispatch with HTTP 400 and JSON-RPC
  `-32000` (unsupported-version gate). Send the negotiated `2025-11-25`
  instead. Pinned by `apps/mcp/test/dual-era.test.ts`.
- **MCP client attribution is per-request only (#213)** — a `2026-07-28`
  `tools/call` that carries `_meta["io.modelcontextprotocol/clientInfo"]` is
  read from the SDK request context and mapped (`mapMcpClientId`) to the
  observation trace's `client_id` when it reaches a handler. The hand-written
  server stays legacy-only, so a non-initialize request sending
  `MCP-Protocol-Version: 2026-07-28` is rejected before dispatch (see the
  protocol-version limitation above). A legacy `2025-11-25` stateless HTTP
  tool call carries no per-request identity: the `initialize` handshake is a
  different request, and a stateless server has no cross-request store, so the
  trace records `mcp_unknown`. `mcp_unknown` is therefore the expected legacy
  value, not a lookup failure. The HTTP entry's `initialize`-body extraction
  remains a fallback for a caller that supplies it in the same request scope.
  It is not a stable-attribution promise. Pinned by
  `apps/mcp/test/client-attribution.test.ts`.
- **AnySearch REST `POST /v1/search` is live; this adapter is MCP-only** —
  live probe 2026-11-07: `GET /v1/search` returns 404, while `POST /v1/search`
  returns 200 with a `code:0` response. The provider speaks MCP Streamable
  HTTP at `POST /mcp` only. So an `ANYSEARCH_ENDPOINT` (or explicit endpoint
  arg) ending in `/v1/search` is auto-rewritten to `base+/mcp` with a
  once-per-process stderr warning. That is a compatibility shim, not a sign
  that REST is retired. Upstream `request_id` in the reply is a
  server-generated diagnostic UUID (also returned as `X-Request-ID`). A
  caller-supplied value is ignored, and it is not an idempotency key.
- **The AnySearch adapter wires `search` only** — the official
  `anysearch-mcp-server` documentation lists four tools, while a live
  `tools/list` on 2026-11-07 also returned `score`, so the upstream count is
  deliberately not pinned. `get_sub_domains`, `batch_search`, `extract`,
  and the live-but-undocumented `score` are not wired. The `get_sub_domains`
  output is used as documentation evidence (`docs/vertical-domains.md`), not
  called at runtime. A successful `search` reply's non-empty
  `_meta.request_id` is captured as a diagnostic correlation id (capped at
  128 characters) and recorded on the observation span
  (`retrieval.provider.diagnostic`) when the caller supplies one — CLI and MCP
  tool calls do. Failed replies throw before extraction, so no id is recorded
  for them. The id never enters query results and is never an idempotency key.
- **Anonymous `anysearch` calls hit a quota wall classified `permanent-auth`**
  — upstream answers quota-exhausted anonymous calls with an auto-provisioning
  payload (HTTP 200, `isError:null`, no result body) instead of an error. The
  provider names this `quota/auth nudge` → `permanent-auth`. The fix is on the
  user side: set `ANYSEARCH_API_KEY`.
- **Upstream `finance.fundamental` validator over-requires `cn_code`** — the
  `get_sub_domains` vocab documents `type` + `symbol` *or* `cn_code` per type,
  but the live validator demands `cn_code` at the tag level. So e.g.
  `{type:"overview", symbol:"MSFT"}` returns `isError`. Pass `cn_code` where
  the doc implies `symbol` suffices (eval cell `vert-f1105` is disabled and
  marked `tombstoned` on this; see `eval-looks.json`).
- **Tavily's result package always has `usage` set to `undefined`** — `@tavily/core` returns
  credits only per-call (`response.usage.credits`) and offers no standalone
  usage API, so `usage()` is unimplemented (the contract field is optional).
- **Exa's result package always has `usage` set to `undefined`** — `exa-js` returns cost only
  per-call (`costDollars`) and offers no standalone usage API, so `usage()` is
  unimplemented (the contract field is optional).
