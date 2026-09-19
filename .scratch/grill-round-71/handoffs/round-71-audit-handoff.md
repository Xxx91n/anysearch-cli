# Round-71 审计交接 — 上架首航（0.0.6）审计收口

Stack：审计件落 `r71-audit` 分支（GitButler，与实施栈 `r71-grill` 及他栈并行互不写）；审计基准 `448b5f91`→`c6f39b9e`（main tip `c4ced36a`，tag `v0.0.6`=`6c289397`）。

## 审计结论

实施报告全部关键声明经亲跑/独立实证成立：**硬验收 8/8 复现**（build 4/4、store 62、plugin 10、ship-gate 58×pass 含 1i/9 path-lint 228 docs clean、install-smoke 28/28 含 pnpm-layout 腿、registry 0.0.6 ×4、tag 绑定）；**3 条 run URL 经 `gh run view` 独立实证**（35387286412 success@6c289397 / 35386495456 success / 35385345425 failure=门缺陷红证）；**D-001~D-004 全落地**，deferred 范围零触碰。

**F1 — 已修复**（裁决：本窗口修；commit `yut` on `r71-audit`）：`tryImport` 逐候选 guard——resolve-ok+import-fail 归 absent 不抛，不污染 `modPromise`、不中止其余锚点；测试 5b 补「resolved-but-broken」两用例，断言 16→18。**F2-F6 随票同修**（doctor pnpm 行 / config marker 接线 / globOk fail-closed / cosmetic 组）。修后同套验收全绿：store 62/0 fail（arm 18/18）、build 4/4、install-smoke 28/28、ship-gate green exit 0（1i 230 docs clean）。详见审计报告 §8。

## 次级发现处置

- F2/F4/F5/F6：**已随 F1 同票修复**（commit `yut`，明细见审计报告 §8）。
- F3（留档未修）：`inRepo()` 机器相对——他机绝对库内引用归 out-of-repo，弱化 in-repo 强制；固有缘，建议 ADR-0072 Consequences 注记或下轮议题。

## 绿色 run URL（必填）

LANDED @ 2026-09-19（R73 T0）— `r71-audit` 栈（vxs 审计件 + yut F1-F6 修复件 + tkv 修复补记）经 `but land` 直落 main（线性史，tip `3028a4a9`）。绿 run：ci `35448195039` success / ship-gate `35448195038` success / native-smoke `35448195040` success。run URL：https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195039 · https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195038 · https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195040（`gh run list --branch main` 实证）。落地间隙本地门证：`pnpm install --frozen-lockfile`+`turbo check`+`turbo test`+`ship-gate --quick` 全绿。

## 锚点（内容不重复）

- 审计报告：`.scratch/grill-round-71/reports/2026-09-19-audit.md`（声明→证据→结论全表 + D-001~D-004 对账 + 双轴评审汇总 + 过程呈报）
- 实施报告：`.scratch/grill-round-71/reports/2026-09-19-report.md`；实施 closeout：`.scratch/grill-round-71/handoffs/round-71-closeout.md`
- 账本：`.scratch/grill-round-71/decision-ledger.md`；ADR：`docs/adr/0072-architecture-grill-round-71-first-release-path-governance-embedding-reachability.md`

## 下一个 grill 方向指示

1. F1-F6 修复的 landed 决策：`r71-audit` 栈（vxs 审计件 + yut 修复件）并入 main；0.0.6 已发布，F1 修复是否随 0.0.7 patch 走 release 流程由当轮裁。
2. ship-gate 1g 门槛覆盖缺口（`defer-r71-shipgate-1g-coverage`，R70 首推已连续两轮 deferred）。
3. macos-spillover-probe EXPERIMENT 红因追查（账本 sha 上仍 failure，门外件）。
4. transformers 上游 undeclared-dep 跟进（上游修复版发布后撤 scoped patch，ADR-0072 挂起条件）。
5. F3 留档：`inRepo()` 机器相对固有缘 ADR 注记；release-gate temp ref 生命周期 + look 计数语义。

## Suggested skills

- $implement + $tdd（F1 修复——先写「resolved-but-broken sibling」红测再修）
- $diagnosing-bugs（macos-spillover-probe 红因）
- $code-review（F1 修复后复审）
- $handoff（下轮收口沿用模板）
