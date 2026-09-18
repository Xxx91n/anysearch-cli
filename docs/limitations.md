# Known limitations

- **≤0.0.3 plugin server needs a manual launch** — `@anysearch-cli/plugin@0.0.3`
  ships no bin; run
  `node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"` once per
  machine. Fixed in 0.0.4 as the `ans-plugin-server` bin (ADR-0066).
- **≤0.0.3 hook templates point at library files** — `configs/*/hooks.json`
  Pre/PostToolUse entries reference `dist/hooks/{preheat,distill}.cjs`
  (decision libraries, no stdin main) instead of `adapters/<host>.cjs`; wire
  hooks per `docs/codebuddy-integration.md` / `docs/claude-integration.md`.
  Fixed in 0.0.4 (ADR-0066/0067).
- **Hook adapters before this fix read `stdin.event`** — real hosts inject
  `hook_event_name`; on ≤0.0.3 the hooks deploy but silently no-op
  (false-green). Fixed in 0.0.4 via `hook_event_name ?? event` on all four
  adapters + session-start (ADR-0066).
- **≤0.0.3 Claude output keys are dropped by the host** — `claude.ts` and
  `session-start.ts` emitted `additionalContext` / `updatedToolOutput` at top
  level; Claude Code drops every bare top-level decision key (sentinel-proven
  on 2.1.251). Fixed in 0.0.4: all keys sit inside `hookSpecificOutput`
  (ADR-0067).
- **≤0.0.3 Claude hook template uses a non-schema shape** — `configs/claude/
  hooks.json` `{name,command,args}` entries silently poison the whole event
  column on Claude Code (0 hooks fire, no error). Fixed in 0.0.4: official
  `{matcher, hooks:[{type:"command", command}]}` + `ans-hook-*` bin commands
  (ADR-0067).
- **0.0.4 session-start default output is Codex-unsafe** — published 0.0.4
  `session-start.cjs` emits bare top-level `additionalContext` unless
  `--envelope` is passed; codex 0.142.5 drops the bare form ~80% of the time
  (measured). Fixed in 0.0.5: the shipped Codex config passes `--envelope`
  (ADR-0068).
- **≤0.0.4 Codex hook config is a dead file** — `configs/codex/hooks.json`
  used `{name,command,args}` entries; Codex registers zero hooks from that
  shape (no error). Fixed in 0.0.5: official schema + `ans-hook-codex` /
  `ans-hook-session-start --envelope` bin commands, generated single-source by
  `scripts/gen-claude-configs.mjs` (ADR-0068).
- **≤0.0.4 Codex adapter output is dropped/dropped-silently** — bare top-level
  `additionalContext` lands ~20% of the time on codex 0.142.5 and
  `decision.permission` was never emitted, so URL-policy denies executed the
  tool anyway. Fixed in 0.0.5: all output inside `hookSpecificOutput`,
  `permissionDecision(Reason)` passthrough (ADR-0068).
- **≤0.0.5 Antigravity hook config + adapter are dead on real agy** —
  `configs/antigravity/hooks.json` used the Gemini-legacy `{hooks:{...}}`
  wrapper which agy rejects (`command hook must specify 'command'` → zero
  hooks load), and the adapter read snake_case fields agy never sends
  (`tool_name`/`session_id`/`hook_event_name` — real payload is camelCase
  `toolCall`/`conversationId`, event via argv). Any `additionalContext` it
  emitted would protojson-reject and ERROR the tool call. Fixed in 0.0.6:
  named-hook schema + `ans-hook-antigravity <Event>` + camelCase mapping +
  `{decision:"allow"}`/`{}`/injectSteps outputs (ADR-0069).
- **Antigravity PostToolUse delivers no tool output (0.0.6)** — the host
  stdin carries `toolCall{name,args}` + `error` only, so distill sees args
  but not results on this host; `/index` still accumulates server-side and
  distilled context rides `injectSteps.ephemeralMessage` via a per-
  conversation pending file (ADR-0069 D4).
- **Codex unverified surfaces (0.0.5)** — PostToolUse `additionalContext`
  injection is same-turn-variable on codex 0.142.5 (the `/index` side
  effect is the durable path); `[hooks.state]` trust-hash persistence is
  not headless-verified; `query_knowledge` returns the `adapter=none` stub
  (pre-existing, not a Codex regression); OOD `abstain=null` shape noted
  under allowlist routing (ADR-0068).
- **`anysearch` provider cannot pre-filter** — its REST surface has no domain
  parameter; under a domain allowlist it is post-filter-only (honest degrade,
  recorded in the `retrieval.domain_filter.pre` audit event).
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
  `mustNotHitPaths` negative pins) rather than byte-exact paths (ADR-0065).
  Three byte-exact `mustHitUrls` legs survive on frozen dated MCP spec
  snapshots; the 10 drift-quarantined entries were adjudicated to promote in
  R64 with `migration` provenance on each golden entry (ledger
  `packages/store/eval-quarantine.json` is empty; watch-marked entries
  re-enter quarantine through the same TTL path on a CI flip).
- **FTS-only installs dedupe lexically** — without the optional
  `@anysearch-cli/embedding` peer, memory consolidation falls back to a Jaccard
  similarity floor (θ=0.80): near-verbatim duplicates still noop, but
  paraphrase-level duplicates are not caught (degraded, counted in
  `ConsolidateReport.embeddingAbsent` — ADR-0064 T1).
- **Tavily domain-filter probe: live-verified** — `include_domains` held in
  default + filter modes and subdomain direction is bidirectional
  (`scripts/probe-tavily-domains.mjs`, ledger in `.scratch/grill-round-62/`;
  the `/research` endpoint arm is INCONCLUSIVE — async handle, no URL fields).
- **`ans chat` / `ans llm` need an LLM key** (`OPENAI_API_KEY` etc. via
  `ans llm`); retrieval itself only needs provider keys.

