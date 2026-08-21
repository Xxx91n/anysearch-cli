# ADR-0016: Architecture Grill Round 13 — Temporal Decoupling & Pure Function-ization

### Status
Accepted

### Context
ADR-0015 extracted MemoryPipeline + SufficiencyEvaluator + IR Schema from pi-runtime.ts as deep modules. The extraction was move-only (D7), leaving two known debts:
- #13: Temporal coupling between gate.evaluate() (modifies messages in-place) and pipeline.consolidate() (depends on side effect)
- #14: signalSearchTurn() carries temporal naming residue (passive-aggressive command per Fowler)

atomcode research (13 searches / 17 reads / 12 sources including GAM ACL 2026, LangMem, CRAG, Mem0 V3, Zep, Letta, SEP-2567, Google/Cloudflare MCP stateless blogs) confirms:
- LangMem: core API must be side-effect-free; ordering belongs to integration layer
- CRAG/LangGraph: evaluate-then-consume dependency is graph structure, not implicit sibling call order
- GAM (ACL 2026): semantic-divergence trigger replaces arbitrary signal methods
- Fowler: signalSearchTurn() is "passive-aggressive command" — name says signal, behavior is command
- MCP 2026-07-28 protocol is fully stateless (Google + Cloudflare official); instance fields reset per MCP tool call
- SEP-2567: explicit state handle pattern — server owns state, client holds name
- Five systems (Mem0/Zep/LangMem/Letta/GAM) all objectify consolidation state; none use instance fields

### Decision

**D1: Focus on temporal coupling debt before next architecture concern (Q1=A)**
Resolve #13 + #14 before picking next architectural concern. Highest ROI debt clearance at lowest cost.

**D2: Pure function-ize gate.evaluate() and pipeline.consolidate() (Q2=C)**
Remove side effects on shared messages array. Delete signalSearchTurn(). Both methods become pure functions with explicit input/output. Alignment with LangMem "core API without side effects" pattern.

**D3: consolidate() receives explicit hasRetrievalEvidence: boolean parameter (Q3=A)**
Replace signalSearchTurn() instance field with method parameter. Signal detection (gate) and consolidation (pipeline) are cleanly separated per GAM encoding/integration decoupling.

**D4: gate.evaluate() returns envelope object, gate provides applyTo() injector (Q4=A, Q6=A)**
gate.evaluate() returns `{gaps, reSearchResults, hasRetrievalEvidence}` envelope. gate.applyTo(messages, envelope) injects envelope into messages. Orchestration layer calls gate.evaluate() → gate.applyTo() → pipeline.consolidate() without touching envelope internals (claim-ticket pattern).

**D5: ConsolidationState pure type + hadSearchTurn parameter + local const for snapshot (Q5=C+B hybrid)**
`ConsolidationState = {version: 1, consecutiveReuses: number, lastSummaryMsgCount: number}`. `hadSearchTurn` as parameter. `msgCountAtTrigger` as local const. State serializable for MCP. MemoryPipeline.consolidate becomes shell (fire-and-forget + state persistence). Based on: arXiv:2603.07670 POMDP belief state formalization, Functional Core/Imperative Shell (Bernhardt), GAM explicit state machine, MCP stateless protocol.

**D6: hook内顺序调用, fire-and-forget保留 (Q7=A)**
Three-line sequential call in shouldStopAfterTurn hook: `const env = gate.evaluate(...); const enriched = gate.applyTo(messages, env); pipeline.consolidate({messages: enriched, hasRetrievalEvidence: env.hasRetrievalEvidence, state})`. consolidate fire-and-forget (.then().catch()). Single caller, no abstraction layer needed.

**D7: saveAnchor persistence + in-memory cache dual-write + UPSERT (Q8=A+UPSERT)**
ConsolidationState persisted via `saveAnchor(sessionId, "consolidation_state", state)` with UPSERT semantics (UPDATE-else-INSERT by session_id + anchor_type). version field as CAS guard. CLI mode uses instance field cache (fast path), MCP mode restores from anchor per call. No sessionId → in-memory fallback (fail-open, ADR-0009 D6). FTS5 table rejected (no UPDATE semantics, would pollute full-text search).

**D8: Pure function returns decision + summaryRequest, shell executes LLM (Q9=A)**
`consolidate(state, messages, totalTokens, hadSearchTurn) → {state', decision: "skip"|"reuse"|"compress", summaryRequest?: {gap, prevSummary, msgCountAtTrigger}}`. Shell calls generateSummaryWithUsage(summaryRequest), writes FTS5 + anchor. Pure function does decision logic only, shell does I/O. Functional Core / Imperative Shell pattern.

**D9: Pure function tests + shell integration tests + existing tests adapted (Q10=A)**
Three-layer: (1) pure function consolidate() assertions with zero mock; (2) gate.evaluate + applyTo pure function tests; (3) MemoryPipeline shell integration tests (fire-and-forget + anchor + fail-open). Existing 38 memory-pipeline tests adapted to new signatures, 79 pi-runtime tests adapted to hook chain. Behavior conservation verified by adapted tests passing.

**D10: saveAnchor UPSERT addition (Q8 supplement)**
Add UPSERT semantics to saveAnchor for state-type anchors (consolidation_state). Historical anchors (rolling_summary) remain append-only. version field serves as CAS guard per Fastio recommendation.

### atomcode Research Summary
- Round 1 (Q1-Q5 audit): 12 sources, 5 angles, 5 systems compared (Mem0/Zep/LangMem/Letta/GAM)
- Round 2 (D1-D5 audit): 36 sections indexed, D1-D5 confirmed no mental model violations
- Round 3 (Q8 persistence): 8 primary sources (SEP-2567, Google blog, Cloudflare blog, LangGraph docs, Hindsight, MCP security, Confluent dual-write, Fastio)
- Key finding: four systems (Mem0/Zep/LangMem/Letta) do NOT persist consolidation decision counters — they persist memory content; our ConsolidationState is unique but fail-open semantics make it safe

### Consequences
- gate.evaluate() and pipeline.consolidate() signatures change (breaking interface change)
- signalSearchTurn() deleted (debt #14 resolved)
- ConsolidationState type introduced (new type in kernel)
- saveAnchor gets UPSERT capability (minor API enhancement)
- Existing 174 tests require adaptation (signatures changed)
- MCP stateless mode fully supported via anchor persistence
- Two future directions noted: (1) RL-based memory strategy (AgeMem/DeltaMem), (2) COMPRESS evolving to IR 5-segment incremental update

### References
- LangMem: https://langchain-ai.github.io/langmem/concepts/conceptual_guide
- CRAG: arXiv:2401.15884
- GAM: arXiv:2604.12285 (ACL 2026)
- Zep: arXiv:2501.13956
- Mem0 V3: https://docs.mem0.ai/api-reference/memory/add-memories
- Agent Memory survey: arXiv:2603.07670
- MCP Stateless: https://blog.modelcontextprotocol.io/posts/2026-07-28
- SEP-2567: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2567-sessionless-mcp.md
- Google MCP: https://developers.googleblog.com/scaling-ai-agent-infrastructure-with-the-mcp-stateless-updates
- Cloudflare MCP: https://blog.cloudflare.com/mcp-v2
- Fowler Event-Driven: https://martinfowler.com/articles/201701-event-driven.html
- Functional Core/Imperative Shell: Gary Bernhardt
