# ADR-0035: Grill Round 32 — Entity Relation Layer (KG-lite fifth arm over a closed predicate table)

## Status

Accepted (grill round 32, landed 2026-08-29). Implements Q1–Q7 of the relation-layer interview; research-driven, one question at a time, atomcode-verified on Q3/Q4/Q5/Q7.

## Context

anysearch-cli is an information-specialist, local-first, single-user Agent CLI: SQLite + FTS5, rules-first + LLM-fallback extraction, `valid_until` soft-close discipline, eval-gate-driven development. Four retrieval arms already exist (FTS + trigram expansion + fused freshness + vector semantic arm, ADR-0033), entity linking (ADR-0031), reversible entity merge (ADR-0032), and claim-level answer attribution (ADR-0034).

Missing today: **relations between entities**. The memory store can answer "what is X" but not "who works on what / X depends on Y / who is part of which project". Entities without edges are a fact list, not a knowledge web. Industry research (this round, 30+ primary sources) shows the correct local-first shape is a KG-lite edge layer that feeds retrieval as *recall augmentation*, never as a replacement for text arms (pure-KG retrieval loses to RAG on fine-grained QA, arXiv 2502.11371; Mem0 removed its graph variant in production for 3x latency / 2x tokens at only +2% LOCOMO).

## Decision

**D1 — Relation arm = fifth RRF arm (conditional, weight 0.5, 1-hop, episode backlink).** Query text goes through the existing entity candidate extraction; matched active entities trigger a bidirectional 1-hop edge scan (sampling cap ~100 edges, GraphRAG practical-KG parameters); arm output ids are `episode_memory_id` values so they join the existing `extraArms` RRF path and dedupe against FTS/vector hits naturally. 2-hop and as-of traversal are explicitly P2+ (Graphiti's value zone, not ours yet). Lookup budget guard: single digit ms, two indexed JOINs, no recursive CTE in v1.

**D2 — Closed predicate table (fixed taxonomy).** Relations are a closed set (`works_on / depends_on / uses / part_of / member_of / located_at / authored_by / related_to` seed set), enforced in the DB and in the LLM fallback. Free-form relation phrases (Graphiti-style) are rejected: ctxgraph's benchmark measured relation F1 0.104 (free-form) vs 0.763 (fixed taxonomy). LLM output beyond the table is filtered by strict post-validation; new predicates enter only via eval-gated migration (see D5). A closed alias table maps surface forms (incl. Chinese synonyms) to canonical predicates — alias mapping is deterministic, never LLM-judged.

**D3 — Single edges table, system-time-only, six patches.** Schema:

```sql
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES entities(id),
  target_entity_id INTEGER NOT NULL REFERENCES entities(id),
  relation TEXT NOT NULL CHECK (relation IN (...)),
  description TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  episode_memory_id INTEGER NOT NULL REFERENCES retrieval_results(id) ON DELETE CASCADE,
  rules_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT
);
CREATE UNIQUE INDEX edges_active_uniq ON edges(source_entity_id, relation, target_entity_id) WHERE valid_until IS NULL;
```

Writing the same (s,r,t) closes the old row and inserts the new row in one transaction (Graphiti-style auto-supersede, but rows are kept = transaction-time-lite). No world-time `valid_from` in v1 (Tem-DocRED/Semantica show LLM time extraction is unreliable; PG18 ships valid-time without system-time — even Postgres stages the expensive half); migration path reserved via additive `ALTER TABLE` + eval-gated `temporal_confidence` discipline. Six patches adopted:
1. Memory cascade: delete cascades to edges; memory *soft-close/quarantine does NOT* cascade — edges survive, query path filters on joined memory validity.
2. **Merge redirects edges**: ADR-0032 `combine()` transaction extends to three actions — memory_entity redirect + edges source/target redirect + merge_log snapshot gains `redirectedEdgeIds` (unmerge basis). Merge never touches edge `valid_until`.
3. `episode_memory_id` is formally defined as `retrieval_results.id` — no hidden episodes table.
4. Closed predicate set lands as `CHECK (relation IN (...))`; switch to a predicates reference table only if the set outgrows ~50.
5. `valid_from` deferred; reserved additive migration, eval-gated.
6. Timestamps stay UTC TEXT, half-open interval `[created_at, valid_until)`.

**D4 — Rules-first + LLM-fallback extraction pipeline, six patches.** New `relation` channel alongside the entity channels: rule layer = preposition/verb patterns (EN + CN) + URL↔handle natural edges + dictionary-channel entity-pair co-occurrence; LLM fallback fires only when rules hit zero AND the sentence links ≥2 entities, emits plain-JSON under `(head_type, relation, tail_type)` triple constraints + strict post-filter (`ignore_tool_usage` semantics); pipeline is staged (entity resolution → relation extraction → edge dedup), never one giant prompt. Budget: hard cap **≤1 relation LLM call per memory write** (same bounded-cost family as MAX_ENTITY_CANDIDATES), expected ≤0.1 calls/write, ~$1.5/yr per 10k memories at mini-tier pricing. Six patches:
1. Failure ladder: one retry degrading `json_schema → json_object`, then fail-open skip + telemetry (write path never blocks).
2. LLM result cache keyed on `(episode_memory_id, text hash)`.
3. `relationTel = {ruleHits, llmActivations, llmFailures, triplesWritten, dedupSkipped, schemaRejected}` telemetry, mirroring entityTel — report-only, never gated (Goodhart).
4. Predicate dedup is two-tier: exact via partial unique index; semantic via closed synonym/alias table only.
5. Merge triple-action (D3 patch 2) restated as pipeline contract; memory-delete vs memory-invalidate paths stay separate.
6. `(head_type, relation, tail_type)` patterns validation table (Neo4j SimpleKGPipeline precedent) checked on insert.

**D5 — Eval & gate: refined option-A.** Golden `relations` group with four assertion types `assert_edge / assert_no_edge / edge_supersede / edge_hop` (mirroring the temporal group's pattern), closed-predicate stratified sampling (≥1 positive per predicate), paired strong negatives, +10–14 case budget; fingerprint flips force recalibration (ADR-0027 D9). Fail-closed immediately: `assert_edge`, `edge_supersede`, fused 1-hop rank regression, allowance via existing `--calibrate` integer floor (CI never rewrites it). Observational one release: `assert_no_edge` precision, `edge_hop` 1-hop hit rate, arm gain metrics, relationTel — budget formulas pre-registered with values blank. LLM fallback layer is evaluated through the ADR-0029 calibration channel; LLM unavailable/connection failure is NOT red (fail-open extension, stubs evaluate the rule path). Predicate table changes = golden changes = fingerprint flip + forced recalibration. Rejected: 2-hop goldens in gate (bridge-confusion trap), judge in ship-gate fail-closed, arm weight via --calibrate (semantic mismatch), process-count gating.

**D6 — Five-step landing order, minimal CLI surface.** (1) eval golden relations group first (ADR-0031 D6: baseline before code) → (2) edges table + migration + combine triple-action → (3) rule extraction channel → (4) LLM fallback seam + dual thresholds + telemetry → (5) fifth arm wiring into RRF (0.5) + ship-gate assertions extended. CLI adds only `relation list` and `relation backfill-relations` under existing command families; no new top-level command group; merge/unmerge flow (ADR-0032) absorbs edge redirects in place.

**D7 — Idempotent backfill + Chinese corpus coverage this round.** New command `ans relation backfill-relations [--apply] [--batch M] [--from-id X] [--limit N] [--reprocess]`, default **dry-run report** (polarity difference vs backfill-vectors' opt-in `--dry-run` is recorded here; the shipped command is NOT changed). Idempotency key = unique index `(episode_memory_id, predicate, subject_norm, object_norm)`; deterministic rules make reruns side-effect free; `--batch/--from-id` keyset pagination; per-batch transaction; exit codes 0/1/2; WAL single-writer + busy_timeout; documented "no concurrent MCP traffic during backfill". `--reprocess` (not `--reset`) re-extracts when `rules_version` bumps, superseding old rows via valid_until (never DELETE). Golden relations group ships with Chinese AND English cases (≥1 per assertion type) this round — verifies the r83 CJK-bigram repair and closes the ADR-0033 Q3 noted gap. Ten patches P1–P10 recorded (idempotency key, rules_version column mirroring `memory_embeddings.model`, pagination/exit codes, write-conflict policy, eval-during-backfill insulation via per-case temp DBs, Chinese predicate alias table, `pendingEdges` telemetry mirroring `pendingVectors`, Chinese goldens this round, flag-polarity memo, documented backfill window semantics).

## Consequences

Positive: entities become a queryable knowledge web; relation arm is pure recall augmentation riding the existing RRF/conditional-activation machinery (no fusion-layer change); every decision extends an existing local discipline (valid_until, Fellegi-Sunter 0.9/0.6 review belt, budget-ledger, Observational cadence) instead of inventing a new one; merge/unmerge reversibility stays complete via snapshot `redirectedEdgeIds`.

Negative/costs: one new table + migration; rule pattern table needs bilingual maintenance; LLM fallback adds a second extraction seam (mitigated by ≤1 call/write cap and fail-open ladder); arm gain is unproven until one observational release (accepted knowingly, same as ADR-0033).

Rejected during grill: free-form predicates (F1 0.104 evidence), full bitemporal (no audit/retention product need, extraction unreliable), reification side-tables (no n-ary need), pure-LLM Graphiti pipeline ($500–2000/yr equivalent, 5–7 calls/episode), pure-rules-only (recall too low; implicit relations invisible), observational-only gating (contradicts ADR-0034 D2 same-round three-part landing), `--reset` destructive backfill, new top-level CLI family.

## Implementation Plan（implementation round 必做）

1. Golden `relations` group (4 assertion types, CN+EN, stratified per predicate) + fingerprint — precedes all code.
2. Migration: `edges` table, partial unique index, predicate CHECK, patterns validation table, `rules_version`.
3. Store: edge CRUD with close+insert supersede semantics; `combine()` triple-action + merge_log `redirectedEdgeIds`; unmerge restores edges.
4. Kernel: relation rule channel (EN+CN patterns, URL↔handle, co-occurrence), LLM fallback seam (triple-constraint JSON, ≤1/write cap, cache, retry ladder, fail-open), relationTel telemetry.
5. Retriever: fifth arm (1-hop, cap 100, conditional activation, weight 0.5, episode_memory_id output) into existing RRF path.
6. CLI: `relation list`, `relation backfill-relations` (dry-run default, exit codes, P1–P10).
7. Ship-gate: extend assertion set (schema/seed checks for edges + golden relations in eval zone); eval runner relations zone with fail-closed/observational split per D5.
8. Docs: CONTEXT.md +3 terms; audit-checklist ADR-0035 section; CHANGELOG.

## Acceptance（实现的共识门）

1. `pnpm check` + `pnpm build` green; kernel/store/cli tests green (incl. merge redirect + unmerge restore edge cases).
2. Eval: relations group runs; fail-closed assertions red on seeded violations; fingerprint flip triggers recalibration path.
3. ship-gate 9-zone clean incl. new relation assertions; CLI packaged tgz boot smoke green (process liveness).
4. `backfill-relations` idempotent: two consecutive `--apply` runs produce zero new edges on identical corpus; `--reprocess` supersedes via valid_until, never DELETEs.
5. Chinese golden cases pass; relationTel counters increment; arm gain metrics present in Observational report.

## Research Sources

- ctxgraph, "SQLite as a Graph Database: Recursive CTEs…" (dev.to/rohansx/sqlite-as-a-graph-database-recursive-ctes-semantic-search-and-why-we-ditched-neo4j-1ai) — fixed vs free-form extraction F1 0.763 vs 0.104; recursive CTE performance bounds.
- Towards Practical GraphRAG (arXiv 2507.03226) — cascaded 1-hop retrieval, 100/200 relation sampling, per-type embeddings, RRF k=60, +15% over vector-only.
- RAG vs GraphRAG systematic evaluation (arXiv 2502.11371) — pure-KG triplet retrieval loses on fine-grained QA.
- Mem0 graph variant study (arXiv 2504.19413) — graph +2% only, 3x latency; production removal.
- Zep/Graphiti (arXiv 2501.13956; getzep.com temporal-KG; graphiti README) — EntityEdge bitemporal model, edge dedup-by-semantics, temporal extraction task, json_schema→json_object degradation, small-model JSON failure warning.
- LangChain LLMGraphTransformer reference — allowed_relationships as (head,relation,tail) triples, strict_mode, ignore_tool_usage, property whitelists.
- Neo4j LLM Graph Builder + neo4j-graphrag SimpleKGPipeline — patterns triple constraints, retry_condition, schema-driven extraction.
- mempalace (github.com/MemPalace/mempalace; knowledge_graph.py source) — SQLite triples, valid_from/valid_to half-open, supersede(), mine/sweep/rebuild three-function backfill, 96.6% R@5 zero-API.
- SQLite WITH RECURSIVE official docs (sqlite.org/lang_with.html) + WAL (sqlite.org/wal.html).
- SQL:2011 temporal cost analysis (Kulkarni, SIGMOD Record) + PostgreSQL 18/19 temporal docs (application-time only, WITHOUT OVERLAPS) + Jamie Lord correction (lord.technology).
- Emegard, "Your graph database will not work…" — reification critique, properties-on-edges pitfalls for LLM text-to-SQL.
- Lettria Text-to-Graph benchmark 2025 — model reliability stratification 3%–99.95%, mini-tier unusable.
- Diaz-Garcia & Amador 2025 RE survey (Springer); Karanikolas 2025 (MDPI); Principe et al. 2025 (LDK) — hybrid rules+LLM consensus.
- Microsoft GraphRAG cost blog; Gustafson GraphRAG cost analysis; GraphPraxis "GraphRAG Cost Cliff" — build-cost dominated by LLM calls.
- Banko & Etzioni 2008 (O-CRF) — rule/pattern precision high / recall low in closed sets.
- DuIE 2.0 + HacRED + InstructIE/IEPile — Chinese closed-schema RE datasets; alias-dictionary evaluation precedent (Genpeng baseline).
- 许浩亮等 2019 (中文嵌套实体关系抽取) — Chinese NER error propagation is the RE bottleneck.
- Elasticsearch Reindex API docs; pg_repack README — idempotent resumable backfill patterns, --dry-run precedent, unique-index requirement.
- Prefect "Idempotent Data Pipelines"; ml4devs backfilling guide — idempotency keys, checkpoints, small batches.
- KGHaluBench (arXiv 2602.19643) — KG hallucination eval, NLI+LLM dual filtering.
- Internal: ADR-0024..0034, gate.ts, entity.ts five channels, attribution.ts CJK-bigram (r83), backfillEmbeddings, golden-cases.ts.
