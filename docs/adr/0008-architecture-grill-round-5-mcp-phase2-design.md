# ADR-0008: Architecture Grill Round 5 — MCP Phase 2 Design

日期: 2026-08-19
状态: Accepted

## 背景 (Context)

Post-Round 4 (ADR-0007), pi-agent-core integration complete (G011-G014 + G016, 185 tests pass).
ADR-0005 三阶段路线 Phase 1 (CLI) done, Phase 2 (MCP server) next.

Three atomcode deep research runs informed this ADR:
1. MCP server TypeScript implementation (9 searches, 9 source reads, 5 domains)
2. context-mode full architecture (13 searches, 17 full reads, 17 sources)
3. MCP tool design best practices (19 searches, 28 sources, 5 angles)
4. Time decay / memory edge effect (17 searches, 14 full reads, 24 sources)

Key findings:
- Official @modelcontextprotocol/sdk is the only industrial-safe choice (all production
  servers use it; mcp-framework and fastmcp-ts have no production deployments).
- context-mode = "one kernel, two facades" (CLI + MCP same src, esbuild 5 units).
  Our mental model follows this: same kernel, MCP server wraps it.
- Industry converges on 4-8 tools; 40+ tools cause severe agent selection degradation.
- Three-layer retrieval (memory + realtime + RAG) has production precedent (Perplexity
  Web/Org Files Focus selector, Microsoft Foundry IQ agentic retrieval).
- Time edge effect = three mechanisms, not one function (Mem0 decay, Zep bi-temporal,
  Google QDF — each handles different staleness patterns).

## 决策 (Decision)

### Decision 1: MCP server = context-mode mental model (Route B)
MCP server exposes context-management tools, not business tools. Main Agent calls
ans_search -> results auto-index to FTS5, only distilled summary enters Agent context.
Same mental model as context-mode but specialized for information retrieval.

### Decision 2: Time Edge Effect — Full three-layer (Scheme C)
Research Memory layer (FTS5) uses:
1. Exponential half-life decay: BM25 × exp(-Δt/τ), τ tiered (7d news / 30d docs /
   90d evergreen), floor 0.3, w=0.15~0.4.
2. Bi-temporal invalidation: new result for same entity closes old record's
   valid_until at write time (not relying on decay to suppress staleness).
3. QDF query classification: time-sensitive keywords (最新/最近/news/2026) boost
   freshness; evergreen queries (什么是X) disable decay.
4. Pinned exemption: user/domain-pinned results bypass decay.
References: Mem0 Memory Decay (1.5×/0.3× band), Zep bi-temporal (arXiv:2501.13956),
Google QDF, OpenClaw #5547, STALE paper (arXiv:2605.06527).

### Decision 3: 5 MCP tools — layer × depth grid
| Tool | Layer | Purpose |
|------|-------|---------|
| search_web | Realtime web | Multi-source fanout retrieval, auto-index to FTS5 |
| research_web | Realtime web (deep) | Minute-level deep research, structured citations |
| recall_memory | Research Memory | FTS5 memory recall with time edge effect |
| query_knowledge | Enterprise RAG | Domain-specific knowledge base retrieval |
| ans_chat | Combined | PiAgentRuntime agent loop, auto-orchestrates 3 layers |

No store_memory tool (Agent is read-only consumer). No single unified search_all tool
(layers must be visible per Perplexity precedent). Naming: snake_case, flat params
(query/limit/provider/recency), service prefix if needed.

### Decision 4: Dual transport (stdio + Streamable HTTP)
CLI switch: ans mcp serve --transport stdio|http.
- stdio: StdioServerTransport (default for local Agent integration).
- http: express + StreamableHTTPServerTransport, stateless (sessionIdGenerator:
  undefined, enableJsonResponse: true, keepAliveMs: 0).
- Constraint: one Server instance per transport, buildServer() factory per request.
References: context7 production mode, official SDK discussion #1677.

### Decision 5: SDK v1 stable (@modelcontextprotocol/sdk ^1.x)
v1 is stable, tavily-mcp production-tested, full docs. v2 (@modelcontextprotocol/server)
deferred until mandatory upgrade reason. TypeBox (not zod) for tool schemas — manual
JSON Schema definition, similar to tavily-mcp low-level approach.

### Decision 6: New apps/mcp package
Independent package with own package.json, tsup.config, dist/.
CLI adds ans mcp subcommand that forwards to apps/mcp entry.
MCP server reuses createEngine() from packages/kernel (lift from apps/cli/composition.ts).

### Decision 7: createEngine() lifted to packages/kernel
Composition root factory createEngine(domain?) moves from apps/cli/src/composition.ts
to packages/kernel export. Both apps/cli and apps/mcp import from @anysearch/kernel.
Zero duplication — same factory, same engine, same domain config.

## 备选方案 (Alternatives Considered)

1. Route A (business tools: search/chat/llm) — rejected: pollutes main Agent context,
   defeats context-mode mental model purpose.
2. Time decay scheme A (simple BM25 × exp only) — rejected: ignores staleness in
   high-relevance facts (STALE paper: 68% stale top-1 hits).
3. 3 tools (one per layer) — rejected: no depth dimension, loses research_web
   minute-level deep research capability.
4. 6 tools (add store_memory) — rejected: breaks read-only Agent consumer model.
5. 1 unified search tool — rejected: layers must be visible (Perplexity precedent),
   users need source control.
6. stdio only — rejected: HTTP transport needed for remote/network Agent integration.
7. v2 SDK — rejected: docs migration incomplete, TypeBox compatibility unverified,
   no production deployment yet outside context7.
8. apps/cli subcommand (no new package) — rejected: coupling prevents independent
   MCP server packaging/distribution.
9. Duplicate composition root in apps/mcp — rejected: violates DRY, createEngine()
   belongs in kernel as it's shared infrastructure.

## 后果 (Consequences)

正面:
- MCP server follows context-mode mental model: saves main Agent context window,
  auto-indexes to FTS5, returns distilled summaries.
- 5 tools in industrial sweet spot (4-8 range), avoids 40+ degradation cliff.
- Time edge effect handles both low-relevance noise (decay) and high-relevance
  staleness (bi-temporal invalidation) — the two failure modes that pure decay misses.
- Dual transport maximizes Agent integration surface (local stdio + remote HTTP).
- v1 SDK stable, production-tested, manual JSON Schema avoids zod dependency.
- createEngine() in kernel = single source of truth for engine construction.

负面:
- 3 atomcode research runs cost ~20 min total (mitigated: all indexed in FTS5,
  reusable for implementation phase).
- Express dependency for HTTP transport (mitigated: only loaded when --transport http).
- Bi-temporal invalidation requires entity tracking in FTS5 schema (new column
  valid_until + entity extraction logic — deferred to implementation, not in scope
  of this ADR's architectural decisions).
- TypeBox manual JSON Schema is more verbose than zod (mitigated: tavily-mcp
  proves this is viable; switch to zod if SDK v2 upgrade happens).

关联: ADR-0005 (三阶段路线), ADR-0006 (组合根), ADR-0007 (pi-agent-core 集成).
*End of ADR-0008*
