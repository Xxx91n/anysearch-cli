---
name: ans
description: Search the web across several sources, run deep research, recall earlier results from local memory, query an organization knowledge base, and save selected materials as long-term knowledge, through the anysearch ans_* tools. Use when the user asks to look something up, research a topic, check current events, or find the result of an earlier search.
---

# ans skill

Research and fetch information from many sources, with persistent memory.

## When to use

- The user asks to search the web, research a topic, or look up current events
- The user needs deep research across several steps, with a written answer
- The user wants earlier search results from memory
- The user needs the organization's own knowledge base
- The user has a research question that needs several tool calls
- The user wants to save selected research results as long-term knowledge

## Tools

- **search_web** — Search the web now, across several sources at once (Exa, Tavily, Anysearch). Removes duplicates and merges the ranked lists into one order (RRF). Use it for facts, current events and quick answers.
- **research_web** — Deep research. Runs for minutes, follows leads across several steps, checks sources and writes up what it found. Use it for questions that need a thorough investigation.
- **recall_memory** — Look through earlier research results stored in local memory (FTS5 keyword search). Older records slowly lose weight as they age. Always try this before running the same search_web again.
- **query_knowledge** — Search the organization's own knowledge base. Use it when the question is about internal documents and that knowledge base may hold the answer.
- **ans_chat** — An agent loop (PiAgentRuntime) for research that needs several tools in a row. Use it when one tool call is not enough. With `operation="consolidate"` it instead turns selected stored materials into long-term knowledge (see below).

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
  rejected — there is no "consolidate everything".
- If you pass both, `memoryIds` wins and the session does not widen it. Read
  `structuredContent.scope` to confirm what was actually read.
- Preview first when the outcome matters: `dryRun: true` saves nothing, but it can
  still call the model and cost money.
- One reliable material can correct existing knowledge: `allowSingleEvidence:
  true`. The exception is decided per entity cluster, not per call: a `sessionId`
  scope can correct an entity only when that session holds exactly one
  non-superseded material for that entity, and a session with one such material
  for each of several entities can correct each one separately. An entity with
  three or more materials uses the batch path; with two, it is skipped. Preview
  with `dryRun: true` and read `structuredContent.scope` before applying.
  `memoryIds` with one entry is the precise form. It may only correct, never
  create new long-term knowledge. A refusal is a normal answer — read
  `verifyDetails` for the old content, the candidate, the sources and what to
  check next, then go find the missing evidence instead of forcing the write.
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

- You do not start a rebuild yourself. It is automatic for a suspended
  `rolling_summary` (the session memory block), once per anchor per run, and it
  is reported in the run's `structuredContent.summaryRebuilds` (and as one
  `[summary]` line in the answer text). A suspended `l2_recall` block (the
  research-recall snippet) is NOT rebuilt: it belongs to the query that produced
  it, so the next search turn regenerates recall on its own. It still appears in
  `summaryRebuilds` with the reason, so its absence is never silent.
- Read `outcome` for a rolling summary before reporting anything to the user:
  - `rebuilt` with `cleared: true` — a current version is back and is injected
    from the next turn on.
  - `already-current` — the new version is current and injectable too; the only
    thing that did not happen is the clear (no suspension row was left open, so
    something else cleared it first). Read `reasons`, do not re-run anything.
  - `stored-not-current` — the text was written but is suspended as well, because
    a source was replaced mid-rebuild. Nothing is injected. The rebuild is tried
    once per anchor per run, so a NEW run (a new ans_chat call or a new `ans chat`
    process) tries again — do not expect a retry inside the same run.
  - Any other outcome means the summary is STILL suspended, and `reasons` says
    what was missing (no recorded sources, no stored user turn, over budget, no
    model configured, or the model produced nothing).
- The task requirement in a rebuilt summary comes from the user's own stored
  turns, never from the old summary text, from tool output or from memory. If
  the reasons say there is no stored user turn, the rebuild cannot recover the
  task — ask the user instead of assuming what they wanted.
- Do not treat "no `[Session Memory]` block" as "this session has nothing" when
  a `summaryRebuilds` entry is present: read its reasons.
- Old derived summaries without source records are checked only when needed.
  The original text remains available as a lookup lead. Recovery uses exact
  source ids in the original tool records (or refs already in the payload),
  never rows chosen just because they share a URL, wording or session. The NEW
  summary records what the recovery actually read; it does not invent the old
  summary's missing history. Missing original user requirements, source versions
  or a verifiable record order mean `incomplete`, with no recovery model call.
  Legacy records stored within the same timestamp second may have no provable
  order and stay incomplete. Ordinary sourced materials remain searchable.
- Legacy recovery results and each attempt are kept across restarts, with reasons
  and any provider usage. Successful or incomplete recoveries do not repeat paid
  calls for unchanged evidence. A generation/write failure or interrupted attempt
  can retry after five minutes, only when a NEW ans_chat call or ans chat process
  needs it; no timer starts background work. A new call/process also rechecks
  restored original records or a changed current source version. Recovery shares
  the normal summary usage and cost report; missing provider usage means unknown
  cost, not free recovery.

## Anti-patterns

- Do NOT call search_web again when recall_memory results already answer the question. Search again when those results are incomplete, out of date, or the user asks for the latest.
- Do NOT call ans_chat for a simple fact lookup or when one tool call is enough (use search_web instead).
- Do NOT call research_web for a one-step question (use search_web instead).
- Do NOT ignore recall_memory results when they exist — it saves API calls and tokens.
- Do NOT consolidate without naming the materials. "Consolidate everything" is not
  a default; the call is rejected without a scope on purpose.
- Do NOT run consolidate in the background on a timer. It is an explicit action.

## Namespace conventions

All anysearch tools use the ans_* prefix. Host agents may add their own namespace
prefix (for example mcp__anysearch__search_web). The hook code matches any tool
name that contains ans_ followed by a known tool name.

## When something breaks

If the anysearch server is unreachable or down, continue without the memory
features and do not wait for the server to come back. Errors are written to
stderr, and the tool returns an empty result.
