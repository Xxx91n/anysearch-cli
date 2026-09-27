# Q4 atomcode 调研存档 — 全绿臂复跑口径与认识论地位

调研时间：2026-09-27 · 问题原文见 q4-prompt.txt

## 1) 执行摘要（TL;DR）

**推荐方案 A + 随票项落地（判读器语义修正本轮同落）**，置信度高。工业界与计量学一致心智：「装置合格性验收」与「实验裁决」是两个独立闸门，前者失败触发 protocol deviation→数据标记无效（invalid/missing）而非推翻实验结论；对无效数据的重测不构成 peeking——peeking 定义性特征是「基于已见读数选择分析」（results-dependent selection），装置失效与读数无关（data-independent）。R85 的 41 对 tied 是判读器把 instrument failure 伪装成 tie，正确认识论修正=修正评分语义→旧 NO-GO 判词如实降级为「indeterminate/instrument-flag」→确认健康臂后全量复跑产生全新读数→该读数在 fresh preregistration 下裁决。

## 2) 分点结论

**① 装置失效→数据作废重测 ≠ peeking，判据是「与读数无关」。** Lakens（2023 全文读）：可接受 preregistration 偏离限「unforeseen events」与「unequivocally improves validity」两类，偏离在数据可用之前做出「has no consequences for severity, as long as updates are independent of the data」。装置全灭是极端 data-independent 事件：读数不存在，无选择效应。FDA 协议偏离指南（fda.gov/media/184745）：「关键终点数据采自未校准设备」列 Important 级，处置=记录/分类/评估可解释性——不把该批数据当有效读数计入裁决，也不禁止重测。GMP 计量学（usvalidation 全文读）：「Calibration completed after qualification execution does not retrospectively establish that the instrument was suitable when the test data were generated」——失效期间数据追溯性无效，修复后重测是标准动作。**两源一致：重测合法，旧数据不参与裁决。**

**② 健康闸回写实验结论是反模式；「能飞」验收线与裁决线必须分离。** Smoke test 定义=「shallow broad check deciding whether a build is stable enough to test further」——只答「值不值得测」从不答「产品好不好」（minitap/kualitee/testrigor/momentic 四源一致；momentic 强调 exit criteria 须是二元 measurable pass/fail 与实验读数分开记账）。R86 复跑是「臂可信」的资格判定，不该也不需要改写 R85 裁决记录——R85 正确处置是把判词从「prefer-capable 挂账核销（tied 实证）」修正为「indeterminate—instrument down，未测出任何信号」。这是判词措辞修正（记分簿诚实化）非重开裁决：NO-GO 作为预注册终局仍成立，因装置全灭本就没产出可供推翻任何裁决的读数。「41 对 tied→核销」的依据随语义修正自动失效——旧数据不复算，registry 注明即可（Lakens deviation-reporting 惯例：偏离透明报告，不追溯改判）。

**③ tie vs missing/invalid 语义区分有明确统计学先例：tie 丢弃、missing 另一范畴、instrument failure 归 missing。** Sign test 标准惯例（statisticssolutions+scirp 双源全文+CASRAI/Wikipedia 交叉）：tie 计 0、「ignore the zero sign」、n 缩减——tie 是有效读数只是不含方向信息。但 R85 的 41 对根本不是 tie：一方 n=0 且 hostHit=false 是无读数，属 informative missingness 范畴（worst-rank score 文献 Control Clin Trials 1999：测量缺失与状态相关时 inappropriate to treat as MAR and ignore）——正确记法 unknown/excluded-with-flag，绝不是 tied。scirp「ties included」异见文反佐边界：它争论的是有效零差异读数，前提是 ties come from valid data——无效数据连进入 tie 讨论的资格都没有。aiskillcerts（全文读）工程侧同构：access failure 与 valid empty 必须分列，「mislabel a failure as empty, and the agent reports false absence」——R85 判读器犯了「failure 伪装成 empty→empty 并进 tie」双重混淆。

**④ fail-open 下「provider 失败返回空列表」是被反复记录的生产陷阱，修正是工具层职责。** 2026 年多篇 silent-failure 盘点（n1n.ai、dev.to、prefactor、agentcrew 两篇全文读）一致把「empty output with success code」列第一大模式。修正在工具边界——修正方向是收紧（unknown 记损）不产生有利任何方向的 selection；须同时登记：R85 旧件不复算、判词「41 对 tied」降级为「41 对 instrument-down（按修正前判读器语义记 tied，已作废）」——不是改历史，是给历史加脚注。

**⑤ smoke vs full regression 取舍门槛：smoke 拒掉的 build 连进 full regression 的资格都没有；但 smoke 通过从来不是放行证据。** 四源一致（minitap/kualitee/testrigor/momentic）：smoke 每次构建都跑、失败即拒；full regression 才是 release sign-off 证据。B 方案缩容冒烟单独走=拿 BVT 冒充 regression。

## 3) 对比矩阵

| 方案 | 认识论地位 | peeking 风险 | 配额成本 | 工业先例对齐 |
|---|---|---|---|---|
| **A 全量复跑+健康闸+NO-GO 不重开** | 新读数在 fresh 判读口径下独立证据；R85 判词诚实化降级 indeterminate | 无（健康闸 data-independent） | 高（57 条，可内嵌 B 探针前置） | ✅ FDA protocol deviation+GMP 校准：失效数据作废、修复重测、透明记录 |
| B 缩容冒烟 | 仅够资格判定不够裁决 | 无 | 低 | ⚠️ smoke 从来不是 sign-off 证据 |
| C 复跑+重判读改裁决 | 用新数据推翻旧裁决 | 有——results-dependent selection | 高 | ❌ 违 Lakens「结果已知后不得更新预注册」；重开须 fresh preregistration |
| D 维持现状 | tied 判词留记录 | 无 | 零 | ❌ 「failure 伪装成 tie」假证据污染引用链 |

## 4) 信息缺口

- 未找到「装置失效后复跑」显式 peeking 判例文献——临床界纳入 protocol deviation 管辖未单独命名，结论从 selection-effect 判据（Lakens）+deviation 处置惯例（FDA/GMP）推出，属强类比；
- R85 判读器具体实现未读，providersFailed→unknown 落点（runner vs 判读器）落地前应对照实际判读代码确认。

## 最终推荐

方案 A（内嵌 B 探针前置阶段）+ 随票项语义修正本轮同落 + R85 判词诚实化降级（indeterminate/instrument-flag，旧件不复算）+ registry 登记具名跟进条件（若 R86 全绿臂现方向信号，则 fresh preregistration 下轮重开 prefer-capable 议题）。
