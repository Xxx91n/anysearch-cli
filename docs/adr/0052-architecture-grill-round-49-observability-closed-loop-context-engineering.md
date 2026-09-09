# ADR-0052: Architecture Grill Round 49 - Observability Closed Loop and Context Engineering

Status: Accepted.

## Context

Rounds 1 through 51 established the domain vocabulary and architecture as a vertical information-specialist Agent CLI. The current model already includes layered memory, multi-arm weighted RRF, preregistered evaluation governance, tamper-evident access events, and ship-gate evidence. Three independent research passes concluded that this combination is already at the industrial frontier for a retrieval-specialist Agent. The remaining high-priority gap is not a missing subsystem, but an explicit observability mental model that connects runtime traces to evaluation and experiment assets.

The OpenTelemetry GenAI semantic conventions are the industrial reference point, but the dedicated `open-telemetry/semantic-conventions-genai` repository remains unreleased: the GenAI vocabulary is Development-only, the schema URL is still TODO, and the conventions have had multiple breaking renames. The correct adoption posture is therefore version-pinning and a versioned internal representation, not direct coupling to the volatile external namespace.

## Decision

### D1 Total Frame: Anthropic Context Engineering

Adopt Anthropic "context engineering" as the total frame for the existing architecture. `L0/L1/L2` memory, compaction, and injection are context curation; multi-arm weighted RRF and sufficiency gate are context assembly; preregistered eval, holdout, and calibration are context quality measurement; this round's observability loop is context telemetry. This is a retrospective name for existing assets, not a new subsystem.

### D2 Semantic Pin

Pin `open-telemetry/semantic-conventions-genai` at commit `b5d8440f6f126738fd50f927752cd669772c517b` (2026-09-09). Record `open-telemetry/semantic-conventions` tag `v1.42.0` (`ae3a98640194ed405c4c797281502e4d3bd258b3`) as the last versioned GenAI snapshot before the conventions moved to the dedicated repository. MCP semantics are introduced in tag `v1.39.0` (`6d05e92070f0a5c9a5bbcd396d2ebe2103377f8c`). Implementation must carry a tested-with table for semantic repo commit, OTel SDK, exporter, and local backend, and must not claim a stable GenAI namespace.

### D3 Local-First Observation Asset

Use the existing single-process, local-first architecture for a future local SQLite trace store. One user task is one trace; generation and evaluation records are observations; rubric items are scores; `runId` deduplicates replay. Content capture is opt-in and policy-first, with external storage plus span reference as the production default.

### D4 Internal Representation and OTLP Mapping Layer

Define a versioned internal observation representation as the schema contract. Exporters map that representation to `gen_ai.*` at the boundary. Custom attributes use reserved `anysearch.*` and `eval.*` domains and never claim `gen_ai.*`.

### D5 Trace-Eval-Experiment Semantics

`gen_ai.evaluation.result` may carry an evaluation result, but it does not perform evaluation. Judging, preregistered gates, holdout, and calibration remain the existing governance path. Production traces feed eval, failures feed golden reflow, and experiments feed deployment only through ship-gate.

### D6 Multi-Agent Deferred

The current single-agent vertical runtime remains correct. Multi-agent delegation, A2A, and cross-agent trace propagation are explicitly deferred until an out-of-process agent consumption scenario exists. Reopen with ownership, delegation-safety, and trace-identity requirements.

### D7 Scope Contract

This round is documentation-only. The next fixer round owns the local trace store schema, observation collector, eval-runner wiring, exporter mapping layer, ship-gate observation assertions, and L1-L5 packaged-process verification.

## Rejected

- Changing product source in this grill round.
- Bundling DDD subdomain classification or fitness-function naming into this ADR; those are separate future themes under ADR-0029 scope discipline.
- Adopting the unreleased `gen_ai.*` namespace as a long-lived internal schema.
- Introducing multi-agent delegation in this round.
- Introducing event-driven infrastructure such as an outbox, message broker, or saga layer; the single-process append-only access-event and replay design already covers current consistency needs.

## Consequences

- Existing memory, fusion, evaluation, and governance terms gain a coherent total frame.
- The future local trace store has a stable internal contract and a known volatile export boundary.
- Implementation risk from the six-plus observed GenAI semantic renames is reduced by version pinning.
- No runtime behavior changes in this round.

## Implementation Plan

1. Land this ADR, the five CONTEXT.md terms, and the r49 audit-checklist block.
2. Define the local trace store schema and internal observation representation from the pinned semantic commit.
3. Wire CLI and MCP operation spans, generation observations, and evaluation-result observations.
4. Implement an OTLP mapping layer with custom attributes in `anysearch.*` and `eval.*`.
5. Connect production-trace failures to the existing golden/eval reflow boundary without adding a new gate.
6. Add ship-gate assertions that observational assets never enter the eval gate.
7. Run typecheck, package tests, ship-gate, pack, CLI/MCP smoke, and native integrity checks.
8. Record packaged-process trace/eval smoke evidence in the fixer handoff.

## Acceptance

Current round: seven sections, D1-D7, Rejected, Consequences, Implementation Plan, Acceptance, and Research Sources are present; the new ADR and CONTEXT terms are UTF-8 without BOM and preserve LF; no business source changes. Fixer round: local trace store uses the pinned semantic snapshot; `gen_ai.evaluation.result` is representation-only; custom fields stay outside `gen_ai.*`; observational data never enters the gate; packaged CLI and MCP remain alive.

## Research Sources

- OpenTelemetry semantic-conventions-genai repository. https://github.com/open-telemetry/semantic-conventions-genai
- OpenTelemetry semantic-conventions release v1.39.0. https://github.com/open-telemetry/semantic-conventions/releases/tag/v1.39.0
- OpenTelemetry semantic-conventions release v1.42.0. https://github.com/open-telemetry/semantic-conventions/releases/tag/v1.42.0
- Anthropic, Effective context engineering for AI agents. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Langfuse, OpenTelemetry for LLM Observability. https://langfuse.com/integrations/native/opentelemetry
- Greptime, How OTel Traces LLM Calls, Agent Reasoning, and MCP Tools. https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions
- John Hodge, The state of the OTel GenAI semantic conventions. https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions
- TrueFoundry, OTel GenAI Conventions: AI Observability. https://www.truefoundry.com/blog/opentelemetry-genai-semantic-conventions
- AgentTap repository. https://github.com/HongguangLi/agenttap
- Thoughtworks, Fitness function-driven development. https://www.thoughtworks.com/insights/articles/fitness-function-driven-development
