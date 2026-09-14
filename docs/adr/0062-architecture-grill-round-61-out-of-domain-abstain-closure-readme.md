# ADR-0062: Grill Round 61 — Out-of-Domain Abstain Closure + User-Facing README（docs 域外拒答收口 + 用户向 README 治理）

## Status

Accepted (document round r61). This ADR records the round-61 grill decisions only; source changes land in the fixer round per ticket plan T1–T5. Ledger: `.scratch/grill-round-61/decision-ledger.md` (D-001..D-005, all current, zero revised). Deep-research passes: `.scratch/grill-round-61/q2-atomcode.md`, `q3-atomcode.md`.

## Context

Round-60 (ADR-0061) delivered the docs vertical domain and landed B1–B4 on main; its audit handoff promoted the standing defect `bc0001` to a first-class ticket: the docs domain returns 10 non-allowlist results instead of abstaining on out-of-domain questions. Root cause (verified in atomcode q2): `urlAllowlist` only gates retrieval *after the fact* in `pi-runtime.ts` HITL, and no provider adapter forwards any domain-filter parameter. Separately, npm publication was deferred until B1–B4 completed — that precondition is now met, but the user adjudicated: publication stays deferred until the abstain gap is closed, and the README must become a user-facing quickstart with honest known-limitations.

## Decision

### D1 Round theme = out-of-domain abstain closure + README governance; npm publish deferred (ledger D-001)

Theme = Round-60 handoff candidate 1 (docs domain out-of-domain abstain, bc0001 promoted), plus one documentation ticket: rewrite README.md for actual users. Explicit deferral: npm public release waits until the abstain gap is closed. The README must not cosmetize the unreleased state.

### D2 Dual-gate domain filtering, capability-negotiated pre-filter + authoritative post-filter (ledger D-002; atomcode q2)

Layering:

1. **Pre-filter (entry convergence)**: retriever contract gains `includeDomains?: string[]` + capability flag; tavily adapter sends `include_domains`, exa adapter sends `includeDomains`; brave (Goggles = reranking only) and anysearch providers declare unsupported → degrade to post-filter-only + audit.
2. **Post-filter (authoritative egress gate)**: kernel module adjudicates result URLs by final host using the same `canonicalizeHosts` matching semantics as `url-policy.ts`; deny wins; empty → existing `shouldBridgeToAbstain` → abstain. Policy is resolved per-request from the ADR-0055 single source (lazy mtime reload), never cached in the retriever (AFR tag-freshness lesson: 9.7% re-leak after one policy cycle).
3. **Dual audit**: observation kinds `retrieval.domain_filter.pre` and `retrieval.domain_filter.post`.

Red lines: no `site:` injection into query rewriting (sample-not-inventory semantics); no synthetic filtering for providers lacking domain params. Evidence: TrustNLP 2026 Authorization-First Retrieval (retrieve-then-filter = 86.1% structural leak vs 0 for pre-authorization); Tavily `include_domains` documented as hint-not-blocker with substring pitfalls — hence the local authoritative gate.

### D3 Abstain as a first-class outcome + acceptance criteria 1–6 (ledger D-003; atomcode q3)

Abstain is a successful policy execution, not an error and not a bare empty result.

- **CLI**: one structured line (domain, pre/post filtered counts, which gate fired), **exit 0**; programmable distinction via `--fail-on-abstain` flag, never by default. (grep no-match=1 is documented negative asset — ripgrep #2500 wontfix; host fail-open hooks would swallow a non-zero abstain as hook failure, recreating the very gap being fixed.)
- **MCP/plugin**: `isError:false` + `structuredContent: { abstain: true, reason: "domain_filter_empty", domain, preFiltered, postFiltered }` — the abstain signal must be programmatically consumable by the host agent (MCP spec: actionable feedback belongs in the result; You.com: never retry the same string).
- **Criteria 1–5** (all kept): (1) out-of-domain probe abstains with both audit events; (2) in-domain must-hit with pre-filter send-down evidence; (3) brave/anysearch degradation golden (stub provider, offline-runnable per ADR-0057 D4); (4) cold-domain zero-result golden in eval-looks; (5) Tavily `include_domains` leakage probe — promoted to **mandatory** (Tavily changelog 2026-08: boost soft-mode leaks, Research endpoint is soft preference, subdomain matching is directional) feeding the capability table.
- **Criterion 6 (new)**: abstain rate as an independent observability dimension (`outcome:abstain`), never folded into error counts (You.com missing-vs-exceptions bucketing; inspect_ai `content_filter` stop_reason).
- Assertions anchor the structured `verdict` field, not keyword regexes (regex stays observational-only per ADR-0054); must-abstain and must-hit goldens pair to guard over-refusal. ADR-0054 abstain smoke (observational-only) vs this criteria set (offline golden assertions) must be textually distinguished — not a supersession.

### D4 README = user-facing quickstart, honest 0.0.1 (ledger D-004)

Rewrite README.md per readme-crafter-skill + beautify-github-readme conventions: honest 0.0.1 positioning; install/build/first-run (required API keys, doctor self-check); command examples taken only from actually-re-run evidence; Known Limitations section (out-of-domain abstain in fix, macOS untested, tavily AbortSignal SDK limit). Developer/governance detail compresses behind links. ADR index (SSOT-Derived) is preserved, not deleted.

### D5 Ticket slicing = serial T1 → T5 (ledger D-005)

Serial tickets, each independently revertible (Milestone Serial Slicing, ADR-0061 D3 continuation):

| Ticket | Content | Covers |
|---|---|---|
| T1 | retriever contract `includeDomains` + capability flag; tavily/exa adapters; Tavily leakage probe (criterion 5) | D-002 (pre-filter half) |
| T2 | kernel post-filter gate + abstain bridge + dual audit events + `outcome:abstain` dimension | D-002 (post-filter half), D-003 (criteria 1/2/6 audit parts) |
| T3 | presentation layer: CLI message + exit 0 + `--fail-on-abstain`; MCP/plugin structuredContent abstain contract | D-003 (a1/a2) |
| T4 | golden/eval criteria 1–4 into eval-looks + ship-gate wiring | D-003 (criteria 1–4) |
| T5 | README rewrite, evidence backfilled from T1–T4 reruns | D-004 |

Negative constraint (from user adjudication context): T1+T2 must not ship as a non-closed intermediate — each gate is completed within its own ticket; serial order keeps each ticket testable end-to-end.

## Out of scope (explicit, with reasons)

- golden.expected offline executor (audit F4): either fixture replay or formal deferral — next round candidate, not this round (D-001 theme discipline).
- Adversarial-dimension entry: triggered by first injection badcase per existing deferred entryTrigger.
- macOS CI lane: real macOS report arrives first (documented limitation).
- `typescriptlang.org` bare-domain classification micro-flaw (F5 residual): adjudicate in T2 as a spec annex note if encountered, otherwise stays residual.
- npm public release: deferred by D-001 until abstain gap closes.

## Consequences

Provider pre-filter intentionally reduces out-of-domain recall — aligned with the vertical-domain product creed and ADR-0053 fail-closed semantics. Brave/anysearch providers degrade honestly rather than faking filtering. Publication order is now: close abstain gap → README → only then npm 0.0.1 release evaluation.
