# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## File structure

This repo is **single-context**:

```
/
├── CONTEXT.md          ← glossary (domain terms only, no implementation details)
├── docs/adr/           ← architecture decision records, 0001 through 0049
├── apps/cli/           ← anysearch CLI entry
├── apps/mcp/           ← MCP server
├── apps/plugin/        ← hooks layer and project-index plugin
└── packages/           ← embedding, kernel, retriever, store
```

No `CONTEXT-MAP.md` at the root → single-context, not multi-context.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary of domain terms.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When discussing the codebase, use the terms defined in `CONTEXT.md`. When you introduce a new term that isn't in the glossary, add it via `/domain-modeling` — don't leave it fuzzy.

## Flag ADR conflicts

If code contradicts an accepted ADR, flag it. If an ADR is `Proposed` and code already implements a different path, note the divergence for the next grill round.
