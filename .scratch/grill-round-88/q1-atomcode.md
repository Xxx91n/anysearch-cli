# R88 Q1 atomcode 调研归档

> 来源：atomcode -p（q1-prompt.txt）；串行单跑；已索引 ctx。

# R88 Q1 裁决调研报告：下一轮主轴推荐
# R88 Q1 裁决调研报告：下一轮主轴推荐

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐 A【搜索面卫生轮】，Confidence 高**。工业界有明确的 **post-release grooming/cooldown 惯例**（Atomic Object）+ **Fowler 债务四象限的「分诊-偿还」纪律** + **触发式战略复盘模型**（Benny：复盘由信号触发而非日历）三者共同支持：发布刚收口、重开条件未达、无新证据时，正解是**批次化清债**而非空议方向。B 的最强反对论据（漂移风险）已被「具名触发条件」机制本身对冲；C 的逐票全分诊违反 ADR-0029 单主题纪律，且证据支持「按利息/瓶颈优先级清偿」而非「全量盘点」。

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 4) 对 A 的辩证检验（含最强反对论据）
## 4) 对 A 的辩证检验（含最强反对论据）

**反对 A 的最强论据**：「refactor 轮是低价值自嗨，发布后第一个产品轮应该做用户可见的事；且 F-6 只是一个 89 行脚本的 `??/||` 一致化+三张小票，撑不起一个『主轴』，有打發轮嫌疑。」这个论据的工业版本是 Fowler 的警告：**「prudent debt 可能不值得偿还，如果利息足够小」**（原文：rarely touched part of the code-base 的债不必急还）。

**反驳**：(a) 利息不在行数而在位置——a03/a06/F-6 全落在 `cli/search.ts`/`mcp` 工具面，即本仓库**核心交付面**（用户每次查询都过），Back Market 文的「利息=velocity/incident 信号」判据恰好命中；(b) 反发布轮混排正是 D-001 自己立的规矩——发布后首轮做工程面收束，比反着来（卫生轮里塞产品动作）更符合「两道门分离」的既有心智模型；(c) 若担心体量不足，可在轮内按 ADR-0029 让 CHANGELOG Removed/Refactored 条目+审计三联（found/fixed/deferred）自然吃满，无需扩范围。

**残余风险（诚实声明）**：若 F-6 施工中触碰 sanitize/guard 语义导致与 a06 三处近重复的归并方案冲突，轮体量会膨胀——建议 A 轮 ADR 里**预注册** a06 的归并边界（统一到哪一层）作为验收判据之一，防止施工中临时改判。

## 推荐

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐 A【搜索面卫生轮】，Confidence 高**。工业界有明确的 **post-release grooming/cooldown 惯例**（Atomic Object）+ **Fowler 债务四象限的「分诊-偿还」纪律** + **触发式战略复盘模型**（Benny：复盘由信号触发而非日历）三者共同支持：发布刚收口、重开条件未达、无新证据时，正解是**批次化清债**而非空议方向。B 的最强反对论据（漂移风险）已被「具名触发条件」机制本身对冲；C 的逐票全分诊违反 ADR-0029 单主题纪律，且证据支持「按利息/瓶颈优先级清偿」而非「全量盘点」。

## F-6 refactor

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 2) 分点结论
## 2) 分点结论

**① 发布后首轮 = 卫生轮是成熟惯例（支持 A 的核心依据）**
Atomic Object《Grooming Your Project After a Release》明确：「发布收口后正是清理风险更高技术债的时机——发布前不敢动的耦合/黑客代码，现在可以安全清理」，配套动作是回归测试确认基线。这精确映射 R88：R87 刚完成 tag/deprecate/OIDC 收口，且 R86 钉版后 5 包不动（D-001），F-6+三票全部是「发布时被搁置的 desirable changes」。同一结论在 Back Market 的 SRE 实践文中以 SLO/错误预算语言重述：**债不按日历清，按「利息是否在烧」清**——r83 三票漂 5 轮且同落 search/tooling 热点面，正是当前最高利息区。
来源：spin.atomicobject.com（已读全文）、engineering.backmarket.com（已读全文）。

**② 分诊优先于全量盘点：C 方案被证据否决（部分否定 C 的「债龄结构值得检视」直觉）**
Fowler 四象限（已读原文）：正确的动作是**分类后按偿还价值排序**，不是「把 17 张票逐张过一遍」。aalonso.dev（2026-05，已读全文）更直接：把 backlog 里每张票贴 `tech-debt` 标签的前提是**有偿还计划**；没有计划的任务不是债，是「未分析的 drag」——对应你账本里的 8 项常驻背景债（domain-ownership、f16 watch 等），它们的正确动作是**维持挂账+触发条件**，不是一轮里重新分诊。C 会把 17 项拉进一个主题，既违 ADR-0029（Scope discipline 明文「一轮一主题」），又制造 aalonso 所说的「bottomless backlog 复盘剧场」。

**③ 战略复盘由信号触发，不由日历触发：B 被双源否决**
benny.ghost.io（已读全文）：「该问的不是多久复盘一次，而是什么触发复盘——设定触发器强制即时复盘，其余时间是 planning theater」；delightpath 产品复盘案例同样强调「launch failure 是信号不是症状，但**信号来了才动**」。R86 预注册实验判负（P=0.0378）**就是那次信号**，且已消费完毕——R86 当轮已裁决 NO-GO。此刻重议没有新信号：0.1.0 上架不足一轮、|ΔarmHostHit|≈0.4 具名条件未达。工业界对「无新数据重开裁决」有专属负名：goalpost-shifting / decision-reversal without disconfirming evidence（runtimedecisions.com 的 pre-mortem 文：失败假设复核要**定期**做，但每次都要有新假设可验）。

**④ B 的辩证保留确有实体，但解法不是 B 轮，而是保持触发器在线**
「产品已发布、方向假设已死后不问方向会累积漂移」——这个担忧成立，且 benny 文支持「连续复盘优于年度复盘」。但你已有的机制（r88-candidate-vertical-direction-redeliberation 作**候选**挂账、具名重开条件）正是 benny 文开出的处方：「When metric X falls below Y, trigger strategy review」。候选票本身就是持续复盘机制。漂移风险由制度对冲，无需空转一轮。

**⑤ 批次化 refactor 纪律：A 的「五件同域打包」有直接证据支持**
Bourgau《When the Boy Scout Rule Fails》（已读全文）：boy-scout 顺手清只解决局部问题，**大规模 refactor 需要共享目标+追踪进度+独立排期**，且「拆成小项后仍有独立的价值优先级，嵌入其他任务只会增加 WIP、降低吞吐」。这正是 ADR-0029 的英文原版表述。F-6+r83 三票作为**一个 refactor 批次、一个主题、一张 ADR**，符合 Bourgau 开出的「fund manager 式 ROI 评估后整批执行」。

**⑥ A 的执行增益（两源交叉）**
Back Market 文强调反馈回路里「incidents/velocity 下降是债的最高利息信号」；Google《Searching for Build Debt》论文展示 Fixit（集中清债日）+ 专用团队是 Google 的两种主流清债形态——**集中式清债轮是工业界在「大账本、多票龄」下的标准形态**。r83 三票漂 5 轮 = 利息正在累积，A 轮就是一次 mini-Fixit。

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 4) 对 A 的辩证检验（含最强反对论据）
## 4) 对 A 的辩证检验（含最强反对论据）

**反对 A 的最强论据**：「refactor 轮是低价值自嗨，发布后第一个产品轮应该做用户可见的事；且 F-6 只是一个 89 行脚本的 `??/||` 一致化+三张小票，撑不起一个『主轴』，有打發轮嫌疑。」这个论据的工业版本是 Fowler 的警告：**「prudent debt 可能不值得偿还，如果利息足够小」**（原文：rarely touched part of the code-base 的债不必急还）。

**反驳**：(a) 利息不在行数而在位置——a03/a06/F-6 全落在 `cli/search.ts`/`mcp` 工具面，即本仓库**核心交付面**（用户每次查询都过），Back Market 文的「利息=velocity/incident 信号」判据恰好命中；(b) 反发布轮混排正是 D-001 自己立的规矩——发布后首轮做工程面收束，比反着来（卫生轮里塞产品动作）更符合「两道门分离」的既有心智模型；(c) 若担心体量不足，可在轮内按 ADR-0029 让 CHANGELOG Removed/Refactored 条目+审计三联（found/fixed/deferred）自然吃满，无需扩范围。

**残余风险（诚实声明）**：若 F-6 施工中触碰 sanitize/guard 语义导致与 a06 三处近重复的归并方案冲突，轮体量会膨胀——建议 A 轮 ADR 里**预注册** a06 的归并边界（统一到哪一层）作为验收判据之一，防止施工中临时改判。

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 3) 对比矩阵
## 3) 对比矩阵

| 项 | 工业惯例契合 | 证据新鲜度 | ADR-0029 合规 | 主要风险 |
|---|---|---|---|---|
| **A 搜索面卫生轮** | post-release grooming（Atomic）+ Fixit（Google）+ 偿还计划到期（aalonso）| R87 收口直接推荐 F-6，r83 票龄 5 轮=利息区 | ✅ 单主题、同域五件、due chores 分流 | 反对论据见 §4 |
| B 垂域方向重议 | ❌ 触发式复盘模型：无信号不开盘（benny/delightpath）| 0.1.0 刚上架、重开条件未达，零新证据 | ✅（候选票已是其挂账形态）| 无新数据空谈 + goalpost 移动反模式（D-001 明文）|
| C 广义清债轮 | 半契合：债龄检视本身有价值，但形式错 | 17 项中 12 项（上游债+背景债）具名触发条件不可动 | ❌ 范围过散违反单主题 | 分诊剧场；对不可动项空转 |
| D 另指 | — | — | — | 无更优选项：A 已占满 post-release 首轮的惯例位置 |

## 垂域方向重议

### R88 Q1 裁决调研报告：下一轮主轴推荐 > 3) 对比矩阵
## 3) 对比矩阵

| 项 | 工业惯例契合 | 证据新鲜度 | ADR-0029 合规 | 主要风险 |
|---|---|---|---|---|
| **A 搜索面卫生轮** | post-release grooming（Atomic）+ Fixit（Google）+ 偿还计划到期（aalonso）| R87 收口直接推荐 F-6，r83 票龄 5 轮=利息区 | ✅ 单主题、同域五件、due chores 分流 | 反对论据见 §4 |
| B 垂域方向重议 | ❌ 触发式复盘模型：无信号不开盘（benny/delightpath）| 0.1.0 刚上架、重开条件未达，零新证据 | ✅（候选票已是其挂账形态）| 无新数据空谈 + goalpost 移动反模式（D-001 明文）|
| C 广义清债轮 | 半契合：债龄检视本身有价值，但形式错 | 17 项中 12 项（上游债+背景债）具名触发条件不可动 | ❌ 范围过散违反单主题 | 分诊剧场；对不可动项空转 |
| D 另指 | — | — | — | 无更优选项：A 已占满 post-release 首轮的惯例位置 |

## 清债

No matching sections found.


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: martinfowler, post-release, atomicobject, runtimedecisions, comparative, engineering, mini-fixit, criticism, community, anysearch, searching, atomcode, official, currency, cooldown, planning, strategy, project, release, 2026-05, theater, without, prudent, tavily, reddit, 搜索面卫生轮, object, 重开条件未达, search, launch, fails, build, spin, drag, exa, r88, r87, slo, com, 批次化