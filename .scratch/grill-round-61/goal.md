# Grill Round 61 — goal

主题：docs 域对域外提问 abstain 收口（bc0001 升正票）+ README 用户向重写（ADR-0062 D-001..D-005）

## 状态：完成（2026-09-14）

串行五票全部独立提交于 GitButler 栈（grill-61-docs 之上）：

| 票 | 分支 | but id | git hash | 验收 |
|---|---|---|---|---|
| T1 | r61-t1-prefilter | nmo | c595792 | adapter 单测 11 绿 + tsc 0 + 探针账本（无 key SKIPPED 诚实） |
| T2 | r61-t2-postfilter | ktl | c7bf545 | kernel 域过滤测试 31 断言绿 + e2e dropped=1 + abstain 落库 |
| T3 | r61-t3-present | mml | 7da70fc（+修正 put/a355ccb）| CLI 15 断言（含 dist 子进程 exit 0/3 实测）+ MCP 契约 9 断言 |
| T4 | r61-t4-golden | rsn | 8344941 | golden 14 条（判据1-4 锚）+ manifest 重计数 + ship-gate 1n 块 |
| T5 | r61-t5-readme | lsk | f1f002c | README 用户向重写 + 全命令实测 + doctor/auth key 漂移修复 |

## 最终验收

- ship-gate 9/9 全绿（含 turbo check/test/build + pack + install verify + MCP initialize + fail-open）
- 验收原文核对：编译✓(turbo check 7/7) 打包✓(5 tgz + npm install --prefix 验) 进程测活✓(MCP initialize + HTTP health 200) 每平台 test 闭环✓(retriever 11/kernel 31+31/store 44/cli 12+15live/mcp 9+14/plugin 绿)
- npm 发布：保持 deferred（D-001，未动）

