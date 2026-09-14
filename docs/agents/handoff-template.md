# Handoff Template — round 交接格式（R62 T9 due-chore）

Every round-closing handoff under `.scratch/<slug>/handoffs/` carries these
required fields. The template exists so the next agent can re-verify claims
without re-reading the whole conversation.

## Required header

```
# Round-NN → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  <branch> → <but-id> (<sha> @ <iso-date>) → ...

## 已完成
## 绿色 run URL（必填）
## 下一轮候选
## Known risks / deferred
```

## Field rules

- **Stack line — but-id is the primary key.** Full SHAs are
  TIME-LAGGED: `but absorb`, `but reword`, and any mid-stack rewrite change
  a commit's SHA while its change-id (the short `but status` id, e.g. `nmo`)
  survives. Cite `but-id` first, SHA second with its capture date — never
  trust a bare SHA recorded earlier than the latest stack rewrite.
- **绿色 run URL — REQUIRED field, not optional.** Every claim of
  "CI green" or "ship-gate green" names the workflow run URL(s):
  `https://github.com/<owner>/<repo>/actions/runs/<id>`. If the runs do not
  exist yet (stack not pushed), write `PENDING — stack unpushed` explicitly;
  a missing/pending field is honest, an absent field is not.
- **Redaction** — no API keys, tokens, or secrets anywhere in the doc
  (ledger files record `key: set`, never the value).
- **Suggested skills** — name the skills the next agent should invoke
  (`$implement`, `$handoff`, etc.) so workflow continuity survives.
