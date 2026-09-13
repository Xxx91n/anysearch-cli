[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我将按“知识库召回 → 本地账本/惯例回顾 → 三引擎联网调研 → 综合”四步执行这次 Round-60 Q3 调研。

**第一步：先证伪知识库 + 定位本地账本文件**知识库召回命中：上一轮 macro-audit 调研已索引过 walking skeleton → vertical slice 的业界材料（O'Reilly/Monson-Haefel、Matt Blodgett、aihero.dev "outrunning your headlights"），可复用。现在并行推进：本地账本/CONTEXT 核对 + 三引擎联网调研。知识库已召回关键材料（mattblodgett/aihero 全文此前已抓取）。现在并行：定位 Round-60 账本文件 + 抓取核心信源原文验证。第二阶段：读 Round-60 账本与 Round-59 票序惯例 + 继续抓取核心信源原文（累计 fetch 2/6，还差 4+）。配额补足阶段：补批评/时效角度搜索 + 抓取剩余原文 + 本地核对 golden 消费端 schema。补足最后两条全文核验（累计 fetch 将达 6），随后综合输出。**Sufficiency Gate**：searches: 6（Exa 2 + Tavily 2 + AnySearch 2）| angles: Official / Comparative / Criticism / Currency / Community（5/5）| full reads: 6（mergify、cartographer、valery.tech、mattpocock/skills、scottlogic、ctx_search 召回的上轮已抓全文 mattblodgett/aihero/oreilly）| gaps：martinfowler WalkingSkeleton bliki 404、devops.stackexchange 403（已换 valery/cartographer 同论点替代）；另 tricentis/geeksforgeeks/arxiv/atlassian 为搜索结果原文级引文支撑，关键结论均有 ≥2 独立信源。

---

# Round-60 Q3 分票结构与票序 · 深调研报告

## 1) 执行摘要（Tl;dr）

**推荐候选 1 的串行骨架，但票序按“可演示里程碑”重排为 B1 → B2 → B4 → B3，C1/G1 治理验证小票挂尾（本报告的第四种结构 = 候选 1 + 里程碑切票法）**。理由：walking skeleton 教义是骨架落地后逐层“竖切增肌、每步可演示”，与 trunk-based 小步交付的合并成本曲线（分支存活期与集成成本超线性增长）共同否决并行两流与单一大票（**Confidence：高**——工业界三路独立信源一致，且无账本冲突，无需 revised）。

## 2) 对比矩阵（三候选 + 推荐结构）

| 结构 | 骨架先行 | 每票独立验收 | 合并/集成风险 | 行数纪律可测性 | 账本符合度 |
|---|---|---|---|---|---|
| 候选1 串行小三票 B1→B2→B3 | ✅ | ✅ | 低（单线） | ✅ 逐票可测 | ✅ 但 B3 先于 B4 略失序 |
| 候选2 并行两流 | ⚠️ B3 无 B1/B2 证据即启动 | ⚠️ 流2 混治理与正文 | 高（本仓单代理，假并行=纯分支成本） | ❌ 两流 diff 交叠 | ❌ D-001(3) 治理票独立性被稀释 |
| 候选3 单一大票 | ⚠️ | ❌ 一次验收 | 极高（big-bang） | ❌ 无法逐票测 | ❌ 违 Round-59 D-004 判据② |
| **推荐：串行里程碑 B1→B2→B4→B3 + C1/G1 挂尾** | ✅ | ✅ | 最低 | ✅ | ✅ 全约束兼容 |

## 3) 分点结论（每条标来源）

**① walking skeleton 之后 = 逐条竖切增肌，每步可演示，而非横向铺层。** valery.tech 把 lifecycle 显式分层：Walking Skeleton（验证结构）→ Thin Vertical Slice（增量交付）→ Pilot/Beta（真实条件验证），并强调 "All walking skeletons are thin vertical slices; the walking skeleton may be MVP-0"；cartographer 的 milestone 切法：首里程碑 = 触达全旅程的最薄切片，之后每个里程碑都是“整条体验的下一个最有价值版本”，**"After every milestone, you have something that works"**——这正是“按可演示里程碑分票”的判据。上轮 macro-audit 调研已核验的 O'Reilly（Monson-Haefel："bulk it up with end-to-end functionality, keep the system running"）与 Matt Blodgett（user story 级竖切加肉）同向；aihero.dev 点名反面模式 "outrunning your headlights"（各层横铺完才首次串接，假设全在黑暗中验证）。

**② 并行流的隐含前提在本仓不成立，且票间依赖使“并行”名不副实。** mergify 的成本曲线：分支存活期与集成成本**超线性**增长（两周 ≈ 语义冲突大概率、一月 ≈ merge week），解法是拆小 PR 串行落地而非长分支并行。mattpocock/skills 对“并行任务是否要按文件分区”的回答： Mostly no，唯一硬纪律是 **"do large refactors first"**——大改动晚落地在十支分叉之后是最贵的情形。映射到 Round-60：B4（badcase 回灌）吃 B2（真实装+实跑）的产出，B3（doctor 增强）吃 B1/B2 实测暴露的缺口，G1（remove-or-implement）需要真实使用证据——“流2”的头两张票实质依赖“流1”，并行只是把串行依赖伪装成分支，徒增合并成本。

**③ 单一大票 = big-bang 反模式，直接违反本仓已机制化的验收纪律。** Tricentis/GeeksforGeeks 一致：非增量集成使缺陷定位困难、反馈后置；arXiv 2507.17270 边缘计算项目一年期 big-bang 集成的经验教训报告为实证。账本侧：Round-59 D-004 已把“票序显式且逐票独立验收”写成豁免五判据之一，单一大票自我瓦解该机制；CONTEXT.md Scope Discipline（ADR-0029 D6）反对的 while-you're-at-it 恰是大票的必然产物。

**④ 治理票挂尾有账本内先例与依据。** D-001(3) 已定：治理项走独立小票、diff 行数不计入正文行数对比；Round-59 的 T-1..T-4 惯例证明“串行票 + 逐票验收”在本仓可运转。C1（release-lines 对真实产物实跑）按 D-001 是任务集成员而非治理项，但它产出的是验证脚本而非新功能——行数归类需在 B1 spec 显式声明（见风险点 R4）。

**⑤ 与账本冲突声明：无 revised 级冲突。** 推荐结构与 D-001/D-002 全部六条约束兼容；对候选 1 字面票序的唯一偏离（B4 提到 B3 之前）属 D-001 未固定的轮内排序细化，依据是 D-001(2) “A 仅作 B 的薄探针（真实 badcase 回灌）” 与 D-002(3) “候选 4 作为 B2 之后扩展轨”共同指向的依赖方向：badcase 回灌需要真实装到用链路先产生 badcase。

## 4) 推荐票序结构（含验收判据草案、票间依赖、豁免声明）

```
M1 ●── B1 示例域 walking skeleton（含 C 最小切片）
      │
M2 ●── B2 装到用链路 CI 实测            ← 依赖 B1（eval-looks.json + 域定义）
      │
M3 ●── B4 badcase 回灌（A 薄探针）      ← 依赖 B2（真实链路产 badcase）
      │
M4 ●── B3 doctor 自服务增强            ← 依赖 B1/B2 实测缺口清单
      │
尾  ●── C1 release-lines 对真实产物实跑 ← 依赖 B1/B2 产出的真实 pack
    ●── G1 graceWindow/deepMode 裁决小票（治理，waiver 豁免）← 依赖 B1-B4 使用证据
```

| 票 | 可演示里程碑（做完后“系统在走”） | 验收判据草案 | 依赖 |
|---|---|---|---|
| **B1** | docs 域检索端到端走通：toml 域定义 + golden 首批 10-20 条八维切片落 `eval-looks.json`（`anysearch/eval-looks@2`），pack→干净环境装→doctor→search 实跑一遍 | A1 五端联动可见；C 最小切片实测通过（D-001(1)，B 非裸 B）；spec 显式修正 cc-persona 失实前提（D-002(2)）；golden 全为真实提问 + 可回访一手 URL（D-002(1)）；核对 `apps/plugin/test/golden.test.ts` schema 兼容性 | — |
| **B2** | 真实安装产物在 CI 里从“装”走到“用” | A2 pack 真实装 + 离线 golden CI 绿；A3 归因 URL 硬断言；A4 弃答 + 注入复用既有机制；禁用根目录 3 个过期 0.0.0 tgz | B1 |
| **B4** | 真实 badcase 进入 golden 并被回归捕获 | 回灌循环可复现：badcase → eval-looks.json 条目 → 回归测试捕获；A 探针仅薄（D-001(2)）；禁合成 Golden（D-001(4)） | B2 |
| **B3** | 用户可自服务诊断 | doctor 增强覆盖 B1/B2 实测暴露的具体缺口（逐条列出）；A5 诚实性：macOS 列 documented limitation（D-001(5)） | B1、B2 |
| **C1** | release-lines 对真实产物实跑通过 | 实跑对象 = B2 产出的真实 pack 产物，非 mock/旧 tgz | B2 |
| **G1** | graceWindow/deepMode 存废裁决落地 | remove-or-implement 二选一并实施；裁决依据引用 B1-B4 的使用证据；**waiver 豁免声明**见下 | B1-B4 |

**治理票（G1）行数豁免声明（写入 Round-60 ADR，非静默沿用）**：依 D-001(3)，G1 的 diff 行数不计入“新代码行 > 治理行”对比；豁免按 Round-59 D-004 五判据机制化——①单一伞形主题（graceWindow/deepMode 收尾）②票序显式、逐票独立验收 ③waiver 写入当轮 ADR 并声明 **sunset：Round-61 不得自动沿用** ④本轮豁免仅此一票（两次以内）⑤独立复核签字（atomcode 审计角色承袭）。C1 不申报豁免——若 B1 spec 将其验证脚本计为治理行，须在 spec 显式归类而非轮末补认。

## 5) 风险点

- **R1 离线 CI × 归因 URL 硬断言的内在张力**：A2 要求离线 golden CI，A3 要求归因 URL 硬断言（需网络/真源）。缓解：B1 spec 预先裁定分层——URL 断言走 online/本地真源校验，离线 CI 用快照 fixture + URL 记录不设阈（D-002(4) live golden 首轮只记录）。
- **R2 G1 证据不足导致裁决过早**：若 B1-B4 产生的使用证据单薄，remove-or-implement 可能拍脑袋。缓解：G1 判据允许合法结局含 “documented deferral + 下轮复核条件”，禁止为闭环而闭环。
- **R3 golden.test.ts schema 兼容性**：`eval-looks.json`@2 与现有消费端是两套体系（D-002 明确不复用 golden-cases.ts），但背景指出消费端存在——B1 spec 必须核对二者是否互不污染，否则 ship-gate 覆盖断言会失真（Round-57 曾因覆盖断言失实出过 N-3 更正）。
- **R4 行数测量的归类模糊**：C1 与 B4 的“回灌脚本”是测试/脚本行，本轮行数纪律以什么算“正文行”未在 D-001 定义——B1 spec 中显式给出定义（建议：域代码 + golden 数据计正文；CI 脚本与 doctor 诊断逻辑按其所属票计），避免轮末对账争议。
- **R5 macOS 单平台**：pack 真实装只能覆盖本机平台，documented limitation 如实落 ADR（D-001(5) 已定，此处仅提醒写入位置）。

## 6) 完整来源清单

| 来源 | URL | 角度 | 贡献 |
|---|---|---|---|
| Valery.tech Engineering Techniques | valery.tech/engineering/architecture/techniques/ | Official（已全文） | lifecycle 分层：skeleton→vertical slice→beta；MVP-0 论 |
| Cartographer Milestones | cartographer.studio/product/milestones | Official（已全文） | 可演示里程碑切法：每里程碑 = 整体验的下一版本 |
| Mergify TBD vs Feature Branch | mergify.com/learn/trunk-based-development/vs-feature-branch | Comparative（已全文） | 分支存活期×集成成本超线性曲线；拆小 PR 串行 |
| mattpocock/skills resolving-merge-conflicts | github.com/mattpocock/skills/.../resolving-merge-conflicts.md | Community/Official（已全文） | 并行分区 mostly no；大 refactor 先行的唯一硬纪律 |
| Scott Logic: 3 Types of MVPs | blog.scottlogic.com/2018/06/26/... | Official（已全文） | Vertical Slice MVP 实战案例（FX 交易 POC） |
| 上轮会话已抓全文（ctx_search 召回） | mattblodgett.com / aihero.dev / oreilly.com | Official/Criticism | 竖切加肉、outrunning-your-headlights 反模式 |
| Tricentis big-bang testing | tricentis.com/learn/big-bang-testing | Criticism | big-bang 缺陷定位难、反馈后置 |
| GeeksforGeeks big-bang integration | geeksforgeeks.org/software-testing/big-bang-integration-testing | Criticism | 同上，对比表 |
| arXiv 2507.17270 | arxiv.org/abs/2507.17270 | Official（论文） | 一年期 big-bang 集成失败经验报告 |
| Atlassian TBD | atlassian.com/continuous-delivery/.../trunk-based-development | Official | feature flags 补充 TBD；小批量纪律 |
| ScaledByDesign TBD 2026 | scaledbydesign.com/blog/trunk-based-development-actually-works | Currency (2026-02) | 47 长分支团队改造前后量化数据 |
| AnySearch MVP/vertical-slice 聚合 | agensi.io、devops.SE、unity 讨论等 | Community | walking skeleton ≠ MVP 的社区共识佐证（devops.SE 403 未全文，仅佐证级） |

## 7) 信息缺口

- 本仓实际是单人+代理协作还是多人协作未在账本中显式记录——若未来有 ≥2 并行执行者，候选 2 的部分前提可重新评估（mattpocock 指出代理并行分区的成本已比人类团队低）。
- `eval-looks.json` 的 schema（`anysearch/eval-looks@2`）具体字段未读到定义文件，R1 的分层裁定需在 B1 spec 时落到该 schema 上。

继续此会话，运行：atomcode -p "…" --resume e24a62df-b799-48fd-983c-5c4643e70d72
