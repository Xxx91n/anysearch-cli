# anysearch-cli

> **Reader: new contributor / external integrator**
> **Purpose: orient to repo structure, architecture decisions, and how to build**

A vertical-domain information-specialist Agent CLI. The anysearch mental model:
search + research + memory + knowledge in one Agent, with time-edge-effect FTS5
recall, multi-source RRF fusion, and an MCP server that auto-indexes results.

## What this is

- **Kernel** (`packages/kernel`): Retroaererd Engine — bounded budget, sufficiency gate, RRF fusion
- **Store** (`packages/store`): FTS5 session memory + time-edge-effect decay (bi-temporal, QDF, pinned)
- **Retriever** (`packages/retriever`): provider contracts (exa/tavily/anysearch) + RRF pure function
- **MCP server** (`apps/mcp`): 5 MCP tools (search_web, research_web, recall_memory, query_knowledge, ans_chat)
- **Plugin** (`apps/plugin`): hooks layer + project index + two-stage recall (ADR-0009/0010)
- **CLI** (`apps/cli`): entry point, `ans` command, composition root forwarder

## Before you explore

- Read `CONTEXT.md` at the repo root — the glossary of domain terms (38 terms).
- Read `docs/adr/` — 10 ADRs (0001-0010), all Accepted, consecutive.
- Read `docs/agents/domain.md` for how to consume domain docs.
- Read `docs/agents/issue-tracker.md` for the local-markdown issue tracker conventions.

## Architecture decisions

| ADR | Round | Topic |
|-----|-------|-------|
| 0001 | — | TypeScript PI skeleton |
| 0002 | — | Domain authority (CC persona TOML) |
| 0003 | — | Code mode soft-depends (context-mode + codegraph) |
| 0004 | — | Kernel split seam architecture |
| 0005 | 2 | Architecture grill round 2 |
| 0006 | 3 | Seam wiring (composition root, billing dimension, seam wiring) |
| 0007 | 4 | PiAgentCore integration |
| 0008 | 5 | MCP phase 2 design (5 tools, time edge effect, dual transport) |
| 0009 | 6 | Phase 3 plugin design (hooks, project index, dual DB, two-stage recall) |
| 0010 | 7 | Post-phase 3 evolution (L1 hot-cold hybrid, SessionStart hook, progressive disclosure) |

## Build & test

```bash
pnpm install --node-linker=hoisted  # Windows: hoisted avoids better-sqlite3 EPERM

# Tests (per package, no global runner):
cd packages/store && npx tsx test/session-store.test.ts
cd packages/kernel && npx tsx test/engine.test.ts
cd packages/retriever && npx tsx test/rrf.test.ts
cd apps/mcp && npx tsx test/mcp.test.ts
cd apps/plugin && npx tsx test/plugin.test.ts

# Build:
cd apps/mcp && npx tsup   # -> dist/index.cjs
cd apps/cli && npx tsup   # -> dist/index.js

# Server liveness:
node apps/mcp/dist/index.cjs --transport http --port 3099
curl http://127.0.0.1:3099/health  # -> {"status":"ok",...}
```

## Debt & governance

- `docs/ponytail-debt-ledger.md` — tracked technical debt with upgrade triggers
- `.scratch/<feature-slug>/` — local-markdown issue tracker (not committed to git)
- `AGENTS.md` — minimal project agent-skill metadata (13 lines)
