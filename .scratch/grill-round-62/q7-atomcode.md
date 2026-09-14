# atomcode 深调研 — Q7 ship-gate.yml macOS 车道处置（F-16）

> atomcode · 2026-09-14 · grill-round-62
> Sufficiency Gate：searches 6（web_search×3 + tavily×2 + anysearch×1）；angles 五类全；full reads 6（onnxruntime #24579、PR #26445、better-sqlite3 #1514、costops matrix-explosion、minware quarantine、pytest xfail）+ 本地实物
> gaps: ① F-16 半日探测原始日志不在本轮可读范围（采信 ADR-0059 文本自述）；② explicit-close 对 macOS 连带效果仅机理推断无实测先例（正是 B 要买的答案）

## 1) 执行摘要（Tl;dr）

**推荐 B（有界连带验证）——这是账本自己的逻辑推导出的答案**：在 D-003 的 explicit-close 票内追加 macOS 探针臂（macos-latest 腿只跑 F-16 崩溃复现脚本 + continue-on-error 非阻塞 + 显式实验标注 + 预注册判据 + TTL）。转绿则按 ADR-0059 D4 ③④ 恢复三 OS 真绿；不绿则无条件回落 A（剪矩阵 + H3 台账 + README 照实）。全程不重开五闸探测链（否决 C），也不用"永久红+台账"拖延一小时内可验证的因果实验（否决直接 A）。Confidence：高。与全部 current 账本零冲突；唯需钉死 continue-on-error 写法以不越"工作流级静默跳过"红线。

## 2) 对比矩阵

| 项 | F-16 消除速度 | 与 current 账本关系 | 失败时落点 | 主要风险 |
|---|---|---|---|---|
| A 剪枝对齐 | 立即消红（崩溃仍在只是不观测） | 与 ci.yml ponytail、ADR-0059 终态一致；但弱化 D-003 "≥5次零崩溃"验收的 OS 覆盖 | 无失败分支 | 账本所有"三 OS"措辞（D-003、ADR-0020 D1）与实物漂移需逐条 errata |
| **B 有界连带验证（推荐）** | 连带命中则本轮真绿；未命中同 A | 完全内嵌 D-003 票 + ADR-0059 D4 ③④⑤ 既定路径，零新闸 | 无条件回落 A（D4 ⑤ 终态） | continue-on-error 写法不当触碰静默跳过红线；约 10-15min/跑 macOS 成本 |
| C 重开五闸全链 | 同 B 或更慢 | 违反 ADR-0059 D4 ①"半日探测已执行完毕"与 R62 主题定界 | 重复已做完的①②③ | 烧半日做已证伪的事，违反 Scope Discipline |

## 3) 分点结论与证据

### 3.1 F-16 上游根因图景已完整，"同族病"被外部证据强化

- onnxruntime #24579（官方 issue 已读原文）："mutex issue at process exit on MacOS since v1.21.*"——症状逐字吻合 F-16 的 libc++abi mutex lock failed，发生在推理结束/析构/退出阶段，arm64+x86、macOS 12/13 全挂，确定性复现。
- 官方修复链已闭合：PR #26445（2025-10-31 合入，把 Meyers Singleton 静态 mutex 改静态类成员防异常退出时 OrtEnv 析构触发已销毁 mutex）声明 Fixes #24579；livekit/agents-js PR #1377（2026-05 合并）实证 "bump onnxruntime-node to 1.24.3 to fix libc++abi mutex abort"——与 ADR-0059 D4 ③ 预注册 ">=1.24.1 必要例外" 精确一致。第三方项目 eric-cielo/moflo#613 有一模一样的 consumer-install smoke CI 场景。
- better-sqlite3 #1476（2026-05 开/07 关）佐证同一原生库退出期崩溃跨 OS 同族。
- 推论：F-16 大概率 = "store 从未显式 close → 进程退出时 onnxruntime/better-sqlite3 静态 mutex 在析构序里被撞"。

### 3.2 新风险闸：better-sqlite3 13.x 对 Node 22 的 darwin-arm64 segfault

- better-sqlite3 #1514（2026-08-13 开仍 Open 已读原文）：v13.0.3 在 Node 20/22 darwin-arm64 上 new Database() 注册期 segfault（exit 139），prebuild 与源码编译都复现；评论收敛：Node v22.14.0 前的老 22.x 注册期崩，升 v22.23.2 消失；win32-x64 同崩。
- 对 B 的直接含义：若本仓 better-sqlite3 已升 13.x 且 CI Node 22 < 22.14.0，探针臂可能在 D-003 修复生效前因注册期崩溃报红，污染读数。探针必须区分"注册期 segfault（exit 139）"与"退出期 mutex abort（libc++abi/F-16 族）"两种签名。

### 3.3 工业界"矩阵剪枝 vs 保留"心智模型：两边都支持 A 的方向，但带一个 B 正好满足的前提

- costops matrix-explosion（已读原文）：维度去留判据 = "是否还在产出独有失败信号"；macOS 按 $0.062/min 是 Linux 10 倍；但判据表 OS 行 Keep 条件恰是 "ship native binaries or OS-specific APIs"——anysearch-cli 分发 better-sqlite3/onnxruntime 原生 prebuild 属临界情形。
- nowifi PR #60 先例：PR 矩阵剪 mac + release 交叉编译兜底 + "Reversible in one line"，与 ci.yml ponytail 同构。
- 综合：工业共识 = "先剪、留恢复条件、条件触发时加回"。B 的探针臂把恢复条件从"等用户报告"（被动）升级为"每次 CI 顺带自测"（主动零边际人力）——严格改进而非背离。

### 3.4 known-issue 台账治理：H3 形态已是工业最优，B 不破坏它，但一红线要钉死

- H3（ADR-0057 D2 expectations-inventory 模型：Chromium/WebKit TestExpectations、WPT metadata、pytest strict_xfail 同族）逐条对上外部最佳实践：minware quarantine 指南三 gotcha（坟场化/隐藏耗时/必须 tracked item+owner）H3 全内置；pytest xfail strict "xpass 即自动揭榜"对应 TTL 复评转绿摘牌。
- **关键红线**：ADR-0059 明文 no workflow-level silent skip。continue-on-error 探针臂必须三件套不越线：① 步骤名/注释写明 experiment: F-16 D-003 spillover probe, non-blocking；② 崩溃签名进 job summary/artifact 而非只进日志；③ 带 TTL——D-003 修复合入后下一复评点要么转正要么摘除回落 A，禁无限期挂着（对齐 ADR-0027 D8）。备选 workflow_dispatch 手动 job 失去每次 push 顺带采样的免费复评价值，首选前者。

### 3.5 为什么不是 A 直接剪 / 不是 C 重开五闸

- 非 A：D-003 修复本周就要写，验证成本只是矩阵多一条腿——先剪再等是放弃免费答案；且 A 有隐藏账本成本：D-003 验收条款与 ADR-0020 D1 的"三 OS"措辞全要逐条 errata，B 成功时这些不用动。
- 非 C：五闸链按 ADR-0059 已全部走过到 ⑤，审计已接终态；重开 = 用半日重做已证伪的探测，违反 ADR-0029 Scope Discipline 与本轮定界。B 显式不是 C：B 不探测（探测已做完，结论是上游 1.24.x 才有修复），只验证 D-003 修复的连带效果——新变量（我们代码里从未有过的 close 路径），不重开旧闸。

## 4) 推荐方案执行形态（fixer 票落点）

1. ship-gate.yml：macos 腿整体 continue-on-error: true，步骤收敛为最小探针（install + build + 只跑 eval-gate/abstain 复现路径，非全量 9 步），job 名显式 "experiment (F-16 spillover probe, non-blocking)"；crash 签名（libc++abi vs SIGSEGV exit 139）进 step summary 区分两个上游问题。
2. 预注册判据（写进票验收，对齐 ADR-0027 D8）：D-003 explicit-close 合入后探针臂连跑 ≥5 次全绿 → 摘 continue-on-error、探针升全量矩阵腿、三 OS 真绿，同时按 ADR-0059 D4 ③ 评估是否仍需 onnxruntime ≥1.24.1 例外（1.24.3 实证版本）；探针仍崩 → 摘除探针腿、执行 A（剪 ubuntu+windows）、H3 台账 defer-f16-macos-native-crash 续期并附探针实验证据（"explicit-close 不清除 macOS 崩溃"成为新的已验证事实，比台账现有推测强一档）。
3. 无论哪个分支：README Known Limitations 与 D-003 无条件文档动作（审计 "exit code 不受影响" 错误定性改正）同票落地。
4. 明确不做：不动 better-sqlite3 pin（D-002 约束）、不引入新 npm 依赖、不在探针臂做任何 onnxruntime 升级实验（那是 D4 ③ 闸，只在探针转绿后作为恢复腿一部分评估）。

## 5) 完整来源清单

| # | 标题 | 来源 | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | onnxruntime #24579 mutex at process exit on MacOS | github.com/microsoft/onnxruntime | Official | F-16 症状逐字吻合 |
| 2 | onnxruntime PR #26445 fix logging mutex crash | 同上 | Official | 官方修复=禁异常退出 OrtEnv 析构 |
| 3 | livekit/agents-js PR #1377 bump onnxruntime-node 1.24.3 | 经 #2 关联区 | Official/Currency | 实证修复版本 |
| 4 | better-sqlite3 #1514 v13.0.3 segfaults Node20/22 darwin-arm64 | github.com/WiseLibs | Official/Criticism | 探针签名区分依据 |
| 5 | better-sqlite3 #1476 segfault on worker exit | 同上 | Official | 跨 OS 同族佐证 |
| 6 | costops.dev matrix-explosion | costops.dev | Comparative | 维度去留判据、macOS 10x 计费、剪枝+恢复条件 |
| 7 | nowifi PR #60 实例 | — | Community | 剪 PR 腿+release 兜底+reversible 先例 |
| 8 | minware quarantine 指南 / pytest xfail strict | — | Criticism/Official | H3 台账工业对齐验证 |
| 本地 | decision-ledger r61/r62、ADR-0020/0027/0057/0059/0060、ci.yml、ship-gate.yml | — | 实物 | 冲突判定与缝位 |

## 6) 信息缺口

1. F-16 探测原始日志不在本轮可读范围，onnxruntime 归因采信 ADR-0059 自述——探针若发现签名与 #24579 不符需回头重查。
2. explicit-close 对 macOS 连带效果无实测先例（先验推断）——B 的价值即把推断变廉价实验；失败也反哺 H3 台账证据等级。
3. 本仓 better-sqlite3 当前 pin 与 CI Node 22 小版本未在本轮读取——探针臂先 node -v + new Database(:memory:) 冒烟排除 #1514 干扰。
4. D-003 备选手法（exitCode+drain+unref）与 explicit-close 对 macOS 效果等价性无外部数据——票内实现细节，以探针实测为准。

## 账本冲突声明

与 R62 D-001~D-006、R61 D-001~D-005、ADR-0059/0060/0062 全部 current 决策核对：**零冲突**。B 是 D-003 验收动作的超集（同一票同一修复多一条 OS 观测腿），失败分支精确落回 ADR-0059 D4 ⑤ 既定终态。
