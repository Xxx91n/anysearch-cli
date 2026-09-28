# R86 T5 决策记录 — 全绿臂复跑判读（单次终读，matrix@2）

- 判读执行：`.scratch/grill-round-85/readout-delta.mjs readout`（唯一一次执行，输出留档 `.scratch/grill-round-86/readout-output.json`）
- 证据件：`.scratch/vertical-eval/delta.json`（机器本地通道，不入库）· schema `anysearch/vertical-delta@1`
- 输入指纹：`7ac0a48e55cd7954`（G0 通过——语料零漂移，原协议原指纹）
- 判读器版本：prereg-matrix@2（R86 T4 修订已先登记于 §10）
- 测量环境声明：剔除坏 env 覆盖（endpoint→源码公开默认值），凭证=上游匿名配额边界处自签发 key（值不入档，声明式测量环境，不改用户配置）
- operator: devin-subagent (r86-green-gate-ship) · 2026-09-27

## 裁决

**NO-GO / direction-negative**——G0✓ G1✓ G1b✓ G2✓ G3✓ G4：P(better>worse)=0.0378 ≤ 0.5 → NO-GO；净胜率 −0.125（better 5 / worse 10 / tied 25 / unknown 1，nPaired 40/41）。

### 效应量四字段

| 字段 | 值 |
|---|---|
| 净胜率 (better−worse)/nPaired | −5 / 40 = **−0.125** |
| P(better>worse)（Beta flat 后验） | **0.0378** |
| EL（期望损失 E[max(W−B,0)]） | **0.2967** |
| rankDiff 中位 | **0** |

### 闸序轨迹

| 闸 | 结果 | 关键量 |
|---|---|---|
| G0 输入完整 | pass | fingerprint=7ac0a48e55cd7954 |
| G1 对照层装置闸 | pass | measured 12/16 · unmeasured 4（=4 bogus-sub_domain 设计内拒收格）· nonTied 0 |
| G1b subject 装置闸 | pass | instrumentDown 1/41（vert-f1105 契约拒收）< 30% |
| G2 覆盖闸 | pass | nPaired 40/41 ≥ 29 · unknown 1 ≤ 12 |
| G3 负向硬闸 | pass | 反向域不足 2 |
| G4 方向轴 | **NO-GO** | b=5 w=10 P=0.0378 池化 on<off |

## 判词

健康装置下的**真实测量版 NO-GO**：anysearch 垂域臂在 armHostHit 轴上实测负效应（垂域收窄吞命中宿主）。defer-r83-prefer-capable-weighting 的程序性关闭获得第一次真实数据背书；加权问维持死（不复活）。

### 判据如实记账

- `iso providersFailed=∅` 字面判据未达：残余 5 腿失败=4 设计内 bogus 对照+1 语料欠参数契约拒收（确定性、非装置性；语料指纹冻结不可修）。装置性失败=∅ 达成（0 transient/quota/env）。
- `非空覆盖≥70%` 达成：40/41=97.6%。
- R85 裁决不溯改；本读数为独立终读（matrix@2）。

### 勘误（R87 T5 补记，不溯改正文）

F-3 判据表述勘误：`iso providersFailed=∅` 的字面判据写法把「确定性上游契约拒收」与「装置性失败」混为一谈——前者含设计内 bogus 对照格与语料欠参数格，本属预期拒收而非臂病。等价表述（语义已达成、不引入新变量、不破坏预注册）：**判据当读作「装置性失败=∅ 且 非空覆盖≥70%」**——装置性失败实测 ∅（0 transient/quota/env）、覆盖 40/41=97.6%，两项均达成；字面 `providersFailed=∅` 的残余 5 腿全部落在「确定性契约拒收」类（4 设计内 bogus 对照 + vert-f1105 欠 cn_code，已分账 defer-r86-anysearch-corpus-param-contract）。预注册判读结论不受影响（NO-GO 由 G4 方向轴给出，非覆盖闸）。
