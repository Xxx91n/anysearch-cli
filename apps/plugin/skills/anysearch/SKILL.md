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

**ans_chat** — An agent loop (PiAgentRuntime) for research that needs several tools in a row. Use it when one tool call is not enough.

## Decision tree

1. Is this a fact lookup or a current event? -> search_web
2. Does it need research across several steps? -> research_web
3. Have we searched this topic before? -> recall_memory first, then search_web only if results are missing
4. Is this about internal company knowledge? -> query_knowledge
5. Does it need several tools in a row? -> ans_chat

## Anti-patterns

- Do NOT call search_web for a topic that recall_memory already returned results for
- Do NOT call research_web for a simple fact question (use search_web)
- Do NOT call ans_chat when one tool call is enough
- Do NOT ignore recall_memory — it saves API calls and tokens

## Mandatory rules

- Always check recall_memory before starting a new search_web on a topic already discussed
- If the anysearch server is unreachable, continue without the memory features; do not wait for the server to come back
- Tool names: all anysearch tools use the ans_* prefix (a host may add its own prefixes)
