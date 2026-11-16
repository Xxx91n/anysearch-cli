# #267 acceptance record — release package installed and used

Parent spec: [#255](https://github.com/Xxx91n/anysearch-cli/issues/255). This
ticket is the last of the twelve implementation tickets, so it also carries the
combined acceptance for D1—D14 and the test entries T1—T6.

**What this page is.** A record of what was actually run for this ticket, and —
just as important — what was not. Each row names the evidence file or command so
a later reader can re-run it instead of trusting this page. A row is never
marked done on "a ticket was closed" or "CI was green once"; it needs an entry
here whose evidence still exists.

**Scope boundary.** The v0.1.2 artifacts named below were built from `51f3aec7`
(main). The only change this ticket adds on top is
`scripts/installed-acceptance.mjs` plus its CI step and docs; that script does
not change product code. Anything that depends on product behaviour was
therefore observed on the same product code that main ships.

---

## Part 1 — D1—D14 (decisions from spec #255)

| Decision | What it required | Evidence for this ticket | Status |
|---|---|---|---|
| D1 full PI 1.5.1 + ESM, real entry | Installed CLI/MCP run through the real SDK entry, versions pinned | Installed `ans 0.1.2` and the installed `@anysearch-cli/mcp` both start and answer (lanes A and B), which is only possible through the real ESM/SDK entry. The 1.5.1 pin is a literal in `packages/kernel`, `apps/cli` and `apps/mcp` `package.json` and in `pnpm-lock.yaml`; no gate asserts that number — ship-gate's version-pin step checks the workspace packages at `0.1.2` only. | Entry covered; the 1.5.1 pin is read, not asserted by any gate |
| D2 real context window, two summary kinds | Declared window used for run/budget/compaction; bad config fails loudly; not a blanket 1M | Manual probe on the installed build: `ANS_LLM_CONTEXT_WINDOW=1048000` produced `window=1048000`; `1e3` exited 3 with "must be a positive integer token count". The lane asserts a window is reported and > 0, but does **not** set 1048000, so D2's target value is still proved by hand only. | Covered by a manual probe, not by CI |
| D3 memory wiring | Internal search results land in the archive and are recallable by other sessions | Lane E on the installed MCP: the stub makes the model call `search`, the archive gains rows, and a second session recalls one through `query_knowledge`. Regression suite: `packages/kernel/test/memory-archive-recall.test.ts`. | Covered (lane E skips without a provider key) |
| D4 cache/usage/budget accounting | Calls and tokens split per activity; four cost states; searches counted separately | Lane B checks run usage + a named cost source; lane D checks consolidation usage and its call count; both the run and the consolidation must label an unpriced endpoint as `estimated`/`unknown` (never `provider-reported`) and must name the missing cost dimension. `packages/kernel/test/consolidation-usage.test.ts`, `packages/store/test/budget-ledger.test.ts`. **Not covered:** the per-activity split (main run / compaction / memory summary / consolidation / re-judge / extra merge) as separate asserted counters on the installed build. The stub can trigger the main run, the consolidation call and the compaction/adjudication prompts, but the lane asserts only the run's and the consolidation's totals — it does not read a per-activity breakdown, because the installed result shape does not expose one. Also unreachable from a stub: the `provider-reported` and `not-called` cost labels. | Uncovered — per-activity split and two of the four cost labels |
| D5 explicit consolidation + scope | No scope = refuse; memoryIds is a complete scope; dryRun saves nothing | Lane D on the installed MCP and lane A on the installed CLI (exit 2). `apps/cli/test/consolidate-scope.test.ts`, `packages/store/test/scoped-consolidate.test.ts`. | Covered |
| D6 single-evidence correction + doubts | One material may correct existing knowledge only; refusals return evidence | Not exercised by the new lane (it uses the batch path). Coverage: `packages/store/test/single-evidence-correction.test.ts`, and the real-model run `packages/kernel/test/correction-a1-a4.online.ts` (A1, A4 accept; A2, A3 refuse). | Covered by existing tests; not re-run here |
| D7 relationship + final content check | Both checks run; no fixed 0.85, no bypass | Existing tests only: `packages/store/test/concurrent-correction.test.ts`, `packages/kernel/test/consolidation-correction-seams.test.ts`. The new lane does not touch this path. | Not re-run here |
| D8 version relations, partial facts, traceability | Replaced rows close with `superseded_by`; untouched facts stay retrievable | `packages/store/test/single-evidence-correction.test.ts`, `knowledge-fts.test.ts`, `knowledge-ranking-recall.test.ts`. | Not re-run here |
| D9 summary dependencies + task requirements | Summaries record what they read; affected ones pause and rebuild from current sources | `packages/store/test/summary-rebuild.test.ts`, `summary-sources.test.ts`, `apps/mcp/test/summary-rebuild-mcp.test.ts` (#264 M1—M4). | Not re-run here |
| D10 legacy summary on demand | Rebuild only when needed; mark incomplete instead of inventing sources | `packages/store/test/legacy-summary.test.ts`, `apps/mcp/test/summary-rebuild-mcp.test.ts` (A—D legacy cases), PR #290. | Not re-run here |
| D11 concurrency: re-judge once, merge latest | Serial per session, parallel across sessions; at most one re-judge; no silent overwrite | Re-judge count and latest-version merge: `packages/store/test/concurrent-correction.test.ts` (asserts the call count per case) and `consolidate-race-processes.test.ts`. Same-session serialisation: `apps/mcp/test/session-lock-recovery.test.ts` C1—C3 (#266) — those cases cover liveness, SIGKILL recovery and the wait cap, NOT the re-judge count. Real-model retry branches remain uncovered (B2 refused on first judgement). | Not re-run here; real-model retry still uncovered |
| D12 session lock, crash recovery, cold start | Live runs are not stolen; a confirmed-dead holder is reclaimed quickly; a brand-new DB retries instead of losing a process | Lane C2 on the installed artifact: two processes initialize against one brand-new file, both serve five tools, and the file carries a named table from every layer (`sessions`, `messages`, `retrieval_results`, `resume_anchors`, `budget_ledger`, `semantic_memories`, `summary_sources`, `summary_suspensions`, `legacy_summary_states`, `legacy_summary_attempts`, `entities`, `edges`). Existing: `packages/kernel/test/session-lock.test.ts`, `packages/store/test/coldstart-locks.test.ts`, `apps/mcp/test/session-lock-recovery.test.ts`. | Covered at the install boundary |
| D13 schema, release chain, standard checks | Migrations repeatable; installed product real; standard gates run as written | Lane F: an older file opens, migrates, keeps its row, and reopens cleanly; the installed MCP reads it. Standard gates: **not run** — this branch has no remote CI run (see Part 3). | Partial — see Part 3 |
| D14 paper data boundary | No touch to r19 or real experiment data | The lane builds every database in a temp directory and deletes it, and every CLI/MCP call passes `ANS_DB_PATH`, `USERPROFILE` and `HOME` into that sandbox — `doctor` resolves and creates a database directory, so inheriting the real environment would have touched `~/.anysearch`. One manual probe during this window (the D2 window check) ran `ans chat` with the operator's real HOME; it used a temp `ANS_DB_PATH` and an empty provider list, so no experiment database was read or written. | Kept |

## Part 2 — T1—T6 (test entries from spec #255)

| Entry | What it required | Evidence | Status |
|---|---|---|---|
| T1 real MCP main entry | Real MCP call drives chat and consolidate; session resume; ingest and shared recall; scope errors; window, cache, usage; budget; cancel; tool whitelist; URL check | Lane B/C (chat + resume, usage, window), lane C2 (cold start), lane D (scope error, dry-run, apply, usage). **Not in this lane:** cancel, budget refusal, tool whitelist, URL policy. Those live in `apps/mcp/test/ans-chat-cancellation.test.ts`, `cancellation.test.ts`, `vertical-guard.test.ts`, `packages/kernel/test/content-trust.test.ts`. | Partial (the listed pieces are covered by unit tests, not re-run on the installed build) |
| T2 real CLI | Real commands, exit codes, scope, dryRun, fee and conflict detail | Lane A (installed `ans`), lane F (installed `ans` against an older file). Conflict detail is CLI-side only in `apps/cli/test/consolidate-scope.test.ts`. | Partial |
| T3 multi-process + durable state | Two MCP processes, same-session serial / cross-session parallel, long-task protection, post-kill recovery, cold start | Lane C2 covers concurrent cold start on one new database. Long-task protection and post-SIGKILL recovery were covered by #266 (`session-lock-recovery.test.ts` C1—C3) and are not repeated here. | Partial |
| T4 consolidation interfaces + controlled answers | Stable trigger of version races, B2 conflict, re-merge, merge failure, unsupported final content | `packages/store/test/concurrent-correction.test.ts`, `consolidate-race-processes.test.ts`, `scoped-consolidate.test.ts`, `single-evidence-correction.test.ts`. Not part of the installed lane. | Covered by unit tests |
| T5 real model with confirmed inputs | Real model judgement on confirmed samples, with model/params/cost recorded | `packages/kernel/test/correction-a1-a4.online.ts` (excluded from the default suite; run explicitly). Result recorded on PR #273: A1—A4 single runs passed, no accuracy claim — and the same PR records one real fluctuation where A1 hit `merge-empty` on a second run. The B2 real-model retry branch stayed uncovered. This ticket did not re-run it. | Not re-run; historical result stands |
| T6 packaging, install, standard checks, data compatibility | `pnpm -r check`, `pnpm -r test`, `pnpm -r build`, offline memory eval, ship-gate, plus real pack → install → start → call; old data readable; migration repeatable | The new lane covers pack → install → start → call on the installed CLI and MCP (chat, resume, cold start, consolidate, recall, older database). The five standard gates ran in remote CI on PR #291 and all reported `pass` (`check-build`, `install-smoke`, `ship-gate` ×3 OS, `memory-eval`, `test:online`). **Old-data compatibility stays uncovered:** the lane's "older database" is built by the current version and has later tables dropped, so it proves the migration DDL is idempotent, not that a file written by an earlier release reads correctly. | Partial — gates remote-only; old-data compatibility not proved |

## Part 2b — The seven behaviours the ticket names, one row each

CodeRabbit's pre-merge check asked for each of these to be either asserted or
explicitly marked unrun/unknown. This table is that marking, kept apart from the
T-entry table so a reader cannot mistake "covered by an older unit test" for
"checked on the installed build in this ticket".

| Path | Asserted in this lane? | Where it is covered | Status |
|---|---|---|---|
| Ingest + shared recall | Yes | Lane E on the installed MCP (needs a provider key) | Asserted here |
| Scope isolation | Yes | Lane A (CLI exit 2); lane D: no-scope is a tool error, the echoed scope kind is `memory`, and three deliberately out-of-scope materials in the SAME session stay live while exactly one knowledge row is written. Mutation-checked: swapping `memoryIds` for `sessionId` turns it red | Asserted here |
| Reliable correction + keeping valid facts | No | `single-evidence-correction.test.ts`, `knowledge-fts.test.ts` | Unrun here — unit tests only |
| Concurrent latest merge | No | `concurrent-correction.test.ts`, `consolidate-race-processes.test.ts` | Unrun here — unit tests only |
| Summary dependency + task requirement | No | `summary-rebuild.test.ts`, `summary-sources.test.ts`, `summary-rebuild-mcp.test.ts` | Unrun here — unit tests only |
| Legacy summary handling | No | `legacy-summary.test.ts`, `summary-rebuild-mcp.test.ts` (A—D) | Unrun here — unit tests only |
| Long task / crash recovery | No | `session-lock-recovery.test.ts` C1—C3 (#266) | Unrun here — recorded prior run |
| Cancel / budget refusal / tool whitelist / URL policy | No | `apps/mcp/test/ans-chat-cancellation.test.ts`, `cancellation.test.ts`, `vertical-guard.test.ts`, `packages/kernel/test/content-trust.test.ts` | Unrun here — unit tests only |
| Cost accounting (four labels) | Partly | Lane B checks the run's `costSource === "estimated"`; lane D checks consolidation's `costBasis === "unknown"`, both with a zero placeholder and a named missing dimension | Two of four labels asserted; `provider-reported` and `not-called` are not reachable from a stub |

## Part 3 — What is not proved

These rows exist so nobody reads this page as a full green board.

- **The standard gates ran in remote CI and passed; they were not run locally.**
  The window's instruction was remote-only, so `pnpm -r check`, `pnpm -r test`,
  `pnpm -r build`, the offline memory eval and `ship-gate` were proved by CI,
  not by this machine.

  A gate list is a snapshot, and reading it against a later head is how a
  still-running check gets written down as green. So this section names the
  commits it actually read instead of saying "the PR is green", and the
  authoritative answer for any head is the PR's checks tab, not this file.

  The 18 check-runs are `check-build` (ubuntu, windows), `install-smoke`
  (ubuntu, windows), `ship-gate` (ubuntu, macos, windows), `memory-eval`,
  `test:online`, `test:online anysearch` (non-blocking), `coverage`,
  `native smoke` (4 legs), `macos-spillover-probe` (non-blocking) and
  `semgrep`.

  - `38abcdb5`, `224dc364`, `75fb18f9`, `ede9b72b`, `6772393e`, `b705b992`,
    `217ba781`: all 18 green on their own run.
  - `dd600357`: 17 green, `ship-gate (windows-latest)` red on its first run
    (unrelated `coldstart-race` timeout — see the entry below). After a
    targeted rerun it was green, but the first red is recorded, not erased.

  On the lane's own line: `install-smoke` printed
  `76 passed, 0 failed, 0 skipped` on both the ubuntu and windows legs.

  That list is what was read, not a prediction. A head newer than the last one
  named here has not been checked by this section; read its own run. One of
  those runs did go red and is recorded below rather than dropped from the
  list.

  Local runs in this window were narrower: `node --check` on the new script,
  `node scripts/check-workflows.mjs` (8 files, exit 0), `git diff --check`
  (exit 0), and the lane against the main CI artifacts.

- **One gate run went red for an unrelated reason, and the rerun passed.**
  On `dd600357` the first `ship-gate (windows-latest)` leg failed inside
  `pnpm turbo run test`: `apps/mcp/test/coldstart-race.test.ts` hit a
  71.8 s timeout (`duration_ms 84556`). That file belongs to #257 (the
  empty-database concurrent-start test) and this PR does not touch it — the
  diff is one script, one CI step and three docs. The other four legs on this
  branch were green, and a targeted rerun of the failed leg (`gh run rerun
  --failed`, run 43803814296) came back `success`. Recorded as a timing flake
  under the 2-way turbo concurrency on a slow Windows runner, **not** as proof
  that the test is healthy: the timeout was real, no assertion failed, and a
  repeat failure would be a real signal to look at #257's timing budget.
- **The lane's model is a stub.** It proves transport, request shape, memory
  wiring and the accounting path. It proves nothing about a real model's
  judgement, a real bill, or a real cache hit rate.
- **"Older database" is a reconstruction.** It is a current-build database with
  the later add-on tables dropped, not a file captured from an earlier release.
  It shows the migration DDL is repeatable and keeps rows; it does not show
  every historical payload shape was handled (the legacy-summary cases for that
  are in `legacy-summary.test.ts` and `summary-rebuild-mcp.test.ts`).
- **Real-model and multi-process coverage is not re-established here.** T5's
  result is the recorded one from #273; #266's lock evidence is the recorded
  run, not a fresh one.
- **No push, PR, merge or deploy is implied.** This ticket's authorization stops
  at local implementation, checks, commit and review.

## Part 4 — How to re-run

```text
# the lane on CI-built artifacts (no local compile)
gh run download <run-id> --repo Xxx91n/anysearch-cli -n tarballs-windows-latest
ANS_ACC_TARBALLS=<that dir> node scripts/installed-acceptance.mjs

# in CI, as part of the install-smoke job
node scripts/installed-acceptance.mjs
```

Lane E (internal search ingest → cross-session recall) needs `EXA_API_KEY` or
`TAVILY_API_KEY`. Without one it prints SKIPPED and the run reports a partial
result instead of a pass.
