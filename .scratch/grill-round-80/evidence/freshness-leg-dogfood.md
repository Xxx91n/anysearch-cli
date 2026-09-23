# T3 — 派生件新鲜度腿 dogfooding 实录（ship-gate 1u/1v, ADR-0081 D-004/T1）

Date: 2026-09-23. 方法 = r72/r78 先例：临时 commit 造红 → 真门跑 → `but undo` 撤（演示 commit 未留史）。Gate = `node scripts/ship-gate.mjs --quick`。

## 绿向（committed 真树）

```
[pass] freshness leg: CHANGELOG carries a current-round (r80) entry
[pass] closeout-claims r80: 8/8 registered claims re-derived green
[pass] E6 gate invariants: trustLockfile default(false), strict on, missing-time strict, zero age-excludes — upstream verify leg enforced
…ship gate green — ready to tag the next release
```

## 红绿对（4 fixture）

| fixture | 变异 | 期望 | 实测 |
|---|---|---|---|
| F1 陈旧 CHANGELOG | header 去 `r80` token | fail | `[fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r80 — current round is .scratch/grill-round-80; add the round entry or declare 'no-changelog-entry: <reason>' in goal.md`，exit 1（30 行处 fail-fast）|
| F2 计数失配 | claims expect 8→7 | fail | `[fail] ADR-0081 D-004: closeout-claim workspace-pin-0.0.8 (count) re-derived 8 != declared 7 — stale closeout number`，exit 1 |
| F3 空豁免理由 | goal.md 追加 `no-changelog-entry:`（空）| fail | `[fail] ADR-0081 D-004: .scratch/grill-round-80/goal.md 'no-changelog-entry:' exemption carries an empty reason`，exit 1 |
| F4 合法豁免 | `no-changelog-entry: evidence-only round — zero user-visible delta` + CHANGELOG 去 r80 | pass-exempt | `[pass] freshness leg: CHANGELOG entry exempted for r80 (no-changelog-entry: evidence-only round — zero user-visible delta)`，门续行至 step 9 全绿 |

撤销方式：`but undo` 逐 fixture 回退 + node 复写原值；`git status --porcelain` 终态空。栈形修正一并记档：fixture commit 初遭 `but move r80-impl --above r80-grill` 提示——实施栈误建为并行 lane，`but move` 已修正为叠加栈（r80-grill ← r80-impl，合任务书拓扑）。

## 审计逃逸形追补（r80-audit F-B，修后红向复测）

| fixture | 逃逸形态 | 修前 | 修后（commit vuy 正则→注释剥除+字面标量+缩进感知块扫描） |
|---|---|---|---|
| F5 | `trustLockfile: true # opt out for speed`（行尾注释） | 穿透（\s*$ 锚死行尾） | `[fail] ADR-0081 E6: trustLockfile must be unset or literal false (got true)`，exit 1 |
| F6 | `trustLockfile: "true"`（引号标量） | 穿透 | `[fail] ... (got \"true\")`，exit 1 |
| F7 | `minimumReleaseAgeExclude:\n  # comment\n  - left-pad`（列表夹注释行） | 穿透（注释行截断块正则） | `[fail] ... non-empty minimumReleaseAgeExclude ...`，exit 1 |

撤销同法（but undo+node 复原，终态 porcelain 空）。随修观察项 O1–O4：report() JSDoc 补 warn；1t 注释归位至调用紧邻；symbol/field kind 缺文件/坏 JSON 走 fail() 干净闸报；PUBLISH_SET 4→5（dsh-plugin 入 packed-manifest 形状断言，peer-optional 限 embedding 消费三包，noExternal 扫 dist→dist/lib 双目录）。

## dogfooding 发现（先记档再修）

1. **pathlint 命中本轮自有产物**（既有腿，非新腿）：e6-matrix.md 两处 `%TEMP%`/`%LOCALAPPDATA%` 环境变量路径缺 governed marker → `[fail] machine-local path requires a governed marker` ×2。处置：同 line 补 governed marker，amend 回 ntl（证据文件自身 commit）。**绿复验**：ship-gate 全绿 transcript 见本节首块。
2. **warn kind 无独立徽章**（cosmetic）：新腿 narrative/缺注册面 warn 在 console 渲染为 `[info]`（report.json kind=warn 记录正确）。处置：report() badge 增 warn 分支 `[warn]`（line 1268 既有 warn 调用同受益），amend 回本 commit。
3. **栈形偏差**（流程发现，见上表下注）：已修。

## 分档与升级表

- fail-closed（objective，可修）：CHANGELOG 条目断言 / 豁免字段形状 / count·path·symbol·field 四 kind / claims schema+round 锚 / 命令缺位。
- warn-first（narrative 代理）：kind=narrative token 缺席 / 注册面文件缺席（pre-r80 轮次）。升 fail 时间表：ADR-0081 记 narrative 代理稳定一轮后 r82 评审升 fail。
