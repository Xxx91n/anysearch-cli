# Domain Docs

How the engineering skills should read this repo's domain docs while exploring the codebase.

## Read these first

- **`GLOSSARY.md`** at the repo root — the word list for domain terms (one plain sentence per term).

If it is missing, say nothing and move on. Do not point out that it is missing, and do not suggest creating it up front.

## File layout

This repo has one context:

```
/
├── GLOSSARY.md         ← glossary (domain terms only, no implementation details)
├── apps/cli/           ← anysearch CLI entry
├── apps/mcp/           ← MCP server
├── apps/plugin/        ← hooks layer and project-index plugin
└── packages/           ← embedding, kernel, retriever, store
```

There is no `GLOSSARY-MAP.md` at the root, so this is single-context, not multi-context.

## Use the glossary's words

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the word as `GLOSSARY.md` defines it. Do not drift to synonyms.

If the concept you need is not in the glossary yet, that is a signal: either you are inventing language the project does not use (think again) or there is a real gap (add the term to `GLOSSARY.md`).

## Decision history

Architecture decision records are no longer kept as documents. Decisions that matter live as self-contained comments at the code they govern; open product questions live as GitHub issues. To dig into the past, run `git log` on the pre-teardown history.

Record a decision that matters at its code site as a self-contained, greppable comment:

```
Design: <decision> — <reason/alternatives>
```

- `Design:` — the literal marker; `git grep 'Design:'` finds every recorded decision.
- `<decision>` — what was chosen, stated plainly.
- `— <reason/alternatives>` — why, or which other option was rejected and why.

Keep the comment next to the code it governs, so the decision travels with the code instead of with a document that can be deleted.

**Status, honestly: past decisions are not backfilled.** The grammar above is the rule from now on; decisions made before it still live only in `git log` archaeology. So a code site without a `Design:` marker does not prove that no decision was made there. It only proves that no one has recorded it this way yet.
