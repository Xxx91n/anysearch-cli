# R100 审计交接 — grill-round-100 → 下一窗

- 日期：2026-10-08 | 身份：审计 Agent（只出报告，不动手修）
- 审计对象：R100 全轮闭环交付栈（origin/main tip `ef296a2a`；diff 基线 `8d1854e2..ef296a2a`，22 commits / 34 files / +1745）
- 输入源件：`C:\Windows\temp\any.txt`（R100 轮报摘要）+ 本目录 `round-100-closeout.md` / `reports/2026-10-08-report.md` / `handoffs/next-round.md` + `decision-ledger.md`（D-001~D-005）+ `goal.md`
- 唯一事实源：`.scratch/grill-round-100/decision-ledger.md`（D-001~D-005 全 current）

## 结论（先给判定）

**审计通过（PASS），附 3 项非阻塞发现（F1/F2/F3）。** 无过程违规需追认。所有硬验收亲自重跑全绿，报告关键声明逐条对仓库实物抽查全部兑现。3 项发现均为「实现弱于 spec 字面」的规格缺口，不破坏本轮已落地的判定核语义、不引入假绿、不影响 ship-gate 9/9 与断言账本——建议随 R101 顺手轨清偿或单独立小票，无需打回返工。

## 一、硬验收重跑实录（不信报告自述，亲自复跑）

| # | 验收项 | 命令 | 实测结果 | 报告声明 | 判定 |
|---|---|---|---|---|---|
| H1 | 编译（typecheck） | `corepack pnpm -w check` | 8/8 packages pass，exit 0 | ✓ pnpm -w turbo check/build | **兑现** |
| H2 | 构建 | `corepack pnpm -w build` | 5/5 tasks pass，exit 0 | ✓ | **兑现** |
| H3 | verdict 断言 | `node packages/store/test/handoff-lint-verdict.test.mjs` | **473 passed, 0 failed** | verdict 473（基线 463→+10） | **精确兑现** |
| H4 | e2e 断言 | `node packages/store/test/handoff-lint-e2e.test.mjs` | **450 passed, 0 failed** | e2e 450（基线 394→+56） | **精确兑现** |
| H5 | 九步船闸 | `node scripts/ship-gate.mjs` | **9/9 全绿，exit 0**（含 memory-eval 126/126、plugin MCP stdio initialize、packaged CLI/MCP observation smoke、fail-open boot） | 9/9 全绿 | **兑现** |
| H6 | main tip | `git rev-parse --short origin/main` | `ef296a2a` | origin/main tip ef296a2a | **兑现** |
| H7 | 工作树净 | `git status --porcelain` | 空 | 工作树净 | **兑现** |
| H8 | enforcement-anchors 腿 | （H5 step 1j 内） | **5/5 anchors consumer-verified** | anchors 5/5 | **兑现** |
| H9 | r100 claims 腿 | 直读 `.scratch/grill-round-100/closeout-claims.json` | **6 claims**：verbatim×4 + symbol×1 + **anchor-activity×1**（首演） | claims r100 6/6 含 anchor-activity 首演 | **兑现** |
| H10 | 打包形状 | （H5 step 4 内） | cli/dsh-plugin/embedding/kernel/mcp/plugin/retriever/store tarball shape ok | 五包 tarball pack + manifest/bin 形状验证 | **兑现** |
| H11 | T0 绿门改述 | 直读 `.scratch/grill-round-99/handoffs/round-99-closeout.md` | `Stack（dissolved @ 2026-10-06）` + 六死 SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）各保留 1 次散文史料 + re-anchor 注记 | T0 六死 SHA dissolved 改述 | **兑现** |

说明：H5 中 handoff-lint 腿对 r100 closeout 报 `PENDING {run-url:verification-unavailable:ref-unavailable}`——这是 land 后 ref 注销导致 run URL 本地不可再验的**设计态三态降级**（ADR-0097），非失败；gate 整体仍 exit 0 绿。

## 二、code-review 双轴评审（Standards + Spec，双子代理并行取证 + 本人复核）

### Standards（零硬违规，5 项判断级 smell）
- J1 `handoff-lint-shell.mjs` collectDeferred：新版去掉 `uniq(pendingAnchors)`，去重静默移除未文档化（下游 `seats.find` 取首匹配，重复坐席无害，但字段名不再暗示唯一）。
- J2 坐席迁移规则在 `collectDeferred` 与 `enforcement-anchors.normalizeSeat` 两处各自编码一次（string→object 分支在生产态近乎死代码）——真实 shotgun-surgery 缝，最可能的未来回归点。
- J3 `top-level-effects.mjs` 模块头自称「only reports facts」，但 AGENTS.md 把它描述为「adjudicates the closed exclusion list」——实际三分类裁决在 `vocab-scan.scanVocabGuards`，文件名/文档过度声明其权威。
- J4 `handoff-reanchor.mjs` 手写 argv 解析（一次性 CLI，可接受）。
- J5 `handoff-lint-verdict.mjs` stack-orphaned-by-land：`(orphanMembers===null && (orphanRef===null||undefined||""))` 守卫在两分支重复出现，可抽 helper。

### Spec（3 项真实缺口，均非假绿）
- **F1（弱化）** AST class-② RED 码未入封闭词表通道：`ast-codes-unverifiable` / `ast-top-level-effect` / `ast-excluded-codes` 以自由 `findings[].name` 字符串发出（`scripts/vocab-scan.mjs:154/161/165`），不在任何 frozen `*_CODES` 常量内，也不在 vocab-registry 封闭通道（后者仅映射 `stackRed→STACK_RED_CODES`）；且未进 e2e `REQUIRED_RED_COVERAGE`（`handoff-lint-e2e.test.mjs:239`），仅由合成根 inline assert 覆盖。比 D-002 谓词拿到的闭合度弱。
- **F2（弱化）** top-level-await 检测对常见形态失效：`top-level-effects.mjs:270` 仅识别 `const x = await ...`（变量初始化器）；裸 `await foo();` 语句走 `expression-statement` 分支（:229），永不带 `top-level-await` 专签——spec 具名的该违规向量被静默归并到泛类。
- **F3（措辞漂移）** `EXCLUDED_PATHS[0].reason`（`vocab-scan.mjs:54`）以行为理由（spawn launcher 起子进程）论证排除，未携带立法判据「无法命名空间注入」。轻微。

Spec 侧确认正确：fails 必填+封闭词表（5 锚回填）、tier 默认 red、互斥 `anchor-seat-info-conflict`、坐席限期/malformed/dead-seat RED、双读 legacy `LEGACY_SEAT_REVIEW_BY`、masking-surfaced 具名行、tau 递归 `scripts/**/*.mjs`、EXCLUDED_PATHS 首演、纯静态 TS API（lazy createRequire 零新依赖）、§5 第二勾、sunset 一行账只计生产 finding、三枚成对 fixture（positive RED / in-flight PENDING deny / still-pushed GREEN deny）。断言数只升不降满足。

## 三、D-xxx 决策逐条核对（缺失/弱化/跑偏单独列出）

| 决策 | 要求 | 实现证据 | 判定 |
|---|---|---|---|
| D-001 全做形态 | 1 正题 + T0 残留轨 + 3 cohesive + 触发器前置 | ADR-0101 Context 记账 + D2/D3/D5/D6/D7 五 Decision | **兑现** |
| D-002① instance 修复 | R99 六死 SHA dissolved 改述 + capture 留散文 | H11 实测 | **兑现** |
| D-002③ 检测瓣 | `stack-orphaned-by-land` 谓词 + 成对 fixture + 注册 | `handoff-lint-verdict.mjs:91` STACK_RED_CODES 第四元 + 3 fixture + CODE_GROUPS.stackRed 经既有 group 映射入封闭通道 | **兑现** |
| D-002④ §5 双绑 | post-land main tip 重验 + 签字扩域 | audit-checklist §5 第二勾 + handoff-reanchor.mjs | **兑现** |
| D-002⑤ reanchor 脚本 | 幂等改述+记 land SHA+落签字 | `scripts/handoff-reanchor.mjs`（84 行）+ paired test | **兑现** |
| D-003① fails 必填 | 封闭词表 + 5 锚回填 | failure_classes 5 类 + 每锚非空 fails ⊆ 词表 | **兑现** |
| D-003② tier 字段 | 默认 red 零迁移 | 5 锚 tier=red | **兑现** |
| D-003③ 互斥立法 | pending∩tier:info→RED | `anchor-seat-info-conflict` RED 码存在 | **兑现** |
| D-003④ sunset 一行账 | 只计生产 finding | closeout 锚活性一行账 + kind:anchor-activity claim | **兑现** |
| D-004① 坐席 Addendum | 结构化{anchor,reason,seated_at,review_by}+masking+限期 RED | 六新 RED 码各 2 文件（impl+test）；生产态无开坐席（唯一 pending_anchors 条目 closed@2026-10-05） | **兑现** |
| D-004② 双读迁移 | 旧串 seated_at:null + 迁移日设限 | `LEGACY_SEAT_REVIEW_BY` 2026-10-22 | **兑现** |
| D-004③ tau 递归+AST 三分类 | glob 递归 + 三分类 RED | `scripts/**/*.mjs` 递归 + 三分类逻辑 | **部分兑现**（class-② 闭合度弱=F1） |
| D-004④ AST 违规集白名单 | 顶层 expr stmt / side-effect import / top-level await / 非白名单 initializer | 前三者识别；top-level await 仅初始化器形态 | **部分兑现**（F2） |
| D-004⑤ tau-scan 排除首演 | 具名条目 + 判据=无法命名空间注入 | EXCLUDED_PATHS 首演 tau-scan.mjs | **兑现**（判据措辞漂移=F3） |
| D-004⑥ 顺带约束 | 纯静态禁运行 + typescript API 零新依赖 | lazy createRequire，零新依赖 | **兑现** |
| D-005 票序簿记 | T0 先行 / 3 PR / T3 并入 / T4 活链 Stack | diff 序列符合；closeout dissolved 态（land 已完成时写 dissolved，判据=写行时刻事实） | **兑现** |

**缺失：无。跑偏：无。弱化：F1（D-004③）、F2（D-004④）、F3（D-004⑤ 措辞）。**

## 四、过程违规呈报（不替 owner 追认）

**未发现需追认的过程违规。** 具体核验：
- 红基禁落账：T0 绿门 `r100-green-repair` ff-land @ `8d1854e2` 先于 T1/T2 commit，票序合规（diff 基线即 8d1854e2）。
- push/land 授权窗：T5 实录标注「owner 全授权窗」，land 序列 176e3afd→25704ff2→ab00b676→ef296a2a 完整在档。
- 断言数只升不降：463→473 / 394→450，单调上升，无回退。
- 范围外纪律：无越界（未重开评测矩阵 / 未动 formally-declined / approval-channel 仍 deferred 仅触发器注记）。
- 一处**观察项（非违规）**：`freshness leg` 对 `.scratch/grill-round-101/closeout-claims.json` absent 报 warn——属 R101 未开庭的 pre-registration 预期态，gate 按设计保持 warn 不阻断，非 R100 失守。

## 五、处置建议（职责分离：审计窗口不修）

F1/F2/F3 均非阻塞，**不打回原修复窗口返工**。两条路径供 owner 裁：
1. **并入 R101 顺手轨**（推荐）：R101 任务书候选 C「AST 排除候选入册」本就触碰同一 AST 判定域，可顺带把 F1（AST 码入封闭词表/REQUIRED_RED_COVERAGE）+ F2（裸 top-level await 专签）+ F3（排除判据措辞）一并清偿——同子系统 cohesive 通道（ADR-0029）。
2. **单独立小票**：若 R101 正题（候选 A defer-r72-dsh-approval-channel）优先，则 F1/F2/F3 挂 R102 候选。

无论谁修，修完必须重跑本报告第一节同一套验收（H1–H11）。

## Suggested skills（下一窗调用）

- `gitbutler`（全部 VC；push/land 须 owner 授权窗）
- `tdd`（若清偿 F1/F2：谓词/fixture 先行，正反成对）
- `code-review`（F1/F2 修复后 schema/消费方同 PR 复审）
- `domain-modeling`（若 R101 正题立项 ADR 条文落笔）
- `handoff`（R101 收口生成下轮任务书）

## 工件索引

- 本报告：`.scratch/grill-round-100/handoffs/audit-handoff.md`
- 审计日志（本机 .codex-tmp/，不入仓）：audit-r100-{check,build,verdict,e2e,shipgate}.log
- 下一轮任务书：`.scratch/grill-round-101/handoffs/next-round.md`（正题候选 A/B/C + T0 残留轨）
- 账本：`.scratch/grill-round-100/decision-ledger.md`
