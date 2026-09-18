# ADR-0070: Grill Round 69 — GitHub 门面双语化与 T0 火线修红（README 登录页 IA + canonical/translation 对 + standing parity gate）

## Status

Accepted (implementation round r69). Records the round-69 decisions per the
serial ticket plan T0–T7. Ledger:
`D:\Aworker\anysearch-cli\.scratch\grill-round-69\decision-ledger.md`
(D-001/D-003~D-009; D-002 空号 = Q2 跳号证据，已自报). Evidence root:
`D:\Aworker\anysearch-cli\.scratch\grill-round-69\evidence\`.

## Context

Two forcing events met in one round. (a) The main tip went red on `e265667`:
the R68 closeout lint (`isCloseout`) matched `round-69-direction.md` by its
bare `^round-\d+` filename prefix and demanded closeout fields a direction
doc never needs — the shape leg over-extended the moment a new doc type
appeared under `.scratch/*/handoffs/`. (b) The README had accreted into an
engineering archive: 312 lines, ~56% of it a full Known-limitations record
and a generated ADR index, plus a leaking machine-local evidence path — no
badges, no bilingual surface, bare repo metadata (description
"anysearch-cli monorepo", zero topics). Separately, `LICENSE` turned out to
be a *variant* Apache-2.0 (patent-retaliation and redistribution clauses
rewritten) — the declared intent everywhere else (package.json fields, the
adding commit message) was canonical Apache-2.0, so GitHub's "Other" verdict
was accurate, not a detection bug.

## Decision

### D1 Closeout lint is delimited by semantics, not filename shape (ledger D-006; T0)

- `scripts/ship-gate.mjs` `isCloseout` narrowed: a closeout doc now REQUIRES
  the `closeout|closure` filename keyword; the bare `^round-\d+` prefix no
  longer hits alone. Direction/task docs (`round-69-direction.md`) drop out
  of scope; real closeouts (`round-67-closeout.md`, `round-68-closeout.md`)
  stay in scope — narrowing verified bidirectionally before commit.
- Doc side fixed anyway: `round-69-direction.md` carried a bare "双 land 远端
  三绿" claim — it now carries the Stack header + 「绿色 run URL」 section
  citing all six verified runs (claim-citation doctrine attaches to the
  CLAIM, not the doc type).
- Landed `dba42e1` + transcript `ee3600c`; ci / ship-gate / native-smoke all
  green on tip (runs 35317461733 / 35317461823 / 35317461732).

### D2 Derived artifacts retarget — never abandon the diff check (ledger D-004; T1)

- `docs/limitations.md` — the full 20-entry Known-limitations record migrated
  verbatim (facts untouched).
- `docs/adr/index.md` — `scripts/gen-adr-index.mjs` retargeted from the
  README's embedded block to a standalone generated file: relative row links,
  `index.md` self-excluded from `adrEntries`, `--write` creates the file,
  `--check` fails closed when missing/stale. Generate-and-diff discipline
  preserved, not dual-written.
- ship-gate step 1b checks the new target; `readme-adr-index.test.mjs`
  renamed to `adr-index.test.mjs` and asserts the index file.

### D3 Landing-page IA + canonical/translation pair (ledger D-003/D-004; T2/T3)

- `README.md` is the canonical EN landing page: switcher + badges (npm
  version / ci / license — only endpoints that resolve), 3-second pitch,
  Requirements, Quickstart, Domains & abstain, provider matrix, MCP server,
  Verified agent hosts (Proof zone kept), a faithful top-3 limitations
  summary + pointer, three-line Design rationale + `docs/adr/index.md`
  pointer, condensed contributors. Machine-local paths scrubbed to
  repo-relative (zero `D:/` hits).
- `README.zh-CN.md` is the derived translation: top declaration
  "翻译件，规范以 README.md 为准" + reciprocal switcher; heading skeleton
  1:1 (translated text, identical level sequence); code blocks and links
  byte-identical (verified mechanically).

### D4 Standing parity gate (ledger D-007; T4)

- ship-gate step 1h (`stepReadmeParity`) is a standing fail-closed check in
  the 1g family: heading skeleton 1:1 (code-fence aware), fenced code blocks
  byte-identical pairwise, link multisets identical minus the reciprocal
  `README.md`/`README.zh-CN.md` switcher pair, and `docs/limitations.md`
  exists + README links to it. It reads both files from disk every run —
  drift is a *persistent* red, not a per-diff warning.
- Red→green evidence pair on record: a committed heading-level drift failed
  `step 1h` (`heading skeleton drift EN [1,3,…] vs ZH [1,2,…]`, exit 1);
  revert restored full green (`transcripts in evidence/`).

### D5 Facade = files + settings; license repaired to declared canonical (ledger D-005; T5)

- Repo metadata updated via `gh repo edit` (settings-side change, command on
  record): product-line EN description + topics `agent-cli / mcp-server /
  search / retrieval / memory / fts5 / rrf-fusion / domain-filtering /
  anysearch`. No `.github` community infra, no image assets (out of bounds).
- `LICENSE` + 4 publish-dir copies replaced with canonical Apache-2.0
  (apache.org text): the prior file was a variant whose patent-retaliation
  clause had been rewritten — package.json fields and the adding commit both
  declared Apache-2.0, so the variant is treated as a defective copy, not a
  license change. GitHub detection re-runs on next push; "Other" was
  technically accurate for the variant.

### D6 Chore triage is found/fixed/deferred, never silent (ledger D-001/D-008; T5)

- L-1 fixed: report L43 relative path → absolute.
- L-2 fixed: `verify-observation.mjs` step-8b flake — graceful stdin-EOF
  shutdown (bounded kill fallback) + a 20×250 ms retry window on the trace
  read; the hard kill could drop the async write landing right after the
  JSON-RPC response.
- F-S4 deferred: strict two-stage discovery/completion cutoff in
  `assert-checks-green.mjs` needs its own design ticket; current
  timeout-min backstop stays documented.
- `release.yml` dual `gh issue create` fallback annotated (no-label retry).

## Closure (回填位 — completed at T7)

Four-segment evidence (ledger D-009):

1. **Repair** — T0 landed `dba42e1` + `ee3600c` on origin/main; the
   closeout-lint narrowing was verified bidirectionally
   (`round-69-direction.md` de-scoped, `round-67-closeout.md` still matches);
   local `ship-gate --quick` 56×pass committed at
   `D:\Aworker\anysearch-cli\.scratch\grill-round-69\evidence\r69-t0-shipgate-transcript.txt`;
   remote triple-green on `ee3600c` — ci run 35317461733 / ship-gate
   35317461823 / native-smoke 35317461732.
2. **Facade** — README pair landed (EN 312→159 lines + ZH companion); zero
   machine-local paths; three badge endpoints return 200;
   `docs/limitations.md` (20 verbatim entries) and `docs/adr/index.md`
   (70 rows) exist; `gh repo view` before/after JSON on record
   (description + 9 topics); LICENSE → canonical Apache-2.0 —
   `licenseInfo` now reports `apache-2.0`.
3. **Standing guard** — parity red→green pair:
   `D:\Aworker\anysearch-cli\.scratch\grill-round-69\evidence\r69-t4-parity-red.txt`
   (step 1h heading-skeleton drift, exit 1) and
   `D:\Aworker\anysearch-cli\.scratch\grill-round-69\evidence\r69-t4-parity-green.txt`
   (full green). Generator retarget proof: step 1b passes on
   `docs/adr/index.md` and the 69→70 regen followed the ADR-0070 commit —
   the diff discipline itself was exercised.
4. **Documentation** — this ADR; CONTEXT.md R69 词块 (8 terms, pre-ledgered,
   no new implementation coinage); CHANGELOG r69 entry; found/fixed/deferred
   triplets in the round report + closeout (incl. the D-002 skip-gap
   self-report, the LICENSE-Other disposition, and per-chore L-1/L-2/F-S4/
   comment dispositions).

Final land `6c801678` triple-green: ci run 35321041577 / ship-gate
35321041623 / native-smoke 35321041706 (macos-spillover-probe red is the
documented EXPERIMENT non-blocking job, outside the gate).
