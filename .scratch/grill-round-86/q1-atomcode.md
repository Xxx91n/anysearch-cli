# Q1 atomcode 调研存档 — R86 主轴裁决（装船 vs 治理）

调研时间：2026-09-27 · 问题原文见 q1-prompt.txt · 来源清单见 §4

## 1) 执行摘要（TL;DR）

**推荐：方案 C 复合轮，但结构上是「以 A 为主轴、B 裁剪为装船前置 + 随行小件」的复合，不是 A+B 平权打包。** 理由三条主线交叉指向同一结论：① 红门（ship-gate 双红）按 andon/broken-trunk 惯例是**绝对前置**——Google 明文「强烈不鼓励在已知失败的测试上提交新工作」，Build Cop「放下手头一切先修 build」（置信度：高，4 个独立信源）；② 五轮未发布的 npm 修复是典型 WIP 库存，批越大风险越高（Reinertsen 批次理论：8 周期合一发 = 64 倍风险敞口），且**该修复自身带病**（探针期 live / 全量期失败）意味着「先根因判别再装船」不是可选项而是装船的合法前提；③ 治理项不是全部同等紧急——只有「红门修复」和「NO-GO 限定语 + 阴性证据最小归档」因直接影响本轮发布声明合法性而必须进本轮，其余（旧 smell 清障、checklist 加项）可拆小件随行或顺延（置信度：中高）。

## 2) 分点结论

**结论 1：红门双红必须本环修复，且优先于一切新工作（andon / stop-the-line 惯例）。**
- Google《Software Engineering at Google》Ch23：TAP 红了之后「fixing breakages quickly is imperative」；Build Cop 收到通知后「drop whatever they are doing and fix the build」；文化规范明确反对在已知红的头上叠加提交；首选手段是 rollback 而非 forward fix。[S1]
- DevLead.io（Trunk-Based Development 语境）：「we do not work around the problem or schedule a fix (when we have more time)」——明确否定「排期再修」；质量门失败期间冻结一切 enhancement。[S2]
- Hatchet（2026-08，时效性信源）：andon cord 事件 = 全队停工修管线，短痛换长期流速；「nothing more important than our ability to ship reliable software」。[S3]
- 对本案的直接含义：closeout-claims.json 指向 gitignore 文件属于**注册合约错配**（claims 四种 kind 覆盖不了 machine-local 类），这是「红 CI 上签字发版」的反模式。谷歌的做法是 release candidate 从 **green head** 而非 true head 切——红门不绿，v0.0.9 就没有合法的切点。[S1]

**结论 2：「修复在 main 睡五轮」是 lean/WIP 库存问题，库存越大装船风险越高，趋势是缩短而非继续积累。**
- Reinertsen 批次经济（via Belk）：批次 × 周期 = 在制风险总量；8 周期合一发的风险敞口是增量发的 64 倍；五轮积压（MCP 迁移 + 垂域贯通 + dsh repin）一次性装船正是大批次发布，风险已在峰值。[S4]
- Black Light Agile：大批次「整个 release 在所有组件协同工作前一直是 WIP；缺陷更难定位」。已发布 0.0.3–0.0.8 全部指向判死的端点 = 线上库存带毒，每多等一轮，用户侧暴露与回滚成本都在涨。[S5]
- Release train 模式的固有缺陷（Hector 对比文）：「Features may wait unnecessarily」「Risk of carry-over work」——这正是本案症状。但 release train 的合法性前提是「develop on cadence, **release on demand**」（Planview/SAFe）：批次按节奏开发，但过门槛即走，不强迫下一班火车。[S6][S7]
- 含义：本案不是「要不要 release train」之争——单包 npm、单团队，根本不需要固定火车；而是「货已到站台五轮，检测门红了还压着不发」。lean 心智明确指向：修门 → 尽快发。

**结论 3：先根因判别再装船 vs 先发后查——本案证据结构决定了必须先判别。**
- 一般惯例：fix-forward 适合小团队高信任（glazkov：小项目 fix-forward 有效；大项目 rollback/sheriff 制度化）。[S8]
- 但本案特殊：R85 全量跑批中 anysearch 臂 providersFailed 全程失败，而 R82 探针期 verified live——**修复本身的健康状态未知**。Google 的分层心智在此直接适用：presubmit（探针）绿 ≠ post-submit/全量绿，「cost of a bug grows almost exponentially the later it is caught」。[S1]
- 若先把带病修复装进 v0.0.9 再查根因：发布后失败 = 外部用户可见的回归（0.0.8→0.0.9 从「端点死」变成「客户端死」，可能是降级），且违背 fail-open 承诺（AGENTS.md：server 不可达时优雅降级——但 404 route-level dead 是持续硬错）。
- 反过来，defer-r85 三候选根因（携钥隔离路径 / ANS_PROVIDERS 名义匹配 / 上游当日失效）都是**可判别**的：隔离复跑实验可以区分「环境性失败」与「修复缺陷」。工业惯例（Google 热单分诊、Hatchet 停线根因）都支持：停线期内完成根因，再放行。
- **所以 A 方案内部顺序应固化为：判别根因 → 臂复活 → 全绿复跑 → 绿门 → v0.0.9**，根因判别不是发布的前置拖延，而是发布的准入条件。

**结论 4：一轮一主题 vs 复合轮——批次理论给出的是「控制批次内容」而非「禁止复合」。**
- ADR-0029 的一轮一主题是对「undocumented while-you're-at-it」的反模式防御——这个防御对象是**主题漂移**，不是复合本身。
- 批次理论视角：B 方案的治理件（claims kind 扩展、NO-GO 措辞、证据入库、Status 翻面、清障）是一组**同子系统的小内聚件**，把它们拆成独立轮次会产生 6 个轮次开销（每轮的审计、ADR、评审成本），批次过小的开销在协调侧同样真实。[S4][S5]
- SAFe 反模式文献警告的不是复合，而是**无记录的范围蔓延**。故推荐结构：本轮 ADR 主题 = 「装船前置的根因判别与绿门发布」，治理件中与发布合法性直接相关的（红门修复、NO-GO 限定语、阴性证据最小 schema、Status 翻面）作为**装船前置/同轮落地项**写进同一 ADR；纯清障项（旧 defer、checklist 加项）作为独立 refactor commit + CHANGELOG Removed 条目——这恰好就是 AGENTS.md 已规定的处置形态。

**结论 5：阴性结果原始证据归档——惯例是「结论可复核性 ≥ 结论本身」，最小 schema 够用。**
- 科研侧：数据应在结论发表时进入可访问归档，阴性结果尤其需要（发表偏倚使阴性结果更依赖原始数据自证）。[S9 系]
- 工程/平台侧旁证：CI artifact 留存实践（upload-artifact + retention-days: 90，if: always() 确保失败也上传）是工业界标准做法——**失败运行的证据件与成功运行同权留档**。[S10]
- 本案 NO-GO 是项目首份阴性裁决，41 对全 tied 的原始证据不入库 = 第三方只能信判读器。最小 schema（判读器输入快照 + 判读配置 hash + 运行环境指纹）即可达成可复核性，不需要重型数据管理。这与「NO-GO 裁决行补 provider-failure 限定语」是同一件事的两面：限定语声明适用范围，证据件支撑限定语。两者都应进本轮。

## 3) 对比矩阵

| 项 | 主轴 | 红门处置 | 风险 | 适配本案 |
|---|---|---|---|---|
| A：纯装船轮 | defer-r85 根因判别→臂复活→全绿→v0.0.9 | 前置修复 | 修复带病，若判别草率则发版即翻车；治理债继续滚 | 部分适配（缺治理腿） |
| B：纯治理轮 | claims/措辞/证据/清障 | 修复但不发版 | WIP 库存再 +1 轮，npm 用户继续吃死端点；与 lean 直觉相反 | 不适配 |
| **C：复合轮（推荐）** | **A 为主轴**；红门修复 + NO-GO 限定语 + 阴性证据入库 + Status 翻面为装船前置；清障件独立 commit 随行 | **andon 级前置，门绿才切 RC** | 批次偏大——靠 ADR 单主题声明 + 拆分 commit 控制 | **适配** |
| D：先发后查 | v0.0.9 直接装船，根因后补 | 修门但先行发布 | 违背 broken-trunk 惯例 + 带病修复上线 | 不适配 |

## 4) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| S1 | Software Engineering at Google — Ch23 Continuous Integration | https://abseil.io/resources/swe-book/html/ch23.html | Official | 2020 | Build Cop 制度、green head 切 RC、反对红上叠加、rollback 优先 |
| S2 | Andon Cord — DevLead.io | https://www.devlead.io/DevTips/AndonCord | Official/Community | 2020 前后 | 「不绕过不排期」，质量门红冻结新工作 |
| S3 | Bufo pulls the andon cord — Hatchet | https://hatchet.run/blog/andon-cord | Community/Currency | 2026-08-17 | 初创公司停线实践；无计划工作才是最大负担 |
| S4 | Batch Size, WIP & Risk — William Belk | https://medium.com/the-agile-weekly/understanding-product-development-batch-size-work-in-process-wip-risk-for-small-teams-f551144ecbb5 | Criticism | 2015-07-31 | Reinertsen 批次经济学：大批次 = 64× 风险敞口 |
| S5 | Small Batch Size — Black Light Agile | https://blacklightagile.com/2024/09/28/small-batch-size/ | Criticism | 2024-09-28 | 大批次缺陷定位难、整个 release 长 WIP |
| S6 | Release Train vs Continuous Deployment — Hector | （medium.com 全文见 ctx 索引） | Comparison | — | release train 缺陷：features wait、carry-over risk |
| S7 | Planview/SAFe release on demand | （见 ctx 索引） | Official | — | develop on cadence, release on demand |
| S8 | glazkov fix-forward | （见 ctx 索引） | Community | — | 小项目 fix-forward 有效，大项目 rollback/sheriff |
| S9 | 科研数据归档/阴性结果文献（摘要级） | （见 ctx 索引） | Academic | — | 阴性结果依赖原始数据自证 |
| S10 | GitHub Actions upload-artifact 留存惯例 | （见 ctx 索引） | Official | — | retention-days + if:always() 失败同权留档 |

## 5) 信息缺口

1. **「复合轮节奏治理」无直接权威文献**——工业界没有「一轮一主题」的对应成文规范，以上用批次理论 + SAFe 反模式旁证推导，属于类比论证而非直接先例。
2. **阴性证据归档只有科研侧深度文献**，A/B 平台（如 Statsig/Optimizely）的实验 artifact 官方留存政策未抓到原文，S9 为摘要级引用，若需硬引需补抓。
3. npm 侧「带病修复装船造成二次事故」的具体公开案例未检索到贴合样本，结论 3 的后半段依赖 CI 分层测试理论而非真实事故记录。

## 最终推荐落点（裁决语言）

选 C，但 ADR 主题声明为「绿门装船轮」——红门修复、defer-r85 根因判别（携钥隔离路径复跑为第一判别实验）、NO-GO 限定语、阴性证据最小入库、Status 翻面五项构成发布合法性的原子集，全部进本轮主 ADR；旧 defer 清障按既有惯例走独立 refactor commit。v0.0.9 只在「全绿臂复跑 + 双平台门绿」双条件下切版。
