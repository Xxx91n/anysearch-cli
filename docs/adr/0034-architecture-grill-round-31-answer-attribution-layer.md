# ADR-0034: Grill Round 31 — Answer Attribution Layer (claim-level evidence linkage + cascading verification)

## Status

Accepted — 2026-08-29 (grill round 31, commit pending implementation round).

## Context

Grill r31 的用户问题：四层决策盘点后（ADR-0024~0033 覆盖 pnpm 钉版、ship-gate、eval 硬化、judge 校准、预算守卫、融合新鲜度、实体链接/合并、向量语义臂），下一个产品级突破口是什么？atomcode 联网调研（三轮）结论：检索层已达行业第一梯队，边际收益收窄；**答案层（引用回链 / 证据归因 / 可信度分级）是当前全线最薄一环**——这正是项目"信息专精"品牌的最后一公里：ALCE 审计显示商用引擎仅 51.5% 句子被引用完整支撑、74.5% 引用真支撑其相邻句（Liu/Zhang/Liang EMNLP 2023, arXiv:2304.09848）；NeurIPS 2025《Generation-Time vs Post-hoc Citation》(arXiv:2509.21557) 直接推荐高风险场景 retrieval-centric P-Cite-first + 门控 G-Cite——与本项目"站在 Exa/Tavily/Perplexity 检索供应方之上"的定位完全契合。

硬约束：IR 契约化（ADR-0022 ProviderAnswer{verified:false} 已存在）、便宜路径优先 / 贵路径门控触发（ADR-0023 sufficiency-gated 重搜 / ADR-0030 HyDE 门控）、零原生依赖（ADR-0033）、评测先行门禁锁死（ADR-0027/0028/0029）、fail-open（ADR-0009）、观测期→阈值评审先例（ADR-0033 D7）、双通道语义等价（MCPSEP-1624）。

## Decision

**D1 (Q1 主题)：本轮主题=答案层（attribution），不做检索深化 / ingest 硬化 / 多租户。** 已有证据基础设施（retrieval_results 的 arms/valid_until、MVSS verdict、IR 五段、κ 校准 judge、expectAllWeak abstain）是现成输入；reranker 与 HyDE 继续挂 v2 档案；B 子集（写入侧去重 + 索引漂移对账）与 D(schema 键空间预留）均可后置。

**D2 (Q2 交付边界)：同轮三段落地——评测基线 + 运行时验证包裹器 + ship-gate 门禁。** 与 ADR-0027/0028/0029 的"评测先行 → 门禁锁死"节奏保持一致；ADR-0022 revisit 条款（用户是否把答案当权威）已被 ALCE/CJR 证据共证成立，过期待补。A 选项（仅评测基线）与 B 选项（仅包裹器）均被拒——缺了对方的会各自失能。

**D3 (Q3 验证机制)：C+ 两级级联——确定性映射为主，uncertain 才升级 judge LLM，全量 LLM 只做离线审计指标。** 确定性信号 = ——JS 余弦（memory_embeddings）+ BM25 重叠（retrieval_results FTS）+ arms 溯源 + entity 命中——多信号融合得三段：supported / uncertain / unsupported。工业侧无人按句跑 LLM（Perplexity/Bing/Claude/LlamaIndex/vercel AI SDK 核验），学术界 MiniCheck/LIM-RA/HHEM 证明“小而专/确定性”是 SOTA、LLM 逐条是 echo-chamber 与预算累赘；AlignScore 实体扰动假阳假阴证明确定性信号单用上限不及，故 uncertain 带必保留升级通道。judge 走 κ 校准 + budget_ledger 门控；全量 LLM 生成 claim→evidence 审计指标只进离线 eval（不做运行时），评估 citation precision/recall 出入 ADR-0027 golden 数据集。

**D4 (Q4 输出形态)：C+ 分层——IR first-class attribution 字段 + MCP 双通道 + CLI 薄渲染。**
- IR：`FusedEnvelope.attribution?: AttributionReport`（与 metadata.sufficiency 平级）；`{ claims: Array<{ id, text, label, confidence?, evidence: Array<{ url, entity?, title?, span?, provider, sourceKey }>, rationale? }> }`。与 ADR-0022 `verified:false` 正交（provider 自声明 vs 本地信号融合），不合并。
- MCP：content 里 JSON 含完整 attribution；structuredContent 增 `attribution` 键；两通道语义等价（SEP-1624 硬要求）。归因绝不只进 structuredContent（Claude Code/Windsurf 实测忽略）。
- CLI：薄渲染层纯函数；TTY 时每条断言 `✓/~ /✗ [n] 断言上下文本` + 末尾来源清单；`--json` / 非 TTY 退纯 JSON 无装饰字符。
- 边界：每 claim ≤3 条 evidence（Facciani AAAI 2025 + Profound 66% 引用轮仅 1–4 源）；**unsupported ≠ 找不到**，必须是确定性反证，证据缺失一律落 uncertain（诚实性反模式进 ship-gate）；judge 不可用则 uncertain 不上浮 supported（ADR-0027/0029 fail-open）；all-weak 证据 + unsupported 与 expectAllWeak 桥接成整体 abstain。

**D5 (Q5 门禁节奏)：C 两段式——L0 契约断言本轮立即 fail-closed；质量指标（supported-precision / unsupported-recall / 混淆矩阵）先进 eval 观测、预算公式预注册数值留空，观测期后评审落防回归阈值。**
- L0（立即 hard）：attribution schema 合规；attribution → IR 结果链接完整性（幽灵引用即 fail，复用 ADR-0033 D8 arms 溯源机制）；MCP content ↔ structuredContent 语义等价（确定性 diff）；CLI `--json`/非 TTY 退纯结构 ANSI 无泄漏。
- 质量指标进 `.ship-gate/eval-report.json` attribution 区，该区缺失即 fail（报告即契约）。
- 观测期三条件取最后满足者：①golden 答案层扩到 n≥80–120（MDE 从 22.4% 敛到 ≤8–10%，复用 ADR-0028 D1）；②若走 judge 标注则 κ CI 下界 ≥0.6（ADR-0029 D2）；③累计 ≥3 个 ship-gate/golden 运行周期。推荐优先确定性黄金标注，避免 judge 依赖。
- 评审触发器：同一条件任一命中或 L0 破，引发归因评审而非阈值放松。阈值=控制限由累计观测重算（SPC Phase I/II），连续 K 点超限触发评审不放松。Goodhart：过程计数（引用命中率等）永不 gate；断言膨胀治理——每轮 L1 新硬断言 ≤2 条，半年未红降级。

**D6 (Q6 切分)：C' 句锚定 + 信号门控 LLM proposal 级联。**
- L0：`Intl.Segmenter`(sentence)——零依赖、UAX#29 locale 感知；缩写/小数点白名单小规则修正（`e.g.` / `Mr.` / `3.14`），不追求完备。
- L1：碎片检测全确定性可单测——多断言连接词（并且/以及/且/but/however）、枚举符号、逗号/分号密度、长句（阈值校准定）、混排缩写、实体密度 ≥2（复用 ADR-0031 实体臂）。
- L2：仅 L1 标碎的句升级 LLM proposal（SAFE 式：句→事实 + 自包含化代词消解 + VeriScore "只保可验证 claim"过滤）；输出 JSON，claim 带 span 锚回原文；非法输出 fail-open 退"整句为单 claim"。
- 决策依据：A（只知句切）死于 FActScore 的 4.4 事实/句、40% 句真假混杂；B（全量 LLM）死于 Decomposition Dilemmas（NAACL 2025）与 Alignment Bottleneck（2026）证明的"分解对强验证器反退化 + 噪声随 claim 数累积";C' 与 Claude Citations（句块+链式成段）、Glean（语句级内联）、Perplexity（inline 引用号）对齐。spaCy/Stanza/PySBD/SaT 因原生依赖 + Python 运行时明确否决。
- 切分结果入 golden：claim 级标注含"应产出几条 claim + 每条应 supported/uncertain/unsupported"，切分器回归即红线。

**D7 (Q7 unsupported/uncertain 处置)：C2——不 rewrite、不默认 redact，两级处置 + named-gap 重搜 + 有界 abstain。**
- uncertain：黄标 `~` 直出（cheap）；可选门控判罚 judge。
- unsupported：红标 `✗` 直出原文（一字不改），生成断言级 `GapRequest{ assertion, evidenceState:"unsupported", gapQuery }` 进 ADR-0023 sufficiency-gate bounded reround（maxRerounds 有界、URL 去重合并、复检、fail-open）——零新机制，只新增"断言级 GapRequest"触发源。
- 重搜失败升级路径：① 新证据支撑 → 降级为 supported（只改标）；② 新证据反证 → attribution 挂 counter-evidence；③ 无果且非核心主张 → 红标直出；④ 无果且核心主张/高 stake 域 → 随 expectAllWeak 桥入整体 abstain/降级生成（"核心主张"用确定性启发判定——答案首主句/域权重，不引 LLM）。
- 否决：B（默认删 unsupported=编辑 provider 输出 + injures IR 契约 + MCP 双通道漂移；Azure"零重叠才滤除"是唯一先例且小众）；D（改写 RARR 式）——agreement-gate + edit 双调用 + 50 字 / 0.5× 护栏才不至 citation-laundering,撞零原生依赖 / 便宜优先 / authorship 三条红线；工业主流（Bedrock block、Claude Citations 标注、Copilot Studio 引用指令、LlamaIndex 节点过滤）均属"标注/过滤/阻断"系。
- abstain 必须显式设计（Sufficient Context ICLR 2025: 2–10% 普惠；MedAbstain 2026 证明规模不补 abstain 天赋）；abstain 质量 KPI 留 Q5 观测期回填。

## Consequences

收益：信息专精品牌最后一公里补上； reviewer/host agent 可程序消费 attribution；评测先行与门禁锁死贯穿中国支持/不支持/不确定三态链路；向 ADR-0022 revisit 条款发送关闭信号。代价：新 IR first-class 字段（进入 TypeBox 契约 + ship-gate schema 断言）；L0-L3 四级断言数量增长须靠治理约束；attribution 质量阈值需打满观测期才能 fail-closed。

## Implementation Plan（implementation round 必做）

1. packages/kernel/src 新增 attribution 纯函数模块（切分 L0/L1、多信号融合、三段分级）+ tests。
2. IR 契约扩 `attribution?: AttributionReport`（TypeBox）+ schema 断言进 ship-gate step 1。
3. MCP search/research/recall 工具 content + structuredContent 双通道落 attribution，等价断言进 ship-gate。
4. CLI 渲染层（TTY ✓/~ /✗ 内联 + --json 纯结构），断言进 ship-gate。
5. 断言级 GapRequest 触发源挂 sufficiency-gate bounded reround，abstain 桥按 expectAllWeak 语义落地；单测 fail-open。
6. judge LLM 升级通道（uncertain 且亿昇）+ budget_ledger 计数；κ 校准先决条件按 ADR-0029 接入。
7. eval harness 新增 attribution 指标区（golden 扩展 + supported-precision/unsupported-recall/混淆矩阵），进 `.ship-gate/eval-report.json`，缺即 fail；预算公式预注册、数值留空。
8. 满 ADR-0029 Scope Discipline：执行记录唯一 claim 为"本 ADR 全落地"；观测期数据回填准备工作与评审 checklist 进入 docs/agents/audit-checklist.md。

## Acceptance（实现的共识门）

1. 四道验证全绿：check 7/7、build 3/3、ship-gate 9/9+新增断言、CLI 进程存活。
2. L1 碎片信号 100% 确定性、有单测覆盖全部 6 类信号 + fail-open 路径。
3. MCP 双通道等价性、CLI 退出路径无装饰字符、attribution schema 守卫均有 ship-gate 断言语句。
4. eval-report.json 出现 attribution 区且缺失即 fail；golden 增条数与变更指纹随 ADR-0027 规范更新。
5. 切分器漂移检查：golden 的 claim 数期望分布于与实现一致，回归即红。

## Research Sources

1. Liu/Zhang/Liang《Evaluating Verifiability in Generative Search Engines》(EMNLP 2023 Findings) — arXiv:2304.09848
2. ALCE (Gao et al., EMNLP 2023) — arXiv:2305.14627
3. AIS (Bohnet et al., 2022) — arXiv:2204.06245 / arXiv:2212.08037
4. RARR (Gao et al., ACL 2023) — arXiv:2210.08726（agreement + edit, 50 字 / 0.5× 护栏原文）
5. MiniCheck (EMNLP 2024) — arXiv:2404.09974（770M 达 GPT-4 级， 400× 低成本）
6. LIM-RA (AWS Bedrock Science) — arXiv:2404.06579
7. Decomposition Dilemmas (NAACL 2025) — arXiv:2411.02400
8. Alignment Bottleneck — arXiv:2602.10380
9. FActScore (EMNLP 2023) — arXiv:2305.14251（4.4 事实/句、 40% 真假混杂）
10. SAFE (NeurIPS 2024, Google) — arXiv:2403.18802（句锚定分解+自包含化）
11. VeriScore — arXiv:2406.19276
12. Generation-Time vs Post-hoc Citation (NeurIPS 2025 Eval WS) — arXiv:2509.21557（retrieval-centric P-Cite-first 推荐）
13. Sufficient Context (ICLR 2025) — arXiv:2411.06037（guided abstention +2–10%）
14. MedAbstain — arXiv:2601.12471
15. CRAG — arXiv:2401.15884；FLARE arXiv:2305.06983；Self-RAG arXiv:2310.11511；Iter-RetGen arXiv:2305.15294；CRITIC arXiv:2305.11738；LLMs Cannot Self-Correct Yet arXiv:2310.01798；Hallucination Survey 2025 arXiv:2510.06265
16. TRUE (NAACL 2022) — arXiv:2204.04991；TrueTeacher — arXiv:2305.11171；AlignScore — arXiv:2305.16739 / 2404.06579 表 1 实体扰动假阳假阴；HHEM 2.1 (Vectara 官方）；AttrScore — arXiv:2305.06311
17. Vercel AI SDK `sources` 结构化 part + AI Elements `<Sources>` — 官方文档；Claude Citations 官方文档（句块 + char-index span + cited_text 不计 token);LlamaIndex CitationQueryEngine（citation_chunk_size=512)；AWS Bedrock Guardrails grounding check;Azure AI Content Safety groundedness correction；Microsoft Copilot Studio groundedness 文档；Glean 官方引用文档；Perplexity DRACO 评测（research.perplexity.ai)
18. Facciani et al. AAAI 2025 — arXiv:2501.01303（随机引用亦提信任，检查反而降）
19. Reuters Institute《Generative AI and news 2025》；Profound 700K 会话引用分布；NIST AI 600-1 over-reliance
20. MCP 2025-06-18 spec + SEP-1624 双通道语义等价；SonarQube new-code；Codecov patch vs project gate；Stryker incremental；Kayenta (Netflix)；SPC Phase I/II (NASA NTRS 20000097967)；GitHub required checks 治理
