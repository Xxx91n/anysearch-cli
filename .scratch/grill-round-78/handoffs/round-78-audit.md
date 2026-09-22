# Round-78 独立审计 — 治理工具链校准（repin 拦截实测 + pathlint 判定器重构）

Date: 2026-09-22。审计对象 = r78-grill(kok)+r78-impl(nkv→zun→ryr→qqy→ovm→zrz→tnt)，基 `d564ba20`。审计窗不动手修；发现呈报用户裁决。

## 硬验收亲跑（不信报告自述）

| 检查 | 亲跑命令 | 实录 | 判 |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | Already up to date，exit 0 | ✅ |
| typecheck | `pnpm turbo run check` | 8/8 green | ✅ |
| 全量测试 | `pnpm turbo run test --continue=dependencies-successful` | 13/13 green（pathlint 新测随 store 行使） | ✅ |
| pathlint 直跑 | `cd packages/store && node --import tsx --test test/ship-gate-pathlint.test.mjs` | 9 pass 0 fail | ✅ |
| ship-gate | `node scripts/ship-gate.mjs --skip-matrix` | 全绿：`ship gate green — ready to tag`（invariants/task-parity/gen-adr-index 79/pathlint 318 文档净/pack×8/memory-eval 126-126/MCP stdio/fail-open boot） | ✅ |
| 启动+测活 | `node apps/cli/dist/index.js --version` / `doctor` | 0.0.7 / 23 passed 2 skipped 0 failed | ✅ |
| 版本控制 | `but status` / `git status --porcelain` | r78-impl 7 commit 叠 r78-grill；零脏 | ✅ |

注：报告记「317 文档净 / 754 info」，本次实扫 **318 文档 / 757 info**——口径为活枚举（报告落盘后文档数增长），良性漂移非失真。

## 声明 → 证据 → 结论 对照表

| # | 报告声明 | 实物证据 | 结论 |
|---|---|---|---|
| 1 | detect.mjs 161 行新模块+1i 接线 | `wc -l`=161；ship-gate.mjs:36 import + 1133-1146 调用；旧 PATH_RE 块净除 | 坐实 |
| 2 | 四类新 token+字面形统一「token+分隔符=locator」 | CLASS_RES 七类正则（detect.mjs:43-51）；散文不报（59-63 行边界守卫） | 坐实 |
| 3 | `/x` 单段根 info surfaced-skip | detectSurfacedSkips（71-84）；ship-gate 757 info 实录 | 坐实 |
| 4 | 失效标记棘轮腿 | scanLines 154-158 + fence-cover 134；fixture 断言 kind=stale-marker | 坐实 |
| 5 | inline code 不豁免 | red.md:20 红向固化+测试断言 | 坐实 |
| 6 | warn-first 313 文档 96 违例（93/2/1）+685 info | `evidence/t1-warn-sweep.md` 头行计数逐字一致 | 坐实 |
| 7 | 97 动作/52 文件处置，复扫 0 | transcript 逐行点算=94 append+2 remove-line+1 strip-inline=97；unique 文件=52 | 坐实（commit message 分类小注 93+2+1 措辞漂移，见 P-3） |
| 8 | 红绿 fixture 成对+9 断言 | 9 个 test 块全绿；红=两类逃逸实例固化+全 token 类 | **部分坐实**：UNC/AppData 类缺绿向对（见 F-2） |
| 9 | `minimumReleaseAgeIgnoreMissingTime:false` 落盘+install 绿 | pnpm-workspace.yaml:14 在案；frozen install 绿 | 坐实 |
| 10 | E1-E4 一致/E5 语义一致/E6 证伪/E7 记档 | `evidence/t0-repin-matrix.md` 逐格 transcript（含 E6a-e 五变体、exit 码、标本龄期锚） | 坐实（证伪如实呈报，符合 D-005 预合法化路径） |
| 11 | 真身字节零脏 | worktree sha256 ≡ HEAD（ws yaml `b6dcbbbe…`/lock `ce7fdbe9…`）；porcelain=0 | 坐实（报告引 `c68dfcff` 为 T0 时点 pre-ryr HEAD 快照，时序一致） |
| 12 | ADR-0079 七要素+index 79 条 | D1-D5 全在案（判定器/三层豁免/棘轮/矩阵实录/收窄/加固/不 bump）；ship-gate `79 ADRs at HEAD` | 坐实 |
| 13 | registry 核销+11 债 carried_log r78 | `deferred-registry.json`：目标债 status=closed+closed_by=ADR-0079；round:78 carried_log 共 12 条（11 open+自身 1） | 坐实 |
| 14 | upgrade-ledger v2 消解 | `.scratch/grill-round-77/upgrade-ledger.md`:60-61 消解+收窄断言落锚 | 坐实（next-round.md 写 round-73 系任务书陈旧指针，见 P-4） |
| 15 | 不 bump | 8 包全 0.0.7（ship-gate pin 腿） | 坐实 |
| 16 | scratchDocDirs 已含 evidence/handoffs/reports | config 实物含三项 | 坐实 |
| 17 | 「r78-impl 栈 6 commit」 | but status 实录 **7** commit（nkv…tnt） | **失准**（P-5，+1） |
| 18 | 无 functional change 混入 docs commit | qqy/ovm/zrz/tnt 全文书+registry+evidence；驱动脚本随 evidence 归档 | 坐实（evidence 下 .mjs driver 为可复跑实录，惯例可接受，见 P-6） |

## D-001~D-006 逐条核对

- **D-001**（主题定界）：仅清算两件 R77 残账；落选债未动仅续记。✅
- **D-002**（判决矩阵）：7 格预登记先于实验（kok 先于 impl 栈）；逐格实录；断言收窄落三处锚（ADR-0079 D3/ledger D-006/upgrade-ledger）；IgnoreMissingTime:false+install 绿。✅
- **D-003**（判定器 A++）：除「每 token 类红绿成对」中 UNC/AppData 缺绿向外全落地（F-2）。⚠️ 一项部分
- **D-004**（票序）：T0→T1 三 commit→T2 次序对；**commit 内序为 fix→refactor→chore**，D-004 文本列序 refactor/fix/chore——报告明示理由（每 commit 在各自代际皆绿可二分），属已声明有据偏离。⚠️ 呈报
- **D-005**（三段收口+证伪合法）：三段齐；E6 证伪如实；窗口内完成未错过。✅
- **D-006**（实测落档）：transcript+ledger+ADR+upgrade-ledger 四锚一致。✅

## 发现（呈报用户裁决，不替追认）

- **F-1 CHANGELOG 缺 R78 轮次条目**（convention 违例，建议返工级）：r74/r75/r76/r77 四轮连号均有 `## Unreleased — ADR-XXXX rNN:` 段（含不 bump 文书轮）；本 diff 对 CHANGELOG 仅两处 marker 追加，无 r78 段。audit-checklist 有「CHANGELOG 补轮次条目」返工先例。任务书未显式列 CHANGELOG，故定为惯例违例非明文违约。
- **F-2 红绿成对缺两类绿向**（spec 部分缺口，轻重由用户裁）：D-003(6)「每 token 类红绿成对」——UNC(`\\host\`)/AppData 两类只有红向，green.md 无已标记/散文对例。补法=green.md 各加一条 marked 行+断言，小修。 <!-- machine-local: 判定器 token 形态示例引用（审计文书） @ 2026-09-22 -->
- **F-3 存量教义缺口被 verbatim 搬移**（非本轮引入，登记候选）：marked fence 内与 `Stack:` locator 行的 in-repo 绝对路径不参与 in-repo 判定（旧码同构，diff 可证）。ADR-0072「markers 不豁免 in-repo」字面与实现存在既往张力——可立债，非 R78 缺陷。
- **F-4 surfaced-skip info 在 fence 内仍产出**（detect.mjs:141-142 先于 fenced 分支）：info 噪音层，非阻断。

## 过程项（如实记档）

- **P-1** 任务书指针失准：next-round.md:49 指 `.scratch/grill-round-73/upgrade-ledger.md`，实落 `.scratch/grill-round-77/upgrade-ledger.md`（v2 在后者；前者亦存在未动）。文书陈旧引用，交付物自身一致。
- **P-2** 报告矩阵表「6 commit」实录 7（tnt 收口批漏计）。数字失准无伤结论。
- **P-3** nkv commit message 分类数（93+2+1）与 transcript（94 append+2 剥行+1 strip-inline=97）措辞漂移；总数 97 一致。
- **P-4** T0 过程事故（node -e `$` 展开啃坏 ws yaml→快照恢复）已双处如实记档（transcript:54+报告偏差段），非隐瞒。
- **P-5** ship-gate 扫描计数漂移（317→318/754→757）属活枚举良性。
- **P-6** Standards 轴 judgement 级气味（不阻）：detect.mjs:38 WORD_CHAR 缺 `_` 边缘 FP（`foo_C:\x` 会报） <!-- machine-local: 判定器边界用例引用（审计文书） @ 2026-09-22 -->；markerAny 同语句双测；evidence 三 driver 头部样板重复；buildEnv 信任 cfg 字段（校验只在 ship-gate 侧，driver 直跑崩溃式 fail）；remediate driver 取首命中类作 reason 且 malformed 场景留旧 marker 在行内。

## 裁决建议

**硬验收全绿 + 19 声明 17 坐实/1 部分/1 失准 + 双轴评审** —— 裁为「**通过附两项待裁发现**」：

- F-1（CHANGELOG 补 r78 段）与 F-2（UNC/AppData 绿向补齐）皆小而明确，建议**打回修复窗一次补两格**（docs commit），修后重跑：pathlint 直跑+ship-gate --skip-matrix+git 零脏即可，无需重跑全量 turbo。
- 若用户裁 F-2 为「散文面已覆盖绿向语义，不补」，则仅 F-1 返工或直接批准收口——请裁决。
- F-3/F-4 建议立登记债（下轮裁决），不阻塞本轮。

绿色 run URL：栈未 push，PENDING（同 closeout 口径）。
