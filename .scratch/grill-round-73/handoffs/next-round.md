# Round-73 任务书 — 上游跟进与栈合流治理（T0–T4）

Stack：本任务书落 `r73-grill` 分支（GitButler）；实施栈 `r73` 自合并后 main 起栈（D-006）。数据源唯一：`.scratch/grill-round-73/decision-ledger.md`（D-001~D-007）。

## 前置语境（接手者必读实物）

- 审计交接：`.scratch/grill-round-72/handoffs/round-72-audit-handoff.md`（F7 原文 §8 行 + 6 条下轮指示）
- R72 账本：`.scratch/grill-round-72/decision-ledger.md`；R73 调研存档：`q2-atomcode.md`（钉版策略）、`q3-atomcode.md`（升级姿态）
- 升级演练 transcript 模板：`.scratch/grill-round-72/evidence/audit-r72-upgrade-diff.log`
- 现役钉版对象：`pnpm-workspace.yaml`（已有 overrides:zod / minimumReleaseAge:2880 / pmOnFail:error）+ `apps/dsh-plugin/package.json`（4 个 `^0.1.5-rc.2` devDeps + `^4.0.2` cordis；`dependencies:{}` 不可变）
- 环境：Node v24.11.0 · pnpm 11.24.0（pmOnFail:error）· dsh latest/next=0.1.5-rc.2、alpha=0.1.6-alpha.2

---

## T0 — 合流执行（覆盖 D-004、D-006、D-007-i）

顺序：`r71-audit`（vxs+yut+tkv）→ `r72-grill`（7 commits）→ `r72-audit`（2 commits，堆叠其上）→ `r73-grill`（本任务书文档栈，末位——机制性事实非新决策：本文件自身亦在合并面内）。

步骤：
1. 记录合流前态：`but status` 全栈快照存档。
2. 按序落栈（沿用先例=直落 main 线性史，非 PR 道；GitButler 操作以 gitbutler skill 为准——先读 skill 再动手）。
3. 每落一栈后本地验证：`pnpm install --frozen-lockfile` + `turbo check` + `turbo test` + `node scripts/ship-gate.mjs --quick` 全绿才落下一栈。
4. 全落完后 push `main`→origin；`gh run list --branch main` 取绿 run URL（ci+ship-gate 至少两腿）。
5. 回填 PENDING：`.scratch/grill-round-72/handoffs/round-72-audit-handoff.md` 与 `.scratch/grill-round-71/handoffs/round-71-audit-handoff.md` 的「绿色 run URL（必填）」PENDING→实证 URL。
6. 列合后遗留栈/分支清理候选清单（**只列不删**，待用户确认——D-007 红线）。

验收锚：合后 main SHA 记录；run URL 实物；两份 handoff 的 PENDING→URL 回填 diff；清理候选清单条目化。

## T1 — F7-a 钉版落地（覆盖 D-002、D-006、D-007-ii）

改动：
- `apps/dsh-plugin/package.json`：4 个 `@deepseek-ai/dsh-*` devDeps 与 `@deepseek-ai/cordis` 由 `^x.y.z` 改 `catalog:`；`dependencies:{}` 保持空。
- `pnpm-workspace.yaml`：新增 `catalog:` 块（`@deepseek-ai/dsh-*: 0.1.5-rc.2` ×15 族名逐枚举 + `@deepseek-ai/cordis: 4.0.2`）+ `overrides:` 追加全部 15 个 dsh-* + cordis→`catalog:`；overrides 块注释写明**解锁条件**（dsh 出 stable 后移除/切回）。
- 同 commit：`pnpm install` 重生成 `pnpm-lock.yaml` 并提交（不同 commit → CI frozen-lockfile 门口即红）。

验证（全过才算绿）：
1. `pnpm install --frozen-lockfile` 绿；
2. **强制 regen 实证**：备份→删 lockfile（或 `pnpm up` 干跑）→重装→`turbo check`（tsc）绿+`grep 0.1.6 pnpm-lock.yaml` 零命中——混版洞闭合的直接证据；恢复纪律按票内定；
3. `turbo test` + `ship-gate --quick` 全绿；
4. churn lint（ship-gate 1s）仍绿（`@deepseek-ai/*` 仍在 devDeps 非 runtime）。

注意：overrides 只写 root yaml（package.json `pnpm.overrides` pnpm 11 静默忽略）；精确版 override 使 dsh-* 间 peer 降级 dependencies=预期内（type-only 无运行时影响）。

## T2 — F7-b 预演复跑 + 升级账本（覆盖 D-003、D-006、D-007-ii）

两条腿：
1. **alpha.2 升级演练复跑**（模板 `evidence/audit-r72-upgrade-diff.log`）：临时把 catalog 值指向 `0.1.6-alpha.2`→install→`tsc`——**预期 RED on `agent/session-start`**（RED=警报按设计确认，不是失败）→记录 post-mortem transcript→回钉 `0.1.5-rc.2` 复绿。**只记录不施工**（预演/采纳分离——D-003）。
2. **升级账本服侍**：`.scratch/grill-round-73/upgrade-ledger.md`（建议名）含：rename map（`agent/session-start`→`agent/created`）、source-guard 伪代码（durable 路由卡仅 `source=fresh` 注入，防 resume/clear/compaction 重复注入）、payload diff（`{agent, source: SessionStartSource, signal?}`）、预期 RED 符号清单、**过期条款**（0.1.6-rc.1 实发后账本先对账上游 changelog 再施工）、采纳触发器（0.1.6-rc.1 发布 / 桥接功能缺口 / 弃用窗口）。

验收锚：演练 transcript 实物（含 RED 输出与回钉复绿）+账本文件入库。

## T3 — 0.0.7 发布（覆盖 D-005、D-006、D-007-iii）

1. 版本 bump：七包+root+private 包（含 `apps/dsh-plugin`）跟随对齐 `0.0.7`（沿 R71 先例）；ship-gate release pin 同 commit（F-01 纪律）；CHANGELOG `0.0.7` 段=Fixed（R71 F1-F6）+Internal/Changed（R73 钉版等）。
2. 走既有流：release-gate→tag→publish；`npm view <pkg> version` 各包 `0.0.7` 实证；绿 run URL 记录。
3. `apps/dsh-plugin` **保持 private 不发布**（D-005 红线）。

## T4 — 文书收口（覆盖 D-001~D-007 全量、D-007-iv）

- ADR-0074：钉版机制（家族 pin+catalog+解锁条件）+预演/采纳双决策分离+三栈合流+0.0.7 发布裁决；Closure evidence 段按 D-007 四段回填。
- `CONTEXT.md`：R73 词块已就位（6 条）；如有实施期新词补录。
- found/fixed/deferred 逐条闭环（found=F7+12 悬空栈；fixed=全落；deferred=范围外清单承接）。
- `CHANGELOG.md` R73 段（如 T3 未含全量内部变更）。
- pathlint：`scripts/ship-gate-pathlint.config.json` 扫面登记 round-73 目；本票文档自身过 lint。
- `but commit` 后工作区干净；r73 栈随收口落 main。

## Suggested skills

- `$implement` + `$tdd`（T1 钉版落地——regen 实证为红绿对）
- `$diagnosing-bugs`（T0 合流冲突或 T2 演练异常）
- `$code-review`（T1 diff 与 T3 发布面复审）
- `gitbutler` skill（所有栈操作先读它再动手——`but commit`/落栈/推栈语法）
- `$handoff`（收口沿用 Stack but-id+SHA+绿 run URL 模板）

## 红线

- 不改 `apps/dsh-plugin` 的 `dependencies:{}` 与 `private:true`（除 T3 版本号）。
- 不迁移 `agent/session-start`→`agent/created`（本轮只评估留档——D-003）。
- 不删任何栈/分支/worktree——清理候选只列呈报。
- 不顺带发 dsh-plugin、不开 PR 道（未选）、不动 R71 续债名。
- 推 push 前本地门全绿是硬前置（D-004）。

## Deferred 承接清单（下一轮可见，不改名）

`defer-r72-dsh-web-interactive-matrix` · `defer-r72-dsh-plugin-npm-publish` · `defer-r72-dsh-native-tools` · `defer-r71-shipgate-1g-coverage` · macos-spillover-probe 红因 · transformers 上游 · `defer-r71-provider-serverside` · **新增**：`defer-r73-dsh-016-adoption`（0.1.6 迁移采纳——触发器见升级账本）。
