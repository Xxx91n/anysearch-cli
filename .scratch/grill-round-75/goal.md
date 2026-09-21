# Grill Round 75 — Goal（定稿态）

## 主题

`defer-r71-transformers-undeclared-dep` 判定性清算轮——上游触发器「半响」判定与债务处置（D-001/D-002）。

## 终局裁决（账本 D-001~D-006 全 current）

1. 上游删除条件**未达成**：4.3.0 仍顶层 bare require `onnxruntime-common` 且 manifest 未声明（tarball 解剖+atomcode 双证）→ scoped patch 续存（随行护栏=唯一消费者闭环机制）。
2. 施工姿势 A+：留 transformers 3.8.1 不迁 + 上游申报（advocate 已飞修复：#1764 OPEN PR 已含同款一行修，评论落证据推合并）+ registry 证据刷新。
3. ESM 缺口 B+：静态护栏双件（禁裸引断言+版本配对断言单测）+三条重返触发器；registerHooks 具名重返票 deferred。
4. 票序 T0→T3 串行；收口四段（实证/申报/护栏/文书）；不外发由 Agent 代发——评论文稿用户审后亲手发。

## 显式范围外（ledger 裁决，勿扩张）

- 迁 transformers 4.x（B 否：sharp 零增量、ORT 换线+e5/q8 复验真成本、收益仅追维护线）
- A+B 双轨（C 重定为演进项：e5 q8 在 4.x 复验通过+上游仍不动时才触发）
- registerHooks ESM 臂（具名重返票 deferred）
- 自交一行修 PR / 新开 issue（修复已在飞）
- dsh event-rename 采纳（0.1.6-rc.1 未发）、logo bitmap（imagegen 缺席）、全部落选债原名不动
- bump 版本/发布（无发布态代码增量——判定入 ADR 显式记录）

## 路径纪律自证（ADR-0072 dogfood）

本轮文档库内引用全部 repo-relative；机器临时路径（tarball 解剖目录）不入库或带 machine-local 标记。

## 当前事实状态

- 账本：6 条 current 无断号，物理文件已落盘
- 调研存档：q2-atomcode.md / q3-atomcode.md / q2-prompt.txt / q3-prompt.txt 已入库
- 实施：未开始（等 T0 指令）

## 用户确认闸（票内，非 grill 级）

- T1 评论文稿：用户审阅→亲手发（外发权在用户）
- T2 断言选型：按 repo 既有 lint 形态（票内决定，无闸）

## 遗留呈报项（T3 收口时核销）

- `origin/r71-grill` 已消失（remote 仅剩 main）——上轮列报的删除候选事实核销，无需操作
- 落选债显式续债条：shipgate-1g（registry 明示不得再静默飘过——本条最重）/provider-000/dsh 三件套/bitmap/f16/f17/domain-ownership
