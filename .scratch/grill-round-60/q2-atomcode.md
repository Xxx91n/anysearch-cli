[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我将按「知识库召回 → 本地仓库现状 → 联网调研 → 综合输出」四阶段执行。先建立任务清单并启动第一阶段。知识库召回完成（历史 batch 索引对 cc-persona 细节覆盖不足，需读本地源）。进入本地盘点阶段：并行读取 domains/ 文件、ADR-0002、Round-60 decision-ledger。任务 #3 的三要素已读完（ADR-0002、D-001、golden 接入点已定位）。标记完成并推进 #4：读 golden-cases.ts 了解 golden 集结构与切片字段。任务 #4 的本地证据已齐（关键发现：domains/ 里其实没有 cc-persona TOML，只有 default/research 两份——问题前提中的“现成域”假设已失效，这将进入对比矩阵修正）。标记 #4 完成，启动 #5 联网调研（三引擎并行，标注角度）。任务 #5 的查询配额已达成（5+ 查询，覆盖 Official/Criticism/Comparative/Currency/Community 五类角度），标记完成并进入 #6：批量深读原文验证。任务 #6 进行中（已抓 2 个域名：bvp.com、sthambh.com）。继续定点深挖：a16z 官方 Big Ideas、YC thesis 分析、a16z thesis 二手源，凑齐 ≥6 次 fetch + 独立域名交叉。任务 #6 已完成 5 个独立域名的全文深读（bvp、sthambh、a16z、preuve、saasmag），补 2 个深读（Harvey 实操案例 + 垂直选择 ICP 方法）凑足配额后进入综合。任务 #6 已达成配额（7 次全文深读、7 个独立域名、三引擎交叉验证），标记完成并进入最终综合输出。# Round-60 Q2 示例垂直域选型 — 深调研报告

**Sufficiency Gate**: searches: 5（Exa 1 + Tavily 1 + AnySearch batch 3）| angles: Official（BVP playbook、a16z Big Ideas、Harvey 一手访谈）+ Comparative（sthambh 决策矩阵、saasmag 横纵对比）+ Criticism（3800 横向 AI 关停、wrapper 批评）+ Currency（2026 年文为主）+ Community（Reddit YC 帖浮现于结果）| full reads: 7 | gaps: 无直接讲"vertical agent CLI 的示例域选法"的行业文献（品类太新，用 wedge-market 框架映射）；CRV 无公开 first-vertical 博客，其标准经由 BVP/YC 信源旁证。

---

## 1) 执行摘要（Tl;dr）

**推荐：候选 2「技术文档检索域」，但按 Harvey 式打法收窄为楔子切片**——不建“泛技术文档域”，而建 `docs` 域、语料锚定在本项目自己依赖的一小撮一手文档（MCP 规范 / TypeScript / pnpm / agentskills 等团队天天在用的 stack），首批 golden 从真实使用中的提问+可验证 URL 收割，不造合成题。**Confidence：高**——本地证据（domains/ 现状）+ 三引擎行业证据（BVP 三入口框架、Harvey 案例、sthambh 评测观）在两个独立方向上收敛；唯一中等置信处是“候选 1 前提不成立”这一本地事实判断（已用 glob 直接证伪，实为高置信）。

**一个必须先纠正的事实前提**：题目称“repo 内已有 domains/ 目录（含 cc-persona）”——**实际不成立**。`domains/` 仅有 `default.toml` 与 `research.toml` 两个文件，无任何 cc-persona 域文件。"cc-persona" 在本仓库的角色是**深合并语义的移植来源**（ADR-0002/0004/0005，`packages/store/src/domain-schema.ts` 注释明写 "transplanted from cc-persona (persona.rs)"），不是现成域。候选 1 的“改造成本最低”理由随之瓦解。

## 2) 分点结论

**结论 1：候选 1（cc-persona）前提被本地证据证伪，降级排除。**
`glob domains/**/*` 只有 2 个 TOML。要把 cc-persona 变成可演示域，需从零写域文件+prompt 包+skill 集，成本与新建域相同；且“persona/配置管理域”是自指涉的 meta 域，演示的是配置机制而非“信息专精检索”的产品价值，对 B2「装到用链路 CI 实测」的叙事贡献最弱。（来源：本地 glob + ADR-0002 全文）

**结论 2：工业界共识 = 首个垂直切入选“三级工作流楔子”+ 内部人优势切片。**
BVP《Building Vertical AI》playbook（2026-01）给出三入口：tertiary workflows（阻力最小、ROI 显性、先赢再扩张——“tertiary entry is a wedge, not a destination”）、adjacent-to-core、core（Toast 式，需奇迹级说服力）；选垂直的标准是“unfair advantage：行业经验/关系/愿花 6 个月深入”（BVP + preuve.ai 四要素框架交叉印证）。**映射到 anysearch**：团队的 insider 域就是 TS monorepo / MCP / agent 工具链本身——即技术文档检索的窄切片。Harvey 的起点（加州房东租客法规——创始人自己被派到的案子）是同构案例。（来源：BVP 全文、preuve.ai 全文、TechCrunch Harvey 访谈全文）

**结论 3：golden 集的正确做法 = Harvey 的 100 题实测法，天然满足 D-001 约束 4。**
Harvey 用 r/legaladvice 真实问题 + 3 位律师盲评（86/100 通过）完成首个域的可行性验证，并明确说"evaluation becomes a pretty strong moat"。sthambh 的四层架构论把“right evaluations = 工作流真实 KPI 而非通用 helpfulness”列为真垂直 agent 的第四属性。**映射**：golden 不写合成题，从团队真实开发提问 + 可回访的一手 URL 收割（这同时服务 B4 badcase 回灌）。（来源：TechCrunch 全文、sthambh 全文；与 preuve.ai "validation step" 四要素一致）

**结论 4：候选 3（代码/仓库知识域）推迟——双原因。**
(a) 对 embedding 臂依赖重，而向量语义臂（ADR-0033）+ Embedding Circuit Breaker 刚落地，正是最需要浸泡期、最不该当标杆域压上去的部件；(b) ADR-0003 已锁定 Active Domain == code 时软依赖 context-mode/codegraph，会把 B1 walking skeleton 的验收面从“五端联动”扩大到“外部工具软依赖”，违背“新代码行 > 治理行”的行数纪律。（来源：本地 ADR-0003/0033；sthambh “integration layer 占 60-70% 工程量”旁证 integration 越重越难做演示）

**结论 5：候选 4（自选新域）作为 B2 之后的扩展轨保留，不做 B1。**
B1 的目的是 walking skeleton + 装到用闭环，不是押注用户市场。preuve.ai 四要素（量化痛点/垂直为何赢/dated 信号/验证步骤）适用于选**用户市场**域，不适用于选**演示域**；混用会让 B1 提前背上 PMF 验证负担。B2 实测通过后，候选 4 按同一 harness 模板接入，成本已被 skeleton 摊薄。

**结论 6：与 D-001 / 既有 ADR 无冲突，无需 revised 决策——但有一处显式澄清。**
D-001 只定主题 B 与任务集，未命名示例域，Q2 正是它悬置的子决策；ADR-0002 定的是机制（TOML 五端联动）而非域内容，域无关；ADR-0003/0033 恰是**回避**候选 3 的依据而非冲突。**显式澄清（非改向）**：D-001 证据链引用的“repo 内已有 cc-persona 域”描述与实际不符，建议在 B1 票的 spec 里把该句修正为“cc-persona 为深合并语义来源（ADR-0002），示例域为新建 docs 域”，避免后续轮次继承失实前提。

## 3) 对比矩阵

| 项 | 改造成本（域文件+prompt+skill+golden） | 五端联动演示完整度 | 暴露真实缺口的价值 | 主要风险 | 行业框架对应 |
|---|---|---|---|---|---|
| 1. cc-persona | **中**（前提失实：无现成文件，需从零写；但语义机制已被域间互测覆盖） | 中（sources 层无真实信息源可接，rag/hooks 演示空转） | 低——自指涉，不压测真实检索路径 | 演示“配置自管理”，外部观众无感 | 违背 BVP wedge（无外部 ROI 叙事） |
| 2. 技术文档检索（窄切片） | **中**（1 个 TOML + prompts + golden looks；sources 层复用 exa/tavily/anysearch 零新适配） | **高**——五端全部有真实负载 | **高**——直接压测 Routing Card/两段召回/归因层/信任边界 against 真实 web 语料 | 语料漂移（changelog 类）需 freshness 因子参与 | BVP tertiary wedge + Harvey insider 切片 ✅ |
| 3. 代码/仓库知识域 | 高（域文件 + codegraph 软依赖接线 + embedding 管线联调） | 中高（rag adapter 终于有真实用例） | 高但时机错——circuit breaker 刚建，无浸泡期 | 双重依赖放大 B1 爆炸半径；ADR-0003 软依赖面 | BVP core-workflow 入口（需奇迹级，不宜首个） |
| 4. 自选新域 | 中高（真实需求梳理 + 全新语料 + golden 从零） | 高 | 最高但不可预算（缺口暴露程度=需求清晰度，当前无输入） | B1 背负 PMF 验证，回合目标失焦 | preuve 四要素适用但前置条件未满足 |

## 4) 推荐：`docs` 域（技术文档检索，窄切片起步）

**理由（三线收敛）**：
1. **行业框架**：BVP tertiary-wedge——“从阻力最小、ROI 显性、你能 dominate 的切片切入，再用 magic moment 换扩张权”。anysearch 的 magic moment = “对一个窄语料给出带归因、带新鲜度、能弃答的检索答案”，docs 域是唯一能让五个联动端全部承重的最小语料。
2. **Harvey 先例**：首个域 = 创始人自己的 insider 切片 + 真实问题盲评，而非最容易的域。anysearch 团队就是 docs 域的第一用户（B2 装到用 CI 实测本身就是 dogfooding）。
3. **治理约束兼容**：golden 从真实提问+一手 URL 收割（非合成题，满足 D-001 约束 4）；不引入 embedding 重依赖与 ADR-0003 软依赖（行数纪律可守）；macOS 单平台限制照旧列 documented limitation。

**域文件要点**（非本轮产出物，仅约束框定）：`domains/docs.toml` 六段全填——sources 启用三引擎（文档检索正是多臂 RRF 的主场）、rag adapter 可先 `none`（B1 不扩行数）、hooks 白名单最小化、prompts 包含弃答与归因指令（衔接 ADR-0053/0054 观测层）。

## 5) golden 首批 10–20 条的切片维度

落在 `eval-looks.json`（schema `anysearch/eval-looks@2`，当前 `looks: []` 空置——正是为本轮预留的接入点；**不复用** `golden-cases.ts`，那是记忆生命周期 harness，CaseOp 全是 adjudicate/store/retrieve 内存操作，域内容检索需要 looks 形态）。首批 ≤20 条按 8 维切：

| # | 维度 | 切片内容 | 条数 |
|---|---|---|---|
| 1 | 查询意图 | 概念定义 / how-to / API 签名 / troubleshooting-报错 / 版本-changelog / 二选一比较 | ≥5 类各 1-2 条 |
| 2 | 信源层级 | 官方规范 RFC / 官方文档 / GitHub issue / release note / 第三方博客（信任边界分层） | 3-4 |
| 3 | 新鲜度 | 稳定语料（规范）vs 漂移语料（changelog，答案被新版 supersede 的负例） | 2-3 |
| 4 | 语言 | EN 语料 + zh 查询（Routing Card 语言路由） | 2 |
| 5 | 归因 | 答案必须引用到正确 URL+章节（ADR-0034 claim 级归因） | 3-4 |
| 6 | 多跳 | 需跨 2 页合成（规范页 + changelog 页） | 1-2 |
| 7 | 负例 | unanswerable（语料不覆盖，期望弃答）/ 弃答族观测（adr-0054 abstain，只记录不翻 pass/fail） | 2-3 |
| 8 | 注入 | 文档页含 prompt-injection payload（继承既有 inject 五族机制，复用 `injectFingerprint`） | 1-2 |

每条 look 最小字段：`id / query / corpusUrl[] / expectEvidence{url, section} / freshnessClass / authorityTier / negative?`。 harvesting 规则：只收团队真实会话里出现过的提问（B4 badcase 回灌为持续来源），URL 逐一回访核验存在性与章节锚点。

## 6) 验收判据草案（B1+B2）

- **A1 walking skeleton**：`ans domain use docs` 一条命令后，doctor 输出五端联动状态（sources/prompts/skills/hooks/rag 各一行），漂移检测对 `domains/docs.toml` 生效（ADR-0002 契约可观测）。
- **A2 装到用 CI 实测**：pack → 干净环境安装 → doctor → 对 golden looks 中标记 `deterministic` 的条目（冻结 fixture）离线跑通；标记 `live` 的条目在 CI 联网 job 跑，通过率阈值首轮只记录不设门（延续校准生命周期 ADR-0048/0049 的“先观测后设阈”惯例）。
- **A3 归因硬断言**：维度 5 的每条 look，答案引用 URL 必须命中 `expectEvidence.url`，错引即 fail（这是 docs 域区别于通用搜索的核心卖点）。
- **A4 弃答与注入**：负例 looks 弃答动作落入 ObservationalZone；inject look 指纹不变（复用 `assertInjectSuite` 机制）。
- **A5 诚实性**：macOS 单平台限制写入 documented limitation；golden 来源全部标注真实出处（问题来源+URL 核验日期），无一条合成。
- **A6 行数纪律**：新代码行 > 治理行，域文件+looks 计为正文行。

## 7) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Building Vertical AI: An early stage playbook | bvp.com/atlas/building-vertical-ai-an-early-stage-playbook-for-founders | Official (BVP) | 2026-01-06 | 三入口楔子框架、unfair advantage 标准、wedge-not-destination |
| Inside Harvey（Winston Weinberg 访谈） | techcrunch.com/2025/11/14/inside-harvey-... | Official（一手访谈） | 2025-11-14 | 100 题盲评法、insider 切片（房东租客）、"evaluation is a moat" |
| Vertical AI Agents 2026: Why Generic Agents Fail | sthambh.com/blog/vertical-ai-agents-enterprise-guide | Comparative/Criticism | 2026-07-16 | 四层架构、"right evaluations = 工作流 KPI"、四属性判真垂直 |
| Vertical AI Startup Ideas 2026 | preuve.ai/blog/vertical-ai-startup-ideas-2026 | Currency | 2026-06-20 | 四要素框架、3800 横向 AI 关停数据、YC 10x 论点 |
| Vertical AI Agents Are Eating Horizontal SaaS | saasmag.com/vertical-ai-agents-eating-horizontal-saas | Comparative | 2026-06-24 | McKinsey 2.3x ROI、71% vs 32% 六月存活率（第二信源交叉） |
| a16z Big Ideas 2026: Part 1 | a16z.com/newsletter/big-ideas-2026-part-1/ | Official (a16z) | 2025-12-09 | "vertical AI from IR+reasoning to multiplayer"、数据熵论点 |
| Vertical SaaS ICP Strategy | gasimo.org/vertical-saas-icp-strategy-... | Community/实操 | 2026-09-06 | 小步测试选段、碎片化工具/付费意愿/运营痛点三信号 |

**三引擎交叉验证情况**：vertical-wins 命题 = Exa+Tavily+AnySearch 三引擎均有支持；wedge-first 窄切片 = BVP（Exa 读全文）+ Harvey（Exa 读全文）+ gasimo（Exa 读全文）三源一致；真实验证非合成 = Harvey + preuve 双源。

## 8) 信息缺口

1. 无任何行业文献直接讨论"vertical agent CLI 的**示例/演示域**”该怎么选——品类本身太新，本报告用 wedge-market 框架做的映射是类比推理而非直接证据；
2. CRV 无公开的 first-vertical 选择标准文章（搜索未见），其标准以 YC/BVP/presuve 旁证；
3. Harvey "86/100" 数据仅出自创始人自述（TechCrunch 访谈），无独立复核；
4. `eval-looks@2` schema 的 look 字段约定是我基于 harness 现状的设计草案，B1 spec 需按 `eval-looks.json` 实际消费方（`apps/plugin/test/golden.test.ts`）核对字段兼容性——本轮只读模式未深入该消费端代码。任务清单已全部完成，最终报告已在上一轮完整输出（推荐 `docs` 窄切片域 + 八维 golden 切片 + A1–A6 验收判据草案），无待办遗留。

继续此会话，运行：atomcode -p "…" --resume 82e6d9a0-f683-4a9e-90bf-d3655eaec09d
