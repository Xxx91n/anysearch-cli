# ADR-0090: Grill Round 89 — dsh 上游线轮（0.2.0-rc.1 breaking-surface 调研 + repin 时机判词=soak-until-stable + r72 两票定形）

## Status

Accepted (grill round r89; 主轴票 dsh-upstream-line). Records T0–T6 per task book `.scratch/grill-round-89/handoffs/next-round.md`. Ledger: `.scratch/grill-round-89/decision-ledger.md` (D-001~D-003). Evidence root: `.scratch/grill-round-89/`（reports/baseline-2026-09-29.md + evidence/t0-l0-watch.json + evidence/t1-l1-0.2.0-rc.1.md + t1-api-snapshot-0.2.0-rc.1.json + r72-shaping.md + 轮报）。

## Context

dsh 上游 0.2.0 minor 线首落候选（0.2.0-rc.1 @ next，2026-09-28T12:13~12:16Z 全族 20/20 同发）；R88 T0 哨戒已首目击落档。本轮=D-001 题面：0.2.0 线 breaking-surface 调研 + repin 时机裁决，交付物=调研件（L1 transcript+迁移面 diff+判词），非实装轮。R72 遗留两票（native-tools / web-interactive-matrix）同域纳编，只定形不实现。

## Decision

### D1（=D-001）轮域与条件票制

本轮=dsh 上游线轮；repin 执行票（T3）以判词为闸——仅当 T2 判词=repin-now 才启，判词≠repin-now 则票不启不留痕（R83 TE1 in-round 先例显式化）。r72 两票定形=设计记录非实现。

### D2（=D-002）三锚判词真值表（先于 L1 立法，探针只填真值）

| 锚 | 定义（枚举化） | 本轮真值 |
|---|---|---|
| 兼容锚 | 消费子集（agent/created payload{agent,source}、tools/pre-execute|post-execute|result 签名、ctx.systemPrompt.section、inject 声明）在候选 .d.ts 保留且签名同构；未消费键漂移≠破坏 | **TRUE**：6/6 消费面 + 12/12 字段级 normalized-IDENTICAL；Events 键面全族零增删 |
| 拉力锚 | r72 票面具名 API 在候选 .d.ts 出现且签名稳定（工具注册面/web 交互面其一即响）或安全/正确性修复证据；不收泛化「成熟化」 | **零**：具名面三代同形（0.1.5-rc.2 起）、候选零特异增量；patchReload:live/browser-turn 双侧缺席；无修复证据 |
| 稳定锚 | rc 线在架 + 2880min 龄期闸 + changelog 核验（不可核验→tarball diff 降级自证并记缺口） | rc 在架✓；龄期≈802min<2880min 未过；changelog 不可核验→降级自证在案 |

**真值表（无第三态）**：拉力∧兼容→repin-now；兼容∧零拉力→soak-until-stable（默认兜底，高频象限必产出不悬置）；兼容破坏→hold。

**判词 = soak-until-stable**（兼容∧零拉力分支）。钉版 0.1.7-rc.1 + cordis 4.0.4 不动；T3 不启。

判读说明：拉力锚按候选特异性证据读（具名 API 之「出现且签名稳定」=候选相对现钉携新增/稳定化证据）；字面「候选 .d.ts 在架即响」读法会使 soak 象限永不可达（具名 API 在每个未来候选均在架），与「高频象限」立法意图矛盾，且属泛化成熟化解读变体——不采，差异已呈报。

### D3（=D-003）附随义务与类推标注

- **收口义务**：repin-now 若落地，上游 stable 晋升时只再验一次收口探针即封账，不跟随 rc.N 递增滚动；本轮 soak 判词下再评估触发点=0.2.0 stable 晋升目击（latest-only 直接跑 L1+判词封账）。
- **rc→rc 跨 minor 类推非先例**：0.1.7-rc.1→0.2.0-rc.1 为跨 minor rc→rc 平移——Renovate 例外条款严格读法不覆盖；若未来判词=repin-now 须标注类推非先例（本轮未达该分支，备录）。
- **changelog 缺口记档**：上游 0.2.0-rc.1 changelog/迁移注记公网不可核验；L1 tarball diff 自证替代，缺口记档（ADR-0084 诚实化同构）。

### r72 两票定形去向（T4）

- **defer-r72-dsh-native-tools**：定形件 `.scratch/grill-round-89/r72-shaping.md`——ctx.tools.register(defineTool(...)) 落 apps/dsh-plugin apply()，五 ans_* 工具映射+卸 mcp__anysearch__ 桥；**依赖触发器实质已响**（API 自 ≥0.1.5-rc.2 三代签名同形），维持 defer 至实施票裁决。
- **defer-r72-dsh-web-interactive-matrix**：依赖分项——approval-channel 已解除（dsh-user-approval 在架同形）；patchReload:live 与 browser-turn 上游 .d.ts 双版缺席——**维持 defer**。

## Consequences

- 钉版 0.1.7-rc.1 + cordis 4.0.4 维持；上游 0.2.0 线以 watch 哨戒继续观察，stable 晋升目击时 latest-only 重跑 L1+判词封账。
- 本判词依赖「拉力=候选特异证据」读法——立法原文「出现且签名稳定」存在字面歧义，已记 spec gap：真值表缺稳定锚否决行+拉力锚候选特异性未明文，下轮立法补。
- 候选特异性读法经审计裁决权威化（A-1）；即便字面读法拉力=TRUE，龄期闸未过亦无分支落 repin-now——判词稳健。
- r72-native-tools 实施票依赖实质可启（触发器三代同形实证），解除 defer 属下轮裁决；web-matrix 的 patchReload:live/browser-turn 两面待上游出面。
