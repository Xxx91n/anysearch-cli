# Round-71 审计交接 — 上架首航（0.0.6）审计收口

Stack：审计件落 `r71-audit` 分支（GitButler，与实施栈 `r71-grill` 及他栈并行互不写）；审计基准 `448b5f91`→`c6f39b9e`（main tip `c4ced36a`，tag `v0.0.6`=`6c289397`）。

## 审计结论

实施报告全部关键声明经亲跑/独立实证成立：**硬验收 8/8 复现**（build 4/4、store 62、plugin 10、ship-gate 58×pass 含 1i/9 path-lint 228 docs clean、install-smoke 28/28 含 pnpm-layout 腿、registry 0.0.6 ×4、tag 绑定）；**3 条 run URL 经 `gh run view` 独立实证**（35387286412 success@6c289397 / 35386495456 success / 35385345425 failure=门缺陷红证）；**D-001~D-004 全落地**，deferred 范围零触碰。

**未结项 1 件 — F1（must-fix 级）**：`packages/store/src/embedding-arm.ts:79,82` 姊妹根 fallback 两处 `await import()` 无保护——resolve 成功但 import 失败 → `modPromise` 永久缓存拒绝态 → `embedText`/`armTelemetry`/`embeddingModelId` 全周期抛错 → search(:614)/write(:740,757)/backfill(:845)/doctor(:796) 四路径无 catch 全炸，且中止其余锚点。违 fail-open 铁律（本文件头契约 + ADR-0033/0063 + CONTEXT.md）。测试 16 断言无「resolved-but-broken」用例。**不影响已发布件功能面**（install-smoke 实测 arm present；触发需 resolve-ok+import-fail 组合），但为合同违约。

处置待裁决（3 选项详见审计报告 §7）：返工窗口修 / 本窗口经批准后修 / 登记 deferred。最小修复=每候选 `try{…}catch{continue}` + 测试补该用例；重跑清单=`pnpm -C packages/store test` + `pnpm build` + `node scripts/install-smoke.mjs` + `node scripts/ship-gate.mjs --quick`。

## 次级发现（随 F1 一并或下轮）

- F2：`apps/cli/src/commands/doctor.ts:69` enable 指引仅 npm——补 `pnpm add -g` 行（断的正是 pnpm 臂）。
- F3：`inRepo()` 机器相对——他机绝对库内引用归 out-of-repo，弱化 in-repo 强制；建议 ADR-0072 Consequences 注记固有缘。
- F4：`ship-gate-pathlint.config.json` `marker` 字段死配（MARKER_OK/ANY 硬编码）——接线或删。
- F5：`globOk` 不支持 glob 形静默零扫——fail-closed 腿内建议 `fail()` 于不可解析 pattern。
- F6 cosmetic 组：口径漂移/fixture 版本/`evidence\` 反斜杠/尾换行/TOKEN_RE×3/createRequire×2。

## 锚点（内容不重复）

- 审计报告：`.scratch/grill-round-71/reports/2026-09-19-audit.md`（声明→证据→结论全表 + D-001~D-004 对账 + 双轴评审汇总 + 过程呈报）
- 实施报告：`.scratch/grill-round-71/reports/2026-09-19-report.md`；实施 closeout：`.scratch/grill-round-71/handoffs/round-71-closeout.md`
- 账本：`.scratch/grill-round-71/decision-ledger.md`；ADR：`docs/adr/0072-architecture-grill-round-71-first-release-path-governance-embedding-reachability.md`

## 下一个 grill 方向指示

1. **F1 处置**（本轮未结项，优先）；F2-F6 随票或清扫票。
2. ship-gate 1g 门槛覆盖缺口（`defer-r71-shipgate-1g-coverage`，R70 首推已连续两轮 deferred）。
3. macos-spillover-probe EXPERIMENT 红因追查（账本 sha 上仍 failure，门外件）。
4. transformers 上游 undeclared-dep 跟进（上游修复版发布后撤 scoped patch，ADR-0072 挂起条件）。
5. release-gate temp ref 生命周期 + look 计数语义（重试消耗是否计入预算审计）——发布后小活。

## Suggested skills

- $implement + $tdd（F1 修复——先写「resolved-but-broken sibling」红测再修）
- $diagnosing-bugs（macos-spillover-probe 红因）
- $code-review（F1 修复后复审）
- $handoff（下轮收口沿用模板）
