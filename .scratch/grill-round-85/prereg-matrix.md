# R85 预注册判读矩阵 — anysearch/vertical-delta@1（commit 先于任何读数/重跑）

- 登记时刻：T1（先于 T2 重跑与 T3 读数；SAP-先于-database-lock 时序）
- 权威源：decision-ledger.md D-001/D-002/D-003/D-004（全 current）；本件为机器执行视图
- 唯一判读器：`.scratch/grill-round-85/readout-delta.mjs`（确定性查表；人肉改判=矩阵作废）
- 输入指纹：`datasetFingerprint = 7ac0a48e55cd7954`（sha256 over 排序后 `{id, v:e.vertical, x:e.expected.vertical, s:scope}` 取 hex16，eval-looks.json live|both 且 `expected.vertical≠undefined` 的 57 条切片）；漂移→装置旗标停跑，不判读

## 0. 语料分层定义（冻结事实，指纹钉死）

| 层 | 选择子 | n | 构成 |
|---|---|---|---|
| 处理层（subjects） | `expected.vertical.role === "subject"` | 41 | vdomain×stratum：finance 11（param 6+sem 5）、academic/code/health 各 10（param 5+sem 5） |
| 对照层（controls） | `role === "control"` | 16 | 每域 4：3 携 spec + 1 无 spec（`ctrl-{f,a,c,h}10x`） |

- **paired**：`armOn ≠ null && armOff ≠ null`（与 runner 聚合定义一致）
- **measured（对照层）**：该格排定的臂级腿全部返回可解析 JSON——携 spec 格=`armOn && armOff` 皆非 null；无 spec 格=`armOff` 非 null（`armOn` 结构性缺席不算未测，self-pair 本就不排定）
- **unknown（处理层）**：`delta.verdict === "unknown"`；本语料处理层全携 hitHosts，故 unknown ⟺ 腿失败或格缺席
- **structural missing**：语料排定但 artifact 无此 row（早停/截断所致）→ 记 unknown 入对应层 tally，不作有效格
- 判读输入锚：row 字段 `armOn/armOff/delta.verdict/delta.rankDiff/vdomain/stratum/role/hadVerticalSpec`；fused 级列只报告不进门

## 1. 判定管线（固定顺序，先过的闸截断后序）

```
G0 输入完整闸 → G1 对照层装置闸 → G2 覆盖闸 → G3 负向硬闸(2-of-4) → G4 方向轴
```

- **G0 输入完整**：`schema==="anysearch/vertical-delta@1"` 且 `datasetFingerprint===7ac0a48e55cd7954`；失败→整轮 INCONCLUSIVE（原因=input-integrity），不进入任何判读
- **G1 对照层装置闸（独立必要合取，不进方向分）**：`unmeasured > 8/16` 或 `nonTied(better+worse) ≥ 4/16` → 装置旗标 → **整轮 INCONCLUSIVE（原因=instrument-flag）**。旗标诊断顺序登记：先 unknown 缺失模式（哪些格未测/缺席）→ 方向一致性（non-tied 是否单边）→ 对称噪音（better≈worse）
- **G2 覆盖闸（处理层）**：`nPaired/41 ≥ 70%`（≥29）且 `unknown/41 ≤ 30%`（≤12）；不达标→INCONCLUSIVE（原因=coverage）。注：本语料下两肢代数等价（paired⟺measurable），仍分别登记保持矩阵形态
- **G3 负向硬闸**：封闭域表 {finance, academic, code, health}；域 `worse−better ≥ 3` 记反向域；反向域 ≥2 → **NO-GO**（一票方向性否决之外的对称保护）；事后新增切分（stratum 等）无否决权，只记假设
- **G4 方向轴（处理层合并池）**：`b=Σbetter, w=Σworse`；flat 先验后验 `B~Beta(1+b), W~Beta(1+w)`，`P=P(B>W)`（固定步长数值积分，确定性无 RNG）；池化 `armHostHit` 差=paired 行 hostHit 均值 on−off
  - `P ≥ 0.8` 且 `池化 > 0` → **GO**
  - `P ≤ 0.5` 或 `池化 ≤ 0` → **NO-GO**
  - 其余 → **INCONCLUSIVE**，必须附具名下触发条件+量化锚（见 §6）

## 2. 效应量四字段（双读落 decision-record）

1. 净胜率 = `(better−worse)/nPaired`
2. `P(better>worse)`（同上后验）
3. EL（期望损失）= `E[max(W−B,0)]` ——「按 on 方向行动」的后验期望损失，同一固定网格数值积分
4. rankDiff 中位 = paired 行 `delta.rankDiff`（=rankOff−rankOn，正值=on 更靠前）中位数；无可用值记 null 不记 0

副列（只报告无否决权）：per-domain {b/w/t/u/nPaired/armHostHit on·off}、per-stratum 同上、truncation 注记（各域完成格数=paired/expected）、`controlDegraded`、`armInFanout` 存活率。

## 3. 早停规则本体（先于 launch 登记）

- 调度序：**对照层 16 格先行全跑** → runner 内联装置旗标判定（同 G1 两肢；runner 判定仅作停手机制，权威判定仍在 readout 脚本）→ 旗标即早停：处理层不跑，artifact 仅含对照层 rows + `instrumentFlag:true` 落盘 → readout 判 INCONCLUSIVE
- 处理层调度序：**vdomain×stratum 轮询交错**（8 桶 sorted-key 轮转，每桶内保语料原序）——配额耗尽截断时 null 格均布四域（MAR 近似），保 per-domain 副列与 G3 可判性；优先级序被禁（需已注册先验，缺席）
- CONCURRENCY=4 维持；每格腿数不变（spec 格 4 腿、无 spec 对照 2 腿）——**排序改动不改采样协议**
- runner 崩溃/artifact 未产出=执行失败：允许修复重跑（未产出即未读数）；**artifact 一旦落盘即为本轮唯一读件**
- 指纹漂移（assert-corpus 失败或 artifact 指纹不符）→ 停，装置旗标流程

## 4. 配额守卫（D-001(4) 落地）

- adaptive pacing=轮询交错实现（不引入未注册优先级）；配额耗尽截断→已完成格保留进判读+truncation 注记（各域 paired/expected 格数）→缺失近似 MAR 保留判读；若缺失呈域相关聚集（排后域系统性缺席）=结构性 MNAR→decision-record 显式标记该域副列不可用
- null 格回填而非弃跑：腿失败格记 unknown，不中止批次（runner 既有语义，本轮不变）
- 不设第五出口：覆盖不达标仍走 INCONCLUSIVE

## 5. 单次终读生效条款

- 本矩阵仅对 **一次** readout 执行生效；二次读取/peek/中途读数改判 → 矩阵作废，本轮记 INCONCLUSIVE（原因=protocol-breach）并如实呈报
- LIMIT 冒烟件/非 canonical 路径件指纹必不符 G0，天然不可被误读；canonical 路径 `.scratch/vertical-eval/delta.json`

## 6. INCONCLUSIVE 具名触发模板（量化锚必填）

- 形如 `defer-r85-delta-<cause>-retry`：触发条件须带量化锚，例「配额恢复后全量重跑，可分辨 |ΔarmHostHit|≳0.4，目标 nPaired≥29/41」或「语料扩量至 n≈X 后重跑」
- 裸 INCONCLUSIVE 禁止（D-001(5)）

## 7. 设计声明（随档+入 ADR-0086 若立）

1. **0.8 阈 ≡ flat-prior 单侧 α0.2 的代数等价**，低于平台默认 0.90–0.99——evidence-only 轮业务选择，非显著性门禁（不报 p 值）
2. **2-of-4 否决为误否决率控制插值**：业界先例=任一否决/all-pass；null 下 2-of-4 误否决 ~5–23% vs 任一否决 ~42–65%；无直接文献先例，属设计选择
3. **per-domain 副列+2-of-4 组合为仓内自创**——ADR-0086 记首创非业界移植
4. **对照层闸操作化**：本语料对照格全 `hit:false`（无 hitHosts）→ verdict 结构性 unknown，「non-tied≥4」肢在当前语料下恒空转（保留以维持矩阵形态+防未来携期望对照）；活肢为 `unmeasured>8/16`（腿失败/格缺席）——R84 配额死签名正落此肢。此操作化登记于预注册，非事后解释

## 8. 功效注记

- 本轮 n=41 下只可分辨 **|ΔarmHostHit|≳0.4**（Airbnb Power Guardrail 精神写入记录）；小于此的效应即使存在也不可判，INCONCLUSIVE 不丢人、伪 GO 丢人

## 9. 出档映射

- GO → `defer-r83-prefer-capable-weighting` 注记转「数据在手信号正向，下轮设计加权」+具名跟进票；立 ADR-0086
- NO-GO → 挂账核销附判词；立 ADR-0086
- INCONCLUSIVE → registry 显式 hold 态+具名触发量化锚；不立 ADR，报告全字段
- `defer-r84-delta-quota-rerun` 按重跑实绩核销或转 hold

## 10. 修订登记（matrix@2 — R86 T4，先于 T5 复跑终读）

- **触发**：声明#4 已知残余限制兑现——provider 级失败（providersFailed 非空）在 R85 全程产生「装置级零数据被判成测得值」的记分簿失真（空臂列表计 tied）。
- **修订内容**：iso 腿 providersFailed 含被测臂 → 该侧 unmeasured（armOn/armOff 等效 null）→ 格 paired=false、verdict=unknown；subject 层 instrumentDown 占比 >30% → INCONCLUSIVE（exit=instrument-flag），新增闸 G1b（装置健康族，序=G1 之后 G2 之前）。
- **runner 侧同步**：捕获层不再把失败腿落成空列表——providersFailed 含 anysearch 的 iso 腿直接记 armOn/armOff=null。
- **生效范围**：自 T5 复跑起的判读执行；R85 锁定读数（readout-output.json）不溯改，语义判词由 decision-record/ADR-0086 勘误承担。
- **生效时点**：本登记 commit 先于 T5 复跑终读——预注册纪律保持（先声明后读数）。
