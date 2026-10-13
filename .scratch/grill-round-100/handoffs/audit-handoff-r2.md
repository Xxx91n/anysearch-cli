# R100 二次审计交接（audit-r2）— grill-round-100 → 下一窗

- 日期：2026-10-13 | 身份：审计 Agent（只出报告，不动手修）
- 审计对象：R100 全轮闭环交付栈 + 一审后修复三 commit（origin/main tip `58f10f95`；diff 基线 `8d1854e2..58f10f95`，25 commits / 35 files / +1873-75）
- 输入源件：`.scratch/grill-round-100/reports/2026-10-08-report.md`（含 T5 证据表）+ `handoffs/round-100-closeout.md`（dissolved 态）+ `.scratch/grill-round-101/handoffs/next-round.md`（defer-r72-approval-channel 触发器前置候选在列）+ 一审 `handoffs/audit-handoff.md`（PASS + F1/F2/F3）+ `closeout-claims.json` + `decision-ledger.md`（D-001~D-005）+ `goal.md` + `evidence/t0-land-record.md`
- 唯一事实源：`.scratch/grill-round-100/decision-ledger.md`（D-001~D-005 全 current）

## 结论（先给判定）

**审计通过（PASS）。** 无 blocker（验收未达 / 声明证伪 / 引入回归三者皆无），无过程违规需追认。一审 F1/F2/F3 修复（`082e86ab`）经本窗独立复验真实落地且未引回归；报告关键声明逐条对仓库实物+远端 CI 抽查全部兑现，唯一陈数为「24 具名候选」（实测 23，B9）。11 项非阻塞发现（B1–B11）记入 `.scratch/grill-round-100/backlog.md`，不打回原修复窗口返工。

## 一、硬验收重跑实录（不信报告自述，本窗亲自复跑）

| # | 验收项 | 命令/途径 | 实测结果 | 报告声明 | 判定 |
|---|---|---|---|---|---|
| H1 | 编译 typecheck | `corepack pnpm -w check` | 8/8 packages pass，exit 0（turbo 缓存命中回放，输入哈希同） | pnpm check/build | **兑现** |
| H2 | 构建 | `corepack pnpm -w build` | 5/5 tasks pass，exit 0（同上缓存） | ✓ | **兑现** |
| H3 | verdict 断言 | `node packages/store/test/handoff-lint-verdict.test.mjs` | **473 passed, 0 failed**，exit 0 | verdict 473（463→+10） | **精确兑现** |
| H4 | e2e 断言 | `node packages/store/test/handoff-lint-e2e.test.mjs` | **458 passed, 0 failed**，exit 0 | e2e 450（394→+56）；修复 commit 再加断言 | **兑现且超出**（458≥450，只升不降满足） |
| H5 | 九步船闸 | `node scripts/ship-gate.mjs` | **9/9 全绿，exit 0**：step0 不变式 / step1 静态+parity / 1b ADR 索引 101 / 1g handoff-lint（r100 closeout→PENDING{ref-unavailable}，land 后设计态降级）/ 1i path-lint / 1j anchors **5/5 consumer-verified** / step2 domains / step3 turbo check+test+build（内嵌 473/458 复绿）/ step4-5 pack+tarball shape / step6 T0 smoke / step7 **memory-eval 126/126** / step7b override verifier / step8 plugin **stdio initialize** / 8b packaged CLI/MCP observation smoke / step9 **fail-open boot** | 9/9 全绿 | **兑现** |
| H6 | main tip | `git rev-parse --short origin/main` + `but status` | `58f10f95`，工作树净，gitbutler/workspace 无未提交 | 一审对象 tip `ef296a2a`（审时正确，今已推进 3 commit） | **兑现**（范围顺延至 tip） |
| H7 | 工作树净 | `git status --porcelain` / `but status` | 空 / (no changes) | 净 | **兑现** |
| H8 | anchors 腿 | `runEnforcementAnchors({root})` 直跑 | `exitKind: pass`，5/5 consumer-verified（probe detail 携 ast-candidates 23 名） | anchors 5/5 | **兑现** |
| H9 | r100 claims | 直读 `closeout-claims.json` + ship-gate claims 腿 | 6 claims：verbatim×4 + symbol×1 + anchor-activity×1（首演，逐字重导校验在 `ship-gate.mjs` claims 腿） | claims 6/6 含 anchor-activity 首演 | **兑现** |
| H10 | 打包形状 | （H5 step4-5 内） | 8 包 tarball shape+manifest/bin 全 ok（cli/dsh-plugin/embedding/kernel/mcp/plugin/retriever/store） | 五包 tarball | **兑现**（实 8 包，声明偏保守） |
| H11 | T0 绿门改述 | 直读 `.scratch/grill-round-99/handoffs/round-99-closeout.md` | `Stack（dissolved @ 2026-10-06）`+六死 SHA 各留 1 次散文史料+re-anchor 注记 | T0 dissolved 改述 | **兑现** |
| H12 | 远端 CI 证据 | `gh run view` ×12 | **12/12 全数对上**：T0 四跑（37712802985/37712808007/37713569426/37713569449/37713569413）success@8d1854e2；分支 ci 37717251731 success@12098d9c（=closeout GREEN head_sha）；ship-gate 37717256357 **failure**@12098d9c（declaration-fact-conflict 设计内升级）；37717744192 success@176e3afd；**37718564771 failure@176e3afd（stack-orphaned-by-land 生产首演实红）**；post-land 三跑 37725106944/37725106979/37725106947 success@ab00b676 | T0/T5 全部 run 结论 | **逐条兑现**（含两个「设计内红」未被粉饰为绿） |
| H13 | AST 扫面 | `scanVocabGuards({root})` 直跑 | ok:true，枚举 38，**具名候选 23**，findings=0 | 24 candidates | **陈数**（B9：报告沿写 24，实测 23） |
| H14 | 危险方向复核 | 逐文件独立复分类 `classifyTopLevel`×38 | 零漏报候选（该报未报=0）/ 零幻影候选 / 零携码候选 | 0 误判 | **兑现**（fail-closed 方向无失守） |

## 二、code-review 双轴评审（Standards + Spec 双子代理并行取证 + 本人逐条复核）

### Standards（0 硬违规，11 项判断级）

- 文档纪律零违规：唯一机外路径（一审输入 `any.txt`）带合规 `<!-- machine-local -->` 标记（`58f10f95` 补钉生效）；封闭词表通道全走 frozen `*_CODES`；verdict 核零 I/O（docOnMain 经 shell `ls-tree` 采集、env 注入）；fail-closed 方向一致（未采集→env-PENDING）；断言只升不降。
- 判断级（全部落 backlog B3/B8/B11）：坐席迁移规则两处编码（J2 复核仍真）/ orphan 守卫重复（J5）/ `uniq(pendingAnchors)` 移除未文档化（J1）/ AST 白名单含 `sort`/`forEach`/`process.argv.*` 超窄集 / `handoff-reanchor` 空 mainSha 静默下行 / `ast-side-effect-candidate` 注释名漂移 / `REQUIRED_RED_COVERAGE` 未扩 / e2e 恒等冗余断言 / anchors.json 无尾换行 / `enumerateScriptFiles` 无 symlink 守卫 / `docPaths` rel-only（降级方向安全）。

### Spec（中×2 低×5 顺手越界×1，均非假绿）

- **部分兑现**：B1 `seatExpired` 坏 `now` 静默有效（违「fail-loud」条款字面，仅 deps 注入可达）；B2 `seatMalformed` 未全执四字段；B3 白名单宽于 D-004④ 窄集（假阴性方向）；B4 class-③ 无具名 info 行+注释漂移；B6 R4 名单未扩新码；B7 anchor-activity claim 存在性无强制。
- **顺手越界（轻微）**：PURE_* 白名单 ~70 callee（spec 只点名 Object.freeze/RegExp/字面构造类）——同 B3。
- **确认正确**：fails⊆封闭 `failure_classes` 且非空、tier 默认 red 零迁移、`anchor-seat-info-conflict` 互斥 RED、`LEGACY_SEAT_REVIEW_BY=2026-10-22` 双读、`masking-surfaced` 具名（坐席+锚双名）、`stack-orphaned-by-land` 第四元+三成对 fixture+模板 `stack-red` 四元同步、`scripts/**/*.mjs` 递归、EXCLUDED_PATHS 首演（F3 措辞已修为「cannot be namespace-injected」）、纯静态 lazy createRequire 零新依赖（package.json/lockfile diff 空）、§5 第二勾、reanchor 幂等配对、anchor-activity 逐字重导、一审 F1/F2/F3 修复真实且成对带测。

## 三、D-xxx 决策逐条核对

| 决策 | 要求 | 实现证据 | 判定 |
|---|---|---|---|
| D-001 全做形态 | 1 正题+T0+3 cohesive+触发器前置 | ADR-0101 Context+D2/D3/D5/D6/D7 五 Decision | **兑现** |
| D-002① instance 修复 | R99 六死 SHA dissolved+capture 留散文 | H11 实测 | **兑现** |
| D-002②③ 检测瓣 | 谓词+成对 fixture+封闭通道注册 | `STACK_RED_CODES` 第四元（verdict:91）+3 fixture（正红/双 deny 绿）+`CODE_GROUPS.stackRed` | **兑现** |
| D-002④ §5 双绑 | post-land main tip 重验+签字扩域 | audit-checklist §5 第二勾（post-land 三跑∧改述机械位） | **兑现** |
| D-002⑤ reanchor 脚本 | 幂等改述+记 land SHA+落签字 | `scripts/handoff-reanchor.mjs`（84 行）+ e2e 配对（正改述/幂等反例）+生产首演 `25704ff2` | **兑现**（B5 潜伏路径另列） |
| D-002⑥ 处死入账 | B/C/第四案判例 | ADR-0101 Consequences 四处死判例全录 | **兑现** |
| D-003① fails 必填 | 封闭词表+5 锚回填 | `failure_classes` 5 类+每锚非空 fails⊆词表（实测 JSON） | **兑现** |
| D-003② tier | 默认 red 零迁移 | 5 锚 tier 全 red | **兑现** |
| D-003③ 互斥 | pending∩info→RED | `anchor-seat-info-conflict` 在 `ANCHOR_RED_CODES`+消费路径 | **兑现** |
| D-003④ sunset 一行账 | 只计生产 finding+半机检 | closeout 首行+`kind:"anchor-activity"` 逐字重导（claims 腿）；fixture kill 不入账 | **兑现**（claim 存在性无强制=B7） |
| D-004① 坐席三件套 | 结构化+masking+限期 | 六新 RED 码+`normalizeSeat`+`masking-surfaced` 具名行；生产无开坐席（`pending_anchors:[]`，deferred 无 pendingAnchors 键） | **兑现**（四字段未全执=B2） |
| D-004② 双读迁移 | 旧串 seated_at:null+迁移日设限 | `LEGACY_SEAT_REVIEW_BY="2026-10-22"`+`normalizeSeat` legacy 支+e2e 演练 | **兑现**（B1 坏-now 静默另列） |
| D-004③ tau 递归+三分类 | glob 递归+RED 双支+③具名排除 | `scripts/**/*.mjs` 实测 38 枚举；①②分支经 `AST_FINDING_NAMES` 封闭集+e2e 成员锁（F1 已修）；③落 candidates | **部分兑现**（③无具名 info 行+注释漂移=B4） |
| D-004④ AST 白名单 | 顶层四向量+窄集 | 四向量识别（含裸 `await` 专签，F2 已修）；白名单含 sort/forEach/argv 超窄集 | **部分兑现**（B3） |
| D-004⑤ tau-scan 排除首演 | 具名条目+判据=无法注入 | `EXCLUDED_PATHS` 首演+reason 已修为「cannot be namespace-injected」（F3 已修） | **兑现** |
| D-004⑥ 顺带约束 | 纯静态禁运行+TS API 零新依赖 | lazy createRequire；package.json/lockfile diff 空 | **兑现** |
| D-005 票序簿记 | T0 先行/3 PR/T3 并入/T4 活链→dissolved | commit 序 8d1854e2→…→ef296a2a→082e86ab→58f10f95 符合；closeout dissolved 态 | **兑现** |

**缺失：无。跑偏：无。弱化：B1–B4（D-003④/D-004①③④ 字面残差），已入 backlog。**

## 四、报告关键声明 → 证据 → 结论 对照表

| 报告声明 | 本窗证据 | 结论 |
|---|---|---|
| verdict 463→473 / e2e 394→450 | H3 473 精确 / H4 458（修复再加断言） | 兑现（e2e 超出声明） |
| ship-gate 9/9 全绿 | H5 本地复跑 exit 0 九步全绿 | 兑现 |
| anchors 5/5 consumer-verified | H8 `exitKind: pass` + gate 1j 内嵌复证 | 兑现 |
| claims r100 6/6 含 anchor-activity 首演 | H9 JSON+claims 腿逐字重导 | 兑现 |
| T0 六死 SHA dissolved 改述 | H11 逐字核对（各 1 次史料+注记） | 兑现 |
| T0 land `8d1854e2` ff+三跑绿 | H12 run×4 success@8d1854e2 | 兑现 |
| 交付栈双道 push `2794826f`/`12098d9c` | git 历史在列+ci success@12098d9c | 兑现 |
| ship-gate 37717256357 failure=declaration-fact-conflict | gh 实测 failure@12098d9c | 兑现（未粉饰） |
| `but land --whole-stack` ff-land `176e3afd`+ref 注销 | git 历史+run head_sha 对位 | 兑现 |
| 谓词生产首演 37718564771 RED | gh 实测 failure@176e3afd | 兑现（设计内红窗实红） |
| 重锚 `zok`→land `25704ff2`；清算坐席 `ab00b676` | git 历史+post-land 三跑 success@ab00b676+registry `"status":"closed"` | 兑现 |
| AST 24 具名候选 | H13 实测 23 | **陈数**（B9，非证伪——检测面无回归） |
| 谓词窗口红是设计产物非失守 | H12 红→25704ff2 重锚→ab00b676 绿 序列闭合 | 兑现 |
| 无开坐席生产态 | anchors.json `pending_anchors:[]`+deferred 无 pendingAnchors | 兑现 |
| 断言数只升不降 | 463→473 / 394→450→458 | 兑现 |

## 五、过程违规呈报（不替 owner 追认）

**未发现需追认的过程违规。** 核验项：

- 红基禁落账：`8d1854e2`（T0 land）先于全部 T1/T2 commit，票序合规。
- push/land 授权窗：T5 实录标注 owner 全授权窗；land 序列 `176e3afd→25704ff2→ab00b676→ef296a2a` 与远端 run 对位一致。
- dissolved 禁预写：`25704ff2` 重锚 commit 在 `176e3afd` land 之后——写时事实合规。
- 断言数单调上升；审计修复三 commit（`082e86ab` fix/`688df733` docs/`58f10f95` docs）标记规范，未混入实现外内容。
- 一审 F1/F2/F3 处置走「单独立小票」路径（owner 裁定权内），修复后经本窗复验为真。
- 观察项（非违规）：①ship-gate freshness 腿对 r101 closeout-claims absent 报 warn——pre-registration 预期态；②handoff-lint 腿对 r100 closeout 报 PENDING{ref-unavailable}——land 后 ref 注销的设计态三态降级（ADR-0097）；③audit-handoff.md 文/讯漂移（B10）。

## 六、处置建议（职责分离：审计窗口不修）

11 项发现全部非阻塞，记入 `.scratch/grill-round-100/backlog.md`。建议优先级：B3（白名单假阴性方向）> B1（fail-loud 方向）> B4/B6/B7（机制缺口）> B2/B5 > B8 > B9–B11。B3/B4/B6/B7 与 R101 任务书候选 B/C（sunset N 值、AST 排除入册）同子系统，可随顺手轨清偿；B9 建议 R101 开庭时直接以 23 为准。

无论谁修，修完必须重跑本报告 §一 同一套验收（H1–H14）。

## Suggested skills（下一窗调用）

- `gitbutler`（全部 VC；push/land 须 owner 授权窗）
- `tdd`（清偿 B1/B2/B5：正反成对 fixture 先行）
- `code-review`（B3/B4 修复后 schema/消费方同 PR 复审）
- `handoff`（R101 收口生成下轮任务书）


## 七、修复窗 LOOP 复核实录（2026-10-13，owner 授权「小问题直接修」）

审计窗口身份解除→修复窗。backlog B1–B7 + B9–B11 已清偿（见 `.scratch/grill-round-100/backlog.md` 已清偿表）；B8 与 B3/B7/B11 残余口径呈报 owner 拍板。

修复内容：`enforcement-anchors.mjs`（seatMalformed 四字段全执 / seatExpired 双操作数 fail-loud）；`top-level-effects.mjs`（白名单剔 sort/reverse/forEach/process.argv.*）；`vocab-scan.mjs`（ast-side-effect-candidate 入封闭集 + scan.info 具名行巷）；`enforcement-anchor-probes.mjs`（detail 增 ast-info 面）；`handoff-reanchor.mjs`（mainSha hex 守卫 exit 2）；`ship-gate.mjs`（round≥100 claims 必带 anchor-activity）；`handoff-lint-e2e.test.mjs`（R4 名单改派生式全覆盖 + 六组新配对断言）；簿记（任务书 24→23 / 一审补记 / anchors.json 尾换行）。

复核（同一套验收重跑）：verdict 473/0（不变）；e2e 458→**471/0**（+13 断言，只升不降）；实扫 38 枚举/23 候选/0 findings/**23 具名 `ast-side-effect-candidate` info 行**（白名单收窄零翻转）；**ship-gate 9/9 复绿 exit 0**（gate 输出可见 `ast-info=` 23 具名巷；r100 claims 腿在新 B7 守卫下过闸）。插曲：一次复跑在 `@anysearch-cli/cli#test` 的 `search --vertical-domain finance` 用例超时红——单包重跑 22/22 绿，定性负载抖动 flake（cli 与本轮改面无依赖边），复跑全绿。

## 工件索引

- 本报告：`.scratch/grill-round-100/handoffs/audit-handoff-r2.md`
- 发现登记：`.scratch/grill-round-100/backlog.md`
- 一审报告：`.scratch/grill-round-100/handoffs/audit-handoff.md`
- 账本：`.scratch/grill-round-100/decision-ledger.md`
- 审计日志目录 `C:\Users\ADMINI~1\AppData\Local\Temp\audit-r100r2\`（check/build/verdict/e2e/shipgate/round100.diff/commits.txt/stat.txt）<!-- machine-local: 本机临时审计输出，不入仓 @ 2026-10-13 -->
- 落地：`r100-audit-r2` 分支经 `but land` ff-land 入 origin/main，tip `0ab9e0e0`；四 commit 按 docs/fix/docs/docs 序（`3817aa2d`/`cc8d95b9`/`7fabbf49`/`0ab9e0e0`）。
