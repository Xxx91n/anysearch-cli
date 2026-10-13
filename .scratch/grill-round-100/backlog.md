# Backlog — R100 二次审计（audit-r2）非阻塞发现

- 来源：`.scratch/grill-round-100/handoffs/audit-handoff-r2.md`（2026-10-13；审计窗 diff `8d1854e2..58f10f95`，25 commits）。
- 全部非阻塞：硬验收全绿、无声明证伪、无引入回归。无论谁修，修完须重跑 audit-handoff-r2 §一 同一套验收（H1–H14）。

## B1 — seatExpired 对坏 `now` 静默有效（D-004 负向② 弱化）

- `scripts/enforcement-anchors.mjs` `seatExpired`：`nowDay !== null && Date.parse(nowDay) > by` —— 非空但不可解析的 `deps.now` → `NaN > by` → false → 坐席静默有效；立法方向=「到期计算错宁可 fail-loud」。
- 仅 deps 注入路径可达（生产 `now` 恒 ISO 日切）；`review_by` 侧已是 fail-loud（不可解析→expired）。修法对称即可。

## B2 — seatMalformed 不查 `reason`/`seated_at`（D-004① 弱化）

- `seatMalformed` 仅验 `anchor` + ISO `review_by`；结构化四件 `{anchor,reason,seated_at,review_by}` 中 `reason`/`seated_at` 缺席仍判 well-formed——四字段形态未全执法。

## B3 — AST 白名单宽于 spec 窄集（D-004④ 弱化，假阴性方向）

- `scripts/top-level-effects.mjs`：`PURE_METHODS` 含 `sort`/`forEach`（就地变异/任意回调副作用），`PURE_CALLEES` 含 `process.argv.slice`/`process.argv.includes` 等；spec 白名单=「Object.freeze/RegExp/字面构造类」窄集。受治模块顶层 `xs.forEach(register)` / `arr.sort()` 现判 pure → 真副作用逃分类（fail-closed 面的假阴性方向）。收窄或逐条立法痕迹。

## B4 — class-③ 无具名 info 行 + 注释名漂移（D-004③ 弱化，F1 残余）

- spec「副作用∧无 codes → 具名排除候选 + info 行」：实现只落 `scan.candidates` 数组，经 probe detail `ast-candidates=[...]` 单串带出，无 per-finding info 行；`scripts/vocab-scan.mjs` 头注释仍写 `ast-side-effect-candidate`——不在 `AST_FINDING_NAMES`、永不发出（文档名漂移）。

## B5 — handoff-reanchor 空 mainSha 静默下行

- `scripts/handoff-reanchor.mjs`：`?? "unresolved"` 不可达（`(... ?? "").trim()` 恒为串）；`git rev-parse origin/main` 失败时空 SHA 无校验直写 dissolved 行（`landDate` 有 regex 守卫，`mainSha` 没有）。生产首演走通，属潜伏路径。

## B6 — REQUIRED_RED_COVERAGE 未扩新码（R4 机制缺口）

- `packages/store/test/handoff-lint-e2e.test.mjs` R4 名单未加 `stack-orphaned-by-land` / 六枚 `anchor-*` / 三枚 `ast-*`；覆盖实有（三成对 fixture + inline asserts + R99 对抗演练），但「无死拒收分支」锁不涵盖新码。

## B7 — anchor-activity claim 存在性无强制（D-003④ 机制缺口）

- ship-gate 在 claim 存在时逐字重导校验（recount 纪律）；不写 claim 则锚活性一行账跳过验证静默缺席。「行存在性可机验」依赖每轮自觉登记，非 fail-closed。

## B8 — 重复面（首轮 J1/J2/J5 复核仍真）

- 坐席 legacy→structured 规则两处编码：`collectDeferred` 挂 `{anchor,legacy,entry}` provenance，`normalizeSeat` 再判 `typeof x === "string"`（生产态近乎死支，drift 缝）；orphan 守卫在两分支重复（可抽 helper）；`uniq(pendingAnchors)` 移除后 `seats.find` 首匹配依赖顺序（重复坐席语义未文档化）。

## B9 — 轮报「24 candidates」为陈数（实测 23）

- `scanVocabGuards` 实测 38 枚举 / 23 具名候选 / 0 findings（本审计逐文件独立复分类：零漏报、零幻影、零携码候选）。R101 任务书 C 项沿用「24 枚」应以 23 为准。

## B10 — audit-handoff.md 文/讯漂移

- `688df733` commit 讯称「F1/F2/F3 已修」，但文内仍把三件列为待处置项（R101/小票路径）；修复真实存在（`082e86ab`，本审计已复验 F1/F2/F3 落地），文未记修复后复验段——历史账可留，宜加注。

## B11 — 杂物（cosmetic）

- `docs/enforcement-anchors.json` 全文重排缩进 + 缺尾换行；e2e `!s2.scanned.every(...)===true || s2.scanned.some(...)` 恒等冗余；`enumerateScriptFiles` 递归无 symlink/深度守卫；`docPaths` 仅收 `d.rel`（name-only 文档 docOnMain=null→降级，方向安全非误红）。
