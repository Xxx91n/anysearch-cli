# atomcode 调研存档 — R84-Q5 delta 测量范围/臂定义（2026-09-26）

> 原问题存档：q5-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：A（双层测量、臂级为主证）。

## 1) 执行摘要（Tl;dr）

**推荐 A（双层测量、臂级为主证）**——Confidence：高。理由：「prefer-capable 加权调参前置」是**组件能力差异命题**（垂域臂拿到三元组时是否比拿不到时召回更好），工业界成熟心智模型对这类命题的标准做法是组件级隔离消融；融合级 on/off delta 因其余 provider 两臂在场+融合稀释，恰落进文献反复警告的「端到端归因噪音」象限。TREC FedWeb 把来源选择/资源质量判断与结果融合判断**拆成两个独立评测任务**（各有独立 judgments 与评分脚本），是「臂质量与融合质量分开测」的最权威先例——与本仓 ADR-0046「融合级 primary」不冲突：**主从排序取决于被门禁的命题是什么**。

## 2) 分点结论

### 2.1 组件级 vs 端到端：文献共识是「两者都要，但用途分流」（Agent Factory/apxml RAG 课程/cfgnotes/RAG 综述 arXiv 2504.14891）

- 端到端（融合级）适合回答「该不该发版/用户所见质量」；组件级适合回答「问题出在哪/该调哪个组件」。E2E 分数下降时无法归因到六个组件中的哪一个——正是 (C) 的弱点。
- Andrew Ng 五步循环（E2E 发现问题→错误分析定位组件→建组件级 eval→组件级快迭代→**回到 E2E 验证收益真正传导**）：组件级改善必须经端到端复核才确认生效——支持 A「臂级主证+融合级副列」：主证管归因，副列管传导验证。
- cfgnotes（摘要级）：「组件指标是早期预警系统，端到端是业务 KPI；组件用于调试，端到端用于决策」——双轨并行各司其职，与 A 双层结构同构。

### 2.2 联邦/聚合检索先例：臂质量与融合质量本来就是两个独立评测任务（TREC FedWeb 2013/2014 官方页/InfiniSynapse/Emerald FnTIR Aggregated Search）

- TREC Federated Web Search track 官方把评测拆为 **Resource Selection/Vertical Selection/Results Merging 三任务，各有独立 judgments 文件与评分脚本**（trec.nist.gov 原文核验）。InfiniSynapse：「TREC FedWeb 的价值在于把来源选择判断与结果融合判断分开，而不是隐藏在一个汇总分数后面」。
- Aggregated Search 综述（Arguello 等）同样把「选哪个 vertical」与「融合后呈现质量」作为两个主任务分别评测。
- 对 R84 的映射：anysearch 臂 vertical-on/off 对照 ≈「该来源在垂域参数下 vs 泛化模式下的召回质量」（资源/臂级命题）；融合列表 on/off ≈ Results Merging 命题。TREC 的拆法直接为 A 背书。

### 2.3 只测融合级（C）的归因噪音有文献级机理支持（Agent Factory/towardsai 消融批评文/InfiniSynapse）

- Agent Factory：「E2E 方差在组件间复合——路由错误导致下游连锁失败，症状远离病因」。本架构下融合级 on/off delta 混杂三重：(i) 垂域臂自身质量差、(ii) 其余 provider 两臂都在场的稀释、(iii) 融合层归并行为，三者不可分。
- 消融批评文（towardsai 2026-04）：「消融后性能几乎不变 ≠ 组件不重要——系统会代偿」。对应：融合级 delta 很小时无法区分「垂域臂没增益」与「其他臂代偿遮蔽增益」；前者是否决证据，后者恰是加权调参的潜在收益空间——**用融合级 delta 作 prefer-capable 前置会把这两种情形错误合并**。

### 2.4 与本仓既有先例 ADR-0046（Fusion-Level Ablation）的表面冲突及裁决（ctx_search 召回 CONTEXT.md）

- ADR-0046 先例是**融合级 primary、臂级 secondary**（drop-arm 反事实重算 RRF，融合后 RoR 唯一 primary），且明确 Avoid「per-arm independent gate decisions」。
- 但该先例回答的命题是「**每个臂对融合结果有没有边际贡献**」——融合贡献命题，drop-arm 反事实是它的干净测量，融合级指标当然 primary。
- R84-Q5 的命题不同：「**垂域臂自身在参数化 vs 泛化两模式下的召回质量差**」——臂能力命题，same-query 配对 on/off 在臂内隔离才是干净测量；且待门禁的下游决策（prefer-capable 加权倾斜）改变的是臂权重，权重生效的效果仍需融合级副列复核（对应 Ng 循环第 5 步）。
- 结论：两先例不冲突，是**命题→测量层级的一一映射**。R84-Q5 命题落在臂级，故 A；同时吸收 ADR-0046 精神——不让臂级 delta 直接变成融合收益断言，融合级列只报告不断言加权收益已兑现。

### 2.5 工程可行性核对（对应 D-004 已定形制）

- 「一次 run 两层断言顺带产出」：per-entry 已可同 query 跑两遍（vertical on/off），臂级 delta 只需在 anysearch 臂两次原始结果上算 mustHitHosts/mustHitPaths 命中率与 expectRankOf 差；融合级 delta 是同批 query 两趟融合列表的最终列表对照——两层共享同一 query 集与期盼集，无额外语料成本，A 增量成本低。
- 小样本配对差分（better/worse/tied+n 显式标注不设门禁）与文献一致：消融证据件用于「决策参考」而非自动门禁时，业界普遍接受小样本显式标注。

## 3) 对比矩阵

| 方案 | 归因干净度 | 回答的问题 | 文献先例 | 对 prefer-capable 前置的适配 |
|---|---|---|---|---|
| A 双层（臂级主证+融合级副列） | 高（臂级）+中（融合级仅报告） | 臂能力差（主）+融合自然浮出率/加权收益上限（副） | TREC FedWeb 双任务拆分；Ng 五步循环第 3+5 步 | ✅ 直接证据+传导复核，一次 run 顺带产出 |
| B 仅臂级 | 高 | 仅臂能力差 | 组件级 eval 标准用法 | ⚠️ 证据干净但丢失「加权收益上限」信号 |
| C 仅融合级 | 低（三重混杂） | 仅端到端差 | E2E 归因噪音；代偿遮蔽 | ❌ 无法区分「臂无增益」与「融合未抬升/他臂代偿」 |

## 4) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Component vs End-to-End Evals (Agent Factory) | agentfactory.panaversity.org/docs/Building-Agent-Factories/evals-agent-performance/component-vs-end-to-end-evals | Comparative | — | E2E vs 组件 eval 用途分流表；Ng 五步循环；E2E 归因噪音机理 |
| TREC 2014 Federated Web Search Track | trec.nist.gov/data/federated2014.html | Official | 2015-02-10 | 来源选择/vertical 选择/结果融合三任务各有独立 judgments 与评分脚本（原文核验） |
| Federated Search: Architecture, Ranking & Evaluation (InfiniSynapse) | infinisynapse.com/en/blog/federated-search | Official/Comparative | 2026-09-18 | 「把来源判断与融合判断分开而非藏进一个汇总分」；验收矩阵含排序因来源可用性变化面 |
| Introduction to End-to-End RAG Evaluation Frameworks (apxml) | apxml.com/courses/getting-started-rag/chapter-6-evaluating-improving-rag-systems/end-to-end-evaluation-frameworks | Comparative | 2026 | 组件诊断 vs 整体有效性互补；E2E 局限清单 |
| Your LLM Ablation Study Is Lying to You (Towards AI) | pub.towardsai.net/your-llm-ablation-study-is-lying-to-you-here-is-the-proof-a372cae4be3f | Criticism | 2026-04-12 | 消融后无变化≠组件不重要（系统代偿）——直接支撑否决 C |
| RAG Evaluation in the Era of LLMs (arXiv 2504.14891) | arxiv.org/html/2504.14891v1 | Official/学术 | 2025-04-21 | Internal（组件级）vs External（系统级）评测二分法 |
| Ablation Studies: The OS for Trustworthy AI Decisions (Medium) | medium.com/@adnanmasood/ablation-studies-b99300d3bd32 | Official/方法论 | ~2026-03 | 消融=受控移除组件+量化关键结果（extract 失败仅摘要级） |
| Resource Selection in Federated Web Search (Semantic Scholar) | semanticscholar.org/paper/00baa5ceb0e42d3513668f94020aaea3e221029e | Official | — | 联邦检索臂级质量评测研究簇存在性佐证（摘要级） |
| Aggregated Search (Foundations & Trends in IR) | emerald.com/ftinr/article/10/5/365/1330381/Aggregated-Search | Official | — | 聚合搜索两大任务=vertical selection+融合呈现分别评测（摘要级） |
| Reddit/HN 消融实践讨论 | reddit r/MachineLearning 1cvoten；HN item?id=47280166 | Community | 2024/2026 | 消融「隔离单变量」共识与误用批评（信号级） |
| 本仓库 CONTEXT.md（ctx_search 召回） | — | Internal | — | ADR-0046 Fusion-Level Ablation 先例：主从排序随命题而变的内部判据 |

## 5) 信息缺口

- Medium 消融方法论长文 extract 失败仅摘要级（「决策级消融形态」），其「前置证据应证明组件级还是端到端差异」的显式判据未能核验原文——但该结论已由 TREC 拆分+Ng 循环+代偿批评三源交叉覆盖。
- 未找到「权重调参决策前必须证明组件级差异」的一手工业规范（如某搜索引擎厂商的 ranking 权重变更 checklist）；现有支持是间接的（TREC 任务拆分+RAG 组件监控实践）。若需更硬先例，可在下轮定向检索 Elastic/Vespa tuning guide。

**对 R84-Q5 的落裁决建议**：采纳 **A**。落地表述建议——臂级隔离 delta（anysearch 臂 vertical-on vs vertical-off，同 query 同期盼集，per-stratum 配对差分）为 prefer-capable 前置的**直接证据**；融合级 delta（最终融合列表 on/off）为**副列报告**，回答「融合自然浮出率多高、加权收益上限多少」，且吸收 ADR-0046 精神：副列只报告不断言加权收益已兑现——加权收益的最终确认仍属后续 prefer-capable 调参后的再评测。