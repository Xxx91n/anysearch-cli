# R81 Q2 — 主轴择货 atomcode 调研存档

Question 原文：.scratch/grill-round-81/q2-prompt.txt
Date: 2026-09-24 · atomcode（Exa+AnySearch；Tavily 配额耗尽降级双引擎）

**Sufficiency Gate**: searches: 6 (web_search×2 + anysearch×3 + tavily×1) | angles: Official/Criticism/Comparative/Community | full reads: 6 (mountaingoatsoftware / agileambition / aqua-cloud / visual-paradigm / theuncertaintyproject / jamesshore) | gaps: Tavily 配额耗尽（触发器门控独立交叉用社区多源替代）；WSJF 原文 404 以摘要+二手转述双源支撑。

## 1) 执行摘要 (Tl;dr)

**推荐 R81 主轴 = A (defer-r71-provider-serverside)，Confidence：高。** 依据是三组成熟模型的一致结论：(1) XP/Scrum/Hubbard 均确认「高风险诊断（spike）在 excess uncertainty 下是合法且优先级最高的进货」——它产出的是 decision-grade 知识，不是次要品；(2) A 是唯一具备**双分支合同出口**（复活→去种子化、仍死→诊断书+路线裁决）的候选，无论结果如何都终结一条挂着 5 轮、deadline 全场最近的债；(3) B 是 trigger-gated 且触发器状态未知——业界标准做法是**不把触发器未验的债立为主轴**，因为「探完未响=轮空」正是外部评审刚点名的自催化失败模式换了个马甲。

## 2) 分点结论 (1) — spike/诊断 vs 上游耦合 vs 验证扩张 vs 测试卫生

排序：**A(诊断) > C(验证扩张) > B(触发器待验) > D(测试卫生)**。

- **XP 原典定位**：Don Wells 的 extremeprogramming.org 明确 spike 的目标是 "reducing the risk of a technical problem"（Official）。James Shore：XP 信条 "concrete data over speculation"，spike 产出可以是 "a decision, a prototype... documentation"。
- **知识型产出是合法 DoD**：Mountain Goat（Mike Cohn）：spike "not trying to immediately deliver a new capability; instead building the knowledge that will allow them to deliver the new capability later"，验收物="decision-grade evidence... not shippable code"。**诊断只产知识不产码，在成熟心智模型里算进货，但有严格条件——必须针对 "excess uncertainty"（超额不确定性）且有时限与明确可验收交付物。** Cohn 警告滥用 spike 会 "extend time to value"。
- **关键条件符合性检查**：A 完全符合 excess uncertainty 标准——「产品一直在发布本地种子记忆而非真检索」正是 "technical approach feasibility" 级别的极高风险。aqua-cloud（Mar 2026）："spikes exist to produce decision-grade evidence like recommendations and baseline metrics"，2-3 天是 spike 实际上限，超时即转为 implementation task。
- **反模式风险**：agileambition《Spike Antipatterns》列整轮被 spike 吞掉的失败形态（"Never-Ending Spike"），引 Mitch Lacey 规则——**spike 产出的后续工作必须留给下一个 sprint，不能在同一轮内消化**。
- **WSJF/成本延迟视角**：SAFe 定义 WSJF = (User-Business Value + Time Criticality + Risk Reduction/opportunity enablement) / Job Size。**Risk Reduction 是分子项**——风险削减工作不是零分子。A 的 time criticality 极高（deadline 全场最近+挂 5 轮）且 job size 小→WSJF 天然最高；B 分子被触发器不确定性折扣；D 双项皆无且属评审点名的「非产品货」类。

## 2) 分点结论 (2) — trigger-gated debt 模式 + 外部不可控依赖

- 业界共识：**先验触发器是低价值前置**，正确做法是把触发器探查合并进工作本身或干脆选无条件工作。对外部依赖的成熟处理是**不立主轴，只立探测任务**，主轴必须是无条件的、无论触发器是否响应都有产出的工作（planview 依赖管理惯例）。这正是选 A 不选 B 的第二个理由。
- 知识库召回本仓 R22 裁定先例：「永假死锁」判定框架——B 的触发器（上游 API 稳定化 / bridge 延迟证明）都是外部条件，探完未响概率不可忽略，与 R22 已否决结构同型。
- **Q3 外部不可控依赖=升值（求真）非贬值**。Hubbard VoI 框架："When you know almost nothing, almost anything will tell you something." 当前对 R71 病因认知=HTTP 000+零调查+零假设，处于信息极低点，任何诊断 VoI 都在曲线最陡段。域名 ownership 未确认**改变的是修复路径可达性，不是病因认知可达性**。
- 出口谱系应扩成**三分支**：复活→去种子化；死但可修→修复路线；**死且外部不可控→如实降级宣称/换 provider**。每个分支都终结一条债或修正一个宣称，无空轮。把「域名确认」前置为门槛才是贬值动作——把 VoI 极高的诊断锁死在 legal/ops 外部等待后。

## 3) 对比矩阵

| 项 | 产出性质 | 断粮修复力 | 轮空风险 | 外部依赖 | 裁决 |
|---|---|---|---|---|---|
| A provider-serverside | 诊断书+三分支路线裁决（决策级知识，可含修复码） | 高——直击「产品真伪未知」 | 零——三分支合同保证闭合 | 域名 ownership（隔离为独立债不阻塞） | ✅ 推荐主轴 |
| B dsh-native-tools | 触发器探查→可能继续挂债 | 低 | 高——探完未响=纯知识无产出 | 上游 API 稳定性+bridge 延迟证据双未验 | ❌ 续挂 |
| C dsh-web-interactive-matrix | 验证面扩张（测试报告） | 中 | 低 | 无 | ⭕ 备选/可作 A 的并行腿 |
| D quarantine-ids | 测试卫生 | 低 | 中——flaky 复现不稳 | 环境依赖 | ❌ 不作主轴 |

## 4) 推荐排序与理由

**A > C > B > D；R81 唯一主轴 = A。**

- A 的三个不成立判断均被推翻：(a)「诊断不产码不算进货」——decision-grade 知识是合法 spike DoD；(b)「外部不可控所以贬值」——VoI 框架证明低信息态诊断在价值曲线最陡段，且出口谱系已预设「死且外部不可控→如实降级宣称」分支使诊断无条件有产出；(c)「时间成本高」——2-3 天 timebox 内可完成，deadline 全场最近强化 WSJF time criticality 分子。
- **执行建议**：A 按 spike 纪律执行——硬 timebox（建议 2-3 天），DoD=「诊断书+三分支裁决+若复活则 live 验证与去种子化立项至 R82」，避免 Lacey 反模式（spike 产出工作不留本轮）。C 可作 A 的低风险并行腿（若轮内有余力）但不可喧宾夺主。B 续挂并显式记录触发器探查任务（不作主轴）。D 维持挂起。

## 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Create a Spike Solution | http://www.extremeprogramming.org/rules/spike.html | Official | — | XP 原典定义，risk reduction 是 spike 存在理由 |
| The Art of Agile Development: Spike Solutions | https://www.jamesshore.com/v2/books/aoad1/spike_solutions | Official | 2010-06-03 | "concrete data over speculation"，spike 交付物=决策/文档 |
| Agile Spikes Deliver Knowledge | https://www.mountaingoatsoftware.com/agile/what-are-agile-spikes | Official | 2024-08-06 | excess uncertainty 判据、滥用代价、合法知识型 DoD |
| Spike Antipatterns | https://www.agileambition.com/Essays/Spike-Antipatterns | Criticism | 2025-10-20 | 6 类反模式、Lacey 规则（spike 产出工作下轮做） |
| Agile Testing Spike Guide | https://aqua-cloud.io/agile-testing-spike/ | Currency | 2026-03-03 | 2-3 天 timebox 共识、decision-grade evidence 定义 |
| What is Spike in Scrum | https://www.visual-paradigm.com/scrum/what-is-scrum-spike/ | Official | — | spike 验收三准则（estimable/demonstrable/acceptable） |
| Understanding the Value of Information | https://www.theuncertaintyproject.org/threads/understanding-the-value-of-information | Comparative | 2024-07-16 | Hubbard VoI 框架，「低信息态任何调查都升值」 |
| WSJF - Scaled Agile Framework | https://scaledagileframework.com/weighted-shortest-job-first/ | Official | — | Risk Reduction 是分子项（摘要级，原文 404） |
| Planning with WSJF & Story Points | https://w.richardpringle.com/story-points-wsjf/ | Community | — | (V+P)/(E+R) 二手转述，双源支撑 WSJF 结论 |
| Agile Best Practice for External Blocking Issue | https://pm.stackexchange.com/questions/15369 | Community | 2015-07-02 | 外部阻塞依赖的社区处理惯例（403，摘要级） |
| Agile Dependency Management | https://www.planview.com/resources/guide/what-is-agile-program-management/agile-teams-dependency-management-visualization/ | Community | — | 依赖可视化/不立主轴只立探测任务惯例 |

## 信息缺口

- WSJF 官方原文页 404，Risk Reduction 分子项结论依赖 framework.scaledagile.com 摘要+Pringle 二手转述双源，非一手原文。
- Tavily 配额耗尽，第三引擎对 trigger-gated debt 惯例的独立交叉未完成（已用 planview/stackexchange 社区源替代）。
- B 的触发器原文措辞（"上游工具注册 API 稳定化"具体判据）未核验——若实为可自验（如 npm 版本比对），B 的轮空风险评估需下调。
