# F-17 flaky-case audit (round-58 T-2 / D-005, evidence for audit item R-3)

This file is the committed evidence for the 20-run check that ledger D-005 asked for: same
input every time, every run sorted into one of three buckets. The raw log lives in
`.scratch/t2-audit.log` (not committed); this file keeps the counts and the
conclusion so the evidence does not vanish with the workspace.

## Method

Same input, 20 runs in a row of the golden eval with `ANS_EVAL_NO_LOOK=1`:

```bash
for i in $(seq 1 20); do ANS_EVAL_NO_LOOK=1 node --import tsx src/eval/cli.ts --out ../../.ship-gate; done
```

## Result

| bucket | definition | observed |
|---|---|---|
| A passes every time (`pass-stable`) | passRate 1.000 on every run | **20 / 20** |
| B sits next to the line (`threshold-adjacent`) | pass/fail stays the same, but a report-only number moves | **1 / 20** (`mrr=0.536` on run 9; `mrr=0.548` on the other 19) |
| C a case crosses the line (`gate-crossing nondeterminism`) | one case moves across its rank line | **0 / 20 locally**; seen once on CI (`126/128`, `mrr=0.524`, main push run 34696814216) |

`fingerprint=4a529f6fbe2096c8` and `passRate=1.000` on every run.

## Conclusion (where the cause lives, ledger D-005)

F-17 comes from how results are ranked. The MRR number moves, but no case crosses its line
locally; on CI the same movement is big enough to push 2 cases across a rank line. The cause
sits in the order of retrieved results (tie order and iteration order), not in the random
seed, not in the embedding, not in the L0 state. That matches the first window written in the
ledger.

## Why the two failing case ids are not in the ledger yet

The flake did not happen again in 20 local runs or in 2 CI memory-eval runs after the fix
(`128/128`, `mrr=0.548`). So `packages/store/eval-quarantine.json` stays empty. The eval
command now prints `[eval] failed cases: <id>(<stage>)` when the gate fails, so the next
run that reproduces it names the cases, and the SLA check
(`packages/store/test/eval-quarantine-sla.test.ts`) is already in place.
