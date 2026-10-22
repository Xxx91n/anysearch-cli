# ADR-0103: Hotfix 0.1.2 — ans_chat 检索恢复、搜索饱和停止、限流误判

## Status

Accepted (hotfix 0.1.2, 2026-10-22). Source: r19 evaluation T1/T2 (research repo `docs/adr/0018`, task brief R19-T2). Amends ADR-0007 D4 only by data (shipped domain whitelists); the filter contract is unchanged.

## Context

r19 smoke runs (dsh host + deepseek-v4.1-flash, ans_chat as the only exposed tool) and the r18 report surfaced three defects:

1. **ans_chat never retrieved.** `PiAgentRuntime` filters its tools by `domain.hooks.toolWhitelist` (ADR-0007 D4). All three shipped domains (`default`, `docs`, `research`) listed only host-side names (`ctx_*`, `atomcode`), so the built-in `search` tool was filtered out and the agent loop ran with zero tools. The model answered from parametric memory (stale facts) or printed tool calls as text. Tests and the no-domain fallback used `["search"]`, so nothing caught it. Probe evidence (same question): whitelist as shipped → 3 s, text tool call, no answer / stale answer; `search` whitelisted → 18–24 s, correct current answer, with either `ANS_LLM_PROVIDER=openai` or `deepseek`.
2. **No non-budget stop for the search loop (r18 seal-0).** On adversarial questions the agent kept re-searching (46–62 searches per question in r18) until the wall-clock budget ran out.
3. **Rate-limit notice classified permanent-auth (r18 STOP-20).** `mapToolsCallResult` treated any reply mentioning `rate limit` / `quota` as the anonymous-quota provisioning nudge, so a throttle on a valid key read as a credential failure.

## Decision

### D1 Shipped domains whitelist the built-in search tool
`domains/{default,docs,research}.toml` (source of truth; synced into `apps/mcp/domains` and `apps/cli/domains` at build): `toolWhitelist` gains `"search"`. `hooks.toolWhitelist` stays the security filter (ADR-0007 D4); a user domain that omits `search` still disables it. `filterAgentTools` and `BUILTIN_SEARCH_TOOL` are exported for the regression test.

### D2 Search saturation stop
`SearchSaturation` tracks URLs returned by each `search` call in one run. When `maxNoNewStreak` (2) consecutive searches add no new URL, or `maxCalls` (12) searches have run, `beforeToolCall` blocks further `search` calls (`block: true`, no terminate) with a reason telling the model to answer from gathered evidence. The wall-clock timeout remains as the outer budget.

### D3 Rate-limit notice is transient
The provisioning nudge (`automatically generated` / `api_key=`) stays `permanent-auth`. A rate-limit/quota notice without those markers (`RATE_LIMIT_NOTICE`, EN + ZH) throws `… rate limited …`, and `classifyProviderError` maps `rate limit` / `too many requests` to `transient`.

### D4 版本
All packages move to 0.1.2 through the normal `release.yml` path (pre-tag → tag → OIDC publish).

## Consequences

- Regression tests (each red before its fix):
  - `packages/kernel/test/agent-tool-filter.test.ts` — every shipped domain keeps `search` active.
  - `packages/kernel/test/search-saturation.test.ts` — a faux model that keeps searching stale results stops at ≤3 searches and still answers (30 without the fix).
  - `packages/retriever/test/anysearch.test.ts` case 17, `provider-error-class.test.ts` — rate-limit notices classify transient.
- r18 `ans_chat` results (255 calls in the main comparison) ran with the zero-tool defect; r18 numbers are frozen and are not re-scored — the defect is reported, not corrected, in the evaluation record.
- Out of scope: host-level repeated tool calls (a host may still call `ans_chat` many times), retry/backoff policy for transient errors, compat auto-detection for DeepSeek models behind non-deepseek base URLs.
