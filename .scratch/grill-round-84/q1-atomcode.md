# atomcode 调研存档 — R84-Q1 主轴裁决（2026-09-26）

> 原问题存档：q1-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）；来源清单尾部一处截断已标注。

## Sufficiency Gate

searches: 6（Exa×2 / Tavily×2 / AnySearch×2）| angles: Official、Comparative、Criticism、Community | full reads: 8（Ferro & Maistro IR 教科书章节 PDF 渲染失败，仅以搜索摘要+正文大纲为据，已注明）| gaps: 见文末。

## 1) 执行摘要(Tl;dr)

**Confidence:高。** 工业界检索排序的成熟心智模型——Cranfield 范式、interleaving 两阶段漏斗、LLM-as-judge 的可靠性协议——**压倒性一致地支持「先建评测面、后调融合/路由权重」**：Netflix/Airbnb 的两阶段在线实验流程明确以离线评测为第一道闸，无评测数据直接调权重在分布式检索文献里没有正例先例，且正是 Goodhart 型指标漂移的高发区。垂域检索评测(金融/法律/医疗)有 RTEB、OmniEval、LegalBench-RAG 等成熟方法论可循。**推荐 R84 主轴 = 候选 A(垂域 eval 面)**，这同时是对仓库自身“prefer-capable 前置=eval 数据证明垂域臂召回质量差异”这一既有纪律的兑现。

## 2) 分点结论

**① 「先 eval 后调权」是工业界标准排序，且有生产级实证**(Confidence:高)
- Netflix(2017,已读):两阶段流程——interleaving 快速剪枝大量候选 ranker → 幸存者进传统 A/B。前提是“已知相对质量的 ranker”做校准实验。Airbnb(摘要)三阶段：**离线 NDCG 评测 → interleaving → A/B**——离线评测面是漏斗第一闸，没有它 interleaving 会被垃圾候选淹没。
- Cranfield 范式(Ferro & Maistro, IR 教科书章节,搜索摘要已读)：语料+话题+人工相关性判断三元组是离线评测的奠基结构，评估活动(共享任务)本身就是围绕构建测试集组织的。仓库已有的金标集/归因校准基础设施正是这个范式的实现——补垂域腿是增量而非新建。

**② 无评测数据直接调融合/路由权重：文献中无正例先例，且已知机制性风险**(Confidence:高)
- 联邦检索文献(Callison-Burch 式 GDS/MERGE 家族，ACM CIKM 2001 结果归并+企业联邦搜索 GDS 实验,摘要已读)的一致发现：**所有带学习权重的归并方法(MW、SSL、SAFE)全部需要训练数据做交叉验证学习权重**；无训练数据可用的方法(round-robin、纯启发式)在实验中系统性垫底。即“权重倾斜”在 DIR 五十年历史里从来都是数据驱动的产物，没有“拍脑袋设权”的成熟先例。
- Goodhart 机制(Wikipedia 摘要，与仓库既有警惕锚一致)：指标未确立为目标量具前就调参，等于在不可观测的目标上优化——仓库的“无启用判定的证据=仪式化残留”纪律反向同构：**无证据的调参=不可证伪的改动**，改完也无法归因(这正是 eval 基础设施里归因校准腿存在的理由)。

**③ 垂域检索评测有成熟方法论，可直接借鉴其形制**(Confidence:高)
- RTEB(HF 官方博客,2025-10,已读):垂域(法律/医疗/代码/金融)检索基准的当代标准，关键方法论：**NDCG@10 为默认指标、开/私混合数据集防基准过拟合、≥1k 文档+50 query 的最小有效规模**。其立论恰是“公开通用基准分 ≠ 域内真实泛化”——直接支撑“通用臂评测不能外推到垂域臂”。
- 实证案例(Broadoak legal-tech 复盘,已读):MTEB 第一名模型在 462 条法律域评测里掉到 #12-15,引用类查询上 BM25 nDCG@10=0.36 vs 冠军稠密模型 0.07(5 倍差)。**这是“垂域臂可能系统性不同于通用臂”的直接质量证据形态**——正是 prefer-capable 前置所需要的证据类型。方法论：分层抽样(0.3% 语料即够)、50-100 条人工标注 query、必含 BM25 基线、按任务类(citation lookup/headnote/自由文本)分层。
- 金融域:OmniEval(arXiv 2412.13018,已读)多维矩阵式场景分类(5 任务类×16 金融主题)+GPT-4 生成+人工复核(87.47% 采纳率)+检索/生成分段评测——LLM 生成判断集+人工抽验的混合建集法已被同行接受。另有 RAGEval(场景特定数据集生成)同一谱系。
- 医疗/法律面全景(Kili Technology 2026 地图,已读):LegalBench-RAG(6,858 专家标注对)是“评测 legal RAG 的检索半边”的首例——**垂域评测重心正在从答案质量前移到检索质量**，与“垂域召回质量”命题同向。

**④ LLM-as-judge 证据等级：可用但仅限二值化+多陪审团+人工抽验协议，不能裸用**(Confidence:高)
- 大规模系统评估(arXiv 2606.19544 摘要)：16 个 judge 模型中出现“test-retest 一致性 0.99 但位置偏置 0.19”的悖论型 judge——一致性高不等于无偏。**最小可行验证协议(位置交换+一致性+κ)需全套采信，部分采信反而产生虚假安心。**
- Galileo(已读)：93% 团队报告重大可靠性问题；核心对策——**二值判定优于 0-100 打分、3-5 judge 多数投票、judge prompt 持续自校准**；Mistral 与 DeepEval 均把 retrieval 侧指标(context relevance/groundedness)作为 RAG 管道标准件。仓库已有的“judge 协议+金标抽验”纪律与此吻合；**对 R84 的含义：垂域 eval 腿的判断集构建可用 LLM 辅助生成+人工抽验(OmniEval 路线)，但门禁判定仍走 rank-of-relevant 类确定性断言(仓库 ADR-0028 已有的 D2 心智)**，LLM judge 只进报告不进闸——与现有架构一致。

**⑤ interleaving 对本仓库的适用性：目前不可用，但它是 A 之后解锁在线面的路径**(Confidence:中)
- Team-Draft Interleaving 优点充分验证：无标注数据下测相对偏好、灵敏度比 A/B 高 10-100×(Chapelle et al. 大规模验证,PDF 原文渲染失败摘要已读;Netflix/MetricGate 交叉印证)，且有已知构造性反例(单相关文档场景可被翻转)。
- 但它需要**真实用户点击流**——anysearch-cli 是 agent CLI 工具层，点击信号在宿主 agent 手里，与 dsh 宿主侧验收同属“unverified-at-host”类阻塞。**不是 R84 主轴，但应作为 A 的远期出口记入 ADR**(若未来宿主遥测可用，TDI 是垂域路由臂在线验证的自然形态)。

## 3) 对比矩阵(R84 主轴候选)

| 候选 | 证据基础 | 工业先例强度 | 解锁价值 | 阻塞 | 判定 |
|---|---|---|---|---|---|
| **A 垂域 eval 面** | 零质量证据缺口明确；方法论现成(RTEB/OmniEval/Broadoak 形制) | 强：离线评测是所有生产漏斗第一闸(NFLX/ABNB/学术) | 直接兑现 R83 既定前置；产出「垂域路由是否改善答案」的可归因证据 | 无(纯仓内工作) | ✅ **推荐主轴** |
| B prefer-capable 调参 | 无 eval 数据 | 零正例先例；DIR 文献一致要求训练数据 | 被前置条件卡死 | 缺 A 的产出 | ❌ 本轮不做 |
| C dsh 宿主侧 live 验收 | 需用户环境 | — | 窄(单点验收) | 用户侧升级/沙箱 | ❌ 挂账不动 |
| D 审计返工七项 | 全部已披露 | — | 卫生类，不产质量证据 | 无 | ⏸ 顺带小批，非主轴 |

## 4) 完整来源清单

| 来源 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Ferro & Maistro, IR 评估章节 | dei.unipd.it/~ferro/papers/2024/IR-Book2024-FM.pdf | Official | 2024 | Cranfield 范式、offline→online 全谱系(PDF 渲染失败，据摘要) |
| HF: Introducing RTEB | huggingface.co/blog/rteb | Official | 2025-10-01 | 垂域检索基准方法论：NDCG@10、开/私混合、最小规模 |
| OmniEval | arxiv.org/abs/2412.13018 | Official | 2024-12 | 金融垂域 RAG 评测矩阵、LLM 生成+人工复核建集法 |
| Broadoak legal-tech 域评测复盘 | broadoakdata.uk/building-and-evaluating-domain-specific-retrieval-benchmarks/ | Community/案例 | 2025? | MTEB 冠军域内掉 10+ 名实证；分层抽样+BM25 基线建集法 |
| Kili Technology 垂域基准地图 | kili-technology.com/blog/domain-specific-llm-benchmarks-guide | Currency | 2026-05 | 2026 垂域评测全景；LegalBench-RAG 检索半边前移 |
| Netflix Interleaving TechBlog | netflixtechblog.com/interleaving-in-online-experiments-at-netflix-a04ee392ec55 | Official/生产 | 2017-11 | 两阶段在线实验；interleaving 灵敏度与局限 |
| Airbnb Interleaving | medium.com/airbnb-engineering/beyond-a-b-test-…7087afa09c8e | Official/生产 | — | 离线 NDCG→interleaving→A/B 三阶段漏斗 |
| Chapelle et al. 大规模 interleaving 验证 | cs.cornell.edu/people/tj/publications/chapelle_etal_12a.pdf | 学术 | 2012 | TDI 灵敏度 10-100×(PDF 渲染失败，据摘要) |
| ACM CIKM 2001 结果归并 | dl.acm.org/doi/10.1145/502585.502618 | 学术 | 2001 | GDS/MERGE 家族；学习权重须训练数据 |
| 企业联邦搜索 GDS 实验 | dl.acm.org/doi/10.1145/2348283.2348393 | 学术 | 2012 | MW/SSL/SAFE 加权归并全需训练数据 |
| arXiv 2606.19544 LLM-judge 大评 | arxiv.org/html/2606.19544v1 | 学术 | 2026 | 一致性≠无偏；位置交换+κ 全套协议 |
| Galileo LLM-judge 可靠性 | （正文引用，URL 截断） | Community | — | 93% 可靠性问题；二值化+多陪审团协议 |
| Mistral LLM-as-RAG-judge | mistral.ai/news/llm-as-rag-judge | Official | — | retrieval 侧指标标准件 |
| DeepEval LLM-as-judge | deepeval.com/blog/llm-as-a-judge | Community | — | context relevance/groundedness |
| Goodhart's law | en.wikipedia.org/wiki/Goodhart%27s_law | 参考 | — | 指标未立量具前调参=不可证伪 |
| RAGEval | （正文引用，场景特定数据集生成） | 学术 | — | OmniEval 同谱系建集法 |
| MetricGate | （正文交叉印证引用） | Community | — | TDI 灵敏度旁证 |

（注：atomcode stdout 尾部一处截断，来源表按索引节+正文引用补齐，两处标「URL 截断」。）

## 5) 信息缺口

- **本仓垂域 query 分布未知**：RTEB/OmniEval 是通用垂域基准，实际用户 query 里垂域占比、垂域子类分布需要先测量——A 轮第一步应是 query 侧事实收集(审计事件已有 instrumentation 支撑)，再决定金标集覆盖哪些 domain。
- **interleaving 在 agent-中间层场景的可行性**：宿主侧点击/采纳信号是否可及(dsh 遥测)未验证，与候选 C 同源阻塞。
- 搜索摘要类来源(Chapelle PDF、Airbnb、RAGEval)未能打开原文全文，关键数字(BM25 5× 差异)仅 Broadoak 一源支撑，未达双源——已在正文标注；若进 ADR 建议补一源或降级为“方向性引用”。

## 推荐

**R84 主轴 = A(垂域 eval 面)**，理由三点：(1) 唯一同时被“工业先例”(离线 eval 是漏斗第一闸)、“仓库自身纪律”(R83 已把 eval 数据登记为 prefer-capable 前置)、“证据现状”(垂域臂零质量证据)三方指向的候选；(2) 方法论有成熟形制可搬(RTEB 指标选型+OmniEval 建集法+Broadoak 分层抽样)，轮内可交付；(3) 直接消解 B 的阻塞——B 在 A 产出之前动工就是无数据调参，文献里没有正例先例，且违反 Goodhart 对称警惕。D(审计返工)可作为本轮顺带小批但不应占主轴；C 与 interleaving 出口同属宿主侧阻塞，合并挂账。
