# Round-73 审计交接 — dsh 上游依赖族钉版 + 顺序合流 + 0.0.7 发布审计收口

Stack：审计件落 `r73-audit` 分支（GitButler，与已合 main 的各栈平行互不写）；审计基准 `5943d750`（r73-grill 定稿 commit，直下即合流后 main `5f16c8e3`）→ `b16de7a3`（现 origin/main tip @ 2026-09-19）；diff = T0~T4 全部 13 个实施 commit。

## 审计结论

实施报告全部关键声明经亲跑/独立实证成立：**硬验收 8/8 项复现**（`pnpm install --frozen-lockfile` 855ms 绿、`turbo check` 8/8、`turbo test` 13/13、`ship-gate --quick` **60 pass / 0 fail**、cli build+pack 产 `anysearch-cli-cli-0.0.7.tgz` 实物、`ans --version`=0.0.7、`doctor` 25/0/0、工作区净）；**git 证据链**（v0.0.7→dbe52e7c、10 引用 SHA 全存在、因果序正确、零 merge commit、origin/r71-grill 已并入）全坐实；**远端**（r71/r72/r73-grill/bump/T4 五组绿 run 全 success、release post-tag `35453100400` success、pre-tag `35452475915` cancelled 与披露一致、npm 四包 0.0.7）全坐实；**D-001~D-007 全落地**；红线全守（dependencies:{} 字面 / private:true / `agent/session-start` 未迁 / 清理候选只列不删 / 无 PR 道 / 续债原名未动）。

**裁决：通过（PASS，附次级发现）**——次级发现 F1-F5（详见审计报告 §5），处置选项已呈报用户裁决：F1 ADR-0074 缺任务书明文 `## Closure evidence` 段（证据内容已分布于 Decision D1-D5+报告四段）；F2 deferred id 偏离任务书预定名（`defer-r73-dsh-016-adoption`→实装 `defer-r73-dsh-event-rename`）；F3 `pnpm-workspace.yaml:44` 注释方向词反（"下方"应为上方）；F4 `goal.md:3` 状态滞留"等 T0 开工令"；F5 cosmetic 组（run URL 无分隔、CHANGELOG 缺 Deferred 小节+双空行）。

## 绿色 run URL（必填）

LANDED @ 2026-09-20 — `r73-audit` 栈（`227e8b5e` 审计件 + `d8090887` F1-F5 修复件）经 `but land` 直落 main（线性史，落地 tip `d8090887`）。绿 run：ci `35483715645` success · ship-gate `35483715664` success · native-smoke `35483715643` success。run URL：https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715645 · https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715664 · https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715643（`gh run list --branch main` 实证）。落地前本地门证：`node scripts/ship-gate.mjs --quick` 60 pass / 0 fail / exit 0。

## 锚点（内容不重复）

- 审计报告：`.scratch/grill-round-73/reports/2026-09-19-audit.md`（硬验收表 + 声明→证据→结论全表 + D-001~D-007 对账 + 双轴评审 + 过程呈报 P1-P5 + 裁决）
- 实施报告：`.scratch/grill-round-73/reports/2026-09-19-report.md`；实施 closeout：`handoffs/round-73-closeout.md`；任务书：`handoffs/next-round.md`；goal：`goal.md`
- 账本：`.scratch/grill-round-73/decision-ledger.md`（D-001~D-007 current）；升级账本：`.scratch/grill-round-73/upgrade-ledger.md`；ADR：`docs/adr/0074-architecture-grill-round-73-dsh-upstream-family-pinning-and-stack-landing.md`
- 证据：`.scratch/grill-round-73/evidence/t0-*.log|txt|md`、`t1-pinning.md`、`t2-alpha2-rehearsal.log`

## 下一个 grill 方向指示

1. **F1-F5 次级发现处置**（用户裁决挂起中）：选项 A=下轮 due-chore 打包（F1 ADR 补 Closure evidence 具名段或销项追认；F2 id 统一 `defer-r73-dsh-event-rename` 为准或回改；F3-F5 顺手修）；选项 B=打回实施窗返工后重跑同套验收。
2. **上游 0.1.6-rc.1/stable 哨戒**：出线即按 `.scratch/grill-round-73/upgrade-ledger.md` 跑预演（catalog 指新版→install→tsc）；采纳决策走 `defer-r73-dsh-event-rename`（session-start→created 迁移 + fresh-only source-guard）；采纳时 overrides 枚举按新锁文件重推导（家族已 15→17）。
3. **`origin/r71-grill` 删除候选**：待用户确认（merge-base 实证已并入 main；本审计复核一致）。
4. **R72 续债**：`defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix`。
5. **R71 续债**：`defer-r71-shipgate-1g-coverage`（连续多轮）/ `defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside`。
6. **`r73-audit` 栈落地决策**：本审计件 2 commits 待合流裁决（含 PENDING 回填义务）。

## Suggested skills

- $implement + $tdd（F1-F5 due-chore 或事件名迁移采纳——升级演练 transcript 作红绿对模板）
- $code-review（任何修复落地后复审）
- $diagnosing-bugs（上游升级 diff 异常）
- $atomcode-research（0.1.6-rc.1 changelog 对账调研）
- gitbutler（`but` 全操作——含 `r73-audit` 栈落地）
- $handoff（下轮收口沿用本模板：Stack 行 + SHA 捕获日期 + 绿色 run URL/PENDING 明示）
