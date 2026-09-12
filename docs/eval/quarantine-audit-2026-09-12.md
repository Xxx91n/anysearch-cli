# F-17 flaky-case audit (round-58 T-2 / D-005, audit R-3 evidence)

Committed evidence for the 20-run fixed-input three-bucket audit required by ledger D-005. The raw
log lives in `.scratch/t2-audit.log` (gitignored); this file records the distribution and the
conclusion so the evidence survives the workspace.

## Method

Fixed input, 20 consecutive runs of the golden eval with `ANS_EVAL_NO_LOOK=1`:

```bash
for i in $(seq 1 20); do ANS_EVAL_NO_LOOK=1 node --import tsx src/eval/cli.ts --out ../../.ship-gate; done
```

## Result

| bucket | definition | observed |
|---|---|---|
| A pass-stable | passRate 1.000 every run | **20 / 20** |
| B threshold-adjacent | pass/fail stable, but a report-only metric moves | **1 / 20** (`mrr=0.536` on run 9; `mrr=0.548` on the other 19) |
| C gate-crossing nondeterminism | a case crosses its rank gate | **0 / 20 locally**; observed once on CI (`126/128`, `mrr=0.524`, main push run 34696814216) |

`fingerprint=4a529f6fbe2096c8` and `passRate=1.000` on every run.

## Conclusion (root-cause window, ledger D-005)

F-17 is a **ranking-level nondeterminism**: MRR drifts without any case crossing its gate locally,
and on CI the same drift is large enough to cross a rank gate (2 cases). The window is the retrieval
rank order (tie / iteration order) - not the seed, not the embedding, not L0 state - matching the
ledger's stated window at its first entry.

## Why the two case ids are not in the ledger yet

The flake did not reproduce in 20 local runs nor in 2 post-fix CI memory-eval runs (`128/128`,
`mrr=0.548`). `packages/store/eval-quarantine.json` therefore stays empty; the eval CLI now prints
`[eval] failed cases: <id>(<stage>)` on gate failure so the next reproducing run names them, and the
SLA enforcement point (`packages/store/test/eval-quarantine-sla.test.ts`) is already in place.
