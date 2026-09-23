# Round-79 → round-80 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-23):
  r79-impl → rmm (f3e303dc) → skq (01d6c309) → ylk (f8fca555) → lxs (60051a41) → sql (1c2206da)
  r79-audit → run (794580c5) 叠于 r79-impl 之上（审计报告 `.scratch/grill-round-79/handoffs/round-79-audit.md`）

## 已完成

- T0 ride-along：dsh 0.1.7-alpha.2 L0/L1 取证三件（evidence/t0-*）→ 特征锚在位、alpha 线非 L2 候选、action=none required；依赖面零脏。
- T1 契约批：c1 `/x` surfaced-skip 移序（所有 fence+locator 行静默）、c2 WORD_CHAR 补 `_`（标识符粘连盘符不误报）、c3 ADR-0072 amendment+AGENTS.md 镜像+机器断言；红向实录 t1-c1/c2-red.md。
- T2 文书：ADR-0080 六要素+index+registry（11 债 carried_log r79+E6→R80 候选）+CHANGELOG+CONTEXT（七词随 grill 已在位）。
- 度量单行：`exemption-domains=3; red-green-pairs=2; baseline=333 docs/0 violations`。判据↔证据映射表见 reports/2026-09-23-report.md。

## 绿色 run URL（必填）

- 本地腿：`pnpm install` Already-up-to-date / `pnpm run check` 8/8 / `pnpm run test` 13/13（返修前；审计实录 store:test 红于 adr-index → 已修）/ `ship-gate --skip-matrix` / pathlint 直跑 333 docs·0 violations / CLI 0.0.7 + doctor 23-0-2。
- CI run URL：**PENDING — stack unpushed**（r79-impl/r79-audit 未推送；推栈后补录 ci + ship-gate 两腿 run URL）。

## 下一轮候选（序）

1. **R80 lockfile 执法轮**（`defer-r79-lockfile-agegate-replay`，open）：钉版 pnpm 11.24.0 实测 `trustLockfile` 验证腿是否天然覆盖 minimumReleaseAge 拦截 → 自建护栏/引用上游/显式记档三选一。
2. **dsh 上游观测哨续班**（`defer-r73-dsh-event-rename`）：rc.3/alpha.1 已 ≈2026-09-24 05:39/06:04Z 出闸，R80 首轮 npm view 复检出闸态；L2 候选等待=双锚（特征锚+稳定锚）同响才彩排。
3. 其余 10 open 债按惯例域外显式续债。

## Known risks / deferred + watch items

- `#1764` 哨：transformers.js 上游 knip PR OPEN（2026-09-03 起无更新，20 天趋僵）——merge 且发布版携 `onnxruntime-common` 声明才关 `defer-r71-transformers-undeclared-dep`；用户动作项（评论 draft）不动。
- **外发闸**：两份 draft 仍用户亲手发（`.scratch/grill-round-75/drafts/`）——用户动作项续挂，代理不代发。
- 残余盲区承继：多段未知根 POSIX 路径（`/d/`、`/c/` 盘符形）不报、`/x` 仅单段 info（R78 记档，本轮未扩域）。
- c2→c3 中间态瞬红（ledger marker 清剿落在 c3）——逐 commit bisect 注意；WORKFLOW.md §4.2 缺位第七次核销。

## Suggested skills

`$implement`（票流执行）、`$atomcode-research`（E6 上游语义调研）、`$but`（全部版本控制写；新 impl 栈须 `but move --above` 显式叠栈）、`$handoff`（收口）；模型可触达 tdd/diagnosing-bugs/code-review。
