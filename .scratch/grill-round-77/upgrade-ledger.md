# dsh 上游升级账本（upgrade-ledger）— R77 v2

> v1 = `.scratch/grill-round-73/upgrade-ledger.md`（R73 预演蓝图）。本版按 D-002 漏斗重排：
> L0 元数据哨（npm view）→ L1 静态探针（npm pack tarball .d.ts 消费面 diff，闸内合法探针，
> 不归 minimumReleaseAge 管辖）→ L2 安装彩排（repin→install→tsc expected-RED，**只给采纳候选**）。
> 预演 ≠ 采纳；alarm 跟随发布、adoption 跟随稳定性。

## 当前钉版基线（未变）

- 全族 15 个 @deepseek-ai/dsh-* = `0.1.5-rc.2`，@deepseek-ai/cordis = `4.0.2`（catalog 单点 + overrides 逐名枚举）。
- 消费面快照：`evidence/t0-api-snapshot-rc2.json`（Events union 37 键含 cordis 9 个 internal/*；消费点 = `agent/session-start`+`tools/*` 三事件+`systemPrompt.section`）。

## 改名映射修正（T0 实测纠偏 v1）

| | rc.2（现役，实测） | alpha 线（0.1.6-alpha.1 起，实测） |
|---|---|---|
| `agent/session-start` | PRESENT，payload `{ agent, source: SessionStartSource }` | **ABSENT（键自 Events 移除）** |
| `agent/created` | PRESENT，payload `{ agent }` | PRESENT，payload `{ agent, source: SessionStartSource, signal?: AbortSignal }` |

- v1 记载「旧载荷 { agent }」偏简——rc.2 的 session-start 本就携 `source`；改名实质=session-start 键消失+source 移挂 created+新增 signal。迁移面不变：`ctx.on('agent/session-start',…)` → `ctx.on('agent/created',…)` + `source==='fresh'` 过滤（source-guard 伪码见 v1）。

## R77 L1 探针记录（每版 transcript 归档于 evidence/）

| 版本 | 发布时间 | 键面 diff vs rc.2 | 消费 payload diff | 家族 dep-closure | ALARM |
|---|---|---|---|---|---|
| 0.1.5-rc.3 (next) | 2026-09-22T05:39Z | 零漂移（28≡28） | 全 identical | 16（15 dsh-*+cordis） | **无 alarm** |
| 0.1.6-alpha.1 | 2026-09-15T03:10Z | -agent/session-start | created +source +signal? | （点探针 dsh-agent） | ALARM（改名最早落地版） |
| 0.1.6-alpha.2（对照锚） | 2026-09-17T13:38Z | -agent/session-start | created +source +signal? | 18（17 dsh-*+cordis） | ALARM ≡R73 install RED |
| 0.1.7-alpha.1 (alpha) | 2026-09-22T06:0xZ | -agent/session-start ≡alpha.2 | ≡alpha.2 | **22（21 dsh-*+cordis）** | ALARM |

transcript：`evidence/t0-l1-0.1.5-rc.3.md` / `t0-l1-0.1.6-alpha.2.md` / `t0-l1-0.1.7-alpha.1.md`；L0 快照 `evidence/t0-l0-watch.json`（23 名全族 versions+publish time+dist-tags）。

## L1 先验预测 vs T0 实裁

- 预测（R73→R77 账本假设）：改名特征若上 rc 线 → L2 expected-RED = `ctx.on('agent/session-start')` TS2345 单错。
- 实裁：特征**未上 rc 线**（rc.3 零漂移）；alpha 线特征自 0.1.6-alpha.1 即落地且至 0.1.7-alpha.1 零再变——L1 diff 对 R73 install-RED 的先验预测成立（同签名级证据互证）。

## 采纳触发器（双锚，版本号退出触发逻辑）

1. **特征锚**：候选 tarball .d.ts 中 `agent/created` payload 携 `source`（/`signal`）且 `agent/session-start` 缺席；
2. **稳定锚**：发布位于 rc-or-stable 线（dist-tag next/latest 系；alpha/beta 不采纳）且 changelog 经审阅；
3. 另保留 v1 的非版本触发：功能桥接缺口、上游宣布 rc.2 废弃/迁移窗口。

两锚全响 + 过 2880min 龄期闸 → 才进 L2 实施轮。版本号只作 transcript 记录字段（leapfrog 证伪：0.1.6-rc.1 若永不发布=死锁，0.1.7 直接出 rc=漏接）。

## 墓碑表（跳线版本——记录非补演，latest-only）

| 版本 | superseded_by | L1-diff 摘要 | 记档于 |
|---|---|---|---|
| 0.1.6-alpha.1 | 0.1.7-alpha.1 | session-start ABSENT + created 携 source/signal（改名最早落地版） | registry defer-r73 tombstones + 本表 @2026-09-22 |
| 0.1.6-alpha.2 | 0.1.7-alpha.1 | 同上 + R73 install 彩排 RED 实证（键级破坏面归因证据已锁） | 同上 |

## L2 排程态（D-005 条件式收口）

- 合格候选判定 = ALARM + 过龄期闸 + rc-or-stable。本轮三版本：rc.3 无 ALARM；alpha.1/alpha.2/0.1.7-alpha.1 皆 alpha 线（稳定锚不响）。
- **显式结论：本轮无 L2 合格候选（no-qualifying-candidate）**——非吊死等闸非口头悬债；下一合格候选出现时按 latest-only 直接彩排，中间被跳线版本只补墓碑。

## 待校准项（落锚，防静默丢——r77-audit F-2）

- ~~**pnpm minimumReleaseAge 对 catalog repin 的确切拦截行为 = 本地实验项**~~ **已消解（R78 T0，2026-09-22）**：7 格预登记判决矩阵实跑（`.scratch/grill-round-78/evidence/t0-repin-matrix.md`）——E1/E2/E3/E4 一致、E5 语义一致（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）、**E6 证伪**：lockfile 携闸内版 + frozen/fetch 五变体全放行，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 在 11.24.0 不触发。#11583「lockfile 复核通道」调研结论与本机实测矛盾，按实测为准。
- **断言收窄落锚**：本账本「L1 tarball 探针是闸内唯一合法探测层」维持——npm pack 不过 pnpm resolver 事实不变；但依据收窄为「闸拦截新鲜解析路径（catalog/range 重解析），**lockfile 回放不执法龄期闸**」。闸内版一旦进入 lockfile，frozen install 静默放行——lockfile 携带内容的评审责任由 review 纪律承担，不能指望闸兜底。详见 ADR-0079 D3。

## 家族规模警戒

- 0.1.7-alpha.1 dep-closure = **21 个 dsh-***（rc.2 基线 15 名缺 6：+ptc-runtime/sandbox/sandbox-policy/session-persistence/storage/storage-domain/workspace——alpha.2 相对 rc.2 另退出 dsh-code-runtime）。采纳时 pnpm-workspace overrides 枚举必须按新锁文件重推导，现行 15 名清单不足覆盖。
