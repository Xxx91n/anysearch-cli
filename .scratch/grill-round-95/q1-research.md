# Q1 调研记录 — R95 主轴定界（垂域方向 formally-declined 后的选题）

日期: 2026-10-01 | 问题: Q1 正题定界（A 定位立法 / B 复活条件推进 / C 新垂域路径 / D 另指）

## 方法与时序

1. atomcode 深调（首选通道）：本地只读回顾完成后三引擎调研中途命中配额——`[rate-limited] 5h window exhausted — resets around 01:50`，进程已退出。会话锚点 `bda96f9b-f7f0-4198-8918-de19689f32df`（`atomcode -p "…" --resume <id>` 可续）。**注意**：其本地回顾疑似串仓（读到 Aworker/6F 的 25 篇 macro-audit ADR），本仓 ADR 实数 95 篇——atomcode 本回事实以本文件 §仓内证据 为准。
2. 本 agent 仓内调研（ctx_batch_execute 三批）：ADR 台账全表、CONTEXT.md 词条结构、deferred-registry 全量条目、R94 handoff/closeout/goal/ledger、R85 prereg 矩阵、R86–R88 ledger 命中行。
3. 外部调研降级通道：web_search ×4（atomcode 配额耗尽后的用户目标保全路径）。

## 仓内证据（本轮事实源）

- registry `r88-candidate-vertical-direction-redeliberation`：status=formally-declined，verdict=reaffirm，原判据 |ΔarmHostHit|≳0.4 废止（R86 实测为负 净−0.125 P=0.0378 + L3b 腿结构性死亡）。四项复活条件：①dsh stable（半可控，npm tags 机检）②上游垂域参数词表（外部不可控）③cn_code 契约补齐（半可控，owner anysearch-eval，verifier=next matrix revision/corpus unfreezing）④新评测矩阵修订版读数（纯内部可控，owner anysearch-eval，verifier=readout-delta.mjs matrix revision）。
- registry `defer-r86-anysearch-corpus-param-contract`（open，owner anysearch-eval，review_cadence=next matrix revision）：语料格 vert-f1105 缺上游必填 cn_code（finance.fundamental），两轮确定性复跑均 isError；语料指纹 7ac0a48e55cd7954 冻结期内不可修；修订候选=下一矩阵期补 cn_code 或降格该格。bogus-sub_domain 对照格（*-103 ×4）为设计内负向拒收非缺陷。
- R94 移交 R95 三待办：deprecate EOTP（用户亲触）/ 垂域复活条件（仅满足时由 owner 重新立案）/ 常驻债范围外；首推正题=claim 纪律硬化（票序终态表入 ship-gate 强制腿），备选=D6 谓词收敛 / CONTEXT.md 同步门禁。
- 纪律沿用：ADR-0029 一轮一题；一票一 commit；pathlint 冻结；无 tag/publish；but 走版本控制。

## 工业界心智模型（外部调研降级通道，辩证看待）

1. **垂直 AI agent 的赢面在领域知识捕获与工作流深度，不在路由权重微调**——vertical AI = 显式规则/标准 + 隐式专家推理层（Red Compass payments 案例）；vertical research copilot 模式 = 任务分解+证据溯源+对抗复核+checkpoint（SSharkthe）；企业垂域 agent 卖点=领域专有数据与 workload 级信号（Draup）。→ 对本题的映射：垂域理念的杠杆在「契约覆盖度/语料完整度/abstain 质量/research 工作流深度」，恰是被判死的加权轴之外的轴。
2. **eval-gated 发布纪律**：eval harness 入发布路径而非旁路（aiarch.dev）；4-band release gate（ship/hold/investigate/block + indifference window，aievals.co）；llm-evalgate 确定性闸 + judge 分层。→ 本仓 G0–G4 预注册矩阵是其更严超集；行业做法支持「尊重负读数、仪器修好前不做方向宣称」。
3. **abstention 是一等能力**：Agent Patterns Catalog 的 Refusal 模式与 Over-Helpfulness 反模式；arXiv 2606.02965「Informed Abstention」框架（compliance bias 批判，abstain=precondition-aware pause + 具名缺口 + 恢复路由）；Perplexity search_domain_filter allowlist/denylist 产品化先例。→ 本仓 OOD abstain + urlAllowlist 真门禁是已验证的差异化护城河，方向无需重新辩护。
4. **kill/pivot/persevere 决策卫生**：core hypothesis invalidated by evidence = kill 信号（pivot-evaluator 框架）；ADR reopen 作为常态治理存在（mnema decision_reopen 带 reason 审计）。→ R86 负读数杀的是「加权假设」这一 mechanism，不是 vertical identity；formally-declined+具名复活条件的结构与行业一致。

## 辩证性标注（这些来源的可疑处）

- 垂域 AI 来源多为厂商营销面（Draup/Red Compass/SimplAI）——方向叙事可信度高、效果断言可信度低，仅取心智模型不取数字。
- atomcode 本轮未出最终报告（配额）；其本地回顾串仓一节已隔离，不作为证据。
- 「行业验证 abstain」主要支持既有定位，不构成新增投资的充分理由。

## 辩证综合

三层分离消解「declined vs 遵循垂域理念」的表面矛盾：
- **身份层**（vertical specialist 定位）：从未被判死，仍在服役（契约+门禁+abstain）。
- **机制层**（prefer-capable 加权路由）：已死，四项复活条件守门，本轮不可单边重开。
- **覆盖层**（契约实做面：cn_code 语料、sub_domain_params、评测仪器修订）：从未被判死，且 registry 自己写明 verifier=next matrix revision——即制度期待该工作发生。

## 推荐与理由

**推荐 B∩C 合题——「评测矩阵修订轮（corpus unfreezing + cn_code 补齐 + delta 腿重跑读数）」**作为 R95 正题：
- 唯一同时满足：实质推进垂域理念 + 纯内部可控 + 已是 open 在册债（defer-r86 的 review_cadence 字面=next matrix revision）+ 不触碰 formally-declined（不单边重议方向）+ 产出的读数恰好是任何未来合法重议的唯一输入。
- 排序上 ③ 先于 ④ 是 registry 自带语义（corpus unfreezing 先行，readout 随后）。
- 对 A：定位立法若单独成轮产出稀薄（README 已是 canonical 定位）；可作为本轮副议项在 ADR Context 里钉一句话，不另开题（守 ADR-0029）。
- 对 R94 首推（claim 纪律硬化）：不冲突，属不同轮次选题；若用户判断治理优先于产品推进，可作 D 另指。

## 各落选项主要风险

- A 单选：治理空转风险——立法文本重复 README 已述定位，无产品增量。
- B（若窄化为「为重议攒证据」）：工具化风险——为复活而做事，读数大概率仍非正（R86 洁净读数在先），期望值存疑；应把矩阵修订定位为仪器健康/债清偿，复活只是副产品。
- C（若脱离仪器约束）：goalpost-shifting 风险——若新路径滑回加权判据，等于绕开法庭判词；必须显式红线「不动加权轴」。
- D（claim 纪律硬化）：合理但属治理题；会推迟垂域债的具名触发窗（next matrix revision）。
