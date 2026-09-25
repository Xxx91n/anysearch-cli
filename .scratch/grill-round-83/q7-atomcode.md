# Q7 atomcode 调研存档——R83 收口判据

Date: 2026-09-25. 原题见 q7-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q7）。

## 裁定：A=三段收口承袭+nit 处置纳入文书段（Confidence：高）

R83 风险画像（主轴跨契约/路由/审计三面+辅轴 TE1 首次闸开+4 nit 待去向）命中「重证据分级」全部加重要件；三段式=成熟 DoD「验收证据/就绪门/文书闭环」分层惯例的常设政策化实现；B 会重演已两次书面否决的半成品轮。

## 分点结论

2.1 **三段式=业界模式收紧版非自创**：CTO Academy 五层 DoD 的 Proof&Acceptance 终层要求每条验收注明 Verified-in 证据锚=取证段同构；Momentic 12 步清单=每步具名 owner+二值证据=判据↔证据映射表的存在意义。
2.2 **就绪段/文书段分离=Release Management 标准相位**：LaunchDarkly 五阶段 25 步把 QA 与 Release documentation 分两个独立相位（文档非 QA 副产品是独立 gate）；IF4IT：证据严格度按风险分级为**常设政策非每轮临时裁量**——R82 D-005 立法 R83 承袭正是正确形态，不需每轮重辩。
2.3 **降级条件不满足**：PaellaDoc 轻量化底线=Intent/Boundaries/AC 三缺一则成便签；加重三触发=多人触碰/blast radius 大/决策需留痕——R83 三者全中。
2.4 **B 案真实风险=Goodhart 反向失效**：诊断器「该 artifact 启用了哪个具体决策」——A 案无一件为 checkbox 而生；B 恰裁掉这把刀（无映射表三段坍缩为一件 artifact）。**对称警惕**：映射表某行说不出启用何判定=仪式化残留，应删行非补证。
2.5 **nit 处置=三态登记最小实现**：Momentic 模式=每个 blocker 须具名 owner 书面 waiver+缓解记录；nit 逐项登记 registry（closed/defer-with-ticket/accepted-as-documented 三态之一）；不登记=替未来轮次伪造「干净」状态违兜底精神。建议两档规则：修复<半天→就地修+证据入取证段；否则→registry defer 带具名票。
2.6 **兜底两则=诚实分级证据惯例落地**：verified/partially verified/not verified 三态纪律的仓库方言。

## Sufficiency Gate

searches: 5（Exa×2/AnySearch×2/Tavily 配额尽）| full reads: 6（paelladoc/janisexplains/if4it/momentic/visual-paradigm/launchdarkly）| gaps：CTO Academy 原文 403 摘要计；「三段收口」为仓内方言命名，结论建立在结构同构非同名先例。
