# Round-79 独立审计 — pathlint 豁免域契约收敛（ADR-0080）

Date: 2026-09-23。审计对象 = r79-grill(nxx) + r79-impl(rmm→skq→ylk→lxs→sql)，基 f4031d23。审计窗只出报告不动手修；发现呈报用户裁决，不替追认。

## 硬验收亲跑（不信报告自述）

| 检查 | 亲跑命令 | 实录 | 判 |
|---|---|---|---|
| install | `pnpm install` | Already up to date（pnpm 11.24.0），零 lockfile 改动 | ✅ |
| typecheck | `pnpm run check` | turbo 8/8 green（FULL TURBO 缓存命中=输入未变，结论有效） | ✅ |
| 全量测试 | `pnpm run test` | turbo 7/8——store:test 红于 `test\adr-index.test.mjs`（78 tests / 1 fail；pathlint 14 例在该轮内全绿） | ❌ |
| pathlint 单测 | `node --import tsx --test test/ship-gate-pathlint.test.mjs`（packages/store） | tests 14 / pass 14 / fail 0 | ✅ |
| pathlint 直跑 | enumerateScopedMarkdown+buildEnv+scanLines 独立驱动 | SCANNED=332 VIOLATIONS=0 INFOS=752 | ✅（0 违例硬门成立；计数口径见 P-3） |
| ship-gate | `node scripts/ship-gate.mjs --skip-matrix` | step 1b fail-fast：`docs/adr/index.md is stale (80 ADRs at HEAD)`——1c–9（含 pathlint 1i/pack×8/MCP initialize/fail-open）全部未行使 | ❌ |
| 启动+测活 | `node apps/cli/dist/index.js --version` / `doctor` | 0.0.7 / 23 passed 2 skipped 0 failed | ✅ |
| 版本控制 | `but status` / `git status --porcelain` | r79-impl 5 commit 叠 r79-grill(nxx)，工作树零脏 | ✅ |

**根因（两腿同红）**：committed `docs/adr/index.md:87` 的 0080 行标题带「+ dogfooding 清剿」后缀；同一 commit sql 内提交的 ADR-0080 H1 无此后缀且其后未再改动。`gen-adr-index.mjs:44-49` 标题取自 ADR H1 的 HEAD git tree——committed 行不可能由 HEAD 生成 → index **出生即 stale**。等价推断：报告的「ship-gate 9 步全 pass / turbo test 13/13」绿证来自 commit 组装中间态，终态未复跑（P-1）。

## 声明 → 证据 → 结论 对照表

| # | 报告声明 | 实物证据 | 结论 |
|---|---|---|---|
| 1 | T0 三件套（L0 快照+L1 提取+结论行+观测窗口） | t0-l0-watch.json：versions=28、dist-tags latest=0.1.0-rc.6/next=0.1.5-rc.3/alpha=0.1.7-alpha.2、captured_at=03:15:04Z；t0-l1-alpha2-raw.json：union=27、removed 含 agent/session-start、featureAnchor=true、perPkg=6 包、familyPublished=21+missing=[dsh-code-runtime,cordis]；t0-watch-alpha2.md 结论行逐字在位 | 坐实 |
| 2 | T0 依赖面零脏 | rmm(f3e303dc) name-status 仅 3 个 evidence 文件；全栈 diff 无 package.json/pnpm-lock/pnpm-workspace 面 | 坐实 |
| 3 | rc.3/alpha.1 ≈09-24 出闸复核 | time map：rc.3=09-22T05:39:36Z、alpha.1=06:04:55Z、alpha.2=15:50:04Z；+2880min≈09-24，算术一致 | 坐实 |
| 4 | c1 红 fail 2/12、c2 红 fail 3/13、失败原因与条款语义一致 | t1-c1-red.md「tests 12 / fail 2」豁免域内 info 泄漏（另如实呈报补丁生成层次级失败）；t1-c2-red.md「tests 13 / fail 3」missing-marker FP+detectHits=1 | 坐实 |
| 5 | 改后 12/12→13/13→14/14 绿 | 单测实测 14/14；案例数随三 commit 递增一致 | 坐实 |
| 6 | `pnpm run check` turbo 8/8 | 亲跑 8/8 | 坐实 |
| 7 | `pnpm run test` turbo 13/13 | 亲跑 turbo 7/8，store:test 红（adr-index.test.mjs regenerate-and-diff 断言） | **失准（F-1）** |
| 8 | pathlint 直跑 scanned=330 violations=0 infos=736 | 亲跑 332/0/752——0 违例硬门坐实；计数为含未提交草稿的中间态快照（P-3） | 硬门坐实/计数不可复现 |
| 9 | ship-gate --skip-matrix 9 步全 pass | 亲跑红于 step 1b（fail-fast），1c–9 未行使 | **失准（F-1）** |
| 10 | `pnpm install` 零改动 | 亲跑 Already up to date | 坐实 |
| 11 | 存量文档零新增违例 | 终态直跑 332 文档 0 违例 | 坐实 |
| 12 | ADR-0080 六要素 | D1 三豁免面/D2 drift 归因文本侧/D3 Rejected alternatives/D4 风险+三重缓解/D5 结构性同构先例标注/D6 不 bump——全在位 | 坐实 |
| 13 | registry canonical+11 债 carried_log r79+E6 新条目 | byte-equal JSON.stringify(null,1)；entries=16/open=12（11 续债+defer-r79-lockfile-agegate-replay），12 条 open 全挂 round:79，deadline=2027-03-31 | 坐实 |
| 14 | CONTEXT 七词随 nxx 已落 | nxx diff 实测 +7 条目（Cohesion Tri-Test/Exemption-Domain Contract/Drift Attribution/Neighbor-Paired Assertion/Zero-Finding Conclusion/Evidence Mapping/Mirror Consistency Assertion）——括注词表为意译（P-4） | 坐实 |
| 15 | index 注册+.gitignore 白名单 | 0080 行在、头部范围 ADR-0001~0080、`.scratch/grill-round-79/**` 白名单在——但 index stale（F-1） | 部分（行在/新鲜度败） |
| 16 | 编译/打包/启动测活 | check 8/8、CLI 0.0.7、doctor 23-0-2——pack/MCP/fail-open 腿因 1b fail-fast 未行使（上轮已证绿，本轮未独立复验到） | 部分 |
| 17 | 豁免域三条款代码事实 | detect.mjs:142-148 fenced `continue` 先于 153 surfaced-skip（所有 fence 静默含未覆盖）；149/153/154 `!isLocator` 双闸；143-145 covered fence 全豁免仅记 fenceHadHit | 坐实 |
| 18 | 近邻成对 fixture | green.md:23-34/red.md:32-36 四对齐全（covered↔unmarked in-repo、fence /x↔散文 /etc、locator↔非 locator、foo_C:\x↔裸 C:\x） | 坐实 | <!-- machine-local: 判定器边界用例字面量复述（审计文书） @ 2026-09-23 -->
| 19 | 镜像一致性机器断言 | test case 14 grep 三关键词双载体在位——locator 关键词先于本轮已双在位，辨识力弱（F-6） | 坐实带弱化 |
| 20 | handoff（R80 候选/watch/#1764/外发闸） | round-80-next.md 在、E6 候选+watch 在——但缺「绿色 run URL」必填字段（F-2）、外发闸丢失（F-3）、#1774 出处失实（F-4） | 部分 |

## D-001~D-004 逐条核对

- **D-001**（主题定界）：F-3+F-4 合并单裁决 ✅、WORD_CHAR 同域工程分 commit ✅、T0 纯证据零代码 ✅、E6 拆出为 R80 候选记档未启动 ✅、11 落选债原名续记 ✅、L2 不响 ✅。✅
- **D-002**（Codify A2）：三豁免域立法双载体在位、drift 归因文本侧、三重缓解+先例层级标注如实、`/x` 静默范围=所有 fence+locator 行与代码一致。⚠️ F-7：ADR-0072:33/AGENTS.md:57 旧句未加「豁免域外」限定语，字面张力残留（语义由 non-exempt 邻句兜住）。
- **D-003**（票序）：T0(rmm)→T1 三 commit(skq/ylk/lxs)→T2(sql) 次序对；契约文本与 impl 同批；T2 全文书；fixture 红向改前实测有 transcript。✅（commit 内序与文本一致）
- **D-004**（收口判据）：取证段齐（零发现结论行+窗口戳+出闸复核）；契约段齐（两改+近邻成对+回归面+镜像断言）；文书段大体齐（ADR-0080/registry/CONTEXT/判据映射表/度量回写/白名单）。❌ 两处违约：handoff 缺必填 run-URL 字段+丢外发闸项（F-2/F-3）；「全绿」判据不成立（F-1）。另：equivalent 标注条款字面适用条件=「红态不可被近邻区分者」——Codify 钉死断言本非红态且 transcript 已注明「非红绿行使」，判 spec 字面模糊而非违例（登记 P-7）。

## 发现（呈报用户裁决，不替追认）

- **F-1（阻断）`docs/adr/index.md` 出生即 stale**：0080 行标题带「+ dogfooding 清剿」后缀，与 HEAD 树 ADR-0080 H1 不一致→`pnpm run test` 红（adr-index.test.mjs）+ `ship-gate` 红于 step 1b fail-fast。修法：`node scripts/gen-adr-index.mjs --write` 后 amend 入 sql（或新 commit）。注意：栈未 push 是运气——此态推 CI 必红。
- **F-2 `round-80-next.md` 缺「绿色 run URL」必填字段**：`docs/agents/handoff-template.md:16`（必填节）+:28-32「a missing/pending field is honest, an absent field is not」。报告的 PENDING 注记不能替代交接文档自身字段；round-78-closeout.md:16-22 有先例。
- **F-3 外发闸 watch 项在收口交接丢失**：next-round.md:38/45 与 D-003/D-004 均要求交接含外发闸（`.scratch/grill-round-75/drafts/` 两份 draft 用户动作项）；round-80-next.md 全文无外发/draft/round-75 引用——用户动作项被静默丢弃。
- **F-4 #1774 出处失实**：round-80-next.md:22 称「任务书点名编号」，git grep 1774 全仓唯一语义命中即该行自身（另一命中为 jsonl 浮点 0.1774199 巧合子串）。条目本体诚实标「未核实」，但出处声明是伪造的——改为「编号来源待考」或直接删出处句。
- **F-5 文档间数字不一致**：CHANGELOG:14「全仓 329 文档」vs 报告/交接「330」——同轮两文书对同一度量口径不一（329=lxs 时点、330=sql 组装中间态），需统一或注时点。
- **F-6（判断级）镜像断言弱腿**：关键词 `locator` 在 ADR-0072:31/AGENTS.md 修订前已双载体在位——该条款的镜像漂移检测实际只有 2/3 关键词有效。可换 R79 特有 token（如 exemption domain/covered fence 短语）。
- **F-7（判断级）契约文本残留张力**：ADR-0072:33「a governed marker does NOT exempt them」与 AGENTS.md:57 镜像旧句未随修正案加限定语，与同文件新增豁免条款字面相抵（语义可兜，字面不净——契约收敛轮的收敛对象自身）。

## 过程项（如实记档）

- **P-1** 验收跑在 commit 组装中间态、终态未复跑——F-1 的直接成因。报告把中间态绿写成终态绿，属本审计最重的过程违规。
- **P-2** 报告「豁免域近邻成对 fixture（green +12 行/red +5 行）」vs git stat 实测 green +11/red +4——计数措辞漂移 +1。
- **P-3** 报告「330 docs/736 infos」为含未提交草稿的中间态快照（enumerate 口径=git ls-files+-o，草稿计入）；终态实测 332/752。0 违例硬门不受影响，良性漂移（同 R78 P-5 先例）。
- **P-4** 报告括注「七词」为意译词表非字面条目名（实质 7 条目在 nxx，claim 成立）。
- **P-5** `_scan-fence.cjs` ROOT 硬编码机内绝对路径——committed 取证脚本不可移植（.cjs 在 pathlint 域外，仅登记）。
- **P-6** t0-watch-alpha2.md 内 tmp 目录与 t0-l1-alpha2-raw.json 内 tmp 目录不同（两次探针各自产物，无碍结论，登记）。
- **P-7** t1-c1-red.md 引用 `t1-c1-green.log` 文件不在库（有「或报告内联实录」兜底措辞，弱引用登记）。

## 双轴评审（$code-review）

### Standards（explore 子代理 + 审计窗亲验）

hard：F-1（generated artifact 与源不一致，违「do not edit by hand/ regenerate-and-diff」纪律+ADR-0059 D6）、F-2（handoff 必填字段缺席）。judgement：test.mjs:76-79 自带 fence 翻转逻辑重复 FENCE_RE（判定器边界测试自实现可接受，登记）；detect.mjs:153 无括号长行可读性；_scan-fence.cjs ROOT 硬编码（=P-5）。

### Spec（explore 子代理 + 审计窗亲验）

missing/partial：F-3（外发闸）、F-4（#1774 出处）、F-5（329/330）；equivalent 标注见 D-004 行判定（字面未触发）。scope creep：无实质项（lxs 的 r78 文书 marker 清剿=棘轮强制次生效应已呈报）。误判纠正：子代理疑「nxx 不在栈」——nxx=dad73222 在 r79-grill 分支，报告引用成立。

## 裁决建议

**不通过——打回修复窗返工。** 修复量小、范围明确：

1. `node scripts/gen-adr-index.mjs --write` 重生 index.md（消 F-1）——建议 amend 入 sql 或新 commit 于 r79-impl；
2. `round-80-next.md`：补「绿色 run URL」节（显式 `PENDING — stack unpushed`）+ 补回外发闸 watch 项（round-75 两 draft 用户动作项）+ 修正 #1774 出处措辞（消 F-2/F-3/F-4）；
3. CHANGELOG「329」与报告/交接「330」口径统一或加时点注（消 F-5）；
4. 判断级可选（用户裁）：F-7 旧句加「豁免域外」限定语；F-6 换 discriminating 关键词。不修则立债记档；
5. **修后重跑同一套验收**（审计窗复跑）：`pnpm install` / `pnpm run check` / `pnpm run test` / `node --import tsx --test packages/store/test/ship-gate-pathlint.test.mjs` / pathlint 直跑 / `node scripts/ship-gate.mjs --skip-matrix` / `but status` 零脏——全绿才算过闸。

绿色 run URL：栈未 push；且当前 HEAD 若推 CI 必红（adr-index），**勿推**。

审计驱动脚本（本会留证）：r79-audit-scan.mjs / r79-audit-scan2.mjs / r79-audit-scan3.mjs / r79-stack.diff 于机内 Temp 目录，不入库。

## 复审实录（2026-09-23 返修后同套验收重跑）

修复窗处置经审计窗逐条复核 + 同套验收重跑，全数坐实：

| 发现 | 处置证据（亲验） | 结论 |
|---|---|---|
| F-1 index.md stale | `gen-adr-index --check` → `up to date (80 ADRs at HEAD)`；index 0080 行=ADR H1 派生（旧后缀已除）；ship-gate 1b `[pass]`；store:test `adr-index.test` ✔ | 闭合 |
| F-2 交接必填段缺失 | `round-80-next.md` 已重写：Stack 行（but-id 主键）+「绿色 run URL」段 `PENDING — stack unpushed`；ship-gate 1g `handoff-lint` pass | 闭合 |
| F-3 外发闸丢失 | `round-80-next.md` + `round-79-closeout.md` 双载 `.scratch/grill-round-75/drafts/` 两份 draft 用户动作项 | 闭合 |
| F-4 #1774 出处失实 | `round-80-next.md` 零 1774 残留；closeout 实录如实记「出处未核实」 | 闭合 |
| F-5 计数口径不一 | report/CHANGELOG/closeout 统一 333；审计+closeout 入库后终态枚举=334（活枚举时点口径，ship-gate 1i 实测 `334 registered doc(s) clean`） | 闭合 |
| F-6 镜像断言弱腿 | 断言加 `exemption domain` 新词 + `toLowerCase` 大小写不敏双载体校验；14 具名用例全绿——返修记「15 cases」为计数漂移（断言强度提升而非用例数），记 P-8 注记不挡门 | 闭合 |
| F-7 旧句字面张力 | ADR-0072 补 `outside the codified exemption domain`；AGENTS.md 补 `outside the exemption domain codified below` | 闭合 |
| 返修自捕获 | step 1g `round-NN-*closeout*` 命名缺口 → `round-79-closeout.md` 新建（Stack/已完成/绿色 run URL/下一轮候选/risks/skills 全段）；coverage 4/4 pass | 闭合 |

同套验收重跑（亲跑，非转述）：`pnpm install` Already up to date；`pnpm run check` 8/8；`pnpm run test` 13/13（store 78/78 含 adr-index + pathlint 14）；pathlint 直扫 SCANNED=334 / VIOLATIONS=0 / INFOS=766；`ship-gate --skip-matrix` 全绿至 step 9 `ship gate green`（1b index fresh、1g coverage 4/4+handoff-lint、1i path-lint 334 clean、pack×8、T0 smoke、memory-eval 126/126、MCP initialize、8b packaged smoke、fail-open boot 全行使）；CLI 0.0.7 + doctor 23-0-2；`git status --porcelain` 空。

栈序终态（first-parent DAG）：`nxx`→`rmm`→`skq`→`ylk`→`run`(r79-audit)→`lxs`→`sql`——返修 amend 使审计 commit 物理落于 `ylk`↔`lxs` 之间（位置注记，内容与归属不受影响）。

观测注记：复审期 `ship-gate` 内嵌 test 腿曾瞬时红一次（kernel `llm-init.test.ts` SSE stub 竞态，并行负载下 flake），直跑与 turbo 复跑均绿——不计缺陷，挂 R80 watch。

**终裁：审计通过（返修后复审）。** 首轮 8 项发现全数闭合（F-6 附计数注记）；门禁终态全绿。移交载体：`round-79-closeout.md`（本轮收口实录+下一轮候选）+ `round-80-next.md`（R80 方向）已就位；审计窗自身交接见 `round-79-audit-closeout.md`。
