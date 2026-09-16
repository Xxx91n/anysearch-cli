# Round-64 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  r64-impl → rru T1 机制层 → syq T2 fixture 迁移 → rzs T3 证据+裁决 → pzn T4 ship-gate 锚点 → nsy T5 ADR-0065 → zun T5 README/CHANGELOG/索引 → (+T6 closure/report commit, capture date 2026-09-16)
  r64-grill → vzp docs(r64): grill 定稿（账本/任务书/词表）— untouched

## 已完成

- T1–T6 全落地。机制：runner 判定归一 `activeIds()`；`ANS_EVAL_EVIDENCE=1` 证据模式（EVIDENCE 四元组 / 仅隔离失败 exit0 / RETIRE_CANDIDATE）；`mustHitPaths`/`mustNotHitPaths` 页族层；schema 四字段+`schema_version:1`。
- Fixture：8 条路径漂移迁移 + g0008 降格单宿主 + g0010 并入路径簇（未改判 abstain——实测恢复 answer）；3 条 frozen-spec 字节级腿（g0001→2026-07-28 / g0005→2025-11-25 / g0010→2024-11-05）；migration 块+双 class 全配。
- 裁决：9 轮 evidence 复跑（flaky flip=0；g0005 一次瞬时 abstain），10 条全量 promoteEntry，账本清空，watch:true 标 g0001/4/5/6/9/10（g0010 审计窗口补标 F4）。
- 闸门：ship-gate §1n R64 锚点（exact≥2 frozen-only / paths≥1 / migration 块）9/9 步全绿。
- 文档：ADR-0065（含四成文义务+closure 回填）、README 页族条目、CHANGELOG、ADR 索引 65 条。
- 验证：check 干净；store test 62 文件全绿；ship-gate 9/9；test:online eval-looks 69/0 + semantic 4/0（Windows 本机）。

## 绿色 run URL（必填）

PENDING — stack unpushed。本地自证可复跑：
- `pnpm -C packages/store check`（tsc clean）
- `pnpm -C packages/store test`（62 文件全绿）
- `node scripts/ship-gate.mjs`（9/9 步全绿）
- `pnpm -C packages/store test:online`（eval-looks 69/0 + semantic 4/0）

## 下一轮候选

- push r64-impl + 走 CI（ubuntu+windows ship-gate 双绿 corroboration URL 回填 ADR-0065 gaps 行）。
- watch 观测期：g0001/4/5/6/9/10 任一 CI 翻转 → 走既有 TTL 通道重入隔离（同 baseline id 合法，renewals=0）。
- npm 0.0.4 发布议题（含 OIDC trusted publishing——本轮明确不并入）。
- 英文双宿主新案例 harvest（账本独立任务，未在本轮范围）。

## Known risks / deferred

- 字节级腿靠 provider 对冻结快照的覆盖率，覆盖会轮换（本轮实测：2025-06-18 腿 run-03..06 缺席后重锚）——watch 回路是设计内承险机制。
- g0005 run-07 出现过一次瞬时 abstain（verdict 翻转）——已标 watch:true。
- evidence 模式不可在 node --test 下跑全量隔离（180s 文件超时）——证据复跑用 `node --import tsx` 直跑（runner 注释已写）。
- `.scratch/grill-round-64/evidence/` 已提交为可复跑证据；`evidence.log` 追加语义依赖时间戳比较（run-02 起 post-migration）。
- 建议 skills：$implement（后续票）、$handoff（收口）、atomcode-research（调研）、gitbutler（版本控制——写操作一律 but，禁 git write）。
