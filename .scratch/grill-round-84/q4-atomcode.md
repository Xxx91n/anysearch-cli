# atomcode 调研存档 — R84-Q4 断言计分形制与 delta 证据件形态（2026-09-26）

> 原问题存档：q4-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：A，含落地细节固化。

## 1) 执行摘要（Tl;dr）

**推荐方案 A（分层断言制+同判据双臂 delta 证据件），并吸收 rankkit/trec_eval 惯例做两处强化：delta 证据件采用「配对 per-query 差分+per-stratum 分列+只报报告不进门禁」，且不设 CI/显著性门禁但 CI 机制留接口。** Confidence: 高——curated 期望+确定性断言的证据等级高于纯 judge 打分（SIGIR'26 有效性论文、llm-judge-bench、pooled-LLM-eval 三方独立支持）；配对比较惯例被 rankkit/abeval 工具生态直接验证。B（纯 judge）证据等级不足；C（弱结构）对垂域召回质量无区分度，均否。

## 2) 对比矩阵——四方案裁决

| 方案 | 可归因性（证据等级） | 内容轮转抗性 | 可维护成本 | 双臂对照区分度 | 裁决 |
|---|---|---|---|---|---|
| A 分层断言+配对 delta | 高：确定性断言锚定 curated 期望（gold assessor 先例） | 高：host/页族粒度容忍轮转 | 中：期望需按 stratum 维护 | 强：同 query 同期望下 per-arm hit-rate/rank 差分 | ✅ 采纳 |
| B 纯 judge delta | 低：LLM=第三方判官，verbosity/self-family 偏置已实证 | 高（无期望可漂） | 低 | 名义有、实则被 judge 偏置污染 | ❌ judge 降为报告附注 |
| C 弱结构断言 | 低：只验管线存活 | 高 | 最低 | 无：通用臂同样非空→不构成质量证据 | ❌ 可作 smoke 层 |

## 3) 分点结论

### ① 期望粒度分层（host vs URL 字节级 vs 页族）是成熟心智模型，内容轮转下锚在「provider 稳定承诺」层

仓内三级粒度惯例（mustHitHosts/mustHitPaths 页族/mustHitUrls 字节级+stability_class 锚定 controlled/frozen-spec 才许字节级）与业界一致：Langfuse 明言 golden 条目须有「reviewed definition of what a correct response looks like」且「freshness silently decays」——条目须带时间元数据（=provenance/harvestedAt）；Microsoft RAG 实践强调 QA 对必须保留 context location（source doc ID）才算 retrieval success 指标——正是 mustHitHosts/mustHitPaths 的角色。（langfuse、Microsoft/Data Science at Medium、decagon 三源交叉）

### ② delta 证据件的成熟形态=配对比较（paired compare），同 query 双臂差分

rankkit（配对比较工具，专为此设计）汇报形制与 A 几乎一一对应：同一批 shared queries 双系统配对打分→报 delta+CI+per-query better/worse/tied 计数+biggest movers+per-stratum 等价物。其设计理由：「paired: query difficulty cancels」——正是「双臂共享同一批 query」的价值。Sentifish（六搜索 provider 同 query 头对头、P@K/R@K/NDCG/MRR per provider）是该形态的另一独立实例。（rankkit GitHub 原文、Sentifish 原文双源）

### ③ delta 是证据件不是门禁项→本轮不设阈值正确，业界支持「报 CI 但不硬门」

rankkit 在几百 query 规模上明言「differences smaller than that are routinely noise」并给出 queries_needed 检验力公式；总盘 ~60-70 条远低于显著性检验规模（按 rankkit 算例检出 +0.01 需 3671 条）——**delta 证据件应输出 per-stratum 差分值+配对 better/worse/tied 计数，明确标注 n 太小不构成统计结论，judge 评语附报告**。与仓内「聚合 MRR/nDCG 只进报告不进门禁」（ADR-0028 D2，单相关文档场景 rank-of-relevant 整数已含全部信号）完全自洽——rank 位置差可直接落成 expectRankOf 风格整数位差，不需引入聚合指标。

### ④ curated 期望 vs judge 打分的证据等级差异是「gold/silver/bronze assessor」层级差，垂域场景差距更大

SIGIR'26《Evaluation Validity in IR》（Thomas/Craswell/Sanderson/White）：gold assessor=有领域专长+真实信息需求者，TREC 式 curated 判断是金标上限；LLM 是 third-party judge 有实证偏置，且「LLMs seem poor at evaluating specialist text」——垂域评测恰是最不适合裸 judge 的场景。llm-judge-bench 用 ground truth 直接量化 judge 偏置：客观可验证项 97-100% 准确，但等质量长度对上 72-100% 偏好长答案+own-family lean +13pt——judge 对可归因质量证据只能作辅助。pooled LLM eval（arXiv 2609.02745）给出折中工业路径：judge 判断须与 gold 标准做相关性验证（97% 配对排序保持）才可用——对应「LLM judge 只进建集辅助与报告」，且建集辅助按 silver→gold 流程配 reviewer 审核门（D-003 已定 reviewer+audit trail，吻合）。

## 4) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | rankkit — Ranking evaluation with error bars | github.laiyagushi.com/mohammadi-hadi/rankkit | Official(工具)/Comparative | 2026-08 | 配对比较汇报形制全文（delta+CI+better/worse/tied+movers+检验力公式）；trec_eval 跳过无相关惯例 |
| 2 | Evaluation Validity in IR (Thomas, Craswell, Sanderson, White) | ryenwhite.com/papers/ThomasSIGIR2026.pdf | Official/学术 | SIGIR'26 (2026-07) | gold/silver/bronze assessor 分层；LLM=third-party judge、专域评测弱 |
| 3 | Golden dataset evaluation — Langfuse | langfuse.com/resources/engineering/golden-dataset-evaluation | Official | 2026 | 期望面 reviewed definition、freshness/条目日期元数据、synthetic 须同等审核 |
| 4 | The path to a golden dataset (Microsoft) | medium.com/data-science-at-microsoft/…045e23d1f13f | Official/实践 | 2024-05 | silver→gold 构建式、保留 context location 以算 topN retrieval、reviewer 门 |
| 5 | What is a golden dataset — Decagon | decagon.ai/glossary/what-is-a-golden-dataset | Official | 2026 | 分层抽样、版本治理、label 定期 IRR 审计 |
| 6 | When the Judge Is Wrong (llm-judge-bench) | labs.iovstudio.kr/en/papers/llm-judge-bench | Criticism/学术 | 2026-05-30 | judge 偏置量化：verbosity 72-100%、family lean +13pt |
| 7 | Incremental Pooled LLM Evaluation | arxiv.org/abs/2609.02745 | Official/学术 | 2026-09-02 | judge qrels 与 gold 相关性验证流程（97% 配对保持）、judge 可用性门槛 |
| 8 | Sentifish — web search provider benchmark | github.com/yamyr/sentifish | Comparative | 2026 | 同 query 六 provider 头对头、P@K/R@K/NDCG/MRR per provider |

（注：来源表按索引节重组；正文另引用 trec_eval/abeval/SEO 三层分析惯例。）

## 5) 信息缺口

- Thomas SIGIR'26 全文未抓到原文（PDF 二进制），引文经 Tavily 摘要窗口佐证——关键论断（gold assessor 分层、LLM 专域弱）另有 llm-judge-bench/arXiv 2609.02745 双源独立支持，结论不受影响；
- 「垂域评测 host 断言先例」无大厂一手公开案例（各 provider benchmark 均为社区项目），第⑤条结论由 SEO 三层分析与 rank-of-relevant 惯例归纳，属中等置信、可作为 ADR 里显式假设记录；
- 四判据分层选域的 per-stratum 样本量下限（每 stratum 几条才能让 rank 位置差有信号）无直接文献，建议参考 rankkit queries_needed 思路在 D-003 落盘时按 stratum 估算。

## 6) 对 R84-Q4 的最终推荐

采纳 **A**，落地细节固化建议：

1. **断言键**：expected.vertical{domain,sub_domain,paramsKeys}+verticalHit+degraded 照 D-002；参数化查询锚 mustHitHosts+mustHitPaths（页族），语义垂域查询期望面更宽（host+页族+minResults），字节级 mustHitUrls 仅限 stability_class=controlled/frozen-spec；
2. **对照条目**：独立断言键（如 expected.vertical.role: "control"），对照臂失败走 degraded 名单而非红门——对照类存在性是一等断言（D-003 既定）；
3. **delta 证据件形态**：per-stratum 分列的配对差分——per-arm hit-rate（host 命中率与「host+页族」强命中率分两档）、rank 位置差（双臂都命中的 query 的 expectRankOf 整数差+better/worse/tied 计数）+fingerprint+臂标识+judge 评语附报告；显式标注小样本 n、不设 CI/显著性门禁（证据件非门禁项），但 schema 留 CI 字段位；
4. **否决 B/C**：B 的 judge 只保留「报告附注+建集辅助（须 reviewer 审核后入 gold）」；C 降为 smoke/管线存活检查，不承担垂域质量证据职责。