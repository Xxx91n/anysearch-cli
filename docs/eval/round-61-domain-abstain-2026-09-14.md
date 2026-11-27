# Round-61 domain abstain — 2026-09-14

This file is the evidence for ticket **#656** under spec **#643** (section E). It backs two
corpus entries: `docs-g0012` (the in-domain half of the abstain pair) and `docs-g0014` (cold-domain zero-result abstain). The raw text was recovered from
`0f1148ca`, where it lived in `.scratch/grill-round-61/handoffs/next-round.md` and
`.scratch/grill-round-61/narrow-domains/cold.toml`; neither path is in a clean checkout.
The corpus refs still point at those old paths; ticket #665 repoints them at this file.

The ADR layer was removed in `5593fe05`. The ADR numbers and `D-xxx` decision ids below are historical names,
not links that still resolve.

## Trigger

Round-61 closed a real bug: the docs domain answered questions from outside its domain. The
fix rested on four golden criteria, and two of them became corpus entries. Their provenance
used to be workspace files, so a reader in a clean checkout got two ids and no way to see
why they exist. This card is the replacement.

## Method

- Date: 2026-09-14.
- Material: the round-61 task book (its T4 row and the 判据 5 paragraph) and the
  `cold.toml` fixture, all copied from `0f1148ca`.
- No endpoint and no request body: this is a decision record plus a local TOML fixture, not a
  live probe. It needs no key, and none is recorded.
- Read-only: the text is copied as found. No runtime code was changed.

## Raw

### T4 row

| 票 | 内容 | 覆盖 D-xxx | 验收锚点 |
|---|---|---|---|
| T4 | golden 判据 1-4 落 eval-looks：域外 must-abstain / 域内 must-hit（成对）/降级 stub provider golden/冷门域 0 结果；ship-gate 接线 | D-003 | 离线 golden 全绿；断言锚 verdict 字段非 regex |

### 判据 5

判据 5 补充：Tavily changelog 2026-08 实锤 `include_domains_mode` boost=软模式会泄漏、Research 端点软偏好、子域匹配方向性——探针要测：默认 mode 是否等效 boost、子域覆盖方向、端点差异；结果入 INJECT 式账本，驱动 capability 表。

### cold.toml

```toml
# Round-61 e2e fixture: domain whose allowlist host has no real content.
# Every provider result is out-of-domain -> authoritative gate empties -> abstain.
name = "cold"
description = "cold-domain abstain fixture (ADR-0062 criterion 4)"

[settings]
language = "TypeScript"
depth = "docs"

[skills]
active = ["search"]

[sources]
enabled = ["tavily", "exa"]
urlAllowlist = ["nonexistent.invalid"]

[rag]
adapter = "none"
```

## Evidence table

| entry | assertion | what supports it |
|---|---|---|
| `docs-g0012` | An in-domain zh question must answer and hit `pnpm.io`. That is the must-hit half of judgement 2: the half that catches a post-filter which over-abstains. | The T4 row (域内 must-hit 成对) and the ship-gate wiring it names. The check reads the `verdict` field, never a regex over the reply. |
| `docs-g0014` | The cold domain must return zero surviving results and abstain. | `cold.toml` above: the only allowlisted host is `nonexistent.invalid`, so every provider result is out of domain and the gate empties the set. The end-to-end arm is `apps/cli/test/abstain.test.ts`, the `5. Built-CLI arm` case, live arm. |

## Scope

- Provenance only: no corpus entry is added, no runtime code changes, and the check is not
  re-run here. This file is meant to stay as committed.
- `cold` is a made-up domain whose allowlist cannot resolve. That is deliberate: the
  abstain path is proven with no live source in play.
- The 判据 5 paragraph is kept because the ticket asks for it; it sets up the capability table
  beside the pair and does not back either entry.
- The `.scratch/...` paths above are historical. This file is where their text lives now.
