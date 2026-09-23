# T0 — 上游哨戒取证 transcript（ride-along，纯证据零代码）

Date: 2026-09-23. 观测窗口截至戳 = **2026-09-23T10:11:30Z**（UTC）。闸 = `minimumReleaseAge: 2880`（48h）。快照 JSON = `evidence/t0-watch.json`（npm view + gh pr view 原文 + L1 探针摘要）。

## L0 npm view 快照（采样 2026-09-23T10:11:30Z）

`npm view @deepseek-ai/dsh-agent time version dist-tags --json` → 全表存 t0-watch.json。关键行：

| 版本 | 发布时间 (UTC) | 出闸点 (+2880min) | 采样时闸态 | dist-tag |
|---|---|---|---|---|
| `0.1.5-rc.3` | 2026-09-22T05:39:36.425Z | ≈2026-09-24T05:39:36Z | **闸内**（剩 ~19h28m）| `next` |
| `0.1.7-alpha.1` | 2026-09-22T06:04:55.999Z | ≈2026-09-24T06:04:56Z | **闸内**（剩 ~19h53m）| —（alpha 已让位）|
| `0.1.7-alpha.2` 🆕 | 2026-09-22T15:50:04.145Z | ≈2026-09-24T15:50:04Z | **闸内**（剩 ~29h39m）| `alpha` |
| 现钉 `0.1.5-rc.2` | 2026-09-10T14:44:55.316Z | 已出 | 出闸 | — |

dist-tags：`latest=0.1.0-rc.6` `next=0.1.5-rc.3` `alpha=0.1.7-alpha.2`（alpha 线 09-22T15:50Z 自 alpha.1 推进至 alpha.2）。

## L1 探针（npm pack 拆包 .d.ts，scratch=%TEMP% 外不入仓）

| 候选 | `agent/created` payload | `agent/session-start` | 特征锚判定 |
|---|---|---|---|
| `0.1.5-rc.3`（rc 线）| `{agent}` —— 无 source/signal | 在位（runtime-types.d.ts:298）| **无锚**（与 R77 实录一致，复核确认）|
| `0.1.7-alpha.2`（alpha 线）| `{agent, source: SessionStartSource, signal?: AbortSignal}`（runtime-types.d.ts:227-230）| **缺席**（全包 grep 0 命中）| **特征锚齐** |

双锚裁决（ADR-0078 D2，版本号不进触发逻辑）：
- **特征锚**：alpha.2 = ✅（created 携 source+signal 且 session-start 缺席）；rc.3 = ❌。
- **稳定锚**：alpha.2 位于 `alpha` 线非 rc-or-stable 线 → ❌；changelog 未经审阅 → ❌。
- **L2 合格候选：本轮仍不存在**。alpha.2 是事件重命名双锚的最近携带者——若其内容后随 rc/stable 线发布且 changelog 过审即转合格候选，如实呈报供下轮哨戒。

## #1764 哨

`gh pr view 1764 --repo huggingface/transformers.js --json state,mergedAt,updatedAt,title` →
`{"mergedAt":null,"state":"OPEN","title":"Added knip to the test pipeline","updatedAt":"2026-09-03T11:42:12Z"}`
网络可达、实测已验。OPEN 趋僵（updatedAt 20 天前）——观察哨续挂，外发 comment 仍属用户动作。

## 格式化结论行

`watch @ 2026-09-23T10:11:30Z: rc.3=gated(until≈2026-09-24T05:39Z,no-anchor), alpha.1=gated(until≈2026-09-24T06:05Z,superseded-by-alpha.2), alpha.2=gated(until≈2026-09-24T15:50Z,feature-anchor=YES,stability-anchor=NO[alpha-line+changelog-unreviewed]), #1764=OPEN(stale), action=none`

## 零脏声明

纯证据零代码：npm view/gh 只读 + npm pack 拆包于 %TEMP%（不入仓）；依赖面未触。`git status --porcelain` 在收口验收复核。
