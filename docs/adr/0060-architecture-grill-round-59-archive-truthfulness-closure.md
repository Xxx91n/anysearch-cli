# ADR-0060: Grill Round 59 — Archive Truthfulness Closure（档案真实性收口）

## Status

Accepted (document round r59). This ADR records the archive-truthfulness governance decisions only; source changes land in the fixer round per the ticket plan below.

## Context

An independent review (锐评 round 2, `.codex-tmp/锐评.txt`, evidence-backed with local replays) found six cuts; four belong to one theme — the archive's claims must resolve to reality:

1. **刀一**：ADR-0058 is an Accepted ADR whose nine decisions reference files, flags, and precedents (`gates.json`, `gate:all`, `JIAHAO_TEST_TIER`, named external cases, defer-0003/0004/0026) that do not exist in this repo; its own r58 Text Errata confirms this, yet Status stayed "Accepted". Decision chains that cite it (ADR-0059 D2) inherit the rot.
2. **刀二**：ADR-0057 cites six commit hashes as evidence (`a349094`, `cb2518a`, `b694a0b`, `a76598d`, `027226d`, `7318184`); all were destroyed by a later squash (`git cat-file`: not a valid object name). The evidence schema was perfect; the substrate was gone.
3. **刀三**：CONTEXT.md:9 (Retroaererd Engine) still contained claims falsified by the same file it describes (`tokio::JoinSet` in a TS project; `≥4 angles / ≥6 fetches` vs the real `minProviders:2 / minResults:5`; `Resume Anchoring` with zero code) — one round after this repo coined "LYING-Class Doc Drift" for exactly that pattern.
4. **刀六**：ADR-0057 AC4's "turbo test green offline" does not hold on a clean machine without HuggingFace reach: three store eval files red (vector-arm golden case fail-open reorder; `[switch] no such table: access_events` fail-closed). Not a regression — red on the old commit too — so the claim was wrong at publication time.

Cuts 刀四 (3565 lines of governance, zero product lines) and 刀五 (four small honesty items) are handled by rounds organization (Round-60 = product, hard constraint code-lines > governance-lines) and due-chore commits respectively; 刀五(d) becomes a criteria-based waiver mechanism instead of another ad-hoc exemption.

This ADR is the corrective record for ADR-0058 and the mount point for the round-59 fixes. Per the Nygard lineage (Nygard 2011 / Fowler / AWS Prescriptive Guidance / GitLab / MADR / adr-tools), an Accepted record is immutable to edits; the only lawful corrections are append-only new information (errata) or replacement (supersede). ADR-0058's defect is not a decision being reversed but the record describing a parallel universe — the lawful exit is Superseded, body and errata untouched, only the status line changed. "Void" is not a Nygard primitive and is not introduced.

## Decision

### D1 ADR-0058 disposition (T-1)

ADR-0058's status line becomes `Status: Superseded by ADR-0060 (2026-09-13)`; body and r58 Text Errata remain byte-identical. ADR-0059 receives a one-line append-only r59 errata noting that its D2 citation of ADR-0058 is historical context. ship-gate gains a supersession-integrity assertion: every `Superseded by ADR-NNNN` must resolve to an existing ADR file, and the target must carry the back-reference (armory four-job pattern). **No grandfathering**: none of ADR-0058's phantom content is retained, exempted, or treated as precedent; supersession is the only exit.

### D2 Round-59 tickets (D-002 ledger)

Single umbrella theme (archive truthfulness), ordered tickets, each verified independently:

- **T-1** ADR-0058 supersession + this ADR + ADR-0059 r59 errata + supersession assertion.
- **T-2** CONTEXT.md:9 term rewrite per D3 + wiring assertions into ship-gate (same ticket; assertion and wording land atomically).
- **T-3** ADR evidence-anchor repair + resolvability assertion (per D5 below).
- **T-4** ADR-0057 r59 errata (AC4 scope) + eval fixture schema-path fix + fail-open degraded marking (per D7 below) + CONTEXT.md round-57-Terms pointer line.
- **due-chore commits** (ADR-0029's own channel, separate refactor commits + CHANGELOG Removed; NOT a second waiver): t6 texture-position assertion deletion (behavioral coverage already in plugin-security.test.mjs), preheat.ts tamper→damage comment downgrade, canonicalVersion dual-implementation annotation.

### D3 CONTEXT.md:9 Retroaererd term rewrite (T-2)

Per-claim disposition (atomcode local forensics with line numbers, q3 report):

| claim | finding | disposition |
|---|---|---|
| bounded budget (token/usd-cap) | per-call reserve/settle wired (engine.ts:250-264); tokenCap/usdCap type-only (ports.ts:9-13) | correct: per-call wired; token/usd marked "not wired" |
| ≥4 angles / ≥6 fetches / ≥3 domains, "serialized" | real gate = minProviders:2/minResults:5/minDomains:3, post-hoc not serialized | correct to 2/5/3; drop "serialized" |
| tokio::JoinSet fanout | never existed (TS) | delete |
| RRF(k=60) consensus fusion | real (fusion-registry.ts:24, engine.ts:373) | keep |
| cross-engine verify | real and wired (crossEngineVerify=true + checkCrossEngine, engine.ts:102,480-483) | correct & keep (fact-correction of the grill draft) |
| Resume Anchoring on timeout/crash | absent (repo-wide grep) | delete from body; detail goes to Deferred (remove-or-implement) + ponytail-debt-ledger |
| spec lineage (paperfoot/Mole/atomcode) | partially true; engine.ts:1-5 already honest | keep as ≤2-line "design inspiration (not an implementation promise)" |

House rule (from Diátaxis Reference discipline + LyingDocs PhantomSpec + Fern "transclusion is the only reliable control" + this repo's ADR-0059 D7 template): **the term body states only machine facts; only negative status lines with an ADR/ledger pointer are allowed; no affirmative future promises.** CONTEXT.md terms are Diátaxis Reference; external specs are links, not internal facts (C4 layering). Wiring assertions, all fail-closed in ship-gate, stdlib-only: **L1 numeric** — parse `DEFAULT_GATE` {2,5,3,true} and `k_fusion` {memory:60,web:60} from source and assert CONTEXT.md contains current values and not stale ones (bidirectional); **L2 symbol existence** — DEFAULT_GATE/FUSION_REGISTRY/rrfRank/checkCrossEngine must exist; **L3 behavior** — no positive assertions (claim ≠ wiring); negative over-claim assertions (existing stepDocClaims pattern) only. Whole-term-table audit is deferred (ADR-0018 review-by-clause + debt ledger), not this round's ticket.

### D4 Waiver mechanism for ADR-0029 multi-ticket rounds (institutionalized, replaces ad-hoc exemption)

A multi-ticket round is lawful only when all five criteria hold (sunset clause / security-exception / FedRAMP POA&M / RFC 9280 §8 mappings):

1. Single umbrella theme; all tickets derive from it.
2. Explicit ticket order; each ticket independently verified.
3. The waiver is written into that round's ADR and is NOT inherited by later rounds (sunset).
4. Within any two consecutive multi-ticket windows, at least one one-theme round must follow.
5. Independent review sign-off (the atomcode audit role) recorded in the round's handoff.

ADR-0029 is not rewritten; ADR-0059 D1's "one-shot" stands. This record adds the mechanism so future rounds use a governed channel instead of improvising. Grandfathering is explicitly forbidden (D1).

### D5 Evidence-anchor repair (T-3)

Evaporated hashes (ADR-0057's six, and any other backtick-quoted git reference in docs/adr) are re-anchored by one of: PR number, full-40-hex permalink (`blob/<sha>#L…`), or file-path+line; unresolvable claims carry an explicit `[squashed]` footnote (SPDX NOASSERTION-style honest unknown). ship-gate assertion (tightened from ledger wording): backtick-quoted **40-hex** git references in docs/adr must resolve via `git cat-file -e`, else fail; `[squashed]`-marked references are whitelisted; a non-zero git exit itself is fail-closed (failUnverifiable discipline from round-58 audit C-2). Precedents: git-filter-repo #108 failure mode, GitHub full-SHA pinning policy (2025-08-15), SPDX checksum-on-reference, SCITT receipts, SLSA fail-closed verification. Remote PR-number availability must be verified before implementation; fallback = path+line+footnote.

### D6 Round organization (roll-up of ledger D-001)

Round-59 theme = archive truthfulness (cuts 1/2/3/6). Round-60 = product body with hard constraint: new code lines > governance/doc lines, and graceWindow/deepMode remove-or-implement decided there (LYING rule forces a decision within a foreseeable round). Operational debts (F-16 gate4, F-17 case-id backfill, ADR-0059 retitle) run on their existing TTLs and consume no round.

### D7 AC4 errata + offline-eval boundary (T-4)

Per RFC errata doctrine (IESG: errata fixes errors present at publication; Verified when resolution matches original intent), ADR-0057 gets an append-only **r59 errata** — no status flip, no body edit — stating: AC4 "turbo test green offline" scopes to the default stub suite; the real finding is a boundary misplacement (vector-arm golden cases leaked into the default suite; they belong behind `test:online` per ADR-0057 D4/D5). This is a claim-precision correction, explicitly NOT a quality-bar downgrade (Scrum DoD anti-downgrade clause included verbatim in the errata). The `access_events` red is a test-fixture bug (fixture bypasses the schema-application path; `schema.sql:265` already has `CREATE TABLE IF NOT EXISTS`; `switch-run.ts:121` fail-closed throw is correct and stays fail-closed). fail-open's reorder is a lawful availability semantic (authzed), acceptable **only** because observable (failure counters at embedding index 10/75-78); eval reports must mark degraded. Authority for the semantic lives in this ADR's Consequences; CONTEXT.md gets one negative pointer line in the round-57 Terms section (prevents re-claim; feeds stepDocClaims).

## Consequences

Positive: the archive's claims resolve to reality again; future `per ADR-00XX` citations are trustworthy; waiver discipline becomes mechanism instead of improvisation; offline-eval truthfulness is bounded and observable.

Costs accepted (bidirectional Consequences): offline default suite no longer covers vector-arm ranking (moved to test:online); degraded offline runs produce reordered golden results — documented, not fixed; five criteria make future multi-ticket rounds harder to declare than before; an ADR numbered 0058 exists whose body describes a parallel universe permanently (visible scar, deliberately retained).

Deferred: Resume Anchoring (remove-or-implement, ponytail-debt-ledger); whole-term-table audit (review-by-clause); F-16/F-17/ADR-0059-retitle per existing TTL.

Evidence: atomcode reports `.scratch/grill-round-59/q1-atomcode.md`, `q3-atomcode.md`, `q4-atomcode.md`, `q5-atomcode.md`; ledger `.scratch/grill-round-59/decision-ledger.md` (D-001..D-005); review text `.codex-tmp/锐评.txt`.
