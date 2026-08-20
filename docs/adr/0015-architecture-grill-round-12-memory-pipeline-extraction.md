## ADR-0015: Architecture Grill Round 12 — MemoryPipeline Deep Module Extraction

### Status
Accepted

### Context
PiAgentRuntime shouldStopAfterTurn method inlines ~200 lines of memory logic (L0 dual-track trigger / REUSE/COMPRESS NOOP adjudication / gap distillation / IR summary write-read / L2 FTS5 recall / sufficiency gate gap re-search). Three state variables (lastSearchTurn / consecutiveReuses / lastSummaryMsgCount) are scattered as closure variables.

atomcode research (15 searches / 11 full reads / Mem0+Zep+Letta+MemGPT+Ousterhout five-party consensus) + ctx_fetch_and_index research (5 sources: Mem0 official integration docs / Letta blog / Ousterhout CS190 lecture / pi-agent-core README / Letta Forum four-way comparison) confirmed:

- No industry best practice inlines memory pipeline in agent loop body
- Ousterhout: textbook temporal decomposition (information leakage antipattern)
- pi-agent-core host contract semantics for shouldStopAfterTurn is "stop decision callback", not memory subsystem host

### Decision

**D1: Extract MemoryPipeline deep module (Q1=A)**
Move shouldStopAfterTurn and transformContext method bodies into packages/kernel/src/memory-pipeline.ts. Hooks degrade to 2-line delegation. Behavior byte-for-byte preserved — fire-and-forget timing, fail-open semantics, next-turn-effective all preserved as-is. Not adopting Mem0-style independent service (out-of-process complexity) or Letta-style full stateful runtime (conflicts with host).

Academic anchors: Mem0 add/search/get-all minimal API surface, Zep independent graph service encapsulation, Letta sleep-time decoupling of "bundled single agent" antipattern, Ousterhout CS190 deep module criteria, pi-agent-core hook contract semantics.

**D2: Domain-semantic naming attach/inject/consolidate (Q2=A+)**
Interface surface 3 methods:
- attach({store, models, retriever, domain, sessionId}) — initialization, dependency injection
- inject(messages): Promise<AgentMessage[]> — hot path read, corresponds to transformContext delegation
- consolidate(ctx): Promise<boolean> — cold path write, corresponds to shouldStopAfterTurn delegation

Not using preTurn/postTurn (temporal naming, temporal decomposition antipattern moved to interface). Not using single-method unified entry (option C, temporal decomposition moved inside). Domain-semantic naming ensures interface does not leak host hook details — pipeline interface unchanged when switching hosts.

Academic anchors: Ousterhout "It's more important for a class to have a simple interface than a simple implementation"; Mem0 integration pattern "step beginning retrieval + step end writeback" maps to inject/consolidate.

**D3: SufficiencyGate as sibling module extracted simultaneously (Q3=A)**
SufficiencyGate extracted to packages/kernel/src/sufficiency-gate.ts, sibling to MemoryPipeline. Gate manages "is information sufficient" (LLM gap generation + re-search loop), memory manages "what to remember/forget" (summary write + recall). Two independent fail-open, non-blocking.

Post-extraction architecture:
```
PiAgentRuntime
  pipeline: MemoryPipeline (attach/inject/consolidate)
  gate: SufficiencyGate (evaluate/enhance)
  hooks: transformContext -> pipeline.inject
         shouldStopAfterTurn -> pipeline.consolidate + gate.evaluate
```

Academic anchors: ADR-0014 D2 Google SCA / CRAG grader independent component precedent; Ousterhout different interfaces (gate takes FusedEnvelope + messages, memory takes messages + store) should not be mixed.

**D4: IR Summary Schema extracted to independent shared constant module (Q4=A)**
Extract packages/kernel/src/ir-schema.ts, exporting IR_SEGMENTS array + IR_CUSTOM_INSTRUCTIONS template. Pipeline and gate share reference. Single source multi-output, reusing ADR-0012 D14 routing-card precedent.

Academic anchors: ADR-0012 D5 IR Summary Schema versioned contract; Ousterhout information hiding corollary — contract is shared knowledge, should have single source of truth.

**D5: All in kernel package, no new package (Q5=A)**
- packages/kernel/src/memory-pipeline.ts (~200 lines)
- packages/kernel/src/sufficiency-gate.ts (~80 lines)
- packages/kernel/src/ir-schema.ts (~10 lines)

Zero new package = zero new config. Kernel currently ~1000 lines, after addition ~1300 lines, within Ousterhout 200-2000 line normal range.

Academic anchors: Ousterhout opposes classitis (shallow class proliferation), same logic applies to package level.

**D6: Behavior conservation + existing tests unchanged + new independent unit tests (Q6=A)**
Existing 221 tests unchanged as regression baseline, proving behavior conservation. New packages/kernel/test/memory-pipeline.test.ts independent unit tests: four exits (REUSE/COMPRESS/cap/failure) + state reset + fire-and-forget timing verification. Using assert + mock streamFn pattern, no new test framework.

Academic anchors: The Complexity Trap (arXiv 2508.21433) "extraction does not change behavior" is safe refactor prerequisite; Ousterhout "The interface is the test surface".

**D7: Strict behavior conservation, move only no debt fix (Q7=A)**
Extraction = move commit. Debt fix = independent commit. Mixing debt fix makes diff "move + behavior change" hybrid, reviewer cannot distinguish. Known debts (#1 models undefined / #6 function-calling / #9 sufficiencyMaxRerounds / #10 control booleans) left to future grill mental model.

**D8: Constructor internally creates pipeline + gate, opts unchanged (Q8=A)**
PiAgentRuntime constructor internally creates pipeline and gate instances:
```typescript
this.pipeline = new MemoryPipeline({ store, models, retriever, domain, sessionId });
this.gate = new SufficiencyGate({ retriever, domain });
```
PiAgentRuntimeOptions unchanged, zero caller changes. Hooks degrade to delegation.

Academic anchors: pi-agent-core new Agent(config) pattern (constructor receives config, internally assembles everything); ADR-0006 D3A Composition Root (composition root responsible for wiring); Ousterhout information hiding (caller does not need to know how many internal modules).

Supplementary mental model (not implemented this round): future integration testing of PiAgentRuntime vs pipeline interaction may add optional pipeline? / gate? fields to opts. Currently only one consumer, no seam needed (one adapter = hypothetical seam, two = real).

### Consequences
- pi-runtime.ts hooks degrade to 2-line delegation, ~200 lines moved to memory-pipeline.ts
- sufficiency-gate.ts carries ADR-0014 D2/D5 LLM gap generation + re-search logic
- ir-schema.ts extracts IR 5-segment format shared constants
- 3 state variables promoted from closure variables to pipeline instance fields
- Existing 221 tests unchanged, new memory-pipeline.test.ts independent unit tests
- Callers (CLI chat.ts / MCP server.ts ans_chat) zero changes
- Known debts not fixed, left to future grill

### atomcode Research Summary
- Q1 research: 15 searches (Exa 8 + Tavily 3 + AnySearch 4) / 11 full reads / 5 angles full coverage / 8 independent domains
- Q2/Q8 research: ctx_fetch_and_index 5 sources (Mem0 official / Letta blog / Ousterhout CS190 / pi-agent-core README / Letta Forum)
- Five-party consensus: Mem0 / Zep / Letta / MemGPT / Ousterhout — none inline memory pipeline in agent loop body

### References
- Mem0 official integration docs: https://mem0.ai/blog/how-to-create-ai-agents-with-long-term-memory
- Letta blog: https://www.letta.com/blog/agent-memory/
- Ousterhout CS190 lecture: https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign
- pi-agent-core README: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md
- Letta Forum four-way comparison: https://forum.letta.com/t/agent-memory-letta-vs-mem0-vs-zep-vs-cognee/88
- MemGPT paper: arXiv 2310.08560
- The Complexity Trap: arXiv 2508.21433
- ADR-0010 D1 (hot-cold dual hook split), ADR-0012 D5 (IR Schema), ADR-0012 D14 (routing-card single source), ADR-0013 D11 (four-exit tests), ADR-0014 D2 (gate belongs to agent loop), ADR-0014 D7 (single computation source dual output)
