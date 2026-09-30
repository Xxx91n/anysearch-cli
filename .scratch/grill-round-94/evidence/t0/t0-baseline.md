# T0 基线快照（dsh dist-tags 哨戒 + check/test/全量 ship-gate 预检 + Grill 事实归档）

时间戳: 2026-09-30 | 覆盖: D-001 / D-003 | commit 类型: chore

## 1. 哨戒 — dsh dist-tags 复观（TC 谓词与开庭资格）

执行命令与输出：

```bash
$ npm view @deepseek-ai/dsh dist-tags --json
{
  "alpha": "0.1.7-alpha.2",
  "latest": "0.2.0-rc.2",
  "next": "0.2.0-rc.2"
}

$ npm view @deepseek-ai/dsh versions --json | tail -8
[ "0.1.6-alpha.1", "0.1.6-alpha.2", "0.1.7-alpha.1", "0.1.7-alpha.2", "0.1.7-rc.1", "0.1.7-rc.2", "0.2.0-rc.1", "0.2.0-rc.2" ]

$ dsh --version
0.1.7-rc.2
```

**哨戒结论**：
1. **TC 谓词未触发**：未目击 `0.2.0` stable 晋升，最新仍为 `0.2.0-rc.2`。按任务书约定，TC 谓词不启、不留痕。
2. **开庭资格核验正常**：未发生 stable 晋升，r88 候审标的未被上游实质改变，**T0-F 复议轮降级程序票不触发**，全轮按原定开庭议程推进。
3. **宿主版本**：本机 dsh 维持 `0.1.7-rc.2`（版本轴与消费轴正交，不随意升降）。

## 2. 基线三腿执行结果

| 腿 | 命令 | 退出码 | 结果摘要 |
|---|---|---|---|
| check | `pnpm run check` | 0 | `Tasks: 8 successful, 8 total / Cached: 8 cached (68ms FULL TURBO)` |
| test | `pnpm test` | 0 | `Tasks: 13 successful, 13 total / Cached: 5 cached (4m3.772s)` |
| 全量 ship-gate 预检 | `node scripts/ship-gate.mjs` | 1 | step 0 不变量全绿；step 1 静态断言全绿；新鲜度腿早退（缺 r94 CHANGELOG 条目） |

### 全量 ship-gate 预检单一 Fail 归因与 D6 谓词分析

- **日志位置**：.scratch/grill-round-94/evidence/t0/ship-gate-full.log
- **断言明细**：
  - step 0/9 永久不变量（check-workflows / clean-tree / gitignore-drift / task-parity 8包全覆盖）全 pass。
  - step 1/9 静态断言（8 包 0.1.0 钉版、5 ans_* 工具、TypeBox 模式对齐、Fuser / KG-lite / access-events 链、quarantine ratchet 等）全 pass。
  - 新鲜度腿断言报错：`[fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r94 — current round is .scratch/grill-round-94; add the round entry or declare 'no-changelog-entry: <reason>' in goal.md`。
- **归因**：
  - 与 R88、R92、R93 历史各轮 T0 基线同型。CHANGELOG r94 增量属收口批 T6④ 的排期交付物，T0 干净树时刻必然在场缺位。
  - 此非代码或环境回归，属于预期的在途中间态，在 T6④ 落笔后将完全消解。
  - D6 决策：底层 check/test/invariants 完全洁净（check 8/8、test 13/13 全绿），T1 将在 ADR-0095 中正式固化 D6 分级落地（ship-gate 升 blocking 于本轮 T7 首秀；check/test 维持 advisory 反馈环）。

## 3. Grill 期事实底账证据化归档

本节对 R94 开庭前已实证事实进行法定归档（开庭五面取证直接引用，不再重跑/重查）：

1. **|ΔarmHostHit| 两读数序列事实**：
   - **R85（ADR-0086）**：读数为 indeterminate — instrument down。anysearch 臂 41/41 格 providersFailed，源于测试环境双重缺陷。
   - **R86（ADR-0087）**：同指纹 57 格 paired 40/41 装置失败 ∅ → matrix@2 终读 **direction-negative**（P=0.0378、净 −0.125、EL=0.297、rankDiff 中位 0），装置洁净度完全可信。
2. **重开条件出处澄清**：
   - 出自 ADR-0087 D4：在 R86 明确获得负读数后，registry 的 prefer-capable 条目才附带了「|ΔarmHostHit|≳0.4」具名重开条件。此为已知负读数下设立的未来反转高门槛，绝非「未曾测过」的待测项。
3. **atomcode 混淆纠偏**：
   - armHostHit 判据尺是活的（vertical-delta runner 对 live API 实测，代码 .scratch/grill-round-85/readout-delta.mjs + matrix@2 在案存续）；
   - 死亡的是 L3b/dsh 集成的 stream-json 枚举腿（model-request tools 枚举 3 轮 0 出现，结构性不可观测）——两者分属不同观察轴。枚举腿死亡作开庭语境证据，而非重开裁判尺。
4. **dsh 勘查目标与路径**：
   - 宿主版本：0.1.7-rc.2。
   - 勘查路径：`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` <!-- machine-local: 用户级 npm 全局安装目录为机外路径 @ 2026-09-30 -->
   - 勘查实物确认：包含 `lib/plugin-DkYIj96-.js`、`lib/profile-boot.js` 等已转译 JS 产物及 `lib/types`，作为 T2 勘查 stream-json 字段面的只读物证。

## 4. WORKFLOW.md 缺位声明（第十次独立复核）

本仓不存在 WORKFLOW.md。其 §4.2「版本控制外部承诺」自 ADR-0092 D3 判死起，已由 GitButler skill + 全局 but 协议完全等价覆盖。本轮经第十次独立复核，依然严格遵循 GitButler 分支隔离与提交协议。
