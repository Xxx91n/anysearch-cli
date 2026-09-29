# R89 常驻任务书 — dsh 上游线轮（dsh-upstream-line）

> 数据源：.scratch/grill-round-89/decision-ledger.md（D-001~D-003 全 current）+ goal.md。任何与本任务书冲突的口头指令以账本为准；账本未载的结论不许补进文档。

## 轮主题

上游 dsh 0.2.0-rc.1 首目击（2026-09-28T12:14Z，dist-tag next）触发的信号型轮：正题=breaking-surface 调研+repin 时机裁决（调研件交付：L1 transcript+迁移面 diff+时机判词），同域纳编 r72 两票只定形不实现。基座=main tip（R88 land 后），工作区须净起手。

## 开工纪律（三件套）

动工前先复述：①必读清单（账本+goal.md+本任务书+R77 upgrade-ledger v2）②涉及 D-xxx ③本票验收标准。

## 票序（七票；一票一 commit；条件票判词驱动）

### T0 哨戒续班+基线快照 —— 覆盖 D-003
- dsh 0.2.0-rc.x watch 续班：npm view @deepseek-ai/dsh-* dist-tags/versions/publish-time 再观测（0.2.0-rc.1 是否仍在架/是否递增 rc.N/是否晋升 stable）+CI 三跑观测。
- 基线快照：pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 当前态记录于 reports/baseline-*.md。
- 验收：快照落档，绿/红现状如实记。

### T1 L1 探针跑批 —— 覆盖 D-001/D-002
- npm pack 0.2.0-rc.1 全族 tarball（20×dsh-*+cordis）→.d.ts **消费子集** diff vs 0.1.7-rc.1 基线快照（消费子集=ctx.on(agent/created) payload {agent,source,signal?}+tools/pre-execute|post-execute|result+ctx.systemPrompt.section+inject=['tools','systemPrompt']，基线参照 .scratch/grill-round-77/evidence/t0-api-snapshot-rc2.json 形态+R83 0.1.7-rc.1 实装态）。
- 拉力锚具名 API 扫描：r72 票面点名的面——工具注册面（ctx.tools/原生注册 API）+web 交互面（patchReload:live/approval-channel/browser-turn 相关表面）在候选 .d.ts 中是否出现且签名稳定。
- dep-closure 家族包数变化记录（R83 实装=20 dsh-*+cordis 4.0.4）。
- transcript+snapshot 落 evidence/（命名随 R77 惯例 t0-l1-0.2.0-rc.1.md 类）。
- commit type=chore/docs（evidence）。验收：transcript 落档+三锚证据齐（兼容真值/拉力扫描/closure）+缺口如实记。

### T2 repin 时机判词 —— 覆盖 D-002
- 按 D-002 三锚真值表出判词：拉力∧兼容→repin-now；兼容∧零拉力→soak-until-stable；兼容破坏→hold。无第三态。
- 判词含：收口义务条款（repin-now 后 stable 晋升时再验一次收口探针封账，不跟 rc.N）+rc→rc 跨 minor 类推非先例标注+changelog 缺口记档。
- 记档于 upgrade-ledger v3（.scratch/grill-round-89/upgrade-ledger.md，承 R77 v2 格式）。
- commit type=docs。验收：判词依真值表机械产出+三锚证据引用齐备。

### T3 repin 执行条件票 —— 覆盖 D-002/D-003（仅当 T2 判词=repin-now 才启）
- repin：pnpm-workspace.yaml catalog 20×dsh-*+overrides→0.2.0-rc.1（cordis 若上游同跳则随族，否则保 4.0.4 并注明）；L2 安装彩排（install→tsc expected-RED 判据）；必要代码迁移；pnpm -r check/test 回归绿。
- commit type=fix。判词≠repin-now→本票不启不留痕。同票连续 2 轮 LOOP 失败→熔断回退挂回 registry+缩轮呈报。

### T4 r72 两票定形 —— 覆盖 D-001
- defer-r72-dsh-native-tools：解法案（ctx.tools 原生注册落点/五 ans_* 工具映射/绕过 mcp__anysearch_ 桥）+落点包+依赖解除状态（触发器「工具注册 API 上游稳定化」是否已响）写明。
- defer-r72-dsh-web-interactive-matrix：解法案（browser-driven turn/patchReload:live/approval-channel 面）+依赖解除状态写明。
- 定形=设计记录，**不实现**；若轮内裁为提前实现须先过 L2 安装彩排 expected-RED 闸再单开票。
- commit type=docs。验收：两票各含解法案+落点+依赖状态段。

### T5 收口件批（单 docs commit） —— 覆盖 全条
- docs/adr/0090-*.md（三锚判词+真值表+收口义务+类推标注+条件票制+r72 定形去向）+CONTEXT 词块已备+registry r72 两票状态更新（依判词：解除/维持 defer 并注明依赖状态）+closeout-claims+本任务书终态戳+evidence 终归档。

### T6 门禁+审计 LOOP —— 覆盖 D-003
- pnpm -r check / test / node scripts/ship-gate.mjs --quick 全绿+惯例审计复核+轮报落档。

## 跨票闸（全程生效）

- **新债闸（承继 R84 D-007 显式接线）**：非预期发现→三向失真判据分流（失真→并入主票/同文件→复核行/无关→清障轮登记）；发现者无权就地扩票。
- **判据冻结（D-002）**：三锚真值表先于 L1 探针立法；探针结果只得填真值不得改判据；改判据=新 D-xxx 呈报。
- **熔断（承继 R88 D-005③）**：同票连续 2 轮 LOOP 修复失败→回退该票 commit+挂回 registry+缩轮呈报。
- **commit 纪律（承继 R88 D-004）**：一票一 commit；T3 条件票=fix、evidence=chore/docs、文书=docs；不混型。

## 显式范围外

评测面/垂域重议/上游触发债/常驻债×5/0.1.0 钉版动包/外发动作（无 tag/publish/push）/观察项就地扩票/r72 实现直改。

## 汇报纪律

每票毕即报：做了什么+门禁结果+账本是否需要注记；T2 判词、T3 启停、熔断/新债/豁免情形当场回呈用户裁决，不静默吞。

## Suggested skills

- 施工：$implement（T3 若启走 L2 彩排+tdd at seams）。
- 文档：$domain-modeling（ADR-0090 落成时校对词表）。
- 审计/收口：$code-review（收口前双轴复核）+ neat-freak（T5 一致性核对）。
- 版本控制：$but（全程，一票一 commit）。
- 调研（若施工中遇意外复杂面）：$atomcode-research。

---

## 终态戳（R89 执行完毕回填）

（待 T0–T6 执行后回填）