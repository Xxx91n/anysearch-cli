# T2 取证卷宗 01 — ADR-0088 拒绝理由原文调档与 |ΔarmHostHit| 序列登记

时间戳: 2026-09-30 | 覆盖: D-001 / D-002 | commit 类型: evidence

## 1. ADR-0088 拒绝理由与候审来源调档

- **标的物**：registry `r88-candidate-vertical-direction-redeliberation`
- **立案出处**：ADR-0088 / R87 收口件（.scratch/grill-round-87/handoffs/round-87-closeout.md:21）
- **调档原文**：
  > 标题：R88 候选：垂域方向重议轮——prefer-capable 具名重开条件 |ΔarmHostHit|≳0.4 未达，作正题候选候审（不复活加权问）
  > evidence 记录：R86 decision-record 具名重开条件未达；R87 goal 显式范围外登记候场
  > 拒绝理由：R86 实测中 prefer-capable 加权问因负读数被拒绝，但未永久关死方向通道，设立具名重开门槛 |ΔarmHostHit|≳0.4 并列为 R88 候选候审项。

## 2. ADR-0087 / 0086 |ΔarmHostHit| 实测序列调档

本法庭调取历史两轮实测记录，确认序列如下：

| 轮次 | ADR | 测量环境 | 指纹 | 读数结果 | 装置健康度 | 统计学结论 |
|---|---|---|---|---|---|---|
| R85 | ADR-0086 | 本地 live API（env 缺陷） | 7ac0a48e55cd7954 | **indeterminate — instrument down** | anysearch 臂 41/41 providersFailed，装置失败率 100% | 装置损坏，读数不可信，程序性 NO-GO 锁定 |
| R86 | ADR-0087 | 声明式隔离测量环境 | 7ac0a48e55cd7954 | **direction-negative** | 57 格 paired 40/41（97.6%），装置失败 ∅ | P=0.0378，净胜率 −0.125，EL=0.297，中位 rankDiff 0 |

## 3. 判据谓词严格区分

开庭明确区分三种易混淆的谓词表述：
1. **「从未测过」**（False）：R85/R86 均有完整测量执行记录，非未涉足领域。
2. **「连续低且稳」**（Inaccurate）：R85 属于装置性故障（instrument down），不能作为低效能的数值证据。
3. **「实测为负」**（True）：R86 在洁净测量装置（装置失败 ∅、覆盖 97.6%）下，matrix@2 终读明确判定为负效应（净胜率 -0.125，P=0.0378）。

## 4. 重开条件出处澄清

具名重开门槛「|ΔarmHostHit|≳0.4」出自 **ADR-0087 D4**，是在已知 R86 获得真实负读数后设立的高标准反转门槛，并非预设给未测功能的初始通过门槛。
