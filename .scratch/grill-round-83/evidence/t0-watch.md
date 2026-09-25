# T0 哨戒实录 — 2026-09-25（UTC）

## 双锚判定（dsh 事件迁移触发条件）

| 锚 | 状态 | 实测 |
|---|---|---|
| 特征锚 | ✅ 齐 | `npm view @deepseek-ai/dsh-agent@0.1.7-rc.1` tarball（dist.tarball 解开 `lib/types/runtime-types.d.ts`）：`agent/created` payload 携 `agent` + `source: SessionStartSource` + 可选 `signal`；`SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`；`agent/session-start` 在全类型声明中缺席。rc.2 同形复验。 |
| 稳定锚 | ✅ 齐（对 rc.1） | rc.1 published `2026-09-23T13:25:40Z`；闸=pnpm-workspace `minimumReleaseAge: 2880`(48h)；判定时刻 2026-09-25T15:10Z → rc.1 龄 ~49.7h 已过闸。rc.2 published `2026-09-24T14:01:59Z`，龄 ~25h 未过闸（闸点 09-26T14:02Z）。消费目标=rc.1。 |
| changelog 审面 | ✅ | 上游 tarball 无 CHANGELOG 文件（包内容清单实测）；GitHub Releases `dsh-v0.1.7-rc.1` 页面有发版注记已审。仓：github.com/deepseek-ai/deepseek-harness。 |

**双锚判定行：齐 → TE1 闸开，当日（09-25）消费，目标版本 0.1.7-rc.1。**

## #1764 watch

- `gh pr view 1764 --repo huggingface/transformers.js` → `{state:OPEN, mergedAt:null, updatedAt:2026-09-03T11:42:12Z, title:"Added knip to the test pipeline"}`。**OPEN 趋僵续记**（22 天无更新）；用户侧评论外发仍挂——不代发。

## test-online-anysearch 首周观测

- `gh run list --limit 15`（09-25T15:20Z 采样）：最新三 workflow（ci/native-smoke/ship-gate @2026-09-25T02:06:29Z）全 success；此前 02:04:52Z 一组 failure 系同 push 窗口内被 02:06Z 重跑覆盖（cancelled+重跑成功序列）。online 套件不在 turbo test 全量内（CI 专属腿），本周观测窗内未见 online 专属红信号。登记为：未见异常。

## llm-init.test.ts SSE flake watch

- 本轮 turbo test 全量中 `llm-init.test.ts` 通过（kernel suite 66/66 绿），未复现 flake。登记为：本轮观测窗口内未现。
