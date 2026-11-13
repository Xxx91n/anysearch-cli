---
name: anysearch
description: Search the web now, run deep research, recall earlier results and look things up in a knowledge base, through the anysearch ans_* tools.
---

# Anysearch skill

Research and fetch information from many sources, with persistent memory.

## When to use

- The user asks to search the web, research a topic, or look up current events
- The user needs deep research across several steps, with a written answer
- The user wants earlier search results from memory
- The user needs the organization's own knowledge base
- The user has a research question that needs several tool calls

## Tools

**search_web** — Search the web now, across several sources at once (Exa, Tavily, Anysearch). Removes duplicates and merges the ranked lists into one order (RRF). Use it for facts, current events and quick answers.

**research_web** — Deep research. Runs for minutes, follows leads across several steps, checks sources and writes up what it found. Use it for questions that need a thorough investigation.

**recall_memory** — Look through earlier research results stored in local memory (FTS5 keyword search). Older records slowly lose weight as they age. Always try this before running the same search_web again.

**query_knowledge** — Search the organization's own knowledge base. Use it when the question is about internal documents and that knowledge base may hold the answer.

**ans_chat** — An agent loop (PiAgentRuntime) for research that needs several tools in a row. Use it when one tool call is not enough. With `operation="consolidate"` it instead turns selected stored materials into long-term knowledge (see below).

## Decision tree

1. Is this a fact lookup or a current event? -> search_web
2. Does it need research across several steps? -> research_web
3. Have we searched this topic before? -> recall_memory first, then search_web only if results are missing, incomplete, out of date, or the user asks for the latest
4. Is this about internal company knowledge? -> query_knowledge
5. Does it need several tools in a row? -> ans_chat
6. Are the results worth keeping as long-term knowledge? -> ans_chat with operation="consolidate"

## Saving research results (consolidation)

Call `ans_chat` with `operation="consolidate"` when results should become durable
knowledge. Do not do it every turn.

- Pick the scope and pass it: `sessionId` for one session's materials, or
  `memoryIds` when you already hold real positive integer material ids
  (`recall_memory` does not return them, so do not guess). A call with neither is
  rejected — there is no "consolidate everything".
- If you pass both, `memoryIds` wins and the session does not widen it. Check
  `structuredContent.scope` to confirm what was actually read.
- `dryRun: true` saves nothing but can still call the model and cost money.
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
- Read the report as the answer: `failure` = no summary, `conflict` = the
  fidelity gate refused a claim, `budgetRejected` = a cap stopped the run.
  `usage.costBasis = "unknown"` means the cost is unknown, not zero.

## Anti-patterns

- Do NOT call search_web again for a topic whose recall_memory results already answer the question. Search again when those results are incomplete, out of date, or the user asks for the latest.
- Do NOT call research_web for a simple fact question (use search_web)
- Do NOT call ans_chat when one tool call is enough
- Do NOT ignore recall_memory — it saves API calls and tokens
- Do NOT consolidate without naming the materials, and do NOT run it on a timer

## Mandatory rules

- Always check recall_memory before starting a new search_web on a topic already discussed
- If the anysearch server is unreachable, continue without the memory features; do not wait for the server to come back
- Tool names: all anysearch tools use the ans_* prefix (a host may add its own prefixes)
