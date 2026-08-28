# ADR-0032 (grill r29): Entity Merge Execution - Destructive Redirect with Snapshot Log, Bounded Unmerge, Review Belt, Report-Only Merge Telemetry

- Date: 2026-08-28
- Status: Accepted (grill r29, Q1-Q5 全用户确认; atomcode 四轮主题锁调研)

## Status

Accepted. Complements ADR-0031 (entity link layer; 其 r74 审计遗留 E3 = 本 ADR 的全部主题), ADR-0025 (equal-conflict review channel, 本 ADR 候选带复用其模式), ADR-0027/0028 (eval harness + gates, D5 遥测遵守其统计功效纪律), ADR-0029 (scope discipline).

## Context

ADR-0031 落地了实体链接层（两表 schema + 规则提取 + 三级去重 + RRF 实体臂），但 r74 atomcode 审计遗留 E3：被并实体只有 merge_log 记录，没有真实的合并执行（memory_entity 行不重定向、被并实体不关闭）；且抽取时 MAX_ENTITY_CANDIDATES 截断溢出的候选无任何消费方，静默丢失。本 ADR 解决"实体合并如何真实执行、如何撤销、溢出候选谁来消费、合并质量如何度量"四个问题。调研基线：Neo4j agent-memory（破坏式合并 + dedup stats + review 队列）、Zep/Graphiti（IS_DUPLICATE_OF 非破坏 + uuid_map 重定向）、Mem0（隐式合并，无可逆承诺）、Splink/Gov.UK（manual merge/unmerge + override 防复发，F-S 模型最成熟工业实现）、Senzing（entity-centric + possible-match 挂起）、Hindsight（实体摘要增量演化）、SRE 错误预算。学术锚点：Fellegi-Sunter 三带（上阈值自动 = Coleridge 最优分配）、补偿事务语义（不承诺回到操作前状态）、Goodhart 定律。

## Decision

### D1 (Q1): 合并执行 = 破坏式重定向 + merge_log 完整快照

combine(fromId, toId) 的物理语义：`memory_entity` 行 UPDATE 重定向到主实体；被并实体 `valid_until` 置为合并时刻（保留 tombstone，不 DELETE）；`entity_merge_log` 写入 kind="merge" 行并携带**完整快照**（被并实体的别名集、被重定向的 memory_entity 行 id 列表、合并时刻）——快照是后续 unmerge 的唯一依据。拒绝 Zep 式 IS_DUPLICATE_OF 纯边方案：读路径每次多一跳，且我们已在 merge_log 里获得等价的可回放性，一份代价拿两种好处（Neo4j 破坏式主流 + Zep 可回放性）。

### D2 (Q2): unmerge = 半还原增强（边界化重指 + override 防复发）

unmerge(logId) 只回滚合并操作自身的副作用：按 merge_log 快照把当时重定向过的 memory_entity 行重指回去、复活被并实体（打开 valid_until）、恢复其别名快照；**合并时间戳之后新写入的记忆留在主实体**（补偿事务语义：不承诺回到操作前状态）。同时写入 override 记录，阻断同一对实体未来被自动合并（Splink "manual merges and unmerges + override 防复发" 是唯一撤销+防复发双全的工业先例）。候选 A（含新写入的完整还原）被六路证据联合证伪为过度承诺，否决。

### D3 (Q3): 溢出候选 = review 带（entity_merge_log kind="candidate"）+ hit_count 轻量升级

抽取/去重过程中 MAX_ENTITY_CANDIDATES 截断溢出及中带（0.6-0.9 trigram）候选写入 entity_merge_log kind="candidate" 行（review 带），消费方为审查 CLI（复用 ADR-0025 quarantine 模式：list + keep/drop）。candidate 行带 hit_count：同一候选对被后续写入再次命中时计数递增，达到升级阈值转入"建议复审"（Senzing possible-match 自愈思想的轻量版；不做常驻挂起引擎——CLI 无常驻进程）。拒绝"仅丢弃+遥测"：与中带的 Fellegi-Sunter 正统出口冲突，且静默丢候选不可见。

### D4 (Q4): 触发 = 上阈值自动合并 + 中带 review + 手动 CLI 三入口

alias 带（规范化精确等价，ADR-0031 三级去重最高档）保持自动合并现行为——F-S 上阈值之上自动是最优分配（Coleridge），且 D1 快照 + D2 unmerge 已消除自动合并的唯一顾虑；中带不自动合并只进 review 带。手动 CLI：`ans entity merge <from> <to>`、`ans entity unmerge <log-id>`、`ans entity review`（宿主 Agent 可经 ans_* 工具调用）。三护栏：①类型门（防 mem0#5438 类错并，ADR-0031 D5 已有）②阈值数值源自 E4 错误预算校准，不抄业界 0.95 ③任何合并必写 D1 完整快照（MAC-2）。否决纯手动：它是回退（删除现有 alias 自动行为）。

### D5 (Q5): 合并遥测 = report-only 六指标 + 预算公式预注册 + Goodhart 条款

eval Observational 区新增六指标行（auto_merged / review_pending / confirmed / rejected / candidates_truncated / unmerged），**永不 gate**。预算公式本轮预注册（如 rejection_rate = rejected/(confirmed+rejected) 的健康区间形态），数值留 E4 错误预算校准后回填。未来若升 gate，只对 golden case 的 merge 正确性断言设门，过程计数永不 gate（Goodhart 防护条款；n=39 时 MDE≈22.4%，rejection-rate 类阈值无统计功效——ADR-0028 D1）。review 动作的 confirmed/rejected 回写 merge_log，作为 E4 错误预算的数据原料（Neo4j get_deduplication_stats 同构形态）。

### D6 (纪律): 一个 ADR 一个主题

本 ADR 只覆盖 E3 四问。E4（trigram 阈值错误预算校准）保持 de결，为独立后续轮（需独立 commit + eval 基线刷新，见 ADR-0027 基线刷新纪律）。

## Consequences

- 正：实体合并从"日志有记录、数据不动"变为真实可执行、可撤销、防复发；溢出候选从静默丢失变可审消费；合并质量获得不违背统计纪律的度量面。
- 负：merge_log 快照放大单行体积；combine/unmerge 是新的写路径代码（单点集中在 store）；CLI 新增一个 entity 命令组。
- 风险：combine/unmerge 的事务边界必须原子（单事务），否则半合并状态污染图谱——验收强制覆盖。

## Implementation Plan

1. store: combine(fromId,toId) 单事务——重定向 memory_entity + 关 valid_until + 写 kind="merge" 快照行。
2. store: unmerge(logId) 单事务——快照驱动边界化重指 + 复活实体 + 恢复别名 + 写 override 阻断记录。
3. store: 去重路径溢出/中带候选写 kind="candidate" 行（含 hit_count），再次命中递增。
4. store: listEntityReview() / resolveEntityReview(id, keep|drop) 审查 API（复用 quarantine 模式）。
5. CLI: ans entity merge / unmerge / review 三子命令。
6. eval: Observational 区六指标行（report-only）+ confirmed/rejected 回写。
7. 测试：combine/unmerge 往返一致性、快照完整性、override 防再并、candidate hit_count 升级、review keep/drop。
8. eval 基线刷新 + handoff。

## Acceptance

1. combine 后被并实体 valid_until 非空、memory_entity 全部指向主实体、merge_log 快照字段完整。
2. unmerge 后：快照内 memory_entity 行重指回去、实体复活、合并后新写入仍留主实体、override 记录存在且同对实体不再自动合并。
3. 溢出候选出现在 review 带且 hit_count 随再命中递增。
4. eval 报告含六指标行，均不 gate；golden fingerprint 不变（除基线刷新 commit）。
5. ship-gate --quick 9/9 绿；turbo check/build 全绿；CLI --help 存活。

## Research Sources

- Neo4j agent-memory（破坏式合并 Keep Primary + dedup stats + review 队列）: https://github.com/neo4j/agent-memory
- Zep/Graphiti（IS_DUPLICATE_OF + uuid_map 重定向, node_operations/edge_operations 源码）: https://github.com/getzep/graphiti
- Mem0 Graph Memory（隐式合并黑盒 + issue #5438 误并案例）: https://github.com/mem0ai/mem0/issues/5438
- Splink（Fellegi-Sunter EM + manual merges/unmerges + override 防复发）: https://github.com/moj-analytical-services/splink
- Gov.UK record linkage（Splink 生产链路, 人审只在 QA）: https://www.gov.uk/government/publications
- Senzing（entity-centric re-resolve + possible-match 挂起）: https://senzing.com/
- Hindsight（实体摘要增量演化, arXiv 2512.12818）: https://arxiv.org/abs/2512.12818
- LangMem（update/consolidate/invalidate 记忆管理）: https://langchain-ai.github.io/langmem/
- Coleridge/FSL 三带最优分配: Fellegi & Sunter (1969) A Theory for Record Linkage
- Saga 补偿事务语义: Garcia-Molina & Salem (1987) Sagas
- Google SRE 错误预算: https://sre.google/sre-book/embracing-risk/
- Goodhart 定律门禁应用: ADR-0028 D1 + llm-evalgate
- Zingg（blocking RR/PQ/PC + tiered routing）: https://github.com/zinggAI/zingg
- Letta issue #3270（记忆图污染教训）: https://github.com/letta-ai/letta/issues/3270
