# T0 哨戒实录 — 2026-09-26（UTC，观测时刻 12:03Z）

## dsh 版本线（双锚判定面）

| 锚 | 状态 | 实测 |
|---|---|---|
| 全族钉版现状 | ✅ rc.1 在役 | pnpm-lock.yaml 全族 `@deepseek-ai/dsh-*: 0.1.7-rc.1`（catalog 消费）；上游最新 = `0.1.7-rc.2`，无 rc.3+。 |
| rc.2 特征锚 | ✅ 同形复验 | `npm view @deepseek-ai/dsh-agent@0.1.7-rc.2 dist.tarball` 解开 `lib/types/runtime-types.d.ts`：`SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`（L105）；`'agent/created'` payload 携 `source: SessionStartSource`（L227-229）；`agent/session-start` 在全类型声明中缺席。与 rc.1 同形。 |
| rc.2 稳定锚 | ⏳ 边界 | rc.2 published `2026-09-24T14:01:59.702Z`；闸 = `minimumReleaseAge: 2880`（48h）→ 闸点 ≈ 2026-09-26T14:02Z。观测时刻 12:03Z 距闸点 ~2h——**如实记「闸窗临界」**，不越线记已过。 |
| changelog 面 | ✅ 补齐 | GitHub Release `dsh-v0.1.7-rc.2`（published 2026-09-24T14:10:21Z）发版注记齐全：新增提醒/桌面引导/快捷键/自动审阅等产品面条目 + 修复/调整/优化四节 + compare 链接；注记全部为产品面，未涉 `agent/created`/`SessionStartSource` 语义变化（类型锚以上游 tarball 为准实测，changelog 面无冲突）。 |

**结论行**：rc.2 版本线面齐（changelog 补全+特征锚同形），钉版维持 rc.1 不动——本轮 T0 哨戒域不含 repin 消费裁决；rc.3+ 版本线续 watch。

## CI 观测（test-online-anysearch 腿+主轨）

- `gh run list --limit 12`（12:03Z 采样）：最新三 workflow（ci 36219863642 / native-smoke 36219863616 / ship-gate 36219863649 @2026-09-26T05:07:34Z，同 push `docs(r83-t4)`）全 success；前一窗口 05:01:24Z ship-gate failure（`docs(r83-audit)`）系同 push 被后续重跑覆盖形态——与 R83 观测同型，未见 online 专属红信号。登记为：未见异常。

## llm-init SSE flake 哨

- 本轮 turbo test 全量收尾时复核（T 票收口联动）；哨项登记续班。

## #1764 watch

- `gh pr view 1764 --repo huggingface/transformers.js` → `{state:OPEN, updatedAt:2026-09-03T11:42:12Z}`。**OPEN 趋僵续记**（~23 天无更新）；用户侧评论外发仍挂——不代发。

## 红线遵守

- ANYSEARCH_ENDPOINT 用户配置域未录值未代改；本档不录本机环境具体值。
