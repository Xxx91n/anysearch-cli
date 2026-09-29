# Round 89 收口 — dsh 上游线轮（dsh-upstream-line）

Stack: r89-grill（GitButler 栈，未 land）→ main @ 846b2eb6

## 绿色 run URL（本轮祖先线上的实证）

- main tip CI 三跑观测（CI run id+结论载 reports/baseline-2026-09-29.md 散文；观测时点 2026-09-29T01:35Z）：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337984 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337659 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337504 success
- 本轮提交未外发（无 push/publish/tag——纪律内），本地门禁终态见 reports/2026-09-29-report.md

## 票序终态

| 票 | 结果 | 实证 |
|---|---|---|
| T0 哨戒+基线 | ✅ chore | evidence/t0-l0-watch.json（next=0.2.0-rc.1 全族 20/20 在架、无 rc.2/无 stable、cordis 未随跳、龄期≈802min）+ baseline-2026-09-29.md（check/test 绿、ship-gate 仅 freshness 红=预期中态） |
| T1 L1 探针 | ✅ chore | 41/41 tarball 取件；消费子集 6/6+字段级 12/12 normalized-IDENTICAL；Events 键面零增删；dep-closure 同集零 delta；非消费面 6 包附加/收窄实录；缺口记档（changelog 不可核验→tarball diff 自证、龄期未过、runtime 面在 L1 外） |
| T2 判词 | ✅ docs | **soak-until-stable**——兼容∧零拉力分支（upgrade-ledger v3）；判读差异呈报在案 |
| T3 repin | ⏭ 不启不留痕 | 判词≠repin-now（条件票制 D-003） |
| T4 r72 定形 | ✅ docs | r72-shaping.md：native-tools 解法案+落点+触发器实质已响（API 三代同形）；web-interactive-matrix 分项依赖（approval 解除 / patchReload+browser-turn 缺席维持） |
| T5 收口件批 | ✅ docs | ADR-0090+adr/index 行+CONTEXT（词块 rnz 已备）+registry r72 追记+closeout-claims 10 项+终态戳+CHANGELOG r89 段 |
| T6 门禁+审计 | 见轮报 | reports/2026-09-29-report.md 末节回填为准 |

## 已核验的关键事实

- 0.2.0-rc.1 相对 0.1.7-rc.1 消费面**零破坏漂移**——agent/created payload{agent,source,signal?}、tools 三事件签名、systemPrompt.section、inject 声明 normalized 逐字相等；session-start 旧键不复燃（Events 键面 0 增删）。
- 拉力锚零增量实证：ToolRuntime.register/restrict/defineTool 三代同形（0.1.5-rc.2 .pnpm 已装实例即含）；patchReload:live/browser-turn 0.1.7/0.2.0 双侧缺席；无安全/正确性修复证据在 .d.ts 面。
- 非消费面漂移实录（按 D-002 不计破坏）：dsh-workspace initializeDefault 回调返回收窄 {path,title}→string 为唯一收窄项，本仓未消费；其余皆为附加 export/可选字段。
- cordis 不随族跳线（4.0.4 仍 latest；next tag=4.0.1-rc.4 陈旧）——repin 若未来执行，cordis 保 4.0.4。

## 挂账（下轮/观察项）

- 再评估触发点：0.2.0 stable 晋升目击→latest-only 重跑 L1+判词封账（rc.N 不滚动跟随）。
- 龄期事实：0.2.0-rc.1 快照时点 ≈802min < 2880min 龄期闸——如实记，判词由拉力/兼容轴产出不受影响。
- r72 native-tools 触发器实质已响（三代同形）——解除与否依下轮/用户裁决，本轮仅定形+registry 追记。
- 拉力锚字面读法分歧呈报在案（upgrade-ledger v3 判读说明段）。

## 下一次 grill 方向（候选，未立项）

1. 0.2.0 stable 晋升时收口探针（latest-only 重跑 L1+判词）。
2. r72-native-tools 实施票（触发器已实质满足，若裁解除 defer 须先过 L2 安装彩排 expected-RED 闸）。
