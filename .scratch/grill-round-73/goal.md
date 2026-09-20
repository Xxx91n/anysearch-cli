# Round 73 Goal — 上游跟进与栈合流治理（定稿）

**Status**: implemented @ 2026-09-19 — T0~T4 全落地（main tip `b16de7a3`，v0.0.7 已发布），审计 PASS 附次级发现（F1-F5 已修）。
**Ledger**: `.scratch/grill-round-73/decision-ledger.md`（D-001~D-007 全 current，唯一数据源）。

## 一句话目标

把 R71 审计修复与 R72 dsh 宿主适配共 12 commits 从悬空栈落到 main（顺序合流+push 换 CI 佐证），同时对 dsh 上游依赖族完成钉版闭环与「预演/采纳分离」的升级姿态固化，并以 0.0.7 patch release 把已验证修复送到用户手。

## 范围内（账本裁决）

| 面 | 内容 | 票 |
|---|---|---|
| 合流 | r71-audit→r72-grill+r72-audit 顺序落 main；push origin；绿 run URL 回填两份审计 handoff | T0（D-004/D-006） |
| F7-a 钉版 | catalog 单点+overrides 15 名枚举+cordis+devDeps 脱 ^+解锁条件注释+lockfile regen；regen 实证混版洞闭合 | T1（D-002/D-006） |
| F7-b 升级姿态 | 钉住 0.1.5-rc.2 不动；alpha.2 预演复跑（期望 RED=警报确认）+post-mortem；升级账本落盘（rename map/source-guard/payload diff/预期 RED 清单/过期条款/双决策分离） | T2（D-003/D-006） |
| 0.0.7 发布 | 七包+root+private 跟随 bump；CHANGELOG Fixed；release-gate→tag→publish→npm view 实证 | T3（D-005/D-006） |
| 文书收口 | ADR-0074+CONTEXT 词块+found/fixed/deferred+handoff+pathlint 扫面登记+干净工作区 | T4（D-007） |

## 显式范围外（续 deferred，不动名）

- `defer-r72-dsh-web-interactive-matrix`（web 交互矩阵）
- `defer-r72-dsh-plugin-npm-publish`（dsh-plugin 发布道——private 保持）
- `defer-r72-dsh-native-tools`（ctx.tools 原生注册——触发条件未出现）
- `defer-r71-shipgate-1g-coverage` / macos-spillover-probe 红因 / transformers 上游 / `defer-r71-provider-serverside`（R71 续债）
- 合后遗留栈/分支清理：列出候选待用户确认，不自行删（D-007 安全红线）
- 事件名迁移施工（`agent/session-start`→`agent/created`）：仅评估留档，采纳触发器=0.1.6-rc.1 发布或功能缺口——本轮不迁（D-003）

## 验证与收口

四段收口判据见账本 D-007：合流段（SHA+run URL+PENDING 回填+清理候选清单）/ F7 段（钉版 diff+regen 实证+预演 transcript+账本实物）/ 发布段（tag+release-gate+npm view）/ 文书段（ADR-0074+词表+三元组+pathlint 自证+净工作区）。

## 路径纪律自证（ADR-0072）

本目录文档：库内引用一律 repo-relative；绝对路径仅可出现于 Stack 定位器行或带 `<!-- machine-local: <reason> @ <date> -->` 治理标记的库外引用。
