# Anysearch skill

## Tools

- search_web: search the web now, across several sources at once.
- research_web: deep research. Runs for minutes and follows several steps.
- recall_memory: look through earlier research results stored in local memory (FTS5 keyword search). Older results slowly lose weight.
- query_knowledge: search the organization's own knowledge base.
- ans_chat: an agent loop (PiAgentRuntime) for questions that need several tools.
  With `operation="consolidate"` it instead turns selected stored materials into
  long-term knowledge.

## Decision tree

1. Current events or a fact to look up -> search_web
2. Research that needs several steps and a written answer -> research_web
3. Recall earlier research results from memory -> recall_memory
4. Organization's own knowledge base -> query_knowledge
5. Research that needs several tools in a row -> ans_chat
6. If recall_memory already has results that answer the question, skip the extra search. Search again when those results are incomplete, out of date, or the user asks for the latest.
7. Results are worth keeping as long-term knowledge -> ans_chat with operation="consolidate" (see below).

## Saving research results (consolidation)

Call `ans_chat` with `operation="consolidate"` when results should become durable
knowledge. Do not do it on every turn, and do not run it just because it exists.

- Pick the scope yourself and pass it. `sessionId` is the usual scope: it sweeps
  one session's materials. `memoryIds` takes positive integer stored material
  ids, for the case where you already hold real ids; `recall_memory` does not
  return them, so do not invent ids from its output. A call with neither is
  rejected.
- If you pass both, `memoryIds` wins and the session does not widen it. Read
  `structuredContent.scope` to confirm what was actually read.
- Preview first when the outcome matters: `dryRun: true` saves nothing, but it can
  still call the model and cost money.
- One reliable material can correct existing knowledge: `allowSingleEvidence:
  true`. The exception is decided per entity cluster, not per call, so a
  `sessionId` scope can correct an entity only when that session holds exactly
  one non-superseded material for that entity. The exception is judged per
  entity cluster: a session with one such material for each of several
  entities can correct each one separately. An entity with three or more
  materials uses the batch path; with two, it is skipped. Preview with
  `dryRun: true` and read `structuredContent.scope` before applying. `memoryIds`
  with one entry is the precise form. It may only correct, never create new
  long-term knowledge. A refusal is a normal answer — read `verifyDetails` for
  the old content, the candidate, the sources and what to check next, then go
  find the missing evidence instead of forcing the write.
- Treat the report as the answer, not a success flag: `failure` means no summary
  was available, `conflict` means the fidelity gate refused a claim,
  `unresolvedConflicts` means a concurrent session replaced the same knowledge
  first and this run's correction did not land (read `conflictDetails` for both
  sides' materials and the current content; the result is then `isError: true`),
  `resolvedCollisions` counts collisions resolved after one re-read and
  re-judge, and `budgetRejected` means a session cap stopped the run.
  `usage.costBasis = "unknown"` means the cost is unknown, not zero.
  `summariesSuspended` / `suspendedSummaries` mean a stored summary in some
  session stated the fact this run replaced; that summary stops being injected
  until the next turn of that session rebuilds it (see below).
- In a terminal, `ans consolidate --session ID` or `--memory ID` runs the same
  path, and it exits 2 when no scope is given.

## Suspended summaries (after a correction)

A correction can make a stored session summary stale. That summary is not
injected as a current conclusion any more; the next turn of the owning session
tries to rebuild it once, from the sources it originally read (now resolved to
their current versions) plus that session's own stored user turns.

- You do not start a rebuild yourself. It is automatic, once per suspended
  summary, and it is reported in the run's `structuredContent.summaryRebuilds`
  (and as one `[summary]` line in the answer text):
  - `rebuilt` with `cleared: true` — a current version is back and is injected
    from the next turn on.
  - `already-current` — the new version is current and injectable too; the only
    thing that did not happen is the clear (no suspension row was left open, so
    something else cleared it first). Read `reasons`, do not re-run anything.
  - `stored-not-current` — the text was written but is suspended as well, because
    a source was replaced mid-rebuild. Nothing is injected; a later turn retries.
  - Any other outcome means the summary is STILL suspended, and `reasons` says
    what was missing (no recorded sources, no stored user turn, over budget, no
    model configured, or the model produced nothing).
- The task requirement in a rebuilt summary comes from the user's own stored
  turns, never from the old summary text, from tool output or from memory. If
  the reasons say there is no stored user turn, the rebuild cannot recover the
  task — ask the user instead of assuming what they wanted.
- Do not treat "no `[Session Memory]` block" as "this session has nothing" when
  a `summaryRebuilds` entry is present: read its reasons.

## Anti-patterns

- Do NOT call search_web again when recall_memory results already answer the question. Search again when those results are incomplete, out of date, or the user asks for the latest.
- Do NOT call ans_chat for a simple fact lookup (use search_web instead)
- Do NOT call research_web for a one-step question (use search_web instead)
- Do NOT ignore recall_memory results when they exist
- Do NOT consolidate without naming the materials. "Consolidate everything" is not
  a default; the call is rejected without a scope on purpose.
- Do NOT run consolidate in the background on a timer. It is an explicit action.

## Namespace conventions

All anysearch tools use the ans_* prefix. Host agents may add their own namespace
prefix (for example mcp__anysearch__search_web). The hook code matches any tool
name that contains ans_ followed by a known tool name.

## When something breaks

If the anysearch server is down, continue without the memory features.
Errors are written to stderr, and the tool returns an empty result.
