# dsh 上游升级账本（upgrade-ledger）— R89 v3

> v1 = `.scratch/grill-round-73/upgrade-ledger.md`（R73 预演蓝图）；v2 = `.scratch/grill-round-77/upgrade-ledger.md`（L0→L1→L2 漏斗定版）。
> v3 承 v2 格式，判据升级为 R89 D-002 三锚判词·加固版（先于 L1 探针立法，探针结果只填真值不改判据）。
> 预演 ≠ 采纳；alarm 跟随发布、adoption 跟随稳定性。

## 当前钉版基线（未变）

- 全族 20 个 @deepseek-ai/dsh-* = `0.1.7-rc.1`，@deepseek-ai/cordis = `4.0.4`（catalog 单点 + overrides 逐名枚举；R83 TE1 实装态）。
- 消费面：`apps/dsh-plugin/src/index.ts` —— `agent/created`（payload {agent,source}）+ `tools/pre-execute|post-execute|result` 三事件 + `ctx.systemPrompt.section` + `inject=['tools','systemPrompt']`。

## R89 L0 哨戒（2026-09-29T01:35Z 快照，evidence/t0-l0-watch.json）

- `next` = 0.2.0-rc.1 全族 20/20 在架（published 2026-09-28T12:13~12:16Z）；无 rc.2 递增、无 stable 晋升。
- cordis 未随族跳线：latest=4.0.4、next=4.0.1-rc.4（陈旧 tag）。
- latest tag 旧线不动（上游 tag 卫生一贯态）。

## R89 L1 探针记录（transcript evidence/t1-l1-0.2.0-rc.1.md，snapshot t1-api-snapshot-0.2.0-rc.1.json）

| 版本 | 发布 | 消费子集 diff vs 0.1.7-rc.1 | Events 键面 | dep-closure | 备注 |
|---|---|---|---|---|---|
| 0.2.0-rc.1 (next) | 2026-09-28T12:14Z | **零破坏漂移**（6/6 消费面 + 12/12 字段级 IDENTICAL） | 全族 0 增 0 删 | 同集零 delta（21 dsh-*+cordis+非dsh传递件不变） | 非消费面 6 包附加/收窄漂移实录于 transcript |

## 三锚真值表判定（D-002，机械产出）

- **兼容锚 = TRUE**：消费子集（agent/created payload {agent,source,signal?}、tools 三事件签名、systemPrompt.section、inject 声明）逐键 normalized-identical；未消费键漂移（dsh-workspace initializeDefault 收窄等）按 D-002 不计破坏。
- **拉力锚 = 零**：枚举化证据逐格核验——
  - 工具注册面：`ToolRuntime.register/restrict/defineTool` 在 0.2.0-rc.1 .d.ts 在架且签名稳定，但**三代同形**（0.1.5-rc.2 已装实例即含，.pnpm 实证）——相对现钉无候选特异增量；
  - web 交互面：patchReload:live / browser-turn 两版均 ABSENT；approval-channel 包同存（仅 +displayReason 附加字段）；
  - 安全/正确性修复证据：.d.ts diff 面无。
  - 判读说明（如实记）：拉力锚量的是候选相对现钉的特异引力——「出现且签名稳定」按「候选带来的新增/稳定化证据」读。若按「候选 .d.ts 在架即响」字面读法则拉力亦响；但该读法使 soak 象限永不可达（具名 API 在每个未来候选中均在架），与 D-002「高频象限必产出」立法意图矛盾，且属 D-002 明文拒收的泛化成熟化解读变体 → 采候选特异性读法。**此判读差异已呈报用户裁决**。
- **稳定锚**：rc 线在架 ✓（next=0.2.0-rc.1）；**2880min 龄期闸未过**（快照时点龄期 ≈802min）；changelog 公网不可核验 → 已降级 tarball diff 自证，缺口记档于 transcript。

## 判词

> **soak-until-stable**（兼容∧零拉力分支；D-002 真值表机械产出，无第三态）。

- 钉版不动：0.1.7-rc.1 + cordis 4.0.4 维持；T3 条件票不启、不留痕。
- 再评估触发点：0.2.0 stable 晋升（dist-tag latest/在架 stable 线目击）时按 latest-only 直接重跑 L1+判词封账；rc.N 递增不滚动跟随（D-002 收口义务同构——防账本退化滚动义务）。龄期闸在判词时点未过，记为事实记录非悬置态（判词由拉力/兼容轴产出，稳定锚各分量如实记档）。
- **rc→rc 跨 minor 类推非先例标注**：本候选为 0.1.7-rc.1→0.2.0-rc.1 跨 minor rc→rc 平移——Renovate 例外条款严格读法不覆盖跨 minor，若未来判词=repin-now 须标注为类推非先例（本轮未达该分支，条款备录）。
- **changelog 缺口记档**：上游 0.2.0-rc.1 changelog/迁移注记公网不可核验；L1 tarball diff 自证已替代，缺口本身记档（ADR-0084 记分簿诚实化同构）。

## L2 排程态

- 本轮无 L2 合格候选（判词=soak-until-stable；且龄期闸未过 + T3 未启）。下一合格候选 = 0.2.0 stable 晋升或携候选特异拉力证据的新版本目击。

## 家族规模警戒（承 R77）

- 0.2.0-rc.1 dep-closure 与 0.1.7-rc.1 同集（21 dsh-* 含传递件 util-crypto + cordis 4.0.4）。若未来采纳 0.2.0 线，overrides 枚举可按现行 20 名清单平移，无须重推导扩名——T3 若启时以新锁文件复核为准（承 R77 条款）。
