# 02 — fix-r82-dsh-event-created-consumption（TE1 条件辅轴，预注册票）

Status: done（R83 TE1 闸开先行消费完毕 @2026-09-25）
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

## Comments

- 2026-09-25 R83 TE1 消费实录：双锚齐当日触发——特征锚=rc.1/rc.2 tarball 双验 agent/created 携 source/signal+session-start 缺席；稳定锚=rc.1 过 2880min 闸（09-23T13:25Z+48h）、changelog 审面已检（上游无 CHANGELOG 文件，GitHub Releases 有 rc.1/rc.2 发版注记）。消费目标=rc.1（rc.2 龄 25h<48h 被 minimumReleaseAge 拦截，下一窗口 09-26T14:02Z）。落地=commit on r83-te1：catalog+overrides 枚举重推导 21 名（peer 闭包实测）；index.ts 迁移+startup guard+MessageId brand/anysearch-plugin 自有 kind 增扩；测试面 14/14 绿（新增 resume/clear/compact 不注入用例）；L2 彩排=pack→dsh plugin --profile headless add→dump-config 层验+Already-up-to-date 幂等。论证边界三条件入档：①双锚判据成立②时间盒≤主轴 20%③闸开当日消费——齐。残留备注：本机宿主 dsh=0.1.5-rc.2（旧宿主 agent/created payload 无 source→guard 自然不注入=静默降级预期）；行为面在 ≥0.1.7 宿主生效。
