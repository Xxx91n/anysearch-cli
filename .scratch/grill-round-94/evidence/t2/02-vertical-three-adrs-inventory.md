# T2 取证卷宗 02 — 垂域三 ADR 实存性盘点（标的物存续证据）

时间戳: 2026-09-30 | 覆盖: D-001 / D-002 | commit 类型: evidence

## 1. 标的物实存性盘点

法庭对垂域功能相关之三大核心 ADR 进行实存性核验，断言其在代码库中具备物理实物而非纸面假说：

| ADR | 标题 / 主题 | 状态 | 仓内物理实存物证 | 实存性裁定 |
|---|---|---|---|---|
| **ADR-0084** | R83 垂域贯通轮（AnySearch vertical-domain passthrough） | Accepted | `packages/retriever/src/` 中 domain/sub_domain/sub_domain_params 通路落地；DomainSchema 定义在案 | **实存并在案运行** |
| **ADR-0085** | R84 垂域评测证据腿（vertical-eval leg：契约断言+金标语料+双臂配对 delta） | Accepted | 评测执行体 `.scratch/grill-round-85/readout-delta.mjs`、语料生成器 `.scratch/grill-round-84/gen-corpus.mjs` 存续 | **实存并在案运行** |
| **ADR-0059** | R58 CI/Ship-Gate 全绿收口（D7 landed-deferred 状态先例） | Accepted | 确立了「有 owner、有 monitoring channel、季度评审、非隐性滞留」之治理先例 | **有效治理先例** |

## 2. 标的物存续结论

垂域功能非「从未实现的概念」，其代码链路真实贯通（ADR-0084），评测脚手架完整存续（ADR-0085）。
因此，在标的实存性维度，满足 `标的实存（垂域三 ADR 在案）` 之事实认定。
