# PROTOTYPE — Q2(d') output-reserve calibration

**Throwaway. Do not merge.** Branch: `prototype/q2d-output-reserve`.
Purpose: measure the real per-run output-token distribution of `ans chat` so the
main window can set the `[budget].outputReserveTokens` default (spec
[#175](https://github.com/Xxx91n/anysearch-cli/issues/175), decision Q2(d')).
This window implements nothing and changes no production code.

## The question

`outputReserveTokens` has two-sided risk:

- too small → the token cap is soft (settle has nothing to enforce, overspend allowed);
- too large → legitimate runs are rejected up front (LiteLLM PR #27539: a $2000
  pre-charge blocked a real $0.144 run).

So the default must come from the observed **per-run output** distribution, with a
sample-size statement and an interval — not a bare point value.

## Method

- Runs the **production entry** `apps/cli/dist/index.js chat "<query>"` (built from
  HEAD `4f873069`, stamp `dirty=false`) — real LLM (`openai` / `deepseek-v4.1-flash`
  through the configured custom endpoint), real Active Domain, real memory wiring.
- Harvests the run-level usage line the runtime already prints:
  `Agent completed (tokens: <in> in + <out> out)` — Σ of `message_end` usage over
  the run, the same accumulator `settleTokens` consumes in
  `packages/kernel/src/pi-runtime.ts`.
- 24 independent runs: fixed query set × 2 repetitions, across `docs`, `research`,
  `default`, plus a `docs` clone with `[rag] adapter = "fts"` (all shipped domains
  are `adapter = "none"`, so RAG Stage-1 injection would otherwise never fire).
- One unique `ANS_SESSION_ID` per run, `ANS_NO_INTERACTIVE=1`.

Known limits (read before quoting numbers):

- `usage.input` **excludes** cacheRead/cacheWrite; settle's `totalTokens` includes
  them. Output is unaffected — this experiment calibrates the output side only.
- n = 24 on one model/provider/network; p95 is a sample bound, not a population
  quantile. Cross-model and cross-run variance (1.55× median / 2.86× p90 on
  identical tasks per the 424k-session study cited in the handoff) is larger than
  any difference between domains at this sample size.
- Runs write real rows into `~/.anysearch/anysearch.db` (sessions/messages/memory).
  Deleting them needs explicit user authorization.

## Run it

```sh
pnpm --filter @anysearch-cli/cli build   # dist must match HEAD
pnpm proto:budget-cal                    # 24 runs, resumable (skips recorded runIds)
pnpm proto:budget-cal:report             # percentiles + candidate table
```

Artifacts: `out/raw.jsonl` (one line per run), `out/summary.json`, `out/run.log.txt`.

## Result

**Recommended default: 12288, acceptable range 10240–16384** (43 runs; output
p50 3,948 / p90 8,122 / p95 9,309 / max 9,600; 8192 would leave 9.3% of runs
overspending their reserve, up to +1,408).

Full evidence and the two-sided-risk table: `out/REPORT.md`. The decision belongs
to the main window; this branch keeps the raw samples and the apparatus as the
primary source, and is not merged.
