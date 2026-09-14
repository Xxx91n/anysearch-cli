# 深调研报告：OFFLINE_EXCLUDED_GROUPS 排除面是否需要整体缺席上限哨兵

> atomcode q5b · 2026-09-14 · grill-round-62 Q5′（Kayenta 式 NODATA 哨兵取舍）
> Sufficiency：searches 6（三引擎各≥1）；angles 五类；full reads 6+；本地实物全读（golden-cases/runner/cli/skip-ledger/ship-gate.mjs+yml/ci.yml/eval-gate.test.ts）

## 1) 执行摘要

**推荐：不加整体缺席上限哨兵（gate-红形态），但补一条零运行时的静态断言钉住 `OFFLINE_EXCLUDED_GROUPS` 常量与离线覆盖率下界。** Confidence：高。

理由三句话：(a) "无声扩大"威胁模型真实存在，但 B 案前提与实物不符——ship-gate 目前**并没有**静态断言钉住该常量（`grep OFFLINE_EXCLUDED_GROUPS scripts/` 27 文件零命中），"靠现状护栏"是错觉；(b) Kayenta 50% NODATA 哨兵治的是**运行时数据缺失占比漂移**，本仓库排除面是**编译期声明常量 + PR review 变更**，时态与治理通道不同——运行时它永远是精确的已知组，哨兵没有可感知对象；(c) 排除面漂移的正确治理位置在 diff 层不在 runtime 层，一条 ship-gate 静态断言（存在性+白名单精确匹配+离线 case 占比下界）把"无声"变成"结构性不可能无声"，约 10 行 stdlib，与 stepDocClaims/stepEvidenceAnchors 断言家族完全同构。

## 2) 前提核验（关键发现）

- `grep OFFLINE_EXCLUDED_GROUPS scripts/`：**27 文件零命中**——题设"常量已被 ship-gate 静态断言钉住"不成立。ADR-0060 D7 的 anti-downgrade 条款目前只有 CI test-online job 一个运行时锚，无常量锚。
- 排除集内容恒为编译期已知（当前仅 `["semantic"]`）——运行时占比无漂移自由度，Kayenta 同构无对象。

## 3) 工业界先例：成熟心智模型对比

| 机制 | 治理通道 | 上限/纪律形态 | 与本裁决映射 |
|---|---|---|---|
| Kayenta 50% NODATA（WeightedSumScorer.scala:84-88 实物） | 运行时，判决内计算 | 缺席指标 ≥50% → score=0 | 排除集在判决时刻不可预知才有运行时兜底必要；本仓排除集是编译期常量 |
| Chromium TestExpectations（已读原文） | 静态 diff + lint | 不设数量配额；lint 强制 crbug 链接+标签、stale 归档、优先 rebaseline | **最同构先例**：排除是文件内声明常量，治理靠 lint/断言钉形状 |
| pytest skip/xfail（已读原文） | 声明式 reason + 报告分列 | 无配额；strict 模式拒未知 marker | 启示是锚定机制本身（strict marker），不是数量 |
| Datadog Flaky Policies（已读原文） | 平台策略 | TTL 上限：quarantine 30 天自动升级 disable | 治滞留时长非占比；对应本仓 eval-quarantine TTL |
| Spinnaker #6275 | Criticism | 50% 规则误伤实证（合法 Nodata 组合致 canary 永红） | 运行时哨兵的误伤代价 |
| coverage.py exclude_lines | Official | 集中声明+接管语义，无数量上限 | 同上：声明式排除不设配额 |

**关键否定性证据**：「声明式排除集合的规模配额」在主流生态未找到正面先例（Chromium/pytest/coverage.py 均显式不设数量上限）——若选运行时哨兵将是本仓自创机制，按 LYING/预注册纪律需更强论证负担。

## 4) 推荐方案（静态断言，进 ship-gate 既有 golden-cases 断言点，ship-gate.mjs:458-460 同构，stdlib-only）

1. **存在性断言**：golden-cases.ts 必须导出 `OFFLINE_EXCLUDED_GROUPS`（防改名静默移除排除机制）；
2. **白名单精确匹配**：断言该常量字面内容恰为 `["semantic"]`（或允许集=离线不可跑声明组白名单），任何扩容使断言红→强制 PR review 意识到自己在扩排除面——"无声→有声"最小实现；
3. **离线覆盖下界**：断言 `offlineCases().length / GOLDEN_CASES.length` ≥ 预注册下界（如 0.75），把"掏空门禁"变成可断言；
4. 可选升级（不阻塞）：ship-gate 断言 ci.yml 的 test-online job 存在且含 `test:online` 步——堵住"skippable required check"旁路面（真后门不在排除集，而在排除集声称的补偿覆盖无人跑）。

**为什么不加运行时哨兵**：分子分母都是 git 里两行代码，PR review 一眼可见，运行时再判是同一信息的冗余测量；且 runtime 哨兵会把 review 域决策塞进 runtime verdict（ADR-0042 已吃过"placeholder 扮演决策"的亏）。若未来排除面变成运行时可变（如按环境动态探测向量臂可用性），届时按 ADR-0042 D3 预注册纪律写带版本阈值表——今天不预支复杂度。

## 5) 与账本 current 决策的冲突检查

- R62 D-001~D-004：**零冲突**。四条均不触及 eval 排除面；静态断言属 D-001 主题既有 ship-gate 接线工作面，同轮 ADR 记一笔即可。
- R61 D-001~D-005：**零冲突且正向耦合**——D-003"锚结构化 verdict 字段"纪律在排除面上的延伸。
- 既有 ADR 族：**强一致**——ADR-0027 D8/D9、ADR-0042 D4、ADR-0043 D3、ADR-0060 D7 全存活；本推荐是给 ADR-0060 D7 已声明机制补上它自己许诺未兑现的防漂移锚。
- 与 eval-runner.test.ts:33「排除被记录」断言互补（一个测记录了，一个测集合没变）。
- **无需 revised 标记**：推荐修正的是 Q5′ 选项前提（A 的运行时哨兵错位 + B 的"已钉住"虚构），非账本记录。

## 6) 完整来源清单

| # | 来源 | 角度 | 贡献 |
|---|---|---|---|
| 1 | Spinnaker canary judge 官方文档（原文） | Official | Nodata/NodataFailMetric 二层、50% NODATA 语义 |
| 2 | Kayenta WeightedSumScorer.scala（原文） | Official 源码 | NODATA_THRESHOLD=50、tooManyNodata 实现实物 |
| 3 | Chromium web_test_expectations.md（原文） | Official | 期望文件治理：lint 强制 bug 链接、stale 归档、优先 rebaseline |
| 4 | pytest skipping 指南（原文） | Official | skip 语义、strict marker 防漂移 |
| 5 | coverage.py excluding（原文） | Official | exclude_lines 集中声明，无配额 |
| 6 | minware Flaky Test Quarantine（原文） | Comparative | quarantine graveyard 化/遮蔽回归/CI masking 症状清单 |
| 7 | Spinnaker issue #6275（原文） | Criticism | 50% 规则误伤实证 |
| 8 | Datadog Flaky Test Management（原文） | Currency | 30 天 TTL 自动升级——滞留治理非占比治理 |
| 9 | 知识库前会话（2026-09-14）：Argo/GitHub/emmer.dev/FirstMate | 复用 | Inconclusive 三态、skipped==success 侵蚀、deterministic-gate 分层 |
| 10 | 本地实物 | 一手 | 前提核验全表（含 ship-gate 无钉住断言的否定性发现） |

## 7) 信息缺口

- Kayenta 50% 数值阈值的第三方独立评论未找到（仅官方文档+源码，同属 Spinnaker 组织，已标注）；
- 「声明式排除集合规模配额」无主流先例——本身是支持不加运行时哨兵的证据，但意味着若加将是自创机制。
