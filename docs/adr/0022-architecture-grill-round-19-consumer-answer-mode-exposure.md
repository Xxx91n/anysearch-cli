# ADR-0022: Architecture Grill Round 19 — Consumer-Layer Answer Mode Exposure

## Status
Accepted

## Context
Retriever contract (packages/retriever/src/contract.ts:4) defines Mode = fast | index | deep | answer. Provider side fully implements answer: Exa answer() endpoint (exa.ts:49-52), Tavily includeAnswer flag (tavily.ts:50-51), AnySearch explicitly no answer mode (anysearch.ts:33-35, ponytail comment). ProviderEnvelope and FusedEnvelope both carry answers: string[]. But consumers (pi-runtime.ts:26-36, search-web.tool.ts:18, cli/commands/search.ts:19) pass mode through while JSON.stringify-ing the whole envelope, never surfacing answers as a first-class output. Deletion test confirms: removing the \"answer\" literal breaks zero tests and changes zero behavior — the capability is declared but invisible. ADR corpora grep shows the answer literal appears only once in ADR-0005:42 describing Tavily SDK capability (\"answer + extract integrated\"); no ADR ever framed answer as a CLI-side LLM-synthesis feature. CONTEXT.md Vertical Agent explicitly says we stand above providers, do not self-index (i.e., CLI should not do its own synthesis for the answer field).

## Decision

**D1: Expose envelope.answers to consumers via a dedicated top-level field (Q1=A)**
Add a first-class answers output to the search tool surface (MCP search_web tool + CLI ans search output). No silent truncation; the contract surfaces answers as part of the response envelope, not buried in raw JSON. Tool schema description updated to state: answer is a provider-side capability, available only when the chosen provider supports it.

**D2: Provider-side answers marked unverified; excluded from Sufficiency Gate computation (Q2=B)**
answers are emitted with explicit metadata {providerGenerated: true, verified: false} flag. SufficiencyEvaluator continues to compute verdict/agreement/volume/spread from results[] only (cheap-signal AUC ceiling ~0.76, ADR-0014 D3); answers must not inflate gate confidence. Rationale: provider-generated text is not verifiable at this layer; treating it as evidence would inflate the gate and damage the Sufficiency-Gated brand. Aligns with LangChain CRAG precedent: self-RAG confidence signals are advisory, not gate inputs.

**D3: answers stay string[]; per-provider source attribution deferred via metadata (Q3=C-modified)**
Envelope's answers field remains string[] (no per-provider wrapping) — the MVP tool-surface consumer (LLM reading the tool response) does not need source labels to use the answer. But FusedEnvelope.metadata gains providerAnswers: Array<{ provider: string; text: string }> for transparency + future UI. Reasoning: product does not yet need per-provider display; YAGNI before one UI surface needs it. Aligns with ADR-0014 D7 perProvider precedent but defers the schema bloat.

**D4: answer mode is provider-only, fail-open, and permanently so (Q4=B)**
No LLM-side fallback synthesis. AnySearch-only future: if the provider does not expose answer, consumer surfaces return answers: [] plus metadata.answersAvailable=false. The fail-open semantic is aligned with ADR-0021 D2 env-var handling (boot layer fails fast, feature layer fails open). The LLM-synthesis path stays exclusively on PiAgentRuntime / ans_chat / research_web (\"multi-round search + LLM synthesis\") — these are the vertical agent's answer surfaces; the answer mode is the retrieval-layer shortcut, not its replacement.

**D5: CONTEXT.md terms: Answer Mode, Answer Provenance, Sufficiency Gate Preserved (this ADR's D1/D2/D3)**
Three new glossary entries recorded. Answer Provenance term references this ADR as authoritative source; Answer Mode says provider-fulfilled; Sufficiency Gate Preserved says answers do not participate in gate computation.

**D6: Rejected alternatives**
- Implement local LLM synthesis for answer mode (rejected): violates Vertical Agent's no-self-index principle and conflates retrieval-layer responsibility with the agent loop's; PiAgentRuntime already owns LLM synthesis.
- Remove answer literal entirely (rejected): the retriever contract's type union is zero-cost; a future provider (including AnySearch) might add it, and removing then re-adding creates churn.
- Wrap answers into per-provider labeled objects in envelope.answers (rejected as MVP): Q3-C was the user's preferred intent (source-preserved structured output); this ADR compromises by adding providerAnswers into metadata without restructuring envelope.answers, keeping the existing contract stable.

## Consequences

- pi-runtime.ts search tool: description updated to clarify answer mode, output adds top-level answers field reading from envelope.answers, details adds providerAnswers array.
- search-web.tool.ts: same exposure.
- apps/cli/src/commands/search.ts: prints envelope.answers when non-empty.
- FusedEnvelope extended with metadata.providerAnswers (new optional field, additive non-breaking).
- SufficiencyEvaluator: unchanged; tests assert answers do not contribute to verdict.
- No new runtime dependencies; purely type-surface change.

## When to revisit
- If AnySearch ships an answer capability, verify the field surfaces verbatim without new code path.
- If user research shows the answer is treated as authoritative despite the verified:false flag, revisit Q2 and consider requiring an LLM fact-check wrapper.
- If a UI surface needs provider attribution, lift Q3 to schema-level providerList by promoting metadata.providerAnswers.


## Amended by Round-47 audit (2026-08-23)

Post-implementation audit (atomcode + manual) surfaced the following deltas against the original D1–D5 text. ADR remains append-only; these are additive clarifications locked to the same gate.

1. **answersAvailable is a CAPABILITY marker, not an OUTPUT marker.** Computed from `provider.modes` in the engine at fan-out time, not from `providerAnswers.length > 0`. Justification: a provider can fail to produce an answer for a given query (quota, exception, empty result) while still advertising answer mode capability. Conflating the two makes consumers misread "zero output" as "capability absent".
2. **verified:false and providerAnswers.citations are locked at the contract layer (`ProviderAnswer` alias shared by ProviderEnvelope.answersMeta and FusedEnvelope.metadata.providerAnswers).** Consumers (MCP / pi-runtime / CLI) MUST NOT re-stamp marker fields. One source of truth surfaces citation payloads end-to-end.
3. **Exa answer() failures are now observable on stderr** (fail-open still — search results keep flowing — but no silent swallow). The previous `catch {}` violated "failure must be visible" precedent used by search-web.tool.ts:35 auto-index.
4. **MCP summary output shape is stable**: `answers`, `answersAvailable`, `providerAnswers` always present (empty array / false defaults). SEP-1624 semantic parity between content and structuredContent steers toward stable keys over conditional spread.
5. **Per-call budget reservation under answer mode now counts answer-capable providers as 2 units** (search + answer = two upstream calls). Other modes retain 1-per-provider.
6. **pi-runtime + MCP tool schemas now expose the full Mode union** (`fast | index | deep | answer`); the contract Mode is the single source of truth. Stale "answer (with synthesis)" description updated to match D4.
7. **CLI answer output defaults to full text per D1 "No silent truncation"; optional `ANSWER_CLI_TRUNCATE=N` env var re-enables a cap with an explicit truncation hint.**

These clarifications preserve every original decision (D1–D6); they only tighten how the contract carries them across consumer surfaces.

## Research Sources
Atomcode run this round read ADR-0005 line 42 (Tavily answer+extract integrated), CONTEXT.md Vertical Agent glossary, retriever contract, Exa /answer docs (exa.ai/docs/reference/answer), Tavily search include_answer docs (docs.tavily.com), LangChain Tavily integration docs. Exa and Tavily engines rate-limited during verification; cross-verification fell back to AnySearch plus direct fetch of official documentation.
