# T3 — 配对垂直 delta 证据腿（live，如实降格记录）

日期：2026-09-26 · 轮次：grill-round-84（fix-r84-vertical-eval-leg）
Runner：`packages/store/test/online/eval-looks-vertical.online.ts`
产出：`.scratch/vertical-eval/delta.json`（round-neutral 通道，env `ANS_VERTICAL_DELTA_OUT` 可改址）

## 1. 测量设计（D-002 证据层 / D-004 delta 形制 / D-005 双层）

每条带 spec 的 live 语料跑 4 趟（无 spec 对照跑 2 趟，自配对无意义）：

| 趟 | env/flags | 用途 |
|---|---|---|
| isoOn | `ANS_PROVIDERS=anysearch` + `--vertical-*` | 臂级 ON（主证） |
| isoOff | `ANS_PROVIDERS=anysearch`，无 spec | 臂级 OFF（主证） |
| fullOn | 全扇出 + `--vertical-*` | 融合级 ON（副列）+ fanout 存活率 |
| fullOff | 全扇出，无 spec | 融合级 OFF（副列） |

- 臂级 = 隔离 `metadata.fusion`/`results` 的 anysearch 原生列表——隔离是必要的：优雅窗（1.5s）在快臂凑足结果后会取消慢臂，全扇出下的臂缺席是时序产物不是测量（`armInFanoutOn/Off` 单列如实记）。
- 主证 = 臂级 delta；融合级仅观测列，永不作 prefer-capable 加权论据（D-005）。
- 不可测量格一律 `null`/`unknown`，绝不记 0（D-004/账本诚实规则）。
- `marked` = `extra.vertical` 标记计数——印证 params 实际上了 wire。
- `armOnSample`/`armOffSample` = 各臂前 3 URL，供审计手工复核。
- `providersFailed{On,Off,IsoOn,IsoOff}` 四面分列——空臂结果与臂失败可区分。

入口侧新增 env 门控 eval 面：`ANS_ARM_SNAPSHOT=1`（`--json` 透出 `fusion{labels,lists}`）、`ANS_PROVIDERS=a,b`（provider 子集过滤，走 `Query.providers`）。

## 2. 实跑结果（匿名 quota 边界如实记）

```
$ env -u ANYSEARCH_ENDPOINT -u ANYSEARCH_API_KEY node --import tsx test/online/eval-looks-vertical.online.ts
n=57 fingerprint=7ac0a48e55cd7954 controlDegraded=0
control      n=16 paired=12 armHost on=null   off=null   fused on=null  off=null  rankDiff=null v={better:0,worse:0,tied:0,unknown:16}
parameterized n=21 paired=21 armHost on=0.1   off=0.14   fused on=0.38 off=0.33  rankDiff=2.5  v={better:1,worse:1,tied:19}
semantic      n=20 paired=20 armHost on=0     off=0      fused on=0.45 off=0.45  rankDiff=null v={better:0,worse:0,tied:20}
PASS: vertical-delta artifact emitted
```

配额衰减轨迹（如实）：前 ~3 条 parameterized 拿到真臂数据（`vert-f1101/1102/1103` on 臂 n=1 marked=1，命中 `site.financialmodelingprep.com`），其后匿名额度耗尽——连 OFF 臂（普通搜索）也归零，尾声 `providersFailed:["anysearch"]` 显式失败。本机 `ANYSEARCH_API_KEY` 为本地 stub（127.0.0.1:20128，未运行）专用，对公网端点回 `invalid_api_key`，故全程匿名。

## 3. 已证实的机制层事实（配额活着的窗口内）

- `vert-f1101`（finance.calendar type=earnings，NVDA 财报日）：ON 臂返回 `site.financialmodelingprep.com/`（垂域数据源页），OFF 臂 10 条通用结果（wallstreethorizon/investor.nvidia/public.com）——**垂域路由改变了臂级取回构成**，delta verdict=better。归因修正（2026-09-27 审计 F4）：双臂均命中池，better 由 rankDiff=5 产生（ON 臂池命中 rank 1 vs OFF rank 6），非命中翻转——verdict 值正确，表述已更正。
- `vert-f1102`（finance.macro type=cpi）：ON 臂 1 条 fmp，OFF 臂 bls.gov/minneapolisfed/tradingeconomics——tied。
- `vert-f1103`（finance.quote AAPL）：ON 1 条 fmp vs OFF 10 条（yahoo/robinhood/tradingview 命中池）——verdict=worse（池口径下覆盖收窄，如实）。
- `armInFanoutOn` 2/53：快臂（tavily 有真 key）凑足后优雅窗取消慢臂——验证了隔离腿的必要性。
- 垂域上游 URL 可能无 scheme（`site.financialmodelingprep.com/`）——hostOf 已容错处理并注明。

## 4. 定级

**部分降格证据（partially degraded），机制链绿、数据覆盖受匿名配额限。** paired 全成对（41/41 带 spec 条），但大多数 on 臂为配额耗尽后的空结果——这是上游额度事实不是 routing 判定。重跑路径固定：`pnpm -C apps/cli build` 后用真实 `ANYSEARCH_API_KEY`（公网端点有效 key）或待匿名额度恢复执行 `pnpm -C packages/store test:online` 并收 `delta.json`。

对照类 verdict 恒 unknown 属设计（无 hitHosts 池 → 不可测格为 null）。

## 5. 存量件 schema 披露（2026-09-27 审计 F3）

盘上 `delta.json` 由早期 runner 生成，行缺 `providersFailedIsoOn/IsoOff`/`armInFanout*`/`armOnSample` 等后加字段——存量件的失败面只有全扇出两腿。现行代码已齐；重跑（quota-rerun 条件满足时）产出覆盖更新即闭合。本档 §1 字段清单描述的是**现行 runner 契约**，不回溯存量件。
