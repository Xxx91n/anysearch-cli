# Q2 / Q3 samples (shown before use)

Both probes use the real kernel + real SQLite store. The provider and the
consolidation seams are scripted (no network) so content and timing are fixed.
Nothing here is a formal experiment question and no tuning question is reused.

## Q2 — `probe-q2.ts`

| id | sample (exact input) | assertion |
|----|----------------------|-----------|
| S1 | handle H: run A `"A question"` (250 ms stream), 40 ms later run B `"B question"` on the same handle | B's first provider call starts after A finished; B's request carries `A-DONE-MARKER`; B answers `B-SAW:A` |
| S2 | two fresh handles, `"X-QUESTION-MARKER"` / `"Y-QUESTION-MARKER"`, 400 ms streams, started together | request/stream intervals overlap by >150 ms; neither request contains the other question |
| S3 | close the store, reopen it on the same DB file, fresh runtime, handle H, `"restart question"` | one PI JSONL for H; request carries `A-DONE-MARKER` and `B-SAW:A`; run completes |
| S4 | handle M: `"What is the probe fact? Search for it."` → tool call `search("probe fact 42")`; then a DIFFERENT handle asks `"What is the probe fact 42?"` | `retrieval_results` holds `MATERIAL-Q2-FACT`; the second handle's first request carries that text (archive recall, not message replay) |
| S5 | handle I: turn 0 calls `search("durable fact 7")`, turn 1 provider never settles, caller aborts at 500 ms | run ends with no `done`; `FAKE-SUCCESS-MARKER` absent from events and JSONL; a later run on I completes and its request carries `MATERIAL-Q2-INTERRUPTED` |
| S6 | handle C: tool call with 4000-token usage against a 2000 window, then compacted answer; then a fresh runtime on C | `compactionCalls >= 1`; restart request carries `SUMMARY-MARKER-Q2`; JSONL still has `ORIGINAL-Q2-COMPACTION-MARKER` and `ORIGINAL-Q2-TOOL-MARKER` |
| S7 | two store connections; sessions C1/C2 get 3 episodes each (`C1-FACT`, `C2-FACT`); both `consolidateMemory({sessionIds:[own]})` start together, summarize seams rendezvous | both reports `add=1`; two live semantic rows, neither overwritten; each episode set still belongs to its own session |

## Q3 — `probe-q3.ts`

Old fact: `Business hours are Monday to Friday 9-5.`
New material: `Support hours are now 24/7, no longer Monday to Friday 9-5.`

| id | sample (exact input) | assertion |
|----|----------------------|-----------|
| S1 | 3 episodes at `https://biz.example/hours` → `consolidateMemory({sessionIds:[biz]})` | `add=1`, one live semantic row carrying the old fact |
| S2 | anchors `rolling_summary` and `l2_recall` that quote the old fact; an unrelated session also consolidates and gets its own summary | (setup for S4/S7) |
| S3 | one newer official episode at `https://biz.example/hours-2026`; `consolidateMemory({memoryIds:[newEpisodeId], allowSingleEvidence:true})` | `update=1`; old row `valid_until` set and `superseded_by=newId`; all 3 old episodes `superseded_by=newId` and not archived; new row's sources include old + new episode |
| S4 | read anchor_status; `MemoryPipeline.inject()` on `"what are the support hours?"` | status `needsRefresh=true` for `rolling_summary` and `l2_recall`; injected text has no `Monday to Friday 9-5`; unrelated session has no status and its semantic row stays live |
| S5 | `MemoryPipeline.refreshIfNeeded()` with a capturing scripted provider | new `rolling_summary` says `REFRESHED-SUMMARY` / `24/7`; pause cleared; refresh request carries `[knowledge #newId]` and NOT `[knowledge #oldId]`; a second refresh is a no-op |
| S6 | fresh runtime, handle biz, `"What are the current support hours?"` | first real request has `24/7` + `REFRESHED-SUMMARY`, no `Monday to Friday 9-5`; run completes |
| S7 | read archive rows | ≥2 rolling-summary versions retained (old one still quotes the old fact); old semantic row remains, `superseded_by` points forward; new row live |

## What these do NOT prove

- Provider output quality (the provider is scripted).
- Real-model correction judgement; only that the pipeline, anchors, filters and
  request assembly behave correctly.
- Cross-process file locking (S7 uses two SQLite connections in one process).
