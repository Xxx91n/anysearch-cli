# 02 — fix-r82-dsh-event-created-consumption（TE1 条件辅轴，预注册票）

Status: pending-trigger（预注册——双锚未齐不执行）
Covers: D-003 全

## 触发判据（预注册，判定/执行解耦）

特征锚（dsh 候选 tarball .d.ts 中 `agent/created` 携 source/signal 且 `agent/session-start` 缺席）+稳定锚（rc-or-stable 线+过 minimumReleaseAge 闸+changelog 审过）双锚齐 → 本票即时成立执行。

## 票体（触发后执行序钉死 T1 主轴落地后）

1. repin 全族按新锁文件重推导（alpha.1 实测已扩 21 个 dsh-*）。
2. `apps/dsh-plugin/src/index.ts` `ctx.on('agent/session-start')` → `ctx.on('agent/created')` + `source!=='startup'` guard（T0 实测 SessionStartSource 枚举=startup|resume|clear|compact，**无 'fresh'**——guard 按实测枚举落字；resume/clear/compact 不重复注路由卡）。
3. 测试面更新+L2 彩排（装跑+dsh plugin add 实测）。

## 五护栏

时间盒≤主轴 20%（超时封票记「时间盒耗尽」）；回退线（出闸晚于主轴 DoD 冻结点/L2 彩排败→自动转下轮记「错过窗口」不伪造完成）；DoD 独立（repin 落地+验收面过≠写了代码）；动主轴容量须具名换出项；频度熔断（连续触发→retro/ADR 回溯漏斗节奏）。

## 验收

票本体存在+验收面独立+护栏记录可查。未触发→T0 记「合格候选未出现」；已触发未执行→转 R83 记「已合格未消费」。
