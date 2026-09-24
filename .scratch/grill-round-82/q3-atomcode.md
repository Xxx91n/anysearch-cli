# atomcode 调研存档 — R82 Q3（dsh E1 辅轴条件裁决）

> 调研时间 2026-09-24；Sufficiency Gate：searches 8+ | angles=Official/Comparative/Criticism/Currency | full reads 5 | Tavily 额度尽→AnySearch 主+Exa 辅；gap=敏捷文献无 pre-registered trigger 标准术语（用 Expedite 准入判据+临床试验预注册类比覆盖）。

## 1) 执行摘要

推荐 A（条件辅轴预注册），置信度高——与 Kanban Expedite CoS（WIP=1+严格准入判据+平时空置）与 Scrum 突发工作换出规则精确同构。B 会把已兑现触发器转下轮，坐实「扳机生锈」病理；C 无条件插入是所有文献一致点名的反模式。「写好但排后」比「触发才写票」更符合可追溯性——预写票让触发判定本身可被审计。

## 2) 分点结论

① 三候选业界同构：A=Kanban Expedite CoS 成熟做法（Scrum+Kanban 混合标准解）；B=Scrum Guide 原教旨答案被文献称 naive official answer 仅适用非真紧急项；C=PO 中途塞故事不换出=整篇反模式案例（两故事半成品/commitment 失效）。关键区分（Humanizing Work）：先问「真兑现预注册判据还是临时想要」——dsh rc.1 是前者（特征锚 rc 线实证+双锚轮前预登记）。

② 「执行序钉死在主轴落地后」是正确设计：Kanban University 处方=突发工作单开泳道+预留固定比例容量（20%）但不抢占进行中工作；expedite 语义适用生产事故悬崖型，本场景是观察哨候选出闸有下轮窗口兜底——钉在主轴后=WSJF 正确排序。触发器兑现≠触发器清零：票即时写成+执行序已定+转下轮以「已预约」身份非「新候选」——与 B 的本质区别。

③ 写好但排后 vs 触发才写票：预注册核心价值=判定时刻与执行时刻解耦——判定可审计（票面触发前写好判据，触发时机械核对，如临床试验 endpoint 不可后改）+未兑现也有答案（判据未命中一纸答案非沉默）+本仓先例 ADR-0061 Pre-Registered Gate Amendment Closure 同构。

④ 护栏清单（防吞轮）：1.时间盒≤主轴时长 20%（DevOps Handbook 20% 计划外产能惯例；超时止损封票转下轮写明时间盒耗尽）；2.回退线 abort criteria 入口即写（出闸晚于主轴 DoD 冻结点/L2 彩排失败→自动转下轮记「错过窗口」不伪造完成——同 Evidence Window 诚实记档）；3.完成定义独立不稀释（E1 DoD=repin 重推导落地+验收面过，非写了代码）；4.换出显式化（动主轴容量须具名换出项，禁悄悄挤）；5.频度熔断（连续 N 轮辅轴触发→回溯上游漏斗节奏错配，retro/ADR 记录）。

## 3) 来源清单

humanizingwork.com Dealing with Interruptions on a Scrum Team（expedite lane 引入 Scrum 完整机制+真紧急 vs 临时起意判定）| businessmap.io Kanban Classes of Service（Expedite CoS/WIP=1）| kanban.university Unplanned Work（泳道+容量预留+WIP limit）| agilepainrelief.com Scrum Anti-Patterns（三选项拒绝/换出/取消+反模式案例）| spinach.ai Effective Sprint Goals（goal 轮内稳定性）| businessmap WIP Limits KB（20% 预留量化惯例）| DevOps Handbook（20% 产能预留出处）| scrum.org forum（mid-sprint 变更攻防）| ones.com kanban board（expedite lane WIP=1 交叉验证）| teachingagile.com Sprint in Scrum（取消规则交叉验证）

## 4) 信息缺口

Tavily 超额不可用（第三引擎降级 AnySearch 单引擎）；「预注册触发器」非敏捷文献标准术语（最近类比=pre-mortem/expedite entry criteria+临床试验预注册）已覆盖。