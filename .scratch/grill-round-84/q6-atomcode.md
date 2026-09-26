# atomcode 调研存档 — R84-Q6 覆盖域具体圈选（2026-09-26）

> 原问题存档：q6-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：(A) finance+academic+code+health。

## 1) 执行摘要（Tl;dr）

**推荐 (A)：四域=finance+academic+code+health**（Confidence：高）。理由：三大多域评测先例（BEIR、RTEB、Comp-Comp/PolyBench）共同支持「每个入选域必须独立承载一条失败模式轴」，(A) 恰好四域各占一轴（参数面/差似然面/画像面/风险面）；且 RTEB 的企业域先例（finance、healthcare、code、law）与本方案三域重合，唯一差异项（law vs academic）在本仓库语境下 academic 是更优替代。(B) 的 health 缺位不是覆盖率问题而是**效度漏洞**——它是唯一能检验「上游对高风险垂域严格校验」动机的域，剔除后垂域增益结论会系统性偏向乐观。(C) 的 health→ip 交换在四判据中两条同时降级（差似然+风险点双降），无先例支持。

## 2) 分点结论

### 结论 1：工业界选域心智模型=「轴覆盖」——每个域承载一条独特失败模式轴

BEIR 选集方法论四因子：(i) 任务多样性（查询/文档长度形态）(ii) 域多样性（News/Wikipedia 泛域到专业出版物谱系覆盖）(iii) 任务难度（iv) 标注策略多样性。域多样性用 pairwise weighted Jaccard 词重叠度量=「差似然」判据的形式化。验证 D-003 四判据分层合理性：多轴正交选域而非按单维排序取 top-k。〔BEIR 论文 §3〕

### 结论 2：RTEB 域构成逻辑=用户画像/生产场景优先，与 (A) 三域重合

RTEB（HF 2025-10 官方博客）「Domain-Specific Focus: critical enterprise domains like law, healthcare, code, and finance」；MTEB leaderboard 描述「legal, finance, code, and healthcare domains, with tasks representative of real-world production retrieval demands」——最直接的画像优先先例，选的恰是高风险+高频生产域而非差似然最大的域。对 R84：画像轴（code）必须保留；RTEB 第四域 law 在本仓 17 域词表中最接近的是 ip，但见结论 4——(A) 用 academic 替代 law 是更优解。〔HF RTEB 博客/New Stack/InfoQ/Educative 四源交叉〕

### 结论 3：域深度 vs 广度——先例支持「少域×分层紧凑」胜过「多域×均摊」

Comp-Comp/PolyBench（EMNLP 2025 Findings）实证：data scaling（堆域堆题）不是垂域评测集最优构建原则；应优化 comprehensiveness（域内语义覆盖广度）×compactness（去冗余提精度）。直接支持 D-003 per-stratum 分层核算+构建式 silver→gold：**4 域×每域分层紧凑 ≈ 优于 3 域×每域堆量，也优于 17 域浅摊**。〔arxiv 2508.07353〕

### 结论 4：选偏科域对外推效度的已知影响——剔除「唯一轴承载者」产生方向性偏差而非仅覆盖缺口

- BEIR 核心发现：in-domain 性能无法预测 OOD 泛化——若只评泛域或只评画像域，垂域增益结论不可外推。
- "Do Not Trust the Benchmark"（arxiv 2609.23201，2026-09）：五个已证伪维度中「评测域与用户任务分布错配」居首→选域必须锚定真实查询分布（画像轴），同时在每条轴上至少保留一个域。
- 方向性偏差具体化：health 是 17 域中唯一「高风险+上游子域词表严校验动机最强」的组合。剔除它后评测将系统性**高估**「泛网回退兜底」策略可接受度——没有任何被测域能暴露「高风险查询被静默降级为 general 式结果」的失败模式。〔BEIR 论文结论+附录、arxiv 2609.23201〕

### 结论 5：高风险域优先有独立先例——垂直评测碎片化趋势本身由「高风险域先建评测」驱动

垂直 LLM/RAG 评测按高成本/高监管域碎片化：LegalBench-RAG、医疗多轮评测、金融多步计算评测——「built by domain practitioners... in regulated, expert, or high-cost domains」。health/finance/legal 是被单独建评测集频率最高的三域。〔kili-technology 垂域基准综述〕

## 3) 对比矩阵

| 方案 | 轴覆盖完整性 | 先例支持 | 外推效度风险 | 期望面维护成本 |
|---|---|---|---|---|
| (A) finance+academic+code+health | ✅ 四轴各一域承载 | RTEB 三域重合+BEIR 多样性判据+高风险域独立先例 | 低：每轴有域，偏差方向可控 | 中（4 域但构建式下边际成本亚线性） |
| (B) finance+academic+code | ❌ 风险轴缺位 | 画像优先先例 | 高：系统性高估泛网回退可接受度 | 低（省一域） |
| (C) finance+academic+code+ip | ⚠️ 风险轴缺位+ip 与已有域轴重叠 | RTEB law 域形式相似但实质不同 | 高：同 (B) 风险轴空洞 | 低-中 |

## 4) 完整来源清单（尾部截断——以 ctx 索引节为准）

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of IR Models | arxiv.org/html/2104.08663v4 | Official | 2021-10 (v4) | 选域四因子、Jaccard 差似然度量、in-domain≠OOD、标注选择偏差 |
| 2 | Maintaining MTEB: Long Term Usability and Reproducibility | arxiv.org/html/2506.21182v1 | Official | 2025-06 | MTEB 域构成维护机制 |
| 3 | Introducing RTEB（HF 官方博客） | huggingface.co/blog/rteb | Official | 2025-10-01 | 企业域选择逻辑（law/healthcare/code/finance）、规模下限、open+private 混合防过拟合 |
| 4 | How RTEB Prevents Teaching to the Test (New Stack) | thenewstack.io/exploring-rteb-a-new-benchmark-to-evaluate-embedding-models/ | Comparative | 2025-11 | RTEB 域逻辑独立佐证、「应对齐应用」论断 |
| 5 | Hugging Face Introduces RTEB (InfoQ) | infoq.com/news/2025/10/rteb-benchmark | Currency | 2025-10 | RTEB 域构成+20 语言+设计简洁性第三方核验 |
| 6 | RTEB redefining model retrieval accuracy (Educative) | educative.io/newsletter/artificial-intelligence/rteb | Community | 2025 | 28 数据集（15 open+13 private）、分域 leaderboard 子集结构 |
| 7 | Benchmarking for Domain-Specific LLMs (Comp-Comp/PolyBench) | arxiv.org/html/2508.07353v3 | Official | 2025-08 EMNLP | 反 data-scaling 实证、comprehensiveness×compactness |
| 8 | Evaluating Retriever for Enterprise-Grade RAG (NVIDIA) | developer.nvidia.com/blog/evaluating-retriever-for-enterprise-grade-rag/ | Official | — | （索引截断） |

（另引用：kili-technology 垂域基准综述、arxiv 2609.23201 Do Not Trust the Benchmark。）

## 5) 信息缺口

1. **参数丰富度作为独立选域判据的直接文献缺失**——先例均隐含支持（RTEB 金融结构化查询、LegalBench-RAG 条款级查询），无论文显式论证「API 参数面复杂度」作选域因子；finance 作参数面代表主要靠仓内上游实测（calendar/fundamental 子域参数最丰），此实测证据比文献更硬无需补。
2. **「高风险域剔除导致高估」的方向性偏差未见过定量研究**——结论 4 的方向性判断是从 BEIR 选择偏差案例+arxiv 2609.23201 框架推导的定性结论非实证测得；ADR 中注明证据等级时应标「推导级」。
3. RTEB private 数据集清单只公开描述统计，无法核验 private 侧域分布是否与 open 侧同构——若对照类断言设计参考 RTEB 的 open/private 配对需知此不对称。

**落票建议**：投 (A)，并在 ADR 决策记录中注明 **ip 为条件性第五域**（触发条件：上游补齐 ip 子域结构化参数）——把 (C) 的合理内核（ip 画像价值）转为有明确触发条件的后续项而非本次裁决。