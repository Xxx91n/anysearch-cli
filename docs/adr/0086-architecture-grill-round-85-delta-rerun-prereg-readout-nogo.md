# ADR-0086: Grill Round 85 — delta 腿全量重跑 + prefer-capable 预注册判读（NO-GO 终局）

## Status

Accepted (grill round r85; 主轴票 fix-r85-delta-rerun-prefer-capable-readout). Records the round-85 decisions per ticket plan T0/T1/T2/T3/T4. Ledger: `.scratch/grill-round-85/decision-ledger.md`（D-001~D-004，全 current 无断号）. Evidence root: `.scratch/grill-round-85/`（prereg-matrix.md / readout-delta.mjs / decision-record.md / readout-output.json / reports/）；证据件本体驻机器本地通道 `.scratch/vertical-eval/delta.json`（可再生惯例，decision-record 以路径+指纹引用）。

## Context

ADR-0085 把垂域评测证据腿建成在役（契约断言 + 金标语料 + 双臂配对 delta runner），首轮 live 读数因匿名配额耗尽部分降格，挂 `defer-r84-delta-quota-rerun`；其产出是 `defer-r83-prefer-capable-weighting` 的唯一前置证据。2026-09-27 有效 `ANYSEARCH_API_KEY` 在场且 live 探针跑通，触发条件成立——本轮为 **evidence-only 轮**：再生全量证据件、按 run 前落盘的判读矩阵出裁决、迁移 registry；prefer-capable 加权实施本身不在本轮。

## Decision

### D1 主轴定界：evidence-only 轮（D-001）

重跑配对 runner 再生 `anysearch/vertical-delta@1` 四面全量证据件 → 预注册三分出口判读（GO=注记转「数据在手下轮设计加权」+跟进票 / NO-GO=挂账核销附判词 / INCONCLUSIVE=显式 hold+量化锚具名触发）→ registry 状态迁移即轮次完成定义（不是「拿到数据」）。读数法=配对符号检验计数差+效应量+P(better>worse)，**不报 p 值不设显著性门禁**。

### D2 预注册判读矩阵（D-002）

`.scratch/grill-round-85/prereg-matrix.md` 于 T1 commit（`wws`）**先于任何读数/重跑**——SAP-先于-database-lock 时序。固定闸序：

- **G0 输入完整**：schema@1 + `datasetFingerprint=7ac0a48e55cd7954`（sha256 over 排序 `{id,spec,expectation,scope}` hex16），漂移→装置旗标停
- **G1 对照层独立闸**（装置健康必要合取，不进方向分）：control stratum `unmeasured>8/16` 或 `nonTied≥4/16`→整轮 INCONCLUSIVE
- **G2 覆盖闸**（处理层）：`nPaired/41≥70%` 且 `unknown/41≤30%`
- **G3 负向硬闸 2-of-4**：封闭域表 {finance,academic,code,health}，域 `worse−better≥3` 记反向，≥2 反向→NO-GO
- **G4 方向轴**：处理层合并池 `Beta(1+better,1+worse)` 后验——`P≥0.8` 且池化 armHostHit on>off→GO；`P≤0.5` 或池化≤0→NO-GO；中间→INCONCLUSIVE 附具名量化锚
- 效应量四字段双读落 decision-record：净胜率 / P / EL（E[max(W−B,0)]）/ rankDiff 中位
- 唯一判读器 `.scratch/grill-round-85/readout-delta.mjs`（确定性：betacf+Lanczos 精确后验、固定网格积分、无 RNG）；人肉改判=矩阵作废；**单次终读**——二次读取/peek 即作废

三处设计声明如实登记：**0.8 阈≡flat-prior 单侧 α0.2 业务选择**（低于平台默认 0.90–0.99）；**2-of-4 否决为误否决率控制插值**（业界先例=任一否决/all-pass，null 下 ~5–23% vs ~42–65%，无直接文献先例）；**per-domain 副列+2-of-4 组合为仓内自创**（本 ADR 记首创非移植）。

### D3 五票序+执行细节（D-003/D-004）

- T0 哨戒续班（dsh rc.3+ watch / #1764 用户侧不代发 / CI 观测 / 锐评第七轮核账归档 `reports/2026-09-27-t0-watch.md`）
- T1 预注册件落盘先行 commit；T2 重跑执行；T3 判读+决策记录（operator/verified-by 签认字段，Part 11 语义）；T4 收口
- runner 最小改动（commit `npv`，「instrument-health ordering, no sampling-protocol change」）：对照层 16 格前置作仪器探针（旗标即早停省配额）+ 处理层 vdomain×stratum 8 桶轮询交错（配额截断时 null 格均布≈MAR，保 per-domain 副列与 G3 可判性；优先级序需已注册先验故禁）+ `ANS_VERTICAL_DELTA_PLAN=1` 排演面（零上游调用验证调度序）+ `hadVerticalSpec` 记账锚
- 工件驻留分级：prereg/decision/调研档入库（`.scratch/grill-round-85/**` gitignore 白名单承 R84 惯例）；delta.json 驻 `.scratch/vertical-eval/` 机器本地通道；存量降格件改名 `delta-2026-09-26.degraded.json` 归档不删
- 早停规则本体先于 launch 登记；boy-scout 限 hunk 邻接级五项封闭清单（argv 序列化/kill-timer/fakeSink/marked 遮蔽/isVerticalEntry），本轮 hunk 均未触到，零搭车

### D4 判读结果与核销（本轮产出）

**裁决：NO-GO / direction-negative**（单次终读，输出档 `.scratch/grill-round-85/readout-output.json`）：

- G0✓（指纹钉死）G1✓（对照层 16/16 腿级可达，0 未测 0 非平）G2✓（nPaired 41/41、unknown 0——配额全程未耗尽）G3✓（零反向域）
- G4：better=0 worse=0 → P=0.500≤0.5 → NO-GO；池化 armHostHit on=off=0、Δ=0 → NO-GO（双肢同中）
- 四字段：净胜率 0.000 / P=0.500 / EL=0.1667 / rankDiff 中位 null（无可用差，不记 0）

**证据纹理如实披露（判词关键）**：本轮「无信号」的成因是 **anysearch 臂全程未产出结果列**——41/41 处理层格 `providersFailedIsoOn/Off=["anysearch"]` 且 `armOn/armOff.n=0`，全扇出腿 `providersFailed` 同列 `anysearch`（部分含 tavily）、`armInFanout*=false` 全格，对照层 16/16 同病；fused 级命中全部由其余 provider 承载。装置失效在**数据层面**（进程/解析层健康，故按注册的「腿级 JSON 可达性」操作化 G1 未触发）——此「provider 级数据失败」为注册矩阵未覆盖的第三失败形态，登记为**矩阵声明#4 已知残余限制 + 下一修订候选**，不作追溯改判依据。

**判词**：按注册矩阵字面裁决 NO-GO 成立且锁定；`defer-r83-prefer-capable-weighting` 核销——加权问经注册程序判为「无可观测臂级增益信号」，复活前置=先解 `defer-r85-anysearch-arm-providersfailed`（arm provider-failure 面根因不清则臂级测量无从谈起，属新票）。`defer-r84-delta-quota-rerun` 按重跑实绩核销。

## Rejected alternatives

- **peeking / 二次读数 / 中途改判**：单次终读纪律（D-001/D-002(5)）——矩阵作废条款，执行恰好一次
- **人肉改判脚本输出**：判读器唯一权威；provider-failure 纹理以披露+修订候选处理而非追溯改判
- **报 p 值 / 显著性门禁**：样本量对目标效应量差数量级，小样本设阈是伪科学（账本禁项）
- **优先级调度序**：需已注册先验，缺席→轮询是唯一不引入未注册决策自由的默认（D-004(1)）
- **per-arm 独立门禁 / 融合级列进门 / unknown 记 0 / 裸 INCONCLUSIVE / 第五出口**：账本逐项明令否决
- **加权实施提前**：GO 才放行，本轮判 NO-GO——挂账核销，加权永不再入（除非新票复活）
- **未产出即重跑无限次**：runner 崩溃条款只允许 artifact 未落盘前修复重跑；artifact 一落盘即唯一读件

## Consequences

- `defer-r83-prefer-capable-weighting` **closed**（NO-GO 判词附纹理）；`defer-r84-delta-quota-rerun` **closed**（触发条件满足、全量重跑完成、指纹钉死、存量降格件归档）
- 新增 `defer-r85-anysearch-arm-providersfailed`（deferred-with-ticket，owner anysearch-retriever）：isolated+fanout 全程 providersFailed=[anysearch] 空列——清障轮候选，复活 prefer-capable 问的前置
- 判读矩阵（prereg-matrix@1）+确定性判读器入库可复用：下一轮任何 delta 判读以同形态起跳，修订点已知（声明#4）
- 残余观察位（不动工只记录）：defer-r84-ip-fifth-domain；清障轮候场新增 isolated-arm provider-failure 面
- 若复活路径兑现：下轮=prefer-capable 加权设计轮（本决策记录为输入）
