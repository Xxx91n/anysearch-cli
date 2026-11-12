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
- Treat the report as the answer, not a success flag: `failure` means no summary
  was available, `conflict` means the fidelity gate refused a claim, and
  `budgetRejected` means a session cap stopped the run. `usage.costBasis =
  "unknown"` means the cost is unknown, not zero.
- In a terminal, `ans consolidate --session ID` or `--memory ID` runs the same
  path, and it exits 2 when no scope is given.

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
