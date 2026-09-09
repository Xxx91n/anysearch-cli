# ADR-0053: Architecture Grill Round 50 - Content Trust Boundary and Indirect Prompt Injection Defense

Status: Accepted.

## Context

Rounds 1 through 52 established a vertical information-specialist Agent CLI with layered memory, multi-arm weighted RRF, preregistered evaluation governance, tamper-evident access events, attribution calibration, and an observability closed loop under the Context Engineering total frame (ADR-0052). Industrial cross-checking found memory, evaluation, and context curation to be at or ahead of the frontier.

The one structural gap with zero coverage is the trust boundary around content the agent does not author: retrieved pages, tool outputs, and memory recall flow into LLM judgment paths (gap distillation, NOOP adjudication, episodic-to-semantic consolidation, claim attribution, sufficiency judge) as raw bytes. Indirect Prompt Injection (IDPI) is OWASP LLM01 for three consecutive years, was disclosed as an RCE-class vector in 2026-05, is weaponized in the wild (Unit 42, 22 payload families), and is mandated by EU AI Act Article 15 for high-risk systems from 2026-08. This round adopts the missing Content Trust Boundary mental model without re-litigating the existing seams.

## Decision

### D1 Defense Architecture: Probabilistic Marking + Deterministic Boundary
Adopt a layered combination, not a single solution. L0 single-LLM source classification (Spotlighting-style) reduces risk at zero extra LLM cost; L1 schema validation gives a deterministic input gate; L2 fail-closed authorization bounds blast radius. Dual-LLM isolation extraction is deferred to P1 and applied only to the memory-consolidation path. Instruction-hierarchy-capable models are a precondition.

### D2 Source Label and Provenance
Use a FIDES-style `{source, traceId}` dual-axis label where `source ∈ {system,user,retrieved,tool,memory}` carries trust and `traceId` carries correlation only. Three structural attachment points: retrieval ingress tags every fused result; gap distillation propagates a tagged object (bare string is rejected at the type level); the memory write path persists `source_label` plus `trace_id` and refuses unlabeled writes. Four propagation invariants: non-strippable, strictest-merge (`combine_labels`, untrusted wins), summary inherits label, and explicit downgrade only through the user channel or a quarantined LLM. Tamper-evidence reuses access-chain `CHAIN_FIELDS` (add `source_label`, `schema_version` 1 to 2) and emits `anysearch.source` through the ADR-0052 OTLP mapping layer.

### D3 Input Gate: Sanitization + RetrievalContentSchema + JSON Wrapping
Use a fixed-point sanitization pipeline: NFC normalize, strip the zero-width family, Unicode Tag U+E0000-E007F decode-rescan, bidi strip, optional confusable folding (off by default), then iterate until no change. Validate the result with a versioned TypeBox `RetrievalContentSchema` (`additionalProperties:false`, url/title/snippet/entity whitelist and length caps, validated after sanitization). Wrap untrusted content in an Anthropic-style `tool_result` block with JSON encoding as the primary boundary; a `<retrieved>` label is a semantic outer marker only. Dual-layer disposal: shape violations fail-closed as `skipped`; suspicious content degrades to a stripped summary; explicit user raw-view is allowed but flagged `user_viewed_raw`.

### D4 Fail-Closed Authorization
Meta Rule of Two is the umbrella: this CLI combines untrusted input, a sensitive memory store, and external state change, so only authorization narrowing is sound. Use three default-deny, deterministic, zero-LLM authorization points. A memory write requires secret guard plus evidence at least 0.6 plus a new source-gate (retrieved/memory-derived never promote T0). B URL consumption requires a user-sourced URL or a static domain allowlist (`[sources]` TOML), with retrieved-derived URLs as the sole human-in-the-loop escalation. C LLM judgment input asserts the L1 pipeline produced a tagged non-empty object. Data flow is one-way: sufficiency gate, L1 sanitization, C assertion, LLM judgment.

### D5 INJECT Probe Suite
Adopt a five-family golden eval closure: INJ-1 invisible characters, INJ-2 instruction injection, INJ-3 tool-output plus URL egress, INJ-4 memory poisoning, INJ-5 combined adaptive. Samples are public first-party payloads plus production backflow, deduplicated by `canonicalPayload` to SHA-256; the LLM synthesizes cases but never labels. Judgments are deterministic boolean assertions with `passRate == 1` as the only hard gate; ASR is observational-only. Probes register as `inject_*` op types in `golden-cases.ts` and run through the existing eval runner and ship-gate step 2.

### D6 Deferred Items
Six deferrals carry explicit triggers: dual-LLM isolation and Spotlighting encoding are P1 (triggered by INJ-4 or INJ-1 golden failures); confusable folding, ASIDE, TaintBench alignment, and an adaptive-probe budget cap are P2 (triggered by observed evidence).

### D7 Scope Contract
The next fixer round owns implementation and packaged-process smoke: six implement items (sanitizeRetrieved pure pipeline, RetrievalContentSchema, source label propagation, source-gate, URL allowlist, INJECT probe ops), five verification items (typecheck, eval zero-regression, ship-gate, access-chain migration drill, probe minimal set), and six non-goals (all P1/P2 items plus physical separation from the observation store).

## Rejected

- Semantic cache: long-tail one-shot query distribution; 3-7% false positive risk exceeds benefit.
- Guardrails frameworks (NeMo/Guardrails AI): too heavy for a CLI; existing fail-open plus secret guard plus quarantine already cover the shape.
- Full GraphRAG: proven unnecessary; the KG-lite fifth arm already captures the win.
- A2A / multi-agent: ADR-0052 D6 deferral stands; no out-of-process consumer.
- Managed Prompt Shields: a local-first CLI has no managed service; the deterministic layer is self-implemented.

## Consequences

The CLI gains a structural trust boundary around all non-user-authored content, closing the highest-risk industry gap without a second LLM or a new gate. It reuses TypeBox, the hooks whitelist, PDP/PEP, the STALE eval harness, access-chain, and the OTLP mapping layer. Sanitization and schema add deterministic latency on the retrieval fanout path; probe failures are the signal to escalate to P1/P2. Label propagation changes `distillGap` from a bare string to a tagged object, which is the smallest first-version edit.

## Implementation Plan

1. Land this ADR, the seven CONTEXT.md terms, and the r50 audit-checklist block (docs-only).
2. Add the `sanitizeRetrieved(envelope)` pure pipeline and `RetrievalContentSchema`.
3. Change `distillGap` to return a tagged object and thread `{source, traceId}` through judgment paths.
4. Add the source-gate to the memory write path and the URL allowlist to tool consumption.
5. Register the five `inject_*` probe families and fingerprint them.
6. Add access-chain `source_label` (`schema_version` 1 to 2) and `anysearch.source` OTLP emission.
7. Run typecheck, package tests, ship-gate, pack, CLI/MCP smoke, and native integrity checks.
8. Record packaged-process trace/eval/probe evidence in the fixer handoff.

## Acceptance

1. Zero regression: existing golden cases pass (`passRate == 1`); `inject_*` ops form an independent group.
2. Type/pack/smoke: `tsc --noEmit`, `turbo build/test`, three-platform tgz install, stdio initialize, no-env fail-fast.
3. Probe minimal set: each of the five families lands at least one golden case and exits 0.
4. Access-chain `schema_version` migration drill passes with an independent verifier.
5. Fail-open preserved: retrieval fails open; injection fails closed.

## Research Sources

- Microsoft Agent Framework Security (FIDES) - learn.microsoft.com/agent-framework/agents/security
- Securing AI Agents with Information Flow Control (FIDES) - arxiv.org/abs/2505.23643
- Defending Against IPI with Spotlighting - arxiv.org/abs/2403.14720
- The Instruction Hierarchy - arxiv.org/abs/2404.13208
- Anthropic prompt injection defenses and jailbreak mitigation - anthropic.com/research + platform.claude.com
- How Microsoft defends against indirect prompt injection - microsoft.com/msrc/blog/2025/07
- Microsoft Zero Trust for AI - microsoft.com/security/blog/2026/03/19
- Meta Practical AI Agent Security (Rule of Two) - ai.meta.com/blog/practical-ai-agent-security
- NCSC: prompt injection is not SQL injection - ncsc.gov.uk
- OWASP LLM01:2025 and ASI06 Agentic Memory Poisoning - genai.owasp.org
- Unit 42: Web-Based IDPI Observed in the Wild - unit42.paloaltonetworks.com
- NVIDIA Garak; ETH AgentDojo (arxiv.org/abs/2406.13352); NeuroTaint/TaintBench (arxiv.org/abs/2604.23374)
- AWS CloudTrail log integrity; NIST SSDF; OWASP SAMM
