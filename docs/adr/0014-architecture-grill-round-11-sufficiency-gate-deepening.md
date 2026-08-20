# ADR-0014: Architecture Grill Round 11 — Sufficiency Gate 深化

## Status
Accepted

## Context
RetroaererdEngine 的 SufficiencyGate 自 ADR-0005 起存在，但 sufficiencyPassed 布尔在 engine.ts 第 196-202 行计算后从未写入 FusedEnvelope.metadata，也无任何分支消费——跨三个已知失败类（vanity metric / flag-controlled dead path / unconsumed output）。atomcode 三轮深刻调研（合计 58 次搜索、39 个一手原文、21+25+10 个信源覆盖 5 类角度）确认：行业动作链共识为 retry→escalate→annotate→abstain，且证据压倒性支持 gate 放 agent loop 而非 engine 内部。

本轮 grill 通过 7 个决策点确立 sufficiency gate 的完整架构深化方案。

## Decision

### D1: Google Sufficient Context Agent 范式（Q1）
采用 Google Sufficient Context Agent 范式：gate 不止布尔判定 → 输出"缺什么"（named gap）→ 回灌查询改写器做定向二次检索 → 有界循环 → annotate metadata。

学术锚点：arXiv 2411.06037（sufficient context 分类器 93% + guided abstention +2-10%）、LevelRAG arXiv 2502.18139（双层 sufficiency 校验 + 原子查询补充循环）、Google SCA FramesQA +34% / 跨语料 90.1% / 延迟 +3%。

### D2: Gate 放 PiAgentRuntime agent loop，engine 保持纯净（Q2/Q3）
LLM sufficiency gate（named gap 生成 + 定向重搜循环）放 PiAgentRuntime agent loop。RetroaererdEngine 保持纯净（无 LLM 依赖），只向上暴露 metadata.sufficiency 信号。

证据链：Google SCA（编排层独立 agent）、CRAG（evaluator 在 retriever 外部 plug-and-play）、LangGraph/LlamaIndex（grader 是图节点/workflow step）、Self-RAG（reflection tokens 训练进生成器）、Perplexity/Tavily（检索 API 层不做 sufficiency）。四个不要放回 engine 的理由：可测试性、成本与分级、失败域隔离、kernel split 意义（ADR-0004）。

### D3: MVSS 四段式 metadata 信号契约（Q4）
metadata.sufficiency 最低可行信号集 = 四段式结构：
- verdict: CRAG 三态量词聚合（correct/incorrect/ambiguous），纯 EXISTS/ALL 算术
- agreement: 纯 rank 派生（Jaccard@K + RBO@K），始终可算，唯一有 AUC 实证的廉价信号（0.73-0.76）
- volume: uniqueResults/uniqueDomains/successfulProviders 卫生信号
- spread: rrfVariance（rank 派生弱信号）+ scoreScale（原生分数量纲，仅有分数 provider 上计算）
- perProvider: 原生分数随附，明确不跨源归一化

硬上限：廉价信号 AUC 天花板 ≈0.76，reachability 型失败不可见——MVSS 只承诺 escalate，最终判定需 LLM 内容级检查。

### D4: MCP 路径 A+ 注解层（Q5）
MCP search_web/research_web 消费 engine metadata.sufficiency → 不做 LLM 循环 → 在返回 JSON 追加 sufficiency 对象。双通道暴露：content 文本块序列化摘要（SEP-1624 证实 structuredContent 在 Claude Code/Windsurf 被忽略）+ structuredContent 镜像完整对象。fail-open：metadata 缺失时正常返回。

调研 5 个生产级搜索 MCP server（Tavily/Exa/Perplexity/Brave/Firecrawl）源码，无一在基础 search 做 LLM 门。MCP server = "确定性薄代理 + 确定性蒸馏"。

### D5: ans_chat agent loop 有界循环（Q6）
gate 触发 → LLM 生成 named gap → 改写 query → 定向重搜 → 结果合并 → annotate。默认 1 轮重搜，domain TOML compaction.sufficiencyMaxRerounds 可配。与 ADR-0013 consecutiveReuses cap=3 一脉相承（有界 + 可调）。

### D6: 可配置重搜上限（Q6 补充）
domain TOML compaction.sufficiencyMaxRerounds 默认 1，高阶用户可调至 3（Google SCA 上限）。1 轮有成本实证（延迟 +3%），3 轮有质量实证（FramesQA +34%）。

### D7: 单计算源双输出（Q7）
删除 engine.ts 散落的死布尔 gatePassed/crossEngineOk/sufficiencyPassed，重构为单个 computeSufficiency() 纯函数，双路输出：
- control: 内部 fanout 早停布尔（SufficiencyGate 配置保留为内部阈值）
- mvs: MVSS 四段式写入 FusedEnvelope.metadata 外部暴露

学术先例：Fagin TA（PODS 2001）阈值早停 + epsilon-approximation 双用途、CRAG 同一置信度双用途、paperfoot RRF 融合分一次两用。Qdrant 纪律：同一统计被算两次就是冗余信号。

ADR-0005 的 SufficiencyGate 定位为内部质量下界（从未赋予外部判断职责），ADR-0014 补上从未声明的"外部判断"空位，不修改 ADR-0005。

## Consequences
- engine.ts 死变量清零，computeSufficiency() 纯函数可单测
- FusedEnvelope.metadata 新增 sufficiency 字段
- PiAgentRuntime shouldStopAfterTurn 新增 sufficiency gate 逻辑（需 streamFn）
- MCP server search_web/research_web 返回 JSON 新增 sufficiency 对象
- domain TOML 新增 compaction.sufficiencyMaxRerounds 字段
- grace-window 早停（ponytail 债务 engine.ts:97）留升级路径

## atomcode Research Summary
- Round 1: 19 searches, 13 full reads, sufficiency gate 行业动作链 + 反模式命名
- Round 2: 16 searches, 6 full reads, gate 架构落点（engine vs agent loop）
- Round 3: 24 searches, 13 full reads, MVSS 信号契约（Exa score 失效发现）
- Round 4: 10 searches, 17 full reads, MCP sufficiency 处理模式（5 server 源码）
- Round 5: 14 searches, 10 full reads, 内部资源控制 vs 外部质量信号（QPP vs Sufficient Context）

## References
- Google SCA: research.google/blog/unlocking-dependable-responses... (2026-06-05)
- arXiv 2411.06037: Sufficient Context (ICLR 2025)
- arXiv 2502.18139: LevelRAG
- arXiv 2401.15884: CRAG
- qdrant.tech/articles/predicting-weak-retrieval/ (2026-06-24)
- SEP-1624: structuredContent vs content (MCP protocol)
- ADR-0005 Decision 4: SufficiencyGate 内部质量下界
- ADR-0004: kernel split architecture
