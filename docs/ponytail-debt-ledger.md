# Ponytail Debt Ledger — anysearch-cli
# Auto-generated from ponytail: comments across the repo.
# Each entry: file:line | debt description | upgrade trigger

packages/kernel/src/engine.ts:97 | MVP uses Promise.allSettled without early-cancel. Full grace-window abort needs custom race. | Upgrade when latency matters
packages/kernel/src/engine.ts:31 | budget token dimension accepted but not wired (per-call dimension wired in ADR-0006). | Wire token dimension when LLM integration lands
apps/cli/src/commands/skill.ts:2 | MVP stub. Skill install from SearchCLI pattern deferred. | Implement when pi-agent-core lands
apps/cli/src/commands/recommend.ts:2 | MVP stub. Domain recommendation engine deferred. | Implement when domain recommendation logic is designed
apps/cli/src/commands/llm.ts:2 | MVP stub. pi-agent-core integration deferred. | Implement when pi-agent-core is installed
apps/cli/src/commands/chat.ts:2 | MVP stub. Requires pi-agent-core for agent loop. | Implement when pi-agent-core lands
apps/cli/src/commands/domain.ts:2 | ADR-0006 TOML loading implemented. No ANS_DOMAIN persistence write. | Add config write when persistence needed
apps/cli/src/commands/auth.ts:2 | MVP shows key status, does not write config files. | Add config write when needed
packages/retriever/src/providers/tavily.ts | AbortSignal not forwarded (SDK lacks support) | Add when @tavily/core exposes signal
packages/retriever/src/providers/tavily.ts | usage() returns undefined (per-call credits only) | Map credits when standalone usage API exists
packages/retriever/src/providers/exa.ts | usage() returns undefined (costDollars per-call only) | Map costDollars when standalone usage API exists
