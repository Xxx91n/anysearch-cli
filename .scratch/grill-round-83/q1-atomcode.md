# Q1 atomcode 调研存档——R83 主轴候选裁决

Date: 2026-09-25. 原题见 q1-prompt.txt；调研经 ctx_batch_execute 自动索引。

## R83 主轴裁决：推荐 **A=垂域贯通主轴**，B 以预注册辅轴即时兑现（confidence：高）

**Tl;dr**：A 是唯一同时满足 mission-alignment、票体量（契约+引擎+审计三面）与既有 registry 决策（票已立、open）的候选；B 是典型“小票+硬时间窗”，正好落入本仓自己设计的**条件辅轴预注册机制**（≤20% 主轴、双锚齐、执行序钉死）——这不是二选一，而是该机制第一次真实用例。C 的 11 项 open 多为监控/上游依赖型续债，无时间窗压力，继续滞留落选池是最优处置。

## 主轴

### atomcode-r83-q1 > 执行序建议（写入 R83 账本）
### 执行序建议（写入 R83 账本）
1. R83 开轮：主轴=A 具名执行（registry: defer-r83-anysearch-vertical-domain-passthrough 转 in-flight）；
2. 辅轴=B 即时兑现（预注册双锚已齐：rc.1 龄期闸 ~13:25Z 今天；五护栏含 ≤20% 时间盒生效），先做 B 至出闸/彩排完，立即回 A；
3. C 不动，落选池照旧，R83 收口时按三段判据只对 A+B 记账。

### atomcode-r83-q1
# atomcode-r83-q1

$ atomcode -p "$(cat '.scratch/grill-round-83/q1-prompt.txt')"

我先做几路外部检索校准心智模型（WSJF/时间窗、单线程 vs 并发、mission-alignment 取舍），再结合 R82 账本裁决。Tavily 配额已耗尽，改用 Exa + AnySearch 双引擎继续补齐角度。补一轮抓取与检索，凑齐配额后合成裁决。补两次原文核验（WIP 限流与 roadmap 时序原文），然后给出裁决。## R83 主轴裁决：推荐 **A=垂域贯通主轴**，B 以预注册辅轴即时兑现（confidence：高）

**Tl;dr**：A 是唯一同时满足 mission-alignment、票体量（契约+引擎+审计三面）与既有 registry 决策（票已立、open）的候选；B 是典型“小票+硬时间窗”，正好落入本仓自己设计的**条件辅轴预注册机制**（≤20% 主轴、双锚齐、执行序钉死）——这不是二选一，而是该机制第一次真实用例。C 的 11 项 open 多为监控/上游依赖型续债，无时间窗压力，继续滞留落选池是最优处置。

## 垂域

No matching sections found.

## TE1

### atomcode-r83-q1 > 推理要点
### 推理要点

1. **WSJF/CoD 视角**（ProductPlan、SAFe 框架、CD3 批评文献，双源）：Time Criticality 是 CoD 三分量之一，硬 deadline 项通常给 2–5× 乘数——B 的龄期闸正是教科书式 time-criticality。但 B 的**绝对体量太小**，作为主轴会浪费整轮（“高优先≠该占整轮”）；A 的 CoD 高且体量大，恰好是 WSJF 分子分母都大、排第一的项。
2. **单一焦点 vs 并发辅轴**（Jim Grey WIP 限流、Amazon Single-Threaded Teams，双源）：WIP=1 最大化吞吐，但成熟实践允许“低 WIP（≤2）+ 小体积例外”——B 恰是可隔离、可预注册、体量≤20% 的例外项。本仓 R82 前已为此预注册机制立法（双锚齐→即时成立+执行序钉死），**两工作流并行有治理先例且先例就是为此设计的**——不启用反而是机制空转。注意钉死执行序：先完成 TE1 出闸（时间锚），再全力进入垂域主轴，避免主轴中途被日历事件打断（打断成本 > 先打快票）。
3. **Mission vs opportunistic**（reStruggle roadmap 序贯文）：机会型工作若可溯源到目标就是合法 bet，但排序应由“依赖与学习顺序”决定——A 是战略主注；B 是义务型（obligation/expiring option），Reinertsen “expiring option” 框架明确指出：**临期选项优先消费，但不夺主轴**。TE1 若不本轮消费，漏斗空转一轮 + rc.2 明天才出闸，成本实打实。
4. **A 的三面牵动是否够一票体量**：够。契约面（参数进入 provider schema）+ 引擎路由（sub_domain 分派语义与 includeDomains 不同轴，需防混叠）+ 审计语义（路由决策要进账本）——三面正是“大票该有”的耦合深度，且 R82 审计刚建立 MCP 面 mental model，趁热打铁降低切换成本（context switching 文献：40% 生产力损耗主要来自跨主题切换，A/B 同仓同上下文，切换成本被治理机制摊薄）。
5. **C 不选的理由**：征集是元工作（排序他人工作），产不出可交付项，且池内多为“晚做不亏”的续债——等 A 收口后下一轮消化即可。

### atomcode-r83-q1 > 对比矩阵
### 对比矩阵

| 项 | WSJF 速写（CoD/体量） | 时间窗敏感性 | 与使命对齐 | 真实代价 |
|---|---|---|---|---|
| A 垂域贯通 | CoD 高（核心产品差异化）；体量大（三面牵动，一票成色足） | 低（无外部 deadline，可按护栏节奏走） | **直接命中**“垂直领域”使命内核 | 三面耦合的审计/回归成本；但 R82 刚完成迁移、上下文最热，边际成本处于低谷 |
| B TE1 兑现 | CoD 中但**时间衰减**：今天 ~13:25Z 出闸，错过即再递一轮（漏斗空转一轮成本=恒定浪费） | **高**（rc.1/rc.2 龄期闸是硬日历锚） | 中（治理卫生，非使命） | 小票：repin 依赖族+一行 listener+guard+测试+彩排；挤占主轴 ≤20% 在预算内 |
| C 落选池征集 | CoD 低且不随时间增长（监控/隔离/上游依赖型，早做不省成本） | 无 | 低 | 征集本身消耗一轮主轴，只产出“排序”不产出“交付” |

## WSJF

### atomcode-r83-q1 > Sufficiency Gate
### Sufficiency Gate
searches: 5 | angles: Official(SAFe/ProductPlan) + Comparative(CD3 vs WSJF, WIP vs 并行) + Criticism(CD3 批评、context-switch 成本) + Currency(2025–2026 博客) + Community(Reddit/StackExchange 摘要级) | full reads: 4（productplan、jimgrey、restruggle 全文 + 两个 artifact 高亮原文）| gaps: Tavily 引擎配额耗尽未能三引擎交叉（Exa+AnySearch 双引擎已达关键结论双源）；本仓 R82 账本细节以用户陈述为准，无法外部验证。

**来源清单**（本轮实际抓取/检索）：
- ProductPlan《WSJF Glossary》— productplan.com — Official — WSJF=CoD/体量、三分量含 time criticality
- Scaled Agile WSJF Guidance（经 ProductPlan/ProductPlan 引用链）— Official — 经济排序
- reStruggle《Turning Product Vision into a Roadmap》— restruggle.com（全文已读）— mission vs opportunistic、expiring option、依赖驱动排序
- Jim Grey《Strictly limit work in progress》— dev.jimgrey.net（全文已读，2025-05）— WIP=1/2 的吞吐与风险论证，允许低 WIP 例外
- Working Backwards《Single Threaded Leadership》— workingbackwards.com（高亮已读）— 单线程所有权、明确 #1 优先
- orgsignals《Cost of Context Switching》— orgsignals.com（摘要）— 切换损耗 ~40%
- CD3/CoD 批评文（artifact 310f1ad… 高亮）— Criticism — 硬 deadline 乘数、战略 bet 需 20–30% 容量保留
- Kendis WSJF Help（2025-10）— Currency — 硬 deadline（code freeze）下的 WSJF 用法
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume 7990b5c0-9898-494f-812f-3b5a096c7926

### atomcode-r83-q1 > 推理要点
### 推理要点

1. **WSJF/CoD 视角**（ProductPlan、SAFe 框架、CD3 批评文献，双源）：Time Criticality 是 CoD 三分量之一，硬 deadline 项通常给 2–5× 乘数——B 的龄期闸正是教科书式 time-criticality。但 B 的**绝对体量太小**，作为主轴会浪费整轮（“高优先≠该占整轮”）；A 的 CoD 高且体量大，恰好是 WSJF 分子分母都大、排第一的项。
2. **单一焦点 vs 并发辅轴**（Jim Grey WIP 限流、Amazon Single-Threaded Teams，双源）：WIP=1 最大化吞吐，但成熟实践允许“低 WIP（≤2）+ 小体积例外”——B 恰是可隔离、可预注册、体量≤20% 的例外项。本仓 R82 前已为此预注册机制立法（双锚齐→即时成立+执行序钉死），**两工作流并行有治理先例且先例就是为此设计的**——不启用反而是机制空转。注意钉死执行序：先完成 TE1 出闸（时间锚），再全力进入垂域主轴，避免主轴中途被日历事件打断（打断成本 > 先打快票）。
3. **Mission vs opportunistic**（reStruggle roadmap 序贯文）：机会型工作若可溯源到目标就是合法 bet，但排序应由“依赖与学习顺序”决定——A 是战略主注；B 是义务型（obligation/expiring option），Reinertsen “expiring option” 框架明确指出：**临期选项优先消费，但不夺主轴**。TE1 若不本轮消费，漏斗空转一轮 + rc.2 明天才出闸，成本实打实。
4. **A 的三面牵动是否够一票体量**：够。契约面（参数进入 provider schema）+ 引擎路由（sub_domain 分派语义与 includeDomains 不同轴，需防混叠）+ 审计语义（路由决策要进账本）——三面正是“大票该有”的耦合深度，且 R82 审计刚建立 MCP 面 mental model，趁热打铁降低切换成本（context switching 文献：40% 生产力损耗主要来自跨主题切换，A/B 同仓同上下文，切换成本被治理机制摊薄）。
5. **C 不选的理由**：征集是元工作（排序他人工作），产不出可交付项，且池内多为“晚做不亏”的续债——等 A 收口后下一轮消化即可。

### atomcode-r83-q1 > 对比矩阵
### 对比矩阵

| 项 | WSJF 速写（CoD/体量） | 时间窗敏感性 | 与使命对齐 | 真实代价 |
|---|---|---|---|---|
| A 垂域贯通 | CoD 高（核心产品差异化）；体量大（三面牵动，一票成色足） | 低（无外部 deadline，可按护栏节奏走） | **直接命中**“垂直领域”使命内核 | 三面耦合的审计/回归成本；但 R82 刚完成迁移、上下文最热，边际成本处于低谷 |
| B TE1 兑现 | CoD 中但**时间衰减**：今天 ~13:25Z 出闸，错过即再递一轮（漏斗空转一轮成本=恒定浪费） | **高**（rc.1/rc.2 龄期闸是硬日历锚） | 中（治理卫生，非使命） | 小票：repin 依赖族+一行 listener+guard+测试+彩排；挤占主轴 ≤20% 在预算内 |
| C 落选池征集 | CoD 低且不随时间增长（监控/隔离/上游依赖型，早做不省成本） | 无 | 低 | 征集本身消耗一轮主轴，只产出“排序”不产出“交付” |

## 理由

No matching sections found.


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: opportunistic, productplan, criticality, restruggle, anysearch, switching, atomcode, registry, expiring, mission, context, tavily, option, 执行序钉死, safe, time, grey, exa, r83, 双锚齐, te1, 25z, cd3, jim, bet, deadline, roadmap, wip, cod