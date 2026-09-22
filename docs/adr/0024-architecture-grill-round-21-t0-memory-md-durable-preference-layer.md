# ADR-0024: Architecture Grill Round 21 — T0 Hot Zone MEMORY.md Durable Preference Layer

## Status

Accepted. Amends nothing; extends the memory subsystem from ADR-0008 D3 (Research Memory), ADR-0012 (L0/L1 pipeline), ADR-0013 (adjudication), ADR-0019 (TypeBox bridge), ADR-0021 (threshold injection), ADR-0023 (multi-query RRF + transactional adjudication + STALE-lite). Introduces the T0 tier above L0/L1/L2: a small, always-loaded, human-readable preference layer projected from SQLite.

## Context

ADR-0023 D3 left T0 explicitly blocked on adjudication landing; that precondition is now met (fe4487b). Round-52 atomcode landscape research (20 queries / 12 full-text fetches across Exa/Tavily/AnySearch) established:

1. 1500 chars is the claude.ai Profile UI limit; Claude Code MEMORY.md hard limit is 200 lines (issue #25006, silent truncation — a documented anti-pattern we must not copy). Projects instructions ~8K community-reported, not official.
2. Industry form has fully converged: claude.ai / ChatGPT / Gemini / Claude Code all use a small always-resident preference layer; nobody retrieves preferences via search. Retrieval is for long-tail knowledge; preferences must be zero-latency resident (Anthropic "attention budget", "Effective context engineering" 2025-09-29).
3. mem0 retreated from LLM write-path adjudication (paper v1) to deterministic ADD-only (v3 OSS); independent audit: LLM judge found 7/7 conflict pairs but misclassified 100% supersession vs contradiction. Microsoft arXiv:2605.08538: fully deterministic lifecycle achieves 97.2% retention precision, 58% storage cut.
4. CrabTalk 5-product survey (2026-03-08): "agent self-decided memory writes are the biggest failure mode"; dual-store (inspectable markdown + searchable SQLite) is the recommended pattern; aligns with our existing shape.
5. Injection position: position bias exists but is unmeasurable at 1500-char scale; decisions must be driven by host-independence, attention-budget isolation, prefix-cache stability. Claude Code and Cursor both inject via first user message, not system prompt.

## Decision

**D1 (scope, Q1=A+E).** Build T0 MEMORY.md durable preference layer as this round's main track. Quarantine Promotion UX is deferred to the next grill round as a sibling (memory-tier UI lower half). S2 LLM re-rank + AssemblyBudget enters the ADR only as a conditional post-item gated on a STALE-lite recall-failure counter reaching threshold; cross-encoder preferred over LLM reranker when triggered (Redis/Galileo evidence). CJK tokenizer stays a parallel candidate. Sessionless MCP needs no code — a one-line ADR confirmation suffices.

**D2 (storage, Q2=C+a1+b1).** SQLite table is the single source of truth; MEMORY.md is a regenerated materialized projection after each promote/demote (CrabTalk dual-store; Letta MemFS resident layer). MEMORY.md carries an auto-generated header declaring it read-only-by-convention (a1); projection writes are atomic via temp+fsync+rename (b1). No dual-write drift, no reverse reconcile.

**D3 (promote gate, Q3=C-prime).** Two deterministic channels, either suffices: (1) explicit user `/remember` via slash-guard; (2) cross-session correction-event count >=2. Veto: any quarantine record within 30 days; hard-cap overflow parks in quarantine, never squeezes in. Post-gate: TypeBox schema validation (ADR-0019), `modified` timestamp written, any failure fails open to quarantine-not-drop. LLM-reported "high confidence" is explicitly rejected as a gate (pseudo-determinism; mem0 v1->v3 retreat).

**D4 (demote).** d-i conflict-triggered demote to L2 quarantine with `invalid_at` (Zep bi-temporal gold standard, invalid-not-drop). d-iii user manual `/forget` via slash-guard. d-ii is NOT an active time-based demote (identity layer LRU kills long-tail — mtrifonov/Steve Kinney evidence); d-ii is downgraded to eviction-ordering only when the 1500-char/200-line hard cap overflows: deterministic order = least-recently-accessed, then oldest `modified`; evicted entries go to quarantine, recoverable.

**D5 (injection, Q4=C+XML).** Inject as a prefix of the first USER message, wrapped `<user_preferences updated="...">` with markdown list inside — same Stage-1 slot as the existing `[RAG Context]` note in `MemoryPipeline.inject`; ans_chat self-host path renders identical content in identical order via `buildSystemPrompt`. Rationale: host-independent (plugin distribution cannot touch host SYSTEM), does not occupy host SYSTEM primacy budget, turn-2 prefix-cache equivalent, production precedent = Claude Code/Cursor. Position bias (primacy/recency) exists but is engineering-unmeasurable at 1500 chars; XML vs markdown empirical delta <=1.1% so robustness/auditability decide.

**D6 (scope layering, Q5=C+c1-i+c2-i).** Dual-layer: global `~/.anysearch/MEMORY.md` + project `<repo>/.anysearch/MEMORY.md`; merge = key-level override (project wins same-key, distinct keys merge, deterministic like git config); projection artifact is a single merged file, project-scoped when a project context exists, otherwise global. No auto-creation of project files — materialize only on first project-scoped promote. Branch-level isolation is explicitly rejected and deferred to a future grill (insufficient evidence, complexity explosion). <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->

**D7 (hard caps and failure mode).** 1500 chars AND 200 lines, whichever hits first; overflow triggers explicit warning, never silent truncation (issue #25006 lesson). Promotion/demote reversals are logged with provenance (which adjudication event promoted/demoted, when, why) — a pure-file design cannot provide this (INITE criticism), which is why D2 keeps SQLite as truth.

## Consequences

T0 reads are zero-latency, zero-retrieval; FTS5/RRF pipeline keeps long-tail knowledge. Reuses adjudication write path with no new LLM calls. New surface area: one table (scope column), one projection writer (<100 LOC), two slash-guard commands, one injection line. Metrics recommended (defer wiring to product-metrics round): resident-token occupancy, preference hit rate (retrieval-free rate), promote/demote flip rate.

## Implementation Plan

1. `t0_preferences` table (key, value, scope, modified, last_accessed, source, invalid_at) + composite PK (key, scope).
2. Promote gate: adjudication hook for correction-count >=2; slash-guard `/remember` and `/forget`.
3. Projection writer: temp+fsync+rename; global and project render paths; key-override merge.
4. Injection: Stage-1 `<user_preferences>` block in `MemoryPipeline.inject`; identical order in ans_chat `buildSystemPrompt`.
5. Tests: promote both channels, veto paths, demote d-i/d-iii, eviction ordering on cap overflow, atomic write (simulated mid-write crash), projection vs table consistency, injection position/order assertion.
6. Verify: `pnpm -w build`, `pnpm -w test`, `node scripts/ship-gate.mjs`, CLI `--help/--version/doctor` alive.
7. Ship-gate: add T0 smoke probe (boot with seeded preference, assert first user message contains the block).

## Acceptance

- [ ] T0 table + projection landed; MEMORY.md regenerates on every promote/demote.
- [ ] C-prime gate: explicit + correction-count channels both tested; LLM confidence never consulted.
- [ ] d-i/d-iii demote tested; d-ii eviction ordering tested only at cap overflow.
- [ ] Injection at first-user-message Stage-1, identical in ans_chat path; assertion test present.
- [ ] Caps (1500 chars/200 lines) produce explicit warning; no silent truncation.
- [ ] ship-gate T0 probe added and green; full build/test/ship-gate/doctor green.

## Research Sources

Anthropic Effective Context Engineering (2025-09-29); claude.ai Profile limit 1500 (likeone.ai 2026-05-30; unabyss.com); claude-code issue #25006 (200-line MEMORY.md hard limit); MemGPT arXiv:2310.08560; Agent Memory survey Zenodo 20780709 (2026-06-21); TANGLE arXiv:2608.13921; MemConflict arXiv:2605.20926; Microsoft deterministic memory lifecycle arXiv:2605.08538; mem0 blog what-is-ai-agent-memory + discussion #4787; Letta memory blocks docs; Zep bi-temporal invalid-not-drop; CrabTalk persistent-agent-memory survey (2026-03-08); studiomader.it 2026-05-15 six-system comparison; INITE markdown-is-not-agent-memory (2026-06-23); OpenClaw memory system (mem0 blog 2026-04-17); memweave (towardsdatascience 2026-04-16); HN #45329322 SQL memory; HN #47914367 Claude Code auto-memory complaints; Reddit r/AI_Agents 2176-task markdown wiki benchmark; Claude Code memory docs (code.claude.com); Cursor rules docs; Aider conventions docs; SEP-2567 sessionless MCP (2026-03-11); OpenAI conversation-state docs; Google Developers Blog MCP stateless (2026-08-03); Redis/Galileo reranker cautions; deepseek-harness discussion #1456 (trigram vs jieba); SQLite FTS5 docs; zenn FTS5 trigram CJK (2026-05-07); Claude prompting best practices (XML tags); tianpan instruction-position (2026-04-14); AVANDAR U-curve; Steve Kinney forgetting-signal essay; mtrifonov typed decay (HN).
## Amended by — round54 audit (2026-08-26)

**Amendment A1 (D4 d-i semantics correction).**

Original text: "d-i conflict-triggered demote to L2 quarantine with invalid_at".

AtomCode cross-vendor audit (round54) across Mem0 / Zep / LangGraph / LangMem / Claude Code / Cursor shows unanimous industry default: same-key new value on gated promote paths (explicit /remember, or cross-session correction-count >= 2) goes through **in-place supersede** (UPDATE / overwrite), not demote-to-quarantine. Demote/quarantine is reserved for **equal-weight conflicts with no authority signal** - matching ADR-0023 D4 (2) temporal-priority supersede / (3) equal-conflict quarantine - and for veto / eviction paths.

Implementation (packages/store/src/session-store.ts promotePreference -> ON CONFLICT (key, scope) DO UPDATE SET value=excluded.value, invalid_at=NULL, demote_reason=NULL, preserving correction_count and provenance) matches the industry default and is the intended behavior. demotePreference still sets invalid_at + demote_reason (Zep bi-temporal, invalid-not-drop) for d-iii /forget and d-ii eviction-overflow - those cases are unchanged.

Updated decision rule:
- d-i (same key re-promote where the new value passed the C-prime gate) = **in-place supersede**, old value dereferenced.
- d-i' (equal-weight, un-gated, machine-written contradiction) = **demote to quarantine** with invalid_at + demote_reason = "equal_conflict". This path is not yet exercised by ns pref CLI; reserved for future correction-channel auto-detection (ADR-0023 adjudicateMemory already routes these).
- d-iii (/forget) and d-ii (eviction ordering at cap overflow) remain as originally specified.