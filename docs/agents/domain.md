# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root — the glossary of domain terms (term → ≤2-sentence definition).

If it doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront.

## File structure

This repo is **single-context**:

```
/
├── GLOSSARY.md         ← glossary (domain terms only, no implementation details)
├── apps/cli/           ← anysearch CLI entry
├── apps/mcp/           ← MCP server
├── apps/plugin/        ← hooks layer and project-index plugin
└── packages/           ← embedding, kernel, retriever, store
```

No `GLOSSARY-MAP.md` at the root → single-context, not multi-context.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (add the term to `GLOSSARY.md`).

## Decision history

Architecture decision records are no longer kept as documents. Load-bearing decisions live as self-contained comments at the code sites they govern; open product questions live as GitHub issues. Archaeology: `git log` on the pre-teardown history.
