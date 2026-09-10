# ADR-0054: Architecture Grill Round 51 - ADR-0053 Behavioral Loop Closure
Status: Accepted.
## Context
ADR-0053 established the Content Trust Boundary and INJECT Probe Suite structures but left three defined functions unwired in production call chains and the behavioral abstain layer unbuilt. This round closes the loop: wire the three orphan functions into production seams, add one behavioral abstain smoke as observational track.
## Decisions

### D1 Wiring Topology for ADR-0053 Orphan Functions
Three separate framework seams, one per security concern; single implementation, framework-centralized call.
- **wrapRetrieved** → pi-runtime.ts AgentTool execute return boundary (packages/kernel/src/pi-runtime.ts line 41-43). Replaces bare JSON.stringify with wrapRetrieved JSON payload; Anthropic PostToolUse updatedToolOutput equivalent.
- **assertLlamaInput** → shared assertJudgmentInput wrapper called at five judgment boundaries: gap distillation, NOOP adjudication, consolidation, claim attribution, sufficiency judge. Single implementation, called at each pre-LLM-judgment seam (LangChain before_model / MS Agent Framework AIContextProviders equivalent).
- **shouldAllowUrl** → pi-agent-core beforeToolCall hook. Hydrated with isInteractive() TTY detection, askAllowUrl, Linux/Windows TTY-aware.

### D2 Behavioral Abstain Smoke
Registered alongside inject as observational-only, no gate. Three-tier verdict with short-circuit fallthrough: T1 deterministic access-chain trace assertion (zero cost, runs first) → T2 refusal keyword regex (gate committed) → T3 LLM judge (async sampling, advisory only, llm_fallback on failure).
abstainRate and falseAbstainRate pair-reported in ObservationalZone; absent zone read-only.

### D3 Op Structure and Registry
- CaseOp union gains { op: "abstain"; stage: "retrieve"; family: AbstainFamily; prompt: string; expectAbstain: boolean; expectFingerprint?: string } after inject member.
- EvalGroup union gains "abstain".
- runner.ts runCase switch gains case "abstain": with fingerprint validation and mark() mechanism; zero-regression enforced in gate affirmative cases.
- ObservationalZone gains abstain: { n, abstainRate, falseAbstainRate }.

### D4 HITL CLI Form for shouldAllowUrl
TTY-detect interactive / deny-first headless fallback (sudo template).
- TTY: askAllowUrl → y/N → allow / block + enqueue. Deny-first, no hang.
- Headless: block + reason + terminate + enqueueHitl + ANS_NO_INTERACTIVE check.
- Restore path: "ans hitl review" command prints pending list, --allow-url <host> flag pre-authorizes persistent host allowlist. Claude Code hooks emit hookSpecificOutput.permissionDecision: 'ask'.
## Consequences
- Three orphan functions now have production callers; wire topology uses pi-agent-core's beforeToolCall hook and AgentTool execute return seam.
- Behavioral abstain smoke ships as one observational track; never gates.
- Abstain metrics are ObservationalZone-sibling of answerableFalseRefusalRate, report-only.
- HITL recovery path adds ans hitl review command and --allow-url flag.
## Implementation Plan
1. Land this ADR and CONTEXT.md update (docs-only).
2. Wire wrapRetrieved → pi-runtime.ts:41-43 (AgentTool execute return boundary).
3. Create shared assertJudgmentInput wrapper in content-trust.ts; wire at five judgment boundaries.
4. Wire shouldAllowUrl → pi-agent-core beforeToolCall (isInteractive + askAllowUrl TTY).
5. Register abstain case type in golden-cases.ts (abstain_* ids, group: 'abstain', expectAbstain field).
6. Add runAbstainProbe pure function in eval/abstain.ts (three-tier verdict + llm_fallback).
7. Add ans hitl review command + --allow-url flag.
8. Add ObservationalZone.abstain metrics.
9. Full verification: pnpm -r check/test/build, ship-gate smoke, flushOpen eval.
## Acceptance
1. Zero-regression: all existing golden cases pass; inject cases unchanged.
2. abstain golden case registered and pass (positive + negative abstain).
3. Full verification: check/test/build/ship-gate all pass.
4. INJECT probe suite passRate == 1 (unchanged).
## Research Sources
- pi-agent-core README (jsdelivr) - transformContext, beforeToolCall, AgentTool execute
- Claude Agent SDK hooks docs - PreToolUse/PostToolUse, hookSpecificOutput, permissionDecision
- LangChain middleware overview & PR #34951 - before_model node
- MS Agent Framework agent-pipeline - AIContextProviders, before each LLM call
- AWS Bedrock AgentCore policy docs - before tool invocation, Cedar default-deny
- OWASP Agentic Top 10 2026 - LLM01 input validation before goal/tool
- Anthropic mitigate-jailbreaks - JSON-encode untrusted content in tool_result
- Turnstone judge.py - two-tier heuristic/advisory + llm_fallback
- RefusalBench (EACL 2026) - abstainRate + FRR paired, LLM-as-judge
- OR-Bench (ICML 2025) - over-refusal Spearman rho=0.89
- promptfoo - ASR non-comparable, best-of-K math
- clig.dev CLI design guide - TTY detection, --no-input, --force
- sudo askpass - non-interactive error guide
- pydantic-ai deferred tools - requires_approval -> DeferredToolRequests/Results
- NemoClaw CLI - NEMOCLAW_NON_INTERACTIVE hard reject
- AbstentionBench (GitHub) - abstention_detector contains_abstention_keyword

## Post-Review Audit (round-51 follow-up commit)

Audit: two-axis code review (Standards + Spec sub-agents) plus independent industry-pattern research (agent-dojo / Anthropic mitigation docs / NCSC / MCP elicitation references). Diff base 07cc210 -> f0221a8 (978 lines; exceeds the 500-line audit threshold — declared, not split: single cohesive wiring round).

Found / Fixed / Deferred:

- Found: kernel read process.env.ANS_NO_INTERACTIVE (violates kernel env-read discipline). Fixed: interactivity is now passed in via PiAgentRuntimeOptions.interactive from the CLI composition root; kernel keeps only the isTTY capability check.
- Found: fail-closed assertJudgmentInput inside fire-and-forget paths (fireCompress, noop-adjudication) could throw into the agent loop. Fixed: both wrapped, degrade to skip-compression / skip-adjudication.
- Found: Claude hook trusted `toolInput.userProvided` — a model-controllable flag that nothing ever sets (spoofable and vacuous). Fixed: flag removed; all URLs are gated in the hook, allowlist is the only bypass.
- Found: hook permissionReason told users to run `ans hitl review --allow-url`, which writes the domain TOML — a different allowlist source than the hook's ANS_URL_ALLOWLIST env. Fixed: message now names the env var the hook actually reads. Deferred: single-source allowlist unification (kernel reads TOML, hook reads env today) is intentionally deferred to the next grill round.
- Found: askAllowUrl comment claimed "deny-first on timeout" but no timeout exists. Fixed: comment corrected.
- Found: `ans hitl review --allow-url` with a missing value silently listed the queue. Fixed: exits 1 with an error.
- Found: CONTEXT.md lost its trailing newline. Fixed.
- Deferred (next grill round candidates, from industry-pattern comparison): HITL queue has no deny action, no TTL, and no access-chain audit binding; abstain tier-2 regex is a keyword deny-list and the tier-3 LLM judge is never wired in eval; no missed-abstain metric; envelope unwrap does not re-validate the 4000-char snippet limit at wrap time; persisted allowlist grant is host-wide permanent.
