# /goal — grill-round-63（已定稿）

## 主题（D-001 裁决）
npm 0.0.1 go/no-go 终审 + 前置清障逐项过堂（阻塞/带病/后置三出口）。终态=机器可验的发布裁决书+（若 go）发布执行票。

## 账本
.scratch/grill-round-63/decision-ledger.md：D-001..D-008 全部 current。任务书：handoffs/next-round.md（T1-T8，每票声明 D-xxx 覆盖）。调研报告：q2/q3/q5/q8-atomcode.md。

## 关键形态
- 发布形态=bundled-CLI（D-005）：3 app + embedding 第4包 peer-optional；LICENSE=Apache-2.0（D-007）。
- 发布执行=用户本机手动首发（已 npm login），门序：T票全落+main 双绿→pre-tag dispatch→tag v0.0.1→post-tag→publish→72h 窗内净机自验（D-006/D-008）。
- Blocker：con_add_then_noop（T1，D-002）；带病：10 隔离案例+棘轮断言（T3/T6，D-003）。

## 约束
publish/tag/push 等外部副作用由用户亲手执行或当场授权；TAVILY key 在环境变量 1（不明文）；版本控制一律 but；写文件用 node.js；shell=bash（ctx_execute）。
