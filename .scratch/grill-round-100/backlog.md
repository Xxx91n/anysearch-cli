# Backlog — R100 二次审计（audit-r2）

- 来源：`.scratch/grill-round-100/handoffs/audit-handoff-r2.md`（2026-10-13；审计窗 diff `8d1854e2..58f10f95`，25 commits）。
- 处置：审计窗判定全部非阻塞 → owner 授权修复窗直接清偿。修复 commit 见 `r100-audit-r2` 分支。
- LOOP 复核：修后重跑同一套验收（H1–H14）——verdict 473/0、e2e 471/0、ship-gate 9/9 复绿。

## 已清偿（fix commit）

| # | 发现 | 修复 | 复核 |
|---|---|---|---|
| B1 | seatExpired 对坏 `now` 静默有效 | 不可解析/缺席 now → 判 expired（fail-loud，对称 review_by 侧） | e2e 新增 `badNow` 断言绿 |
| B2 | seatMalformed 不查 reason/seated_at | 非 legacy 坐席强制四字段 `{anchor,reason,seated_at,review_by}`；legacy 串豁免（双读口径） | e2e `noReason`/`noSeatedAt`/`legacyInWindow` 三成对断言绿 |
| B3 | AST 白名单超窄集（假阴性方向） | 移除 `sort`/`reverse`（就地变异）、`forEach`（纯副作用语义）、`process.argv.*`（装载期环境输入）；保留数据变换类 | 实扫 38 模块分类零翻转（23 候选不变、0 findings） |
| B4 | class-③ 无具名 info 行+注释名漂移 | `ast-side-effect-candidate` 入 `AST_FINDING_NAMES`；每候选发 `scan.info[]` 具名行；probe detail 增 `ast-info=` 面 | e2e launcher 配对断言绿；F1 成员锁扩至 info 巷 |
| B5 | reanchor 空 mainSha 静默下行 | 删不可达 `?? "unresolved"`；加 hex 校验守卫（exit 2，不落空 land 标记） | e2e `--main-sha ""` → exit 2 + 活链不动 断言绿 |
| B6 | REQUIRED_RED_COVERAGE 未扩新码 | 改为从 `CODE_GROUPS.verdict` 派生全部 `*_RED_CODES` 并集——新 RED 码自动要求 fixture 覆盖，不再靠手维护名单 | e2e R4 腿绿（17 码全覆盖） |
| B7 | anchor-activity claim 存在性无强制 | ship-gate claims 腿加 fail-closed：round≥100 无 `kind:"anchor-activity"` 即 fail | r100 实跑通过（claim 在册） |
| B9 | 轮报「24 candidates」陈数 | R101 任务书更正为 23（注明实测） | — |
| B10 | audit-handoff.md 文/讯漂移 | 文末加 Addendum 记修复 commit 与口径差 | — |
| B11 | 杂物 | anchors.json 补尾换行；e2e:541 恒等冗余断言化简 | — |

## 呈报待拍板（审计窗解决不了/需 owner 裁断）

- **B8 重复面（J1/J2/J5 复核仍真，未动）**：坐席 legacy→structured 规则两处编码（`collectDeferred` 挂 provenance + `normalizeSeat` 再判 string，生产态近乎死支）；orphan 守卫两分支重复；`uniq(pendingAnchors)` 移除后 `seats.find` 首匹配依赖顺序。属重构级清理，非缺陷——立小票或并入下轮 cohesive 项由你定。
- **B3 残余口径**：白名单仍保留 `map/filter/reduce/slice/concat` 等数据变换方法（verdict 核自身 `STATE_PREDICATES.map` 依赖；若按 spec 字面收窄到纯构造类需重构 verdict-core——超「小问题」档）。拍板：就此收口 / 下轮再议。
- **B7 残余口径**：强制域=r≥100 起算；r80-r99 历史轮若回溯登记 claims 文件则同样受约束（当前不触发）。
- **B11 残余硬化项**（降级观察，非缺陷）：`enumerateScriptFiles` 递归无 symlink/深度守卫；`docPaths` 仅收 `d.rel`（name-only 文档 docOnMain=null→走降级，方向安全）。
