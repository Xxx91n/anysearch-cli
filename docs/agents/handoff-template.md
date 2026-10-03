# Handoff Template — round 交接格式（R62 T9 due-chore；R96 T3 三态语法同步）

Every round-closing handoff under `.scratch/<slug>/handoffs/` carries these
required fields. The template exists so the next agent can re-verify claims
without re-reading the whole conversation.

The required fields are machine-checked by `scripts/ship-gate.mjs` step 1g
through the pure verdict core `scripts/handoff-lint-verdict.mjs`, driven by
the shell `scripts/handoff-lint-shell.mjs` (ADR-0097). **Template and gate
share one grammar: this file is the normative source, the core is its
executable form.** Changing one without the other re-opens F8-a.

## Effective scope（生效域边界，ADR-0097 D5）

- **round >= 96** — the three-state grammar below is enforced (GREEN / PENDING /
  RED), including the Stack three-element contract.
- **round < 96** — the legacy presence-only rule applies: the 「绿色 run URL」
  section, the Stack line, and at least one `actions/runs/<id>` URL must
  exist. No live verification runs for those rounds.

The scope is decided by the round number in the filename — a scope boundary,
never a content exemption (CONTEXT.md → No-Grandfathering).

## Required header

```
# Round-NN → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  <branch> → <but-id> (<sha> @ <iso-date>) → <but-id> (<sha> @ <iso-date>) → ...

## 已完成
## 绿色 run URL（必填）
## 下一轮候选
## Known risks / deferred
```

## Field rules

### Stack line — three machine-checked elements

Write the chain as `<branch> → <but-id> (<capture-sha> @ <iso-date>) → ...`.
The gate resolves each element against the live workspace:

1. **but-id resolves** — every `<but-id>` must appear in the `but status`
   id column. A missing id is RED `but-id-not-resolved`.
2. **capture sha is a commit** — every recorded sha must satisfy
   `git cat-file -t <sha>` = `commit`. Anything else is RED
   `sha-not-commit`.
3. **chain tail is in the branch** — the last sha in the chain must be a member
   of `git rev-list origin/main..origin/<branch>`. Membership, not tip
   equality: a late gate run may add commits and must not redden the line. A tail
   outside the branch is RED `chain-tail-not-in-branch`.

An element may omit its sha (the self-referential closing commit; a time-lagged
capture) — a missing sha is not itself a violation, and a sha recorded before a
mid-stack rewrite is expected to lag.

but-id is the primary key: `but absorb`, `but reword` and any mid-stack
rewrite change a commit's SHA while its change-id survives. Cite `but-id`
first, SHA second with its capture date.

### 绿色 run URL — three-state, one state line

The section must open with exactly one state line. URLs that merely appear in
prose or an annotation do NOT satisfy the field (that was the F8-b silent fold).

**GREEN** — claim a verified run:

```
GREEN: https://github.com/<owner>/<repo>/actions/runs/<id>
```

The gate accepts the claim only when at least one cited run satisfies ALL of:

- `head_sha` is on the stack's own history — a member of
  `git rev-list origin/main..origin/<branch>` (a run on `main` is a
  baseline run, not this round's run);
- `conclusion` is `success`;
- the workflow is one of the required gates: `ci`, `ship-gate`
  (`native-smoke` is a load-only matrix and does not count);
- the repository matches this repo.

Otherwise the claim is RED `green-claim-falsified`.

**PENDING** — name one of the two closed reason codes, with a short note:

```
PENDING: stack-unpushed — <why>
PENDING: pushed-no-branch-runs — <why>
```

- `stack-unpushed` — the Stack's named branch has no `origin/<branch>` ref.
- `pushed-no-branch-runs` — the ref exists, but no workflow's `on.push`
covers that branch, so a feature-branch push can never produce a run (F8-c).

The gate verifies the predicate offline. A code that contradicts the facts is
RED `declaration-fact-conflict`. Any other reason text — `waived`,
`time-boxed`, `doc-only` — is RED `pending-reason-out-of-vocabulary`:
the vocabulary is closed and extending it requires a gate code change.

**RED** — the gate's own verdict. It is never authored: a declaration that
contradicts the facts, an out-of-vocabulary reason, a URL that yields no run id,
a missing/ambiguous state line, or an absent/malformed Stack chain all land here.
The closed RED codes are:

- run-URL leg: `run-url-section-missing` / `run-url-state-line-missing` /
  `run-url-state-ambiguous` / `run-url-unparseable` /
  `pending-reason-out-of-vocabulary` / `declaration-fact-conflict` /
  `green-claim-falsified`
- Stack leg: `stack-line-missing` / `stack-chain-empty` / `but-id-not-resolved` /
  `sha-not-commit` / `chain-tail-not-in-branch`
- State leg: `state-marker-unparseable` / `state-predicate-out-of-vocabulary` /
  `bare-word-violation` (plus reused `declaration-fact-conflict`)

### State markers

Self-made state declarations ride single-line HTML comment markers (the grammar owner); the run-URL `PENDING{code}` is the precedent shape:

```
<!-- state: unpushed <branch> @ <iso-date> -->
<!-- state: unlanded stack @ <iso-date> -->
```

- Closed predicates: `unpushed` (no `origin/<branch>` ref) / `unlanded` (`origin/main..origin/<branch>` non-empty) / `no-branch-runs` (no workflow `on.push` covers the branch). Live `no-pr` / `unpublished` ride the extension ticket, never the prose (writing one is `state-predicate-out-of-vocabulary`).
- `args` is a branch name, or `stack` (resolves the Stack line branch); no `--`; the date is the writing day and must not be in the future; the marker owns its line.
- A predicate word in prose needs a legal marker in the same file (bare-word violation); code spans / fences are not scanned; a fact contradiction is `declaration-fact-conflict`; unreadable facts are `state:ref-unavailable` (PENDING).

### Degradation annotations（降级标注格式）

When the gate can prove it cannot verify — no `gh`, unparseable repo, failed
API calls, no `but`, an unread origin ref, a shallow clone — the leg is PENDING
with an explicit annotation instead of a silent pass:

- run-URL leg: `verification-unavailable:{gh-missing|repo-parse|api-failed|ref-unavailable}`
  (`ref-unavailable` = the origin-ref facts could not be READ; a fact that was
  never read is not an empty fact, so the gate never reports it as verified)
- Stack leg: `stack-unavailable` / `ref-unavailable` / `shallow-clone`
- State leg: `state:ref-unavailable`
- Stack leg, advisory only (never blocking): `stale-capture:<but-id>:<days>d`

These are non-blocking by design (CI has no `but` and no `origin/<branch>`
for a PR checkout; blocking there would be permanently red). They are never
silent: each appears as a `[skip]` line naming its code.

### Machine-readable vocabulary（机器可读词表，与判定核双向锁）

The block below is parsed by `packages/store/test/handoff-lint-e2e.test.mjs` and
asserted set-equal to `CODE_GROUPS` in `scripts/handoff-lint-verdict.mjs`. Adding
a code on either side alone turns the suite red — that is what makes ADR-0097
D1's “extending the vocabulary requires a gate code change” enforceable.

<!-- HANDOFF-LINT-VOCABULARY (parsed by handoff-lint-e2e.test.mjs — keep in sync with CODE_GROUPS) -->
```
run-url-red: run-url-section-missing | run-url-state-line-missing | run-url-state-ambiguous | run-url-unparseable | pending-reason-out-of-vocabulary | declaration-fact-conflict | green-claim-falsified
stack-red: but-id-not-resolved | sha-not-commit | chain-tail-not-in-branch
stack-structural-red: stack-line-missing | stack-chain-empty
stack-env: stack-unavailable | ref-unavailable | shallow-clone
stack-advisory: stale-capture
verification-unavailable: gh-missing | repo-parse | api-failed | ref-unavailable
pending-reason: stack-unpushed | pushed-no-branch-runs
state-red: state-marker-unparseable | state-predicate-out-of-vocabulary | bare-word-violation
```

### Redaction

No API keys, tokens, or secrets anywhere in the doc (ledger files record
`key: set`, never the value).

### Suggested skills

Name the skills the next agent should invoke (`$implement`, `$handoff`,
etc.) so workflow continuity survives.

## Reproduce the verdict locally

```
node scripts/ship-gate.mjs
```

The handoff-lint leg prints one line per closeout doc; the fixture truth table
and the E2E smoke live in `packages/store/test/handoff-lint-verdict.test.mjs`
and `packages/store/test/handoff-lint-e2e.test.mjs`, sharing
`packages/store/test/fixtures/handoff-lint/`. The legislative record is
`docs/adr/0097-architecture-grill-round-96-handoff-lint-three-state-exit-semantics.md`
and `docs/adr/0098-architecture-grill-round-97-selfcheckable-declarations.md`.
