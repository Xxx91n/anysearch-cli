# Known limitations

- **≤0.0.3 plugin server needs a manual launch** — `@anysearch-cli/plugin@0.0.3`
  ships no bin; run
  `node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"` once per
  machine. Fixed in 0.0.4 as the `ans-plugin-server` bin.
- **≤0.0.3 hook templates point at library files** — `configs/*/hooks.json`
  Pre/PostToolUse entries reference `dist/hooks/{preheat,distill}.cjs`
  (decision libraries, no stdin main) instead of `adapters/<host>.cjs`; wire
  hooks per `docs/codebuddy-integration.md` / `docs/claude-integration.md`.
  Fixed in 0.0.4 (0067).
- **Hook adapters before this fix read `stdin.event`** — real hosts inject
  `hook_event_name`; on ≤0.0.3 the hooks deploy but silently no-op
  (false-green). Fixed in 0.0.4 via `hook_event_name ?? event` on all four
  adapters + session-start.
- **≤0.0.3 Claude output keys are dropped by the host** — `claude.ts` and
  `session-start.ts` emitted `additionalContext` / `updatedToolOutput` at top
  level; Claude Code drops every bare top-level decision key (sentinel-proven
  on 2.1.251). Fixed in 0.0.4: all keys sit inside `hookSpecificOutput`
.
- **≤0.0.3 Claude hook template uses a non-schema shape** — `configs/claude/
  hooks.json` `{name,command,args}` entries silently poison the whole event
  column on Claude Code (0 hooks fire, no error). Fixed in 0.0.4: official
  `{matcher, hooks:[{type:"command", command}]}` + `ans-hook-*` bin commands
.
- **0.0.4 session-start default output is Codex-unsafe** — published 0.0.4
  `session-start.cjs` emits bare top-level `additionalContext` unless
  `--envelope` is passed; codex 0.142.5 drops the bare form ~80% of the time
  (measured). Fixed in 0.0.5: the shipped Codex config passes `--envelope`
.
- **≤0.0.4 Codex hook config is a dead file** — `configs/codex/hooks.json`
  used `{name,command,args}` entries; Codex registers zero hooks from that
  shape (no error). Fixed in 0.0.5: official schema + `ans-hook-codex` /
  `ans-hook-session-start --envelope` bin commands, generated single-source by
  `scripts/gen-claude-configs.mjs`.
- **≤0.0.4 Codex adapter output is dropped/dropped-silently** — bare top-level
  `additionalContext` lands ~20% of the time on codex 0.142.5 and
  `decision.permission` was never emitted, so URL-policy denies executed the
  tool anyway. Fixed in 0.0.5: all output inside `hookSpecificOutput`,
  `permissionDecision(Reason)` passthrough.
- **≤0.0.5 Antigravity hook config + adapter are dead on real agy** —
  `configs/antigravity/hooks.json` used the Gemini-legacy `{hooks:{...}}`
  wrapper which agy rejects (`command hook must specify 'command'` → zero
  hooks load), and the adapter read snake_case fields agy never sends
  (`tool_name`/`session_id`/`hook_event_name` — real payload is camelCase
  `toolCall`/`conversationId`, event via argv). Any `additionalContext` it
  emitted would protojson-reject and ERROR the tool call. Fixed in 0.0.6:
  named-hook schema + `ans-hook-antigravity <Event>` + camelCase mapping +
  `{decision:"allow"}`/`{}`/injectSteps outputs.
- **Antigravity PostToolUse delivers no tool output (0.0.6)** — the host
  stdin carries `toolCall{name,args}` + `error` only, so distill sees args
  but not results on this host; `/index` still accumulates server-side and
  distilled context rides `injectSteps.ephemeralMessage` via a per-
  conversation pending file.
- **Codex unverified surfaces (0.0.5)** — PostToolUse `additionalContext`
  injection is same-turn-variable on codex 0.142.5 (the `/index` side
  effect is the durable path); `[hooks.state]` trust-hash persistence is
  not headless-verified; OOD `abstain=null` shape noted under allowlist
  routing.
- **`anysearch` provider cannot pre-filter** — its MCP `domain` param is a
  vertical-routing enum (academic..travel), not a hostname allowlist, so
  `includeDomains` cannot ride it; under a domain allowlist the arm stays
  post-filter-only (honest degrade, recorded in the `retrieval.domain_filter.pre`
  audit event). Vertical passthrough is a contract-surface change (R83 ticket).
- **Tavily does not forward `AbortSignal`** — provider-side timeouts are not
  cancelable through the SDK (recorded limitation; the kernel budget guard
  still bounds wall time).
- **macOS exit-time `libc++abi` aborts (F-16) — root-caused, fixed, lane
  restored (#183, after #16 / PR #174)** — the family is **not** "better-sqlite3
  leaks a handle": it is `process.exit()` running C++ static destructors while
  Node's threadpool/native state is still alive. On Apple's libc++ the resulting
  lock on a destroyed mutex is fatal (`EINVAL` → `std::system_error` →
  `std::terminate` → SIGABRT), which is why Linux never showed it and why
  closing handles alone was insufficient. Evidence chain: the first promotion
  (PR #174) was reversed by run 41913304226 / job 126866247252 (5/76 store test
  files aborted after their assertions passed, zero failures, plus the eval
  runner child killed by signal); after the handle-side fix (registry promoted
  to `@anysearch-cli/store`, tracked/idempotent opener, test-process
  close-on-exit) diag run 42031513303 still lost 4 files — access-chain-telemetry,
  access-chain-verify, eval-abstain, fusion-registry-memory, **every one of them
  a `process.exit(...)` file** — while `eval-gate.test.ts` flipped green in the
  same run, purely because `packages/store/src/eval/cli.ts` stopped calling
  `process.exit()`.
  Fix surfaces: (a) `packages/store/src/teardown.ts` + `src/db.ts` (drain-once
  registry; every store handle opened through a tracked, idempotent close) and
  the eval runner's exit path (`exitCode` + unref + 5s watchdog instead of
  `process.exit()`); (b) store test processes preload
  `test/helpers/exit-teardown.mjs`, which defers `process.exit()` to a natural
  exit and closes raw handles newest-first.
  Promotion evidence (the recalibrated rule: only full-gate greens promote):
  **three consecutive macOS full-gate greens** (9 steps including the store
  suite) on PR #191 — run 42032463918 (head `9d172d3`), run 42034443431
  (head `ef6fda5`), run 42035956744 (head `5acf577`) — after diag run
  42032450895 had confirmed the fix surface (`[pass] turbo run test`,
  `SHIP_GATE_EXIT=0`). `macos-latest` is back in the blocking matrix and
  `REQUIRED_LEGS` mirrors it. A later run on the CodeRabbit-repaired head adds
  confirmation, not promotion credit.
  Residual boundary (kept honest): anything that still force-exits a process
  with live native state can abort again — the `macos-spillover-probe` job stays
  as a non-blocking early-warning reporter, and `apps/mcp` / `apps/plugin` close
  per connection without draining the registry on their own exit paths (wire the
  same contract there if a crash is ever observed).
- **`process.exit()` in tests is no longer a synchronous kill (#183)** — the
  `packages/store` test preload defers it to a natural exit (exit code
  preserved, 5s unref'd watchdog as the backstop). Code placed after
  `process.exit(...)` in a store test file now keeps running in that process;
  all 51 existing call sites are terminal statements or already-failing
  branches.
- **Exit-time `libc++abi` can overwrite the abstain exit code** — observed on
  Windows: the teardown crash may replace the `3` that `--fail-on-abstain`
  produced. Automation must read the structured abstain marker (`--json`
  `abstain` field / MCP `structuredContent.abstain`), not the exit code alone.
- **macOS probe data point #1 was a registration-segment red (probe defect,
  closed)** — the 20-run red streak (first: 34927388026) failed at the
  `better-sqlite3` registration check because the check ran from the repo
  root under pnpm's strict layout (`MODULE_NOT_FOUND`, load-time family,
  distinct from the exit-time family under probe and never reaching it) — a
  probe defect, not the F-16 family. Fixed by #121 (`working-directory:
  packages/store`). The promotion clock it anchored fired (PR #174) and was
  reversed by the first full-gate run — see the prune entry above.
- **Page-level assertions sit at page-family granularity** — providers
  rotate URL paths (`/zh/` locale, `/10.x` version, dated
  `/specification/<date>/` variants), so live golden entries assert
  `mustHitPaths` (pathname substring + explicit `tolerate` classes +
  `mustNotHitPaths` negative pins) rather than byte-exact paths.
  Three byte-exact `mustHitUrls` legs survive on frozen dated MCP spec
  snapshots; the 10 drift-quarantined entries were adjudicated to promote in
  R64 with `migration` provenance on each golden entry (ledger
  `packages/store/eval-quarantine.json` is empty; watch-marked entries
  re-enter quarantine through the same TTL path on a CI flip).
- **FTS-only installs dedupe lexically** — without the optional
  `@anysearch-cli/embedding` peer, memory consolidation falls back to a Jaccard
  similarity floor (θ=0.80): near-verbatim duplicates still noop, but
  paraphrase-level duplicates are not caught (degraded, counted in
  `ConsolidateReport.embeddingAbsent` —).
- **Tavily domain-filter probe: live-verified** — `include_domains` held in
  default + filter modes and subdomain direction is bidirectional
  (`scripts/probe-tavily-domains.mjs`;
  the `/research` endpoint arm is INCONCLUSIVE — async handle, no URL fields).
- **`ans chat` / `ans llm` need an LLM key** (`OPENAI_API_KEY` etc. via
  `ans llm`); retrieval itself only needs provider keys.
- **`query_knowledge` is still a stub (#104)** — the kernel-side RAG adapter
  registry (`rag.adapter` = `none` / `note` / `fts`) now powers the agent-loop
  injection path (MemoryPipeline Stage-1), but the MCP `query_knowledge` tool
  does not dispatch to it yet: it still answers with the `adapter=<id>` line.
  Its read scope is now decided (#130): store-level shared Research Memory, the
  same internal range `recall_memory` reads (before its project-index fallback).
  Wiring the tool is tracked in #155.
- **`rag.adapter = "fts"` reads store-level shared Research Memory (#130,
  superseding the #104 CWE-200 disclosure)** — this is a deliberate boundary,
  not an open question: the store is the isolation unit (Store Principal), and
  sessions/domains are retrieval sub-scopes. The #104 CWE-200 finding is accepted
  as this deliberate boundary rather than fixed by a session filter. A domain
  that enables `fts` can surface research saved by any session in the same store.
  The CLI durable path attempts owner-only 0700/0600 (best-effort; Windows ignores
  POSIX modes); the MCP cold-start and plugin-server write paths still inherit the
  process umask (hardening tracked in #156). Every shipped domain stays on
  `adapter = "none"`, so the `fts` prompt injection is opt-in (the same store-wide
  range is already read by `recall_memory` when called); a deployer that shares one
  store or one MCP server across users must isolate with separate stores and
  access-controlled HTTP servers (e.g. `ANS_MCP_KEY`). If multi-principal
  sharing ever appears, attribute origin at write time first, then filter reads.
  Evidence and rejected alternatives: `docs/rag-adapters.md` §作用域.
- **`ans_chat` (MCP) uses an explicit, server-minted session handle (#132)** —
  the tool mints `createSession("mcp")` on the first call and returns it as
  `structuredContent.sessionId` plus a trailing text block (hosts that only
  forward content still make the handle model-visible); a later call threads it
  back as `AnsChatInput.sessionId`, the server `ensureSession()`s it before reuse,
  and `MemoryPipeline` is then constructed with `store` + `sessionId`, so L1/L2
  anchors (and RAG injection) continue in that session. Omitting the handle is
  the explicit single-shot mode: a fresh session per call, no cross-call
  continuity. A malformed handle (anything that is not 1..128 visible ASCII
  characters — empty strings, spaces, control characters, and non-ASCII) is
  ignored for the same fail-open reason: the call runs single-shot, no fake
  handle is returned, and the answer still comes back. A non-string value is a
  wire type error before the handler; it is not treated as a malformed handle.
  This follows the MCP 2026-07-28 revision, which removed
  protocol-level sessions and directs servers that need cross-call state to
  explicit, server-minted handles passed as ordinary tool arguments (SEP-2567);
  the transport `session_id` therefore stays empty. A supplied handle is **not** a
  security boundary — the store is (`Store Principal`, #130), and a client that
  can reach the server can already read the store-level Research Memory.
- **`ans_chat` anchors are written in the background (#132)** — the handle
  guarantees session identity, not write timing: `consolidation_state` is awaited
  but `rolling_summary` / `l2_recall` are fire-and-forget (up to the 90s summary
  budget), and the MCP response does not wait for them. A later call normally
  reads them; an immediate re-call can race the previous background write.
- **Handle-less `ans_chat` calls mint a session row per call (#132)** — this is
  the same per-call pattern `search_web` auto-index already uses, and the store has
  no session GC. A long-lived client that never threads the handle therefore
  accumulates empty `sessions` rows; one that threads the returned handle reuses a
  single row and its anchors. Deployments that care about row growth can prune the
  table out of band.
- **A runtime without the memory pair is named, not silent (#129)** — a
  composition root that supplies `store` without `sessionId`, `sessionId`
  without `store`, or neither at all now gets one stderr line naming what is
  missing and stating that RAG / L1 / L2 injection are disabled for that
  runtime. It is deduped per missing-half combination for the process lifetime,
  because a stateless host (`ans_chat`) builds one runtime per request. This is
  what makes the `ans_chat` gap visible instead of a no-op. The gate itself
  (`store && sessionId`) is unchanged — narrowing it would alter every
  composition root.
- **api.anysearch.com REST `/v1/search` is retired** — the route returns 404;
  the live API is MCP Streamable HTTP at `POST /mcp`. An
  `ANYSEARCH_ENDPOINT` (or explicit endpoint arg) ending in `/v1/search` is
  auto-rewritten to `base+/mcp` with a once-per-process stderr warning.
- **Anonymous `anysearch` calls hit a quota wall classified `permanent-auth`** —
  upstream answers quota-exhausted anonymous calls with an auto-provisioning
  payload (HTTP 200, `isError:null`, no result body) instead of an error;
  the provider names this `quota/auth nudge` → `permanent-auth`. Fix is
  user-side: set `ANYSEARCH_API_KEY`.
- **Upstream `finance.fundamental` validator over-requires `cn_code`** — the
  `get_sub_domains` vocab documents `type` + `symbol` *or* `cn_code` per
  type, but the live validator demands `cn_code` at the tag level, so
  e.g. `{type:"overview", symbol:"MSFT"}` returns `isError`. Pass `cn_code`
  where the doc implies `symbol` suffices (eval cell `vert-f1105` is
  tombstoned on this; see `eval-looks.json`).
- **Tavily envelope `usage` is always `undefined`** — `@tavily/core` returns
  credits only per-call (`response.usage.credits`) and offers no standalone
  usage API, so `usage()` is unimplemented (contract field is optional).
- **Exa envelope `usage` is always `undefined`** — `exa-js` returns cost only
  per-call (`costDollars`) and offers no standalone usage API, so `usage()`
  is unimplemented (contract field is optional).

> AI生成
