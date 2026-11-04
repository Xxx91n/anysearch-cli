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
- **macOS is outside the blocking matrix** — an exit-time `libc++abi` crash
  remains unresolved, so `ship-gate` gates on ubuntu+windows while a
  non-blocking `macos-spillover-probe` job replays a minimal repro each push
  (promotion rule: ≥5 consecutive green probes before restoring the lane).
- **Exit-time `libc++abi` can overwrite the abstain exit code** — observed on
  Windows: the teardown crash may replace the `3` that `--fail-on-abstain`
  produced. Automation must read the structured abstain marker (`--json`
  `abstain` field / MCP `structuredContent.abstain`), not the exit code alone.
- **macOS probe data point #1 is a registration-segment red** — the first
  non-blocking probe run (34927388026) failed at the `better-sqlite3`
  registration check (load-time family, distinct from the exit-time family
  under probe). The ≥5-consecutive-green promotion clock counts from #1.
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
  POSIX modes); the MCP cold-start path still inherits the process umask
  (hardening tracked in #156). Every shipped domain stays on `adapter = "none"`,
  so the shared read is opt-in; a deployer that shares one store or one MCP
  server across users must isolate with separate stores and access-controlled
  servers (e.g. `ANS_MCP_KEY`). If multi-principal
  sharing ever appears, attribute origin at write time first, then filter reads.
  Evidence and rejected alternatives: `docs/rag-adapters.md` §作用域.
- **`ans_chat` (MCP) has no `MemoryPipeline` at all (#129)** — this is the
  whole memory chain being absent, not a fail-open to `none`. `PiAgentRuntime`
  builds `MemoryPipeline` only when `store` and `sessionId` are BOTH supplied;
  `ans_chat` passes neither, so RAG injection (including `fts`), the L1/L2
  anchor injection and the consolidation cold path never run on that path — no
  adapter is consulted and nothing is logged as degraded by the adapter layer
  itself. The CLI `ans chat` path now wires both (`apps/cli/src/commands/chat.ts`)
  and uses the durable `ANS_DB_PATH` store; MCP cannot copy that fix because the
  protocol deliberately carries no per-instance session id
  (`apps/mcp/src/index.ts` stateless transport, `session_id` never stashed), so
  its session semantics must be decided first (#132). #130 only governs the RAG
  read scope and does not block that decision.
- **A runtime without the memory pair is named, not silent (#129)** — a
  composition root that supplies `store` without `sessionId`, `sessionId`
  without `store`, or neither at all now gets one stderr line naming what is
  missing and stating that RAG / L1 / L2 injection are disabled for that
  runtime. It is deduped per missing-half combination for the process lifetime,
  because a stateless host (`ans_chat`) builds one runtime per request. This is
  what makes the `ans_chat` gap visible instead of a no-op. The gate itself
  (`store && sessionId`) is unchanged — narrowing it would alter every
  composition root.
