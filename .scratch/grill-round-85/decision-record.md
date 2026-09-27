# R85 决策记录 — vertical-delta 重跑判读（单次终读）

- 判读执行：`.scratch/grill-round-85/readout-delta.mjs readout`（唯一一次执行，输出留档 `readout-output.json`）
- 证据件：`.scratch/vertical-eval/delta.json`（机器本地通道，不入库）· schema `anysearch/vertical-delta@1` · generatedAt 2026-09-27T04:53:21Z
- 输入指纹：`7ac0a48e55cd7954`（G0 通过——语料零漂移）
- 判读器版本：prereg-matrix@1（commit `wws` 先于任何读数）
- operator: devin-subagent (r85-grill) · verified-by: **Xxx91n**（2026-09-27，审计 PASS 后经用户明示授权代签——「你就是 xxx91n」授权原话）

## 裁决

**NO-GO / direction-negative**——G0✓ G1✓ G2✓ G3✓ G4：P(better>worse)=0.500 ≤ 0.5 → NO-GO；池化 armHostHit Δ=0 ≤ 0 → NO-GO（双肢同中）。

### 效应量四字段（双读落档）

| 字段 | 值 |
|---|---|
| 净胜率 (better−worse)/nPaired | 0 / 41 = **0.000** |
| P(better>worse)（Beta(1+b,1+w) flat 后验） | **0.500** |
| EL（期望损失 E[max(W−B,0)]） | **0.1667** |
| rankDiff 中位 | **null**（全格 rankOf 双 null，无可用差；不记 0） |

### 闸序轨迹（readout-output.json 权威原文）

| 闸 | 结果 | 关键量 |
|---|---|---|
| G0 输入完整 | pass | schema✓ fingerprint=7ac0a48e55cd7954 |
| G1 对照层装置闸 | pass | measured 16/16 · unmeasured 0 · nonTied 0 · artifactFlag=false（runner 探针未触发，全 57 格执行完毕） |
| G2 覆盖闸 | pass | nPaired 41/41（≥29）· unknown 0（≤12） |
| G3 负向硬闸 2-of-4 | pass | 反向域 0（全域 tied） |
| G4 方向轴 | **NO-GO** | b=0 w=0 P=0.500 池化 on=0 off=0 Δ=0 |

### per-domain / per-stratum 副列（报告级，无否决权）

| 域 | b/w/t/u | nPaired/expected |
|---|---|---|
| finance | 0/0/11/0 | 11/11 |
| academic | 0/0/10/0 | 10/10 |
| code | 0/0/10/0 | 10/10 |
| health | 0/0/10/0 | 10/10 |
| stratum parameterized | 0/0/21/0 | 21/21 |
| stratum semantic | 0/0/20/0 | 20/20 |

truncation 注记：无——四域完成格率 100%，MNAR 疑面空集，对照层先行探针未触发早停。

## 证据纹理如实披露（判词关键附注）

裁决按注册矩阵字面为 NO-GO，但证据纹理须如实记载——**本轮「无信号」的成因不是「臂级观测到零差异」，而是「anysearch 臂全程未产出结果列」**：

- 处理层 41/41 格：`armOn.n = armOff.n = 0`（空列），`providersFailedIsoOn = providersFailedIsoOff = ["anysearch"]` 全格命中
- 全扇出腿同病：`providersFailedOn/Off ∈ {["anysearch"],["tavily","anysearch"]}`，`armInFanoutOn/Off = false` 全格——anysearch 臂在 fanout 内亦从未产出列表；fused 级命中（param on=0.33/off=0.29、sem 0.45/0.45）全部由其余 provider 承载
- 对照层 16/16 同样 `providersFailedIsoOff=["anysearch"]`、`armOff.n=0`——装置在数据层面失效，仅进程/解析层面健康（故 G1 按注册操作化未触发；该操作化将「measured」定义为腿返回可解析 JSON，provider 级失败不在其覆盖域——**已如实登记为矩阵声明#4 的已知残余限制**）
- 与 R84 降格件（`delta-2026-09-26.degraded.json`）同形异因：R84 匿名额度死为空列+null 臂混杂且早期格有真数据；本轮携钥全量跑=100% 格空列+具名 provider 失败旗——候选解释=携钥 iso 路径/上游 provider 侧当日失效（不落断言，根因归清障轮）

**判词**：按注册矩阵，「无信号→NO-GO」字面成立且裁决锁定不改判；但本质为装置级零数据（provider-failure 全覆盖），非「测得零增益」。`defer-r83-prefer-capable-weighting` 按 NO-GO 核销路径执行，**附注**此纹理；若未来复活该问，前置=修复 isolated-arm provider-failure 面（登记清障候选项），属新票。

## 单次终读纪律

- readout 对 canonical artifact 执行**恰好一次**（2026-09-27T~05:0xZ，本机）；无 peek、无重读、无人肉改判
- runner 崩溃重跑条款未触发（一次跑成，artifact 单次落盘）
- 报告级证据字段提取（providersFailed/n 分布）发生于裁决之后，仅用于披露，未回流改判

## 设计声明随行（D-002 要求 + 本轮新增第 4 条）

1. 0.8 阈 ≡ flat-prior 单侧 α0.2 业务选择（低于平台默认 0.90–0.99）
2. 2-of-4 否决为误否决率控制插值（无直接文献先例）
3. per-domain 副列+2-of-4 为仓内首创
4. 对照层闸操作化以「腿级 JSON 可达性」定义 measured——provider 级数据失败（空列+providersFailed 具名）为未注册第三形态，本轮实证暴露；登记为判读矩阵下一修订候选，不作本轮追溯改判依据

## 审计勘误补录（r85 audit findings 响应——post-verdict report-level 提取，未回流改判）

- **副列注册项补齐**（prereg §2，审计 finding ①②）：per-domain `armHostHit on·off` 四域全 0（finance on=0/11 off=0/11；academic/code/health 各 on=0/10 off=0/10，率 0.000）；per-stratum 同（parameterized 0/21、semantic 0/20）。`armInFanout` 存活率：处理层 on=0/41、off=0/41；含对照层 on=0/53、off=0/57（4 无 spec 对照格 `armInFanoutOn=null` 为结构性缺席非失败）；`controlDegraded`=0。数值由独立于判读器的提取脚本在裁决后计算，同纹理披露纪律。wws 版判读器未产此二字段属注册缺漏——判读器已按注册项补齐副列输出（审计修订，仅供下轮复用；本轮权威读件仍为 `readout-output.json`）。
- **功效注记补录**（D-002(6) 要求「写入记录」，审计 finding ③）：本轮 n=41 下只可分辨 |ΔarmHostHit|≳0.4——小于此的效应即使存在亦不可判；INCONCLUSIVE 不丢人、伪 GO 丢人。
- **CI 区间勘误**（审计 finding ⑤）：D-001(3)「效应量+CI 区间」与 D-002(4) 四字段（净胜率/P/EL/rankDiff 中位，无 CI）为账本内部歧义——判读权威归 T1 先于读数落盘的矩阵（D-002），本轮实现从后者；且全 tied（b=w=0）下区间估计本就退化。登记为账本措辞勘误项；若下轮要区间，须先修订矩阵注册字段再进判读器。
- **纹理精度勘误**（审计 finding）：上文「providersFailed=["anysearch"] 全格命中」精确形——`providersFailedIsoOff=["anysearch"]` 57/57 格；`providersFailedIsoOn=["anysearch"]` 53/53 排定格（4 无 spec 对照格 iso-on 腿结构性不排定，值为 null）；`armInFanoutOn/Off=false` 同为排定格口径 53/53。臂级零数据实质结论不变（57/57 格 armOn.n=armOff.n=0）。
- **G1 诊断序说明**（审计 finding ⑥）：旗标本轮未触发（unmeasuredIds/nonTiedIds 均空列表即为「unknown 缺失模式」步的记录形）；「方向一致性→对称噪音」归因序为旗标触发后的判别序，非缺陷。
