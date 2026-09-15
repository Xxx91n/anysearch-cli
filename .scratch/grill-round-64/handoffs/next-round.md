# Handoff — grill-round-64 实施任务书（T1–T6）

## 摘要（零上下文可接手）

anysearch-cli 的 live 评测金标准（eval-looks.json，14 条）有 10 条因 provider 路径形态漂移被隔离，TTL 2026-10-14T19:02:29Z 到期强制裁决。本轮 grill 已定稿全部治理决策（decision-ledger.md D-001..D-007）。实施 = 按 T1–T6 落地：新增 mustHitPaths 页族断言层、10 条逐条裁决落账、ship-gate 锚点机器化、文档口径更新。调研报告见同目录 q2/q3/q4/q5-atomcode.md；ADR 目标号 0065。

## 关键机制事实（已核实，勿重查）

- promoteEntry 物理删除账本条目→promote 留痕只能落 golden 条目 migration 块。
- 改 eval-looks.json 的 expected 不翻转 OF 指纹对（key 来自 eval-baseline.json）。
- runner eval-looks-live.online.ts 内联隔离判定不认 longterm flag——D-004 前置修复项。
- ship-gate 1n 段已有 c1/c2/c4 golden 存在性断言先例，新锚点同构。
- EXA_API_KEY 环境已设；eval-looks-live 需 apps/cli/dist 先 build。
- 棘轮 packages/store/eval-quarantine.baseline.json 为 10 id 基线；同 id 重入合法。

## 票序（D-006 串行）

### T1 机制层 — 覆盖 D-004、D-005（schema/matcher 部分）
- runner 内联隔离判定改调 activeIds()（消灭 longterm 复制漂移）；
- evidence 模式：env flag（建议 ANS_EVAL_EVIDENCE=1）使隔离条目实跑、EVIDENCE 四元组行、仅隔离失败 exit 0 覆写、连续全红 RETIRE_CANDIDATE；
- mustHitPaths/mustNotHitPaths matcher（pathname 子串匹配；负例必断）；
- schema 四字段+eval-looks.json 根 schema_version:1 哨兵；
- fixture 一致性单测：longterm/expired/retired 组合台账断言 runner 分类==isActive()。
- 验收锚：单测绿+evidence flag 下隔离条目实际执行且有 EVIDENCE 行。

### T2 fixture 迁移 — 覆盖 D-002、D-003、D-005（migration/stability/failure 部分）
- 8 条（g0001/2/3/4/5/6/9/11）mustHitUrls→mustHitPaths，fragment 从 live 实返校准（先 evidence 模式看当前实返形态再定 fragment），负例写死；
- g0010：evidence 复跑≥2 次确认 abstain 稳定→expected 改判 verdict:abstain（撤 mustHit*/minResults）+failure_class:external-doc-superseded；若恢复 answer 并入 mustHitPaths 簇；
- g0008：mustHitHosts 降格 [pnpm.io]+failure_class:locale-clustering-suppressed-cross-host；hops:multi 保留 dimensions 观测；
- 每条加 migration 块（原断言→新断言+漂移证据+裁决日期）+stability_class+failure_class；
- ≥2 条字节级 mustHitUrls 新腿：自控 sentinel 优先（仓 GitHub URL 类，live 实测收录），不行退 frozen-spec/RFC，标 stability_class:controlled|frozen-spec。
- 验收锚：fixture 全部表达新粒度；fragment 取值有 live 实返依据。

### T3 证据执行 — 覆盖 D-003、D-004
- 分档复跑：稳定 5 条≥1 绿；flaky 3 条≥5 跑 flip<0.2；g0010≥2 次稳定；g0008≥1 绿（时间戳降格后）；
- 证据日志（EVIDENCE 四元组）落 .scratch/grill-round-64/evidence/；
- 逐条 promoteEntry/retireEntry 落账（reviews 记录 decision+note）；不达档者 retire+理由；
- flaky promote 后标 watch:true。
- 验收锚：eval-quarantine.json 棘轮视野清空；每条有裁决记录。

### T4 闸门 — 覆盖 D-005
- ship-gate 锚点：live 条目 mustHitUrls≥2 + mustHitPaths≥1 + 8 条迁移案例 migration 块存在性；
- watch:true 字段消费（runner/报告面呈现）；watch 重入回路文档化（回既有 TTL 通道）。
- 验收锚：ship-gate 全绿含新断言。

### T5 文档 — 覆盖 D-002、D-003、D-004、D-005、D-007
- README Known Limitations：页级口径更新（mustHitPaths 页族层+≥2 sentinel exact+历史漂移注记）；
- ADR-0065：全部裁决+四条成文义务（棘轮边界豁免/re-spec 充要条件/longterm 启用门槛/promote-tombstone 边界/watch 回路）+Closure evidence 四部骨架；
- CHANGELOG Added/Changed；CONTEXT.md 术语块已在本轮整理期预写（Grill Round 64 — Terms）。
- 验收锚：文档与代码面一致，无口径夸大。

### T6 收口 — 覆盖 D-001、D-007
- Closure evidence 四部回填（代码/裁决/闸门/缺口）；
- CI test-online corroboration run URL 入账（promote 最终见证）；
- 棘轮终态+TTL 前瞻确认。

## 范围外（显式登记）
- OIDC trusted publishing（due 0.0.4）：下轮候选主题（D-001）。
- en 版双宿主新案例：独立 harvest 票，不占 TTL 出口（D-003）。
- 版本发布：本轮产物 eval-infra+docs，不触发 npm publish（D-006）。

## 环境备忘
- Windows 主机；ctx_batch_execute shell=bash；写文件用 node.js（ctx_execute javascript）。
- pnpm 11.24.0 pinned（pmOnFail:error）；better-sqlite3 prebuild 路径勿动。
- 版本控制一律 but（GitButler）；禁 git write 命令。
- live 复跑命令：pnpm --filter @anysearch-cli/cli build 后 pnpm -C packages/store test:online（需 EXA_API_KEY）。

## Suggested skills
- implement / tdd（T1 matcher+单测、T4 锚点断言）
- diagnosing-bugs（evidence 复跑不达档时的归因）
- domain-modeling（ADR-0065 与词表一致性维护）
- neat-freak（收口事实面核对）
- handoff（本轮结束/中断时再生成交接）
