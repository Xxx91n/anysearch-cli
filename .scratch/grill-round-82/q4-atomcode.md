# atomcode 调研存档 — R82 Q4（残余假设处置分诊）

> 调研时间 2026-09-24；Sufficiency Gate：searches 多批 | full reads 多源（Google SRE Workbook、incident.io、Mountain Goat、Galen、BCMMetrics、Google Well-Architected 等 9 源）| Tavily 额度尽→AnySearch+Exa 双引擎；gap=「验收锚 vs 独立票」分界为结构类比非单文献命题。

## 1) 执行摘要

Confidence：高（框架）/中（逐项映射）。成熟处置=四分类强制分诊：每项残余必须显式落到「已消解/折入下游验收锚/独立成票/诚实记档接受」四格之一，不存在第五个「挂着不管」的合法状态——incident.io：Closing a post-mortem is a conscious act，explicitly deprioritized with documented reason 是合法出口，被动腐烂不是。

## 2) 四类处置判据边界

| 处置 | 适用判据 | 记档形态 | 反模式信号 |
|---|---|---|---|
| 即销 not-traceable | 信息物理/时间上不可回溯且不构成未来约束 | 五字段一行卡 | 用「暂缓调查」冒充「不可回溯」——前者资源决策后者本体声明 |
| 折入实施票验收锚 | 只有本票实施时才可测且结果只影响本票分支选择不跨票 | 验收条目携原 H#+Test+失败回退分支 | 把「现在就能测」伪装成「实施时才可测」逃当轮验证 |
| 独立成票 | 影响多票/独立交付价值/验证成本超 timebox/需外部协作等待 | 独立票+owner+deadline+原 H# 溯源 | 无 owner 无 deadline=静默漂移 |
| 转下轮（记账不转码） | 属下轮主题域 cohesive 项 | 账本挂债+触发器不进本轮 ADR | 永续债 Never-Ending Spike |

## 3) 分点结论

结论1 四分类强制分诊是收口法定动作，显式放弃与做完同为合法出口（incident.io+Google Well-Architected 双源）——与本仓 R81 D-002 三分支裁决同构。

结论2 action item 可关闭性五要素决定折入合法性：具名 owner+可验证动词+具体产出+真实工单+deadline。判据边界=残余在验收时存在可机械判定的通过/失败谓词；写不出谓词→独立票或即销。

结论3 业界先例=锚随票走、gate 独立于票：Spike 阵营（Mountain Goat/Galen/XP）把 spike 残余归下游 story 验收条目=实施票验收锚是 spike 残余默认归宿；risk register 阵营（BCMMetrics/NIST RMF）要求跨工作流残余脱离单票成 register 条目。独立 gate 票三条分界判据：①失败后果跨票/跨发布②需具名授权方显式接受③验证节奏与实施节奏解耦。R2 具体形态=验收锚携带回退出口：「anon 可用→继续；anon 401/429→stop-gate 触发票 #X」。

结论4 不可回溯即销的诚实记档=五字段一行卡：残余陈述+本体性不可回溯声明（区分 cannot vs won't——「无观测面留存」是 honest closure，「没时间查」是 deferred 混写即逃避）+已有替代证据指针+重开触发器（如「HTTP 000 复现则重开」）+决策人/日期。

结论5 R4 处置已被用户裁决且符合业界：scope 外事项记一行 closed-by-scope+触发器（配置治理权变更则重开）。

## 4) R1–R5 处置推荐汇总

| # | 残余 | 推荐处置 | 形态 |
|---|---|---|---|
| R1 | 历史端口监听态 | 即销 | 五字段卡：本体性不可回溯+收敛证据指针+重开触发器（000 复现） |
| R2 | /mcp anon 凭据限流 | 实施票验收锚（首选） | 实施首日 authed vs anon 对照；锚文写死双分支：anon 可用→继续；401/429→stop-gate+回退票（体量可观则独立成票携原 R2 编号） |
| R3 | transport 细节 | 折入验收锚 | 每 spec 条目一条谓词式验收项，失败即验收失败 |
| R4 | 用户 env 配置语义 | 即销 closed-by-scope | 一行账本记录+触发器 |
| R5 | REST 下线时点 | 即销 | 同 R1，写明已穷举证据面 |

总原则：四格里唯一有道德风险的是即销，唯一有工程风险的是验收锚（谓词写不出退化成愿望），唯一有流程风险的是独立票（无 owner 无 deadline 静默漂移）；转下轮已有 Never-Ending Spike 防御兜底。

## 5) 来源清单

sre.google/workbook/postmortem-culture | incident.io post-mortem action items fail | mountaingoatsoftware agile spikes | rgalen.com user story spikes | bcmmetrics residual risk documentation（NIST 对齐）| docs.cloud.google.com well-architected postmortems | claude-cortex postmortem-patterns（摘要级）| scaledagile spikes（摘要级）| 本仓先例召回：R81 D-002 三分支+R80 Q2 风险接受五要件

## 6) 信息缺口

「验收锚 vs 独立 gate 票」无单一文献直接命题=结构类比；R3 谓词来源须实施票立票时以 spec 原文逐条生成；Tavily 缺席双引擎补偿。