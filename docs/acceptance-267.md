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
| D1 full PI 1.5.1 + ESM, real entry | Installed CLI/MCP run through the real SDK entry, versions pinned | Installed `ans 0.1.2` and installed `@anysearch-cli/mcp` both start and answer: `scripts/installed-acceptance.mjs` lanes A and B. Pin asserted by `pnpm -r check`/`build` in remote CI and by ship-gate's version-pin step. | Covered at the install boundary |
| D2 real context window, two summary kinds | Declared window used for run/budget/compaction; bad config fails loudly; not a blanket 1M | Manual probe on the installed build: `ANS_LLM_CONTEXT_WINDOW=1048000` produced `window=1048000`; `1e3` exited 3 with "must be a positive integer token count". Automated gain: lane C checks a window is reported and > 0, but does **not** set 1048000. | Covered by a manual probe, not by CI |
| D3 memory wiring | Internal search results land in the archive and are recallable by other sessions | Lane E on the installed MCP: the stub makes the model call `search`, the archive gains rows, and a second session recalls one through `query_knowledge`. Regression suite: `packages/kernel/test/memory-archive-recall.test.ts`. | Covered (lane E skips without a provider key) |
| D4 cache/usage/budget accounting | Calls and tokens split per activity; four cost states; searches counted separately | Lane B checks run usage + a named cost source; lane D checks consolidation usage, its call count, and that an unpriced endpoint is not reported as a server-sent price. `packages/kernel/test/consolidation-usage.test.ts`, `packages/store/test/budget-ledger.test.ts`. Not covered here: per-activity split (main / compaction / summary / adjudication / merge) as an automated assertion on the installed build. | Partial |
| D5 explicit consolidation + scope | No scope = refuse; memoryIds is a complete scope; dryRun saves nothing | Lane D on the installed MCP and lane A on the installed CLI (exit 2). `apps/cli/test/consolidate-scope.test.ts`, `packages/store/test/scoped-consolidate.test.ts`. | Covered |
| D6 single-evidence correction + doubts | One material may correct existing knowledge only; refusals return evidence | Not exercised by the new lane (it uses the batch path). Coverage: `packages/store/test/single-evidence-correction.test.ts`, and the real-model run `packages/kernel/test/correction-a1-a4.online.ts` (A1, A4 accept; A2, A3 refuse). | Covered by existing tests; not re-run here |
| D7 relationship + final content check | Both checks run; no fixed 0.85, no bypass | Existing tests only: `packages/store/test/concurrent-correction.test.ts`, `packages/kernel/test/consolidation-correction-seams.test.ts`. The new lane does not touch this path. | Not re-run here |
| D8 version relations, partial facts, traceability | Replaced rows close with `superseded_by`; untouched facts stay retrievable | `packages/store/test/single-evidence-correction.test.ts`, `knowledge-fts.test.ts`, `knowledge-ranking-recall.test.ts`. | Not re-run here |
| D9 summary dependencies + task requirements | Summaries record what they read; affected ones pause and rebuild from current sources | `packages/store/test/summary-rebuild.test.ts`, `summary-sources.test.ts`, `apps/mcp/test/summary-rebuild-mcp.test.ts` (#264 M1—M4). | Not re-run here |
| D10 legacy summary on demand | Rebuild only when needed; mark incomplete instead of inventing sources | `packages/store/test/legacy-summary.test.ts`, `apps/mcp/test/summary-rebuild-mcp.test.ts` (A—D legacy cases), PR #290. | Not re-run here |
| D11 concurrency: re-judge once, merge latest | Serial per session, parallel across sessions; at most one re-judge; no silent overwrite | `packages/store/test/concurrent-correction.test.ts`, `consolidate-race-processes.test.ts`, `apps/mcp/test/session-lock-recovery.test.ts` (#266 C1—C3). Real-model retry branches remain uncovered (B2 refused on first judgement). | Not re-run here; real-model retry still uncovered |
| D12 session lock, crash recovery, cold start | Live runs are not stolen; a confirmed-dead holder is reclaimed quickly; a brand-new DB retries instead of losing a process | Lane C2 on the installed artifact: two processes initialize against one brand-new file, both serve five tools, schema complete (42 tables). Existing: `packages/kernel/test/session-lock.test.ts`, `packages/store/test/coldstart-locks.test.ts`, `apps/mcp/test/session-lock-recovery.test.ts`. | Covered at the install boundary |
| D13 schema, release chain, standard checks | Migrations repeatable; installed product real; standard gates run as written | Lane F: an older file opens, migrates, keeps its row, and reopens cleanly; the installed MCP reads it. Standard gates: remote CI on this branch (see Part 3 — at the time of writing the post-fix run had not reported). | Partial — see Part 3 |
| D14 paper data boundary | No touch to r19 or real experiment data | The new lane builds every database in a temp directory and deletes it. No command in this ticket pointed at `~/.anysearch` or any experiment database. | Kept |

## Part 2 — T1—T6 (test entries from spec #255)

| Entry | What it required | Evidence | Status |
|---|---|---|---|
| T1 real MCP main entry | Real MCP call drives chat and consolidate; session resume; ingest and shared recall; scope errors; window, cache, usage; budget; cancel; tool whitelist; URL check | Lane B/C (chat + resume, usage, window), lane C2 (cold start), lane D (scope error, dry-run, apply, usage). **Not in this lane:** cancel, budget refusal, tool whitelist, URL policy. Those live in `apps/mcp/test/ans-chat-cancellation.test.ts`, `cancellation.test.ts`, `vertical-guard.test.ts`, `packages/kernel/test/content-trust.test.ts`. | Partial (the listed pieces are covered by unit tests, not re-run on the installed build) |
| T2 real CLI | Real commands, exit codes, scope, dryRun, fee and conflict detail | Lane A (installed `ans`), lane F (installed `ans` against an older file). Conflict detail is CLI-side only in `apps/cli/test/consolidate-scope.test.ts`. | Partial |
| T3 multi-process + durable state | Two MCP processes, same-session serial / cross-session parallel, long-task protection, post-kill recovery, cold start | Lane C2 covers concurrent cold start on one new database. Long-task protection and post-SIGKILL recovery were covered by #266 (`session-lock-recovery.test.ts` C1—C3) and are not repeated here. | Partial |
| T4 consolidation interfaces + controlled answers | Stable trigger of version races, B2 conflict, re-merge, merge failure, unsupported final content | `packages/store/test/concurrent-correction.test.ts`, `consolidate-race-processes.test.ts`, `scoped-consolidate.test.ts`, `single-evidence-correction.test.ts`. Not part of the installed lane. | Covered by unit tests |
| T5 real model with confirmed inputs | Real model judgement on confirmed samples, with model/params/cost recorded | `packages/kernel/test/correction-a1-a4.online.ts` (excluded from the default suite; run explicitly). Result recorded on PR #273: A1—A4 single runs passed, no accuracy claim — and the same PR records one real fluctuation where A1 hit `merge-empty` on a second run. The B2 real-model retry branch stayed uncovered. This ticket did not re-run it. | Not re-run; historical result stands |
| T6 packaging, install, standard checks, data compatibility | `pnpm -r check`, `pnpm -r test`, `pnpm -r build`, offline memory eval, ship-gate, plus real pack → install → start → call; old data readable; migration repeatable | The new lane (pack, install, CLI, MCP, chat, resume, consolidate, recall, older database). Standard gates: remote CI on this branch — see Part 3. | Partial — see Part 3 |

## Part 3 — What is not proved

These rows exist so nobody reads this page as a full green board.

- **Standard gates were handed to remote CI.** The user's instruction for this
  window was to use remote CI and not compile locally. The local runs were:
  `node --check` on the new script, `node scripts/check-workflows.mjs` (8 files,
  exit 0), `git diff --check` (exit 0), and the lane itself against the main
  CI artifacts (62 checks, 0 failed, 0 skipped). `pnpm -r check`, `pnpm -r test`,
  `pnpm -r build`, the offline memory eval and `ship-gate` are **not** local
  results; they must be read from the branch's CI run. If that run is not green,
  this ticket is not verified regardless of the lane passing.
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
