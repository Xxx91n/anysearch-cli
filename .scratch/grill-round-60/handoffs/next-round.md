# Round-60 下轮 Fixer 常驻任务书（handoff）

**来源**: 唯一数据源 = `.scratch/grill-round-60/decision-ledger.md`（D-001..D-006）；本任务书不引入账本外任何结论。
**目标**: 执行 ADR-0061（Round-60 产品正文轮：垂直领域可交付闭环）的 fixer 实现。
**硬约束**: 新代码行 > 治理行；治理票 G1 diff 不计入行数对比（豁免已写 ADR-0061 D3 + sunset Round-61 不得自动沿用）。

## 恢复上下文顺序
1. 读本文件 → 2. 读 ledger → 3. 读 ADR-0061 → 4. 需要时引 `.scratch/grill-round-60/q{1..5}-atomcode.md`

## 票序与逐项验收（每项标注覆盖的 D-xxx）

| # | 任务 | 覆盖 | 验收判据 |
|---|---|---|---|
| T1 (B1) | docs 域 walking skeleton：`domains/docs.toml`（一手源 allowlist 按 D-004 三源首批），golden 首批落 `eval-looks.json`，覆盖 manifest 新建 `eval-looks.coverage.json`；开工第一项 = Round-56~59 会话逐条收割真实提问清单 | D-002 / D-004 / D-005 | 五端联动 doctor 可见；pack→干净装→doctor→search 实跑过；spec 修正 cc-persona 失实前提；golden 全带 provenance（internal-dogfood / external-community）；manifest 每维度 covered\|deferred 且 deferred 带入账触发 |
| T2 (B2) | 装到用链路 CI 实测 | D-001 / D-003 | 离线 golden CI 绿（快照 fixture）；online 层做 URL 硬断言；A3 归因硬断言、A4 弃答+注入复用；macOS 列 documented limitation |
| T3 (B4) | badcase 回灌闭环 | D-001 / D-005 | badcase→eval-looks 条目→回归捕获 闭环可复现；禁合成 |
| T4 (B3) | doctor 自服务增强 | D-001 | 覆盖 T1/T2 实测暴露的缺口（逐条点名）；exit code/stderr 合 clig.dev 规范 |
| T5 (C1) | release-lines 对真实产物实跑 | D-001 / D-006 | 对 B2 真实 pack 实跑；版本升至 0.0.1；非 mock |
| T6 (G1) | graceWindow/deepMode 治理小票（remove-or-implement） | D-001 / D-003 | 用 B1-B4 使用证据作裁决依据；允许 documented deferral 结局；行数豁免+ sunset 已声明 |

## suggested skills
- 实现期：`improve-codebase-architecture`、`tdd`、`code-review`
- 起票前追溯：`grill-with-docs`（若账本冲突需开新 grill 轮）
- 治理小票 G1：`domain-modeling`
- 决策冲突路由：atomcode 深调研（`.codex-tmp/` 放 prompt）

## 账本冲突协议
若执行中发现与 ledger current 记录冲突：不改向——把对应 D-xxx 标 revised（原记录保留），生成新 D-xxx 呈报用户拍板。

## 障碍上报
- B1 spec 中"offline 快照 fixture × online URL的一个断言分层"裁定属 D-003 R1 已定方向；若实际消费端 schema 冲突，回报为用户决策。
- `eval-looks@2` schema 与 `apps/plugin/test/golden.test.ts` 兼容性必须在 T1 spec 核对（q3/q5 报告均指出）。
