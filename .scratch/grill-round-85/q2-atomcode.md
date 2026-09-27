[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。


I'll start by checking the knowledge base for any prior indexed material on this topic (per the required "falsify first" rule), and in parallel kick off the first wave of Exa searches across the sub-questions.



知识库中有两条内部相关条目（R78 的预注册判断矩阵、ADR-0050 的双阈值归因）——这些是本仓库自身约定的一部分，将作为本地上下文加以记录，但外部证据需要重新搜索。第一波 Exa 搜索中，4 个成功、1 个失败（网络错误）。现在我将进行第二波：重试失败的查询 + 补充覆盖 5 个子问题的其他角度，并同步启动 Tavily 和 AnySearch 进行三引擎交叉验证。



I've identified the key sources across four domains: Microsoft ExP and KDD for coverage gating, GrowthBook/VWO/Statsig for Bayesian thresholds and guardrails, and epidemiological studies with A/A testing literature for negative controls. Now I'll verify these sources and trace the guardrail document URL.



I've verified the key claims from 8 sources and now I'm diving into the deeper material on paired tests, guardrail contracts, safety monitoring, A/A tests, and the three-exit decision engines.



I've verified 13 sources so far. Now I'll fill in the remaining gaps by pulling in Spotify's Bayesian tiering article, finding an open-access alternative to the blocked MDPI paper, and locating the guardrail contract document from the Exa results.



I've confirmed 15 full reads across 12 domains and now I'm retrieving the VWO expected-loss whitepaper as the canonical source for the TOC threshold logic.



I've confirmed the VWO whitepaper is a binary PDF and found the expected-loss/TOC facts in Wingify and VWO's product updates. Now I'll complete the remaining verification fetches for Statsig's SRM thresholds and Fagerland 2013, then move to synthesis.



# R85 Q2 调研报告：小样本配对差分实验的预注册判读矩阵——业界与统计学心智模型

**Sufficiency Gate**：searches: 15（Exa ×10、Tavily ×2、AnySearch batch ×3）｜angles: Official / Comparative / Criticism / Currency / Community 五类全覆盖｜full reads: 16（VWO 白皮书 PDF 为二进制无法解析，已用 HTML 二手源替代并注明）｜gaps: 见文末 §6

---

## 1) 执行摘要（Tl;dr）

**推荐 (A) 三轴矩阵，做两处修正后使用**：① 方向轴 0.8 后验门槛低于全部业界默认值（90–99%），在「evidence-only 轮、GO 仅解锁后续实施、不直接上线」语境下可接受，但必须在决策记录里显式声明其为业务选择（Spotify 2026-09 证明：flat-prior 下 P(better>worse)≥0.8 与单侧 p≤0.2 代数等价，不是"比 p 值更保守"，只是换了词汇）；② 负向硬闸建议保留「任一域 worse−better≥3 记反向域 + ≥2 反向域 NO-GO」的 2-of-4 形态——业界先例是"任一即否决"（GrowthBook/LaunchDarkly）或"全部须过"（Airbnb 三闸各须独立通过），2-of-4 无直接文献先例，是我为控制误否决率（4 域逐一否决在 null 下误报率约 42–65%；2-of-4 降到约 5–23%）做的插值，应标注为设计选择而非引用。覆盖闸、对照层作噪音侦测、单次终读的设计与业界健康检查（SRM 前置闸）+ 阴性对照（negative control）+ 预注册分析计划（Gelman-Loken 分叉路径）三条成熟实践完全同构，无需改动。(B) 纯计数规则缺覆盖闸与噪音对照，(C) 效应量 CI 轴在 n≈41 配对二元下 CI 过宽、判别力不足，(D) 无必要。

**Confidence：高**（核心结论全部经 ≥2 个独立信源交叉验证，且一手官方/同行评审源占比高：Microsoft ExP、Spotify、JAMA、BMC 同行评审、Statsig/GrowthBook/VWO 官方文档）。

---

## 2) 裁决面对比矩阵

| 裁决面 | 覆盖前置闸 | 方向读法 | 负向局部否决 | 噪音侦测 | 与业界架构同构度 | 主要缺陷 | 推荐 |
|---|---|---|---|---|---|---|---|
| **(A) 三轴矩阵** | ✓ nPaired≥70% 且 unknown≤30% | Beta 后验 P(better>worse)≥0.8 + 池化 on>off | ✓ 反向域≥3 计数、≥2 域 NO-GO | ✓ 对照层期望全 tied | 高（SRM 闸 + 后验阈值 + guardrail + negative control 四件套齐全） | 0.8 门槛低于业界 0.90–0.99 默认；2-of-4 否决无直接文献先例 | **推荐（带两处修正声明）** |
| **(B) 纯计数** better−worse≥5 且 ≥2:1 | ✗ | 净计数（≈Impact Guardrail 点估计风格，无显著性） | ✗ 无分域 | ✗ 无 | 中（只有单一轴） | n≈41 且 tied 占比高时规则脆弱；首轮配额伤（16 条全 unknown）无闸拦截 | 否 |
| **(C) 效应量 CI 轴** CI 下界>−ε 且点估计>δ | ✗ | 区间估计 | ✗ 无 | ✗ 无 | 中（GrowthBook metric boundary / Airbnb non-inferiority 风格） | 配对二元 n≈41 时 armHostHit 差值 CI 半宽约 ±0.24，下界>−ε（ε≥0）几乎恒真，判别力退化为 δ 单点 | 作为 (A) 的**补充记录字段**而非主轴 |
| **(D) 另指** | — | — | — | — | — | 未发现比 (A) 更贴合的单一业界范式 | 否 |

---

## 3) 分点结论（五个调研问题）

### Q1 配对二元结果（better/worse/tied）的最优读法

**结论：Beta 后验 P(better>worse) 作为决策记录主读法有充分业界先例，但它的统计学身份必须在记录中写清：flat-prior 下它等于 1−单侧 p 值，不是独立于频率学的新信息。**

- **业界选型先例（平台默认）**：VWO 用 Probability to be Best（PBB，阈值 95%）+ Potential Loss（PL，TOC=基线×确信度模式×10%）双指标 [VWO glossary；VWO SmartStats 2024-12]；Statsig 用 "Chance to Beat" + Expected Loss + 可信区间，阈值用户可配 [Statsig SPRT 文档；Statsig Bayesian 文档]；GrowthBook 建议更富的策略：P(δ>m|data)（实际改进概率）+ 期望损失 [GrowthBook insights]。**三平台共同点：后验概率 + 效应量（期望损失或实际改进概率）双读，从不单报后验概率**——这正是 VWO TOC 与 productphilosophy 反复强调的"PBB 不含幅度信息"缺陷 [productphilosophy 2021-02]。
- **0.95 默认值与降级惯例**：VWO 95%（1−α）[VWO glossary]；convert.com 汇总：99% 关键变更 / 95% 默认 / 90% 低风险快决策 [convert 2025-09]；modesofplay 表格：≥95% 高影响、90–95% 功能发布、85–94% 中等、80–94% 可低风险上线 [modesofplay 2025-09]；r/AskStatistics 2025-09 社区讨论指出"α 的本质是设误报率，Bayes 用同级不一定有同级错误控制，弱先验下大约相当" [Reddit 1j7si7v]。**没有任何平台默认用 0.8 作为 GO 门槛**——0.8 只出现在"低风险可上线"的下限档。
- **0.8 的精确含义（Spotify 关键证据）**：Spotify 工程博客（2026-09-08）证明：flat-prior + 两组正态模型下，后验均值=MLE、**P(B>A)=1−单侧 p 值、95% 后验阈值与单侧拒绝域代数等价**；"flat-prior 按后验概率阈值停实验（几乎所有商业平台的默认）复现的是频率学 peeking 的误报率" [Spotify 2026-09]。→ 对本轮：P≥0.8 即单侧 α=0.2 的再包装。**这在"单次终读、禁 peeking"约束下是安全的**（后验阈值的主要批评全部针对 peeking 场景，见下），但决策记录应写明等价关系，避免误读为更强证据。
- **peeking 批评（对"单次终读"设计反向加分）**：alexmolas（2025-10，RevenueCat 实测）：每 100 事件查一次、P>0.95 即停，null 下误报率升到 80%；"后验在任何时点可解释，但固定阈值 + peeking-and-stop 不控制误报" [alexmolas 2025-10]；Georgiev/analytics-toolkit（2017/2019）：peek 2 次实际错误率>2×标称、5 次~3×、10 次~4×，且逐个点名 VWO 不调、Optimizely 用 FDR 校正属次优 [analytics-toolkit]；Evan Miller（2010，经典）：peek 10 次后"1% 名义显著性实为 5%" [evanmiller]。**结论：R85 的"单次终读禁 peeking"恰好移除了后验阈值方案被批评的全部前提，该约束应写进判读矩阵作为生效条件（若发生二次读取，矩阵失效）。**
- **配对二元的最优检验（同行评审）**：Fagerland et al. 2013（BMC Med Res Methodol，391 引用）：McNemar mid-p 与 exact unconditional 在 9595 个场景均未违反标称水平，mid-p 几乎与最强的 asymptotic 同等功效；**不推荐 exact conditional 与带连续性校正版**；asymptotic 版在 29% 场景违反水平（小样本 n≤30 时仅 3.7%）[Fagerland 2013]。Roldán-Nofuentes et al. 2024（24 方法蒙特卡洛）：n≈20–50 时 McNemar（无 CC）与 modified Wald 可用，exact/mid-P 保守但永不超水平 [MDPI 2024，摘要经 Exa 验证，原文 403]；Sage 教材 PDF：二分数据 → McNemar/sign test 家族，连续可排序 → sign/Wilcoxon [uk.sagepub.com]。**对决策记录：verdict 计数（better/worse/tied）本身就是 discordant-conditional 读法（tied 条件化掉），与文献最优实践一致；Wilcoxon 配对秩对 rankDiff 是合法补充，但二元 verdict 上 sign 型读法（=Beta 后验在 flat-prior 下的计数形式）已足够，秩检验只用于 rankDiff 的辅助描述。**
- **效应量表达（决策记录用）**：业界三件套 = 净胜率 (better−worse)/nPaired（可审计、免推导）+ 后验概率 P(better>worse) + 期望损失 EL（单位与指标一致、直接回答"错判代价"）[VWO TOC；productphilosophy；GrowthBook]。rankDiff 中位数作为排序质量描述字段保留（无业界对应物但自洽）。**建议决策记录同时落这四个数**，成本为零（字段都在 runner 输出里，EL 可由 Beta 后验解析/采样得出）。

### Q2 预注册决策矩阵的阈值设定实践

**结论：三出口（GO/NO-GO/INCONCLUSIVE）的业界画法是"上阈值 + 下阈值 + 中间地带"，上/下阈值非对称且下阈值常远低于 0.5 的对偶位置——(A) 的 0.8/0.5 画法是业界形态的保守变体，合法。**

- **上阈值（GO）**：平台默认 95%（VWO/Statsig/GrowthBook 一致）；关键决策 99%（convert.com）；低风险 90%（convert.com）；85–94% 为"中等信号，低风险可动"（modesofplay）。**(A) 的 0.8 处于所有档位之下**，仅当 GO 的后果只是"允许下一轮实施加权"（evidence-only 轮，零用户面影响）时才合理——与 modesofplay 的"风险越低、门槛可越低"原则同向，但**必须在矩阵中声明：这是业务选择而非统计默认**（metricgate 文档原话："0.95 是业务选择，不是数学要求" [Tavily 摘要]）。
- **下阈值（NO-GO）**：VWO 引擎在 P<5% 时主动建议禁用变体 [VWO SmartStats 2024-12]——即下阈值是"明确反向"而非"不够正向"。(A) 用 P≤0.5（即反向概率≥正向）+ 池化 on≤off 双条件做 NO-GO，比 VWO 的 5% 宽得多，属于"只在明确反向才判 NO-GO、其余全落 INCONCLUSIVE"的保守画法——对 evidence-only 轮正确（宁可 INCONCLUSIVE 不可误 NO-GO 杀掉真信号）。
- **三出口结构先例**：Statsig SPRT 是教科书形态：LR>上界=接受备择（GO）、LR<下界=接受原假设（NO-GO）、界间=继续收集（INCONCLUSIVE→续跑）[Statsig SPRT 文档]；GrowthBook Safe Rollout 的状态机：Ready to ship / Guardrails Failing / No Data / Reverted [GrowthBook 文档]——"证据不足"是独立终态，**不静默变成 PASS**（FeatBit 引述 Argo Rollouts：Inconclusive 是显式第三态）[FeatBit]。**(A) 完全符合该形态。**
- **预注册字段清单（判读矩阵该锁死什么）**：Donnu 2026-08（引 Gelman-Loken 分叉路径 + Kohavi）给出完整字段表：假设（含机制句）、主指标（唯一+分母）、随机化单元、MDE（带来源）、样本量与时长、停止规则（日期或样本量二选一）、显著性水平（**已按声明的比较数校正**）、**分段的封闭列表**、次级/guardrail 指标封闭列表、决策判据（什么 ship、什么 drop、什么重跑）[Donnu 2026-08]。并给出关键算术：**20 个可用比较下，null 中至少一个假阳性的概率 64.2%**（1−0.95^20）；同一显著结果，预声明先验 1/3 → 后验为真 89%，事后挖掘出的假设先验 1/500 → 3.1% [Donnu，引 Kohavi et al.]。→ **对本轮：四域必须作为封闭列表在重跑前写死；"worse−better≥3 的反向域"判据只能适用于这四个预注册域，事后新增域（如按 semantic/parameterized 再切）不具否决权，只能记为假设。**
- **预注册的代价**：Donnu 示例：4 个声明比较使 α 从 0.05→0.0125、每臂样本 31k→44k；20 个→0.0025、59k [Donnu 2026-08]。离线评测版等价物：预注册 4 个域 = 4 次独立比较，负向硬闸的误否决率按 4 重比较计算（见 Q3）。

### Q3 负向局部否决（regional/subgroup harm gates）先例

**结论：业界形态是"预注册封闭小集合 + 每个 gate 非补偿性独立通过 + 以点估计/显著性两种强度分层"，没有"2-of-N 多数否决"的直接先例；(A) 的 2-of-4 是合理插值，其误否决率可算出。**

- **任一即否决（veto-by-one）**：GrowthBook Safe Rollout："任一 guardrail 指标显著回退即自动回滚并禁用规则" [GrowthBook 文档]；LaunchDarkly guarded rollout：sequential 测试判定任一 metric 显著负向即暂停/回滚 [LaunchDarkly 文档]。这是**单域反向一票否决的直接业界先例**。
- **全部须过（all-pass，等价于任一否决）+ 三重闸分层**：Airbnb 2019 全公司 Experiment Guardrails：三个闸**各自必须独立通过**（Impact Guardrail：点估计劣化超阈值 T 即升级，**不看显著性**；Power Guardrail：SE<0.8t，保证前闸有功效；Stat-Sig Negative Guardrail：对顶级指标，任何显著负向——哪怕量级小——即升级）[Airbnb 2021-01]。**Impact Guardrail 是"计数/点估计型硬闸、无显著性检验"的直接先例**——(A) 的 "worse−better≥3 计数闸" 正是这个家族（点估计阈值，非 p 值）。
- **多 gate 的误报代价（否决阈值如何设的定量依据）**：Airbnb 明算：0.05 水平下 3 个 guardrail → A/A 假警报 ~14%，10 个 → 40%，25 个 → 73% [Airbnb 2021-01]。→ **gate 数量必须小而封闭**；4 域是安全数量级（14% 量级）。
- **2-of-4 的误否决率（自算，非引用，供决策记录参考）**：设单域反向旗（worse−better≥3）在 null 下的单侧误报率 r。n≈10/域、tied 常见时：6 个 discordant 里 5 反向 → r=7/64≈0.11；7 个 discordant 里 5 反向 → r=29/128≈0.23。任一否决：P(≥1 旗)=1−(1−r)⁴ ≈ 42%–65%；**2-of-4：≈5%–23%**。→ 2-of-4 相对任一否决把误否决率压一个量级，代价是放行"单域真伤害"。在 evidence-only 轮（NO-GO 不直接回滚任何人，只是推迟加权实施）该代价可接受；**若未来 GO 直接触发线上加权，应改回任一否决 + 更严的单域阈值（≥4）**。
- **临床先例（harm 专用闸）**：Martens & Logan 2024（Clin Trials，同行评审）：安全监测停止规则家族 = Pocock / O'Brien-Fleming 精确二项序贯 + 贝叶斯 Beta-binomial 后验阈值 P(p>p0|S_k)≥τ（τ 反解到总体 α）+ 单侧 SPRT（只允许提前拒绝 null=只允许"因伤害停"）[PMC11003847]。要点：**harm 闸惯例是单侧的（只设"因伤害否决"，不设"因伤害 GO"）**——(A) 的负向硬闸恰是单侧的，符合该惯例。

### Q4 覆盖闸（measurable-rate precondition）

**结论：业界没有"unknown 比例 X% 即作废"的单一行规，成熟做法是三类闸的合取：(i) SRM 型比例检验（保守 p 阈）、(ii) 最小样本/数据存在性闸、(iii) Power Guardrail 型"SE 相对效应阈值"闸。未知比例是这三者的粗代理；(A) 的 70/30 可保留为声明式代理，并补一句对照层的独立闸。**

- **SRM 是覆盖/完整性闸的母版**：Microsoft ExP：**每个 A/B 实验必须先过 SRM 才能分析**；卡方检验、**p<0.0005 的保守阈值**（"保守以降低假阳性"）；SRM 是"一系列数据质量问题的症状"（如发热之于疾病）[Microsoft ExP 2020-09；KDD'19 论文]；Statsig：卡方，**p<0.01 警告（黄）/ p<0.001 且绝对偏差≥0.1% 警报（红）=结果不可信**；"即使低速率 SRM 也会导致读数严重失真" [Statsig SRM 文档]；社区实践（ravenclaude skill 文件）："用 p<0.01 而非 0.05——**你测的是装置完整性，不是产品假设**" [GitHub]。→ 离线评测的"nPaired≥70%"是 SRM 闸在离线语境的对应物；**方向应更严而非更松**：首轮教训（on 臂截断→control 16 条全 unknown）证明装置伤可以 100% 摧毁一个臂。
- **最小样本/存在性闸**：LaunchDarkly："新变体在每个 ramp step 必须被最少数量 context 评估，否则自动回滚" [LaunchDarkly]；GrowthBook "No Data" 状态 = 终态之一 [GrowthBook]。
- **最严格的形态：Power Guardrail（SE 闸）**：Airbnb：覆盖闸不应是裸样本比例，而是 **SE(效应估计) < 0.8 × 升级阈值 t**——即"你观测到的 n 必须足以分辨你想分辨的效应 t"；且 t 随全局覆盖度调整（低覆盖实验被要求更小的全局影响）[Airbnb 2021-01]。→ **对 n≈41、per-domain≈10：配对二元 armHostHit 差的 SE 约 0.2+，任何 |δ|<0.4 的效应都分辨不了——这正是"70% paired"这类裸比例闸不够的原因。建议在矩阵里把 70/30 声明为 Power 闸的代理，并在记录中注明本轮 n 下可分辨的效应量下限（~±0.4 armHostHit 差）。**
- **"多少 unknown 使判读失效"的直接答案**：业界做法 = 二值闸（pass/fail），不分级；离线版建议：处理层 unknown>30% 或 nPaired<70% → 该层 INCONCLUSIVE（装置旗标）；**对照层 unknown 比例单独设闸——若对照层（n=16）unknown>50%，整轮判读作废**（见 Q5，对照层是装置校验器，它失效则处理层读数无基准）。首轮 control 100% unknown 恰好会被此闸正确拦截为"装置失效"而非"16 条 unknown 证据"。

### Q5 对照层（negative control / placebo）的正确用法

**结论：期望全 tied 的对照层出现系统性非 tied 时，应判"评测仪器失真"（第三选项），不是噪音、也不是可归因于处理的泄漏——按 JAMA 阴性对照的定义，对照层不受处理机制影响，其上出现任何"效果"就是偏差存在的证据；处置 = 整轮判读降级 INCONCLUSIVE + 根因分类，禁止带伤读取。**

- **阴性对照的形式化定义**：JAMA 2016（Arnold & Ercumen，UC Berkeley）：negative control outcome = **与主终点共享同一偏差结构、但按机制不可能被处理影响**的结局；"若观察到按假设机制不可能的处理-对照关联，即提示存在未测量/不可测量的偏差源" [PMC5428075]；placebo 组 = negative control exposure（抽掉必要成分，暴露于同一偏差结构）[同上]；**预指定**阴性对照可防止选择性呈报 [同上，引 Prasad & Jena 2013]。→ R85 对照层（同样语料、无垂域加权声明臂）就是标准的 negative control：它若系统性非 tied，唯一解释是**共享管道（配额、评分器、数据流）出了问题**。
- **三类偏差的判别（JAMA 分类 → 处置）**：
  - 选择偏差（选择性 attrition/纳入差异）→ 对照层与处理层的**缺失/unknown 模式不对称**（首轮：on 臂截断而 control 全 unknown，是典型"配额对臂作用不对称"）；
  - 测量偏差（differential misclassification）→ 对照层出现**系统性方向性非 tied**（如评分器对某域系统性偏 favor 某臂）；
  - 工具/管道 bug → 对照层 tied 率**整体异常低**且处理层同样异常（装置性噪音，即"噪音"选项，但根源仍是仪器）。
  **判别顺序（预注册）：先看 unknown/缺失模式（选择/配额伤）→ 再看方向一致性（测量偏差）→ 最后才是对称噪音。三种情况处置相同：判读 INCONCLUSIVE + 装置旗标 + 根因分类；区别只在记录里的归因类别。**
- **A/A 测试先例（在线实验的对照层）**：Twitter X 工程博客：A/A 是"零处理"测试，用于**验证测试框架整体正确性**（统计实现、离群点检测、垃圾过滤），A/A/B 设计可降误报 [blog.x.com 2016，403 经 Exa 摘要]；Kohavi《Trustworthy OCE》第 19 章"The A/A Test"含"When the A/A Test Fails"专节：A/A 失败 = 框架问题，必须解决后才能信任结果 [Cambridge 目录，2020]；booknotes 摘要：SRM/"A/A 必须解决，因为再小的失衡都能产生误导效应" [booknotes 2025]。
- **对本轮的具体化**：对照层 n=16、期望全 tied。预注册判读：(i) 对照层 non-tied ≥4/16（25%）→ 装置旗标，整轮 INCONCLUSIVE；(ii) 对照层 unknown >50% → 装置旗标，整轮 INCONCLUSIVE；(iii) 对照层 passed 但处理层 unknown>30% → 处理层 INCONCLUSIVE（对照层只证明"装置在本轮基本健康"，不豁免处理层自身缺失）。**关键：对照层通过是处理层判读的必要性条件之一（与 Q4 覆盖闸合取），不进入方向判分——(A) 的这一设计正确。**

---

## 4) 对 (A) 的最终修正清单（供直接落入预注册矩阵）

1. **方向轴**：保留 Beta 后验 P(better>worse)≥0.8，但记录中写明"等价于 flat-prior 单侧 p≤0.2；低于平台默认 0.90–0.99；evidence-only 轮业务选择"；同时落 EL（期望损失）与净胜率 (better−worse)/nPaired 两字段（业界双读惯例）。
2. **生效条件**：矩阵仅在"单次终读"下有效；若发生二次读取/中途 peek，矩阵作废（peeking 文献的全部批评都指向 peeking，单读是安全前提）[alexmolas 2025-10；analytics-toolkit；Evan Miller 2010]。
3. **覆盖闸**：70/30 保留为声明式代理，补一句"本轮 n 下 Power 下限 ≈ |ΔarmHostHit|≥0.4 才可分辨"（Airbnb Power Guardrail 精神）；**新增对照层独立闸**：对照层 non-tied≥4/16 或 unknown>8/16 → 整轮 INCONCLUSIVE（装置旗标）。
4. **负向硬闸**：保留 2-of-4，记录中注明"业界先例为任一否决（GrowthBook/LaunchDarkly）或 all-pass（Airbnb）；2-of-4 为控制 4 重比较误否决率（null 下 ~5–23% vs 任一否决 ~42–65%）的设计选择"；域列表（finance/academic/code/health）封闭、预注册，事后切分无否决权 [Donnu 2026-08]。
5. **INCONCLUSIVE 附具名下触发**（A 已有）：与 Argo/GrowthBook 的显式第三态先例一致——"证据不足"永不静默变 PASS。
6. **本地一致性**：该形态与仓库既有约定同构——R78 D-002「预注册判决矩阵：跑前写死每格预期（含预期错误码），必含正/负对照格，判决后登记=合理化窗口」（本会话知识库命中）；ADR-0050 双阈值归因（上阈 supported/下阈 unsupported/中间弃权）即 (A) 方向轴的内部分类学前身。

---

## 5) 完整来源清单（17 项，均为本轮真实打开/核验）

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Diagnosing SRM in A/B Testing (Microsoft ExP) | microsoft.com/en-us/research/…/diagnosing-sample-ratio-mismatch-in-a-b-testing | Official | 2020-09-14 | SRM 前置闸铁律、p<0.0005 保守阈、SRM=数据质量症状、KDD'19 分类学 |
| 2 | Why Spotify Is Not Using Bayesian A/B Testing | engineering.atspotify.com/2026/9/… | Official+Comparative+Criticism | 2026-09-08 | **flat-prior 后验概率=1−单侧 p、95% 阈=单侧拒绝域代数等价**；Bayes 配置分层（flat-prior 阈值停=peeking 误报率复现；Bayes factor 停=martingale 有 FPR 控制；决策论停） |
| 3 | Bayesian A/B testing is not immune to peeking (alexmolas/RevenueCat) | alexmolas.com/2025/10/30/bayesian-ab-test-peeking.html | Criticism+Currency | 2025-10-30 | 实测：每 100 事件 peek、P>0.95 停 → null 误报 80%；"后验随时可解释，但固定阈+peek-stop 不控误报" |
| 4 | Bayesian AB Testing is Not Immune to Optional Stopping (Georgiev) | blog.analytics-toolkit.com/2017/bayesian-ab-testing-not-immune… | Criticism | 2017/2019 | Armitage 1969 倍增系数（peek 2/5/10 次→2×/3×/4×）；VWO/Optimizely/GA 三家处理（不校正/FDR/bandit）逐个剖析 |
| 5 | How Not To Run an A/B Test (Evan Miller) | evanmiller.org/how-not-to-run-an-ab-test.html | Criticism（经典） | 2010-04-18 | peek 10 次→名义 1% 实为 5%；固定样本量先决；序贯设计/Bayes 设计两条出路 |
| 6 | The McNemar test for binary matched-pairs: mid-p and asymptotic (Fagerland 2013) | link.springer.com/article/10.1186/1471-2288-13-91 | Official（同行评审） | 2013-07-13 | 配对二元检验选型定论：mid-p/exact-unconditional 全场景不违水平；不荐 exact-conditional 与 CC 版；n≤30 时 asymptotic 违规仅 3.7% |
| 7 | Hypothesis Test to Compare Two Paired Binomial Proportions: 24 Methods (Roldán-Nofuentes 2024) | mdpi.com/2227-7390-12/2/190 | Official（同行评审） | 2024-01-06 | n=20–50 区间 McNemar 无 CC/modified Wald 可用；exact/mid-P 保守；（原文 403，经 Exa 全文摘要核验，标为部分读） |
| 8 | Airbnb: Designing Experimentation Guardrails | medium.com/airbnb-engineering/designing-experimentation-guardrails | Official（工程一手） | 2021-01-27 | **三闸 all-pass：Impact（点估计闸，不看显著性）+ Power（SE<0.8t）+ StatSig**；多 guardrail 误报算术（3→14%、10→40%、25→73%）；T 值双取大原则 |
| 9 | GrowthBook Safe Rollouts 文档 | docs.growthbook.io/features/safe-rollouts | Official | （2026 现行版） | **任一 guardrail 显著回退→自动回滚**；metric boundary=CI 界过零；No Data=显式终态；SRM/多曝露健康检查三态处置 |
| 10 | LaunchDarkly Guarded Rollouts | launchdarkly.com/docs/home/releases/guarded-rollouts | Official | （2026 现行版） | 最小样本闸（每 step 最少 context 数否则回滚）；sequential 判回归 |
| 11 | Statsig SRM 文档（Monitoring + SRM Checks + Blog） | docs.statsig.com/experiments/monitoring/srm 等 | Official | 2023–2026 | SRM 分档阈值（p<0.01 黄 / p<0.001+偏差≥0.1% 红）；"低速率 SRM 亦可严重失真"；重启为最佳实践 |
| 12 | Statsig SPRT 文档 | docs.statsig.com/experiments/advanced-setup/sprt | Official | （2026 现行版） | **三出口决策结构母版**（上界 GO/下界 NO-GO/界间继续）；三方法对照表（含 posterior 阈值定义） |
| 13 | VWO Statistical Significance glossary + Enhanced SmartStats | vwo.com/glossary/statistical-significance；wingify.com/product-updates/enhanced-vwo-smartstats | Official（厂商） | 2022-03 / 2024-12-04 | **PBB 95% 默认 + PL/TOC=基线×确信度×10% 双读**；P<5% 主动建议禁用；ROPE/MDE/FPR 可配 |
| 14 | Bayesian A/B Testing in Practice (Product Philosophy) | productphilosophy.com/articles/bayesian-ab-testing-practice | Comparative | 2021-02-18 | EL 与 PBB 双判据（"EL 常先触发"）；监控策略×有效 FPR 对照表（Bayes 95% 日检=4.8%）；95% 可信区间直译 |
| 15 | The Pre-Registered Analysis Plan in A/B Testing (Donnu) | donnuab.com/blog/en/pre-registered-analysis-plan-ab-testing | Official（方法学）+Currency | 2026-08-26 | **预注册字段全表**；Gelman-Loken 分叉路径；20 比较→64.2% 假阳性；先验 1/3 vs 1/500 → 89% vs 3.1% 后验为真；预注册样本代价表 |
| 16 | Negative Control Outcomes: A Tool to Detect Bias in Randomized Trials (JAMA) | pmc.ncbi.nlm.nih.gov/articles/PMC5428075 | Official（同行评审） | 2016-12-27 | **阴性对照形式化定义+三种偏差判别（confounding/selection/measurement）+预指定要求**——对照层判读的直接依据 |
| 17 | Statistical Rules for Safety Monitoring in Clinical Trials (Martens & Logan, Clin Trials) | pmc.ncbi.nlm.nih.gov/articles/PMC11003847 | Official（同行评审） | 2023-10-25 | harm 停止规则家族（Pocock/OBF 精确二项、Bayesian beta-binomial 阈值 τ 反解 α、单侧 SPRT=只允许因伤害停）——负向硬闸单侧性先例 |

另核验未计入：VWO SmartStats 技术白皮书 PDF（chrisstucchio.com，二进制无法解析，TOC/EL 核心已由 #13 两个 HTML 页交叉覆盖）；Cambridge《Trustworthy OCE》目录（A/A 专章+SRM 章节存在性）；Sage 教材 PDF（配对检验家族分类）；blog.x.com A/A 博客（403，仅 Exa 摘要，未计入 full read）；r/statistics 与 r/AskStatistics 线程（Community，社区信号级）。

---

## 6) 信息缺口（仍不知道什么）

1. **2-of-4 反向域否决无直接文献先例**——业界只有"任一否决"与"all-pass"两端；本报告的误否决率算术（5–23%）为自算推导，未经外部验证。若需要更强依据，需对 (A) 矩阵做蒙特卡洛 null 模拟（离线可做，不属于本轮联网调研）。
2. **离线评测的 unknown 比例阈值无行规**——业界 SRM 是比例*检验*（卡方），不是固定百分比；"70/30"在在线实验文献中找不到直接对应数，本报告只能给结构论证（SRM 闸 + Power 闸精神）而非数值引用。
3. **VWO 白皮书 PDF 未读**（二进制）——TOC 公式（基线×确信度×10%）由厂商 glossary + SmartStats 公告两源覆盖，但白皮书中 expected loss 的完整推导未核验。
4. **per-domain n≈10 时"≥3 计数"的统计功效**（检出率多少、对 tied 率的敏感度）无现成表，仅有 Fagerland/Roldán-Nofuentes 的 type-I 侧证据；功效侧需自算。
5. **R83 遗留问题**：首轮"部分 worse 实为配额伤"的逐条重归因（哪些 worse 行是装置伤）无法从外部文献获得，需 runner 原始 per-row 数据本地核查——建议下轮判读前先把首轮 57 行里 unknown/worse 的臂分布拉出来做一次装置伤标记，再套用本矩阵。

---

## 裁决面推荐（一句话）

**采用 (A)，按 §4 六条修正后预注册**：覆盖闸（70/30 + 对照层独立闸 + 单读生效条件）→ 对照层噪音侦测（JAMA 三分类归因，非 tied 即装置失真）→ 方向轴（Beta 后验 ≥0.8 + 池化 on>off，附 EL 与净胜率双记录字段）→ 负向硬闸（4 封闭域、≥3 计数、2-of-4 否决，单侧）→ 三出口 GO/NO-GO/INCONCLUSIVE（显式第三态，附具名下触发）。该形态同时满足业界四条成熟实践（SRM 前置闸、后验双读、guardrail 非补偿否决、预注册封闭比较）与本仓库 R78 判决矩阵/ADR-0050 双阈值既有约定。

继续此会话，运行：atomcode -p "…" --resume 1ecb6370-0dd8-48a7-8c59-c3c6f5e45c6d
