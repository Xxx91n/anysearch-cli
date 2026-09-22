# Round-77 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
`r77-grill` → `zry`（账本/任务书定稿+CONTEXT七词+调研存档+round-77白名单）；`r77-impl`（叠于其上）→ `pqr`（T0 轨一探针取证 evidence 三件+三 transcript）→ `nwr`（T1 轨二 backlog 七项清算+测试）→ `wvu`（T2 文书批：ADR-0078+registry 双锚改写+ledger v2+CHANGELOG+本 closeout 初稿）→ `pmt`（index regen 78 条）→ 收口批（报告+探针行使日志+本行定稿，change-id 见 `but status`）

主题：双轨「治理残账清算」——轨一 dsh 上游观测哨分层漏斗落地（L0 元数据哨/L1 tarball 静态探针/L2 安装彩排仅合格候选）+特征/稳定性双锚触发器（版本号退出触发逻辑）+latest-only 墓碑制；轨二 R76 审计 backlog 七项全清。

## 已完成

- **T0 轨一探针取证**（零源码/lockfile/workspace 改动，git status 零脏）：`evidence/t0-l0-watch.json`（23 名全族 versions+publish time+dist-tags；0.1.5-rc.3@next 05:39Z、0.1.7-alpha.1@alpha 06:0xZ 均龄期闸内，出闸≈09-24）；`evidence/t0-api-snapshot-rc2.json`（pin 版消费面：Events union 37 键含 cordis 9 internal/*；index.ts:87 消费 `agent` 字段）；三份 L1 transcript（`t0-l1-0.1.5-rc.3.md`/`t0-l1-0.1.6-alpha.2.md`/`t0-l1-0.1.7-alpha.1.md`）+ 0.1.6-alpha.1 点探。逐版本显式判定：**rc.3 无 alarm**（Events 面 ≡rc.2 零漂移——改名未上稳定线）；**alpha.1/alpha.2/0.1.7-alpha.1 全 ALARM**（session-start 键移除+created 携 source/signal）；**payload 在 alpha 线内零再变**；**0.1.7 家族 dep-closure 扩至 21 dsh-***（+ptc-runtime/sandbox/sandbox-policy/session-persistence/storage/storage-domain/workspace，alpha.2 另退出 code-runtime——采纳轮 overrides 必须按新锁文件重推导）。三问全答。
- **T1 轨二七项全清**（commit `nwr`）：①titleRound 锚定 title 行首（句中「Grill Round N —」提及不误登记）；②`ROUND_DIR_RE` 全名匹配 `grill-round-7x`→n=null 显式判红；③coverage 红 defer-exit 序真门实测坐实（fixture commit：round-98 空目录+round-99 伪 closeout → `[fail] closeout-coverage: 3 violation(s)` 先于 `[fail] handoff-lint` 双诊断全出，exit 1——探针 commit 已 discard 未留史）；④`CANONICAL_JSON_FILES` 空清单 fail-closed（`governedListViolation` 导出+接线；真门探针临时置空 → `[fail] canonical-json: ... is empty` exit 1，探针已 discard）；⑤F-5⑥ gen-adr-index renderBlock↔parseRegisteredRounds 互注（row 形态/表头字面量/BEGIN-END 双向契约点名）；⑥gov-r76 条目补 `deadline`/`review_cadence`（canonical normalize 流程+字节锁实证 sha 变换后 PASS）；⑦F-6 BOM 专门报错（EF BB BF 签名+`subarray(3)` strip 命令，不发 normalize 指针）。测试 41→46、19→25 全绿。
- **T2 文书收口**：`defer-r73-dsh-event-rename` 触发器双锚改写（特征锚：候选 .d.ts `agent/created` 携 source/signal 且 `agent/session-start` 缺席；稳定锚：rc-or-stable 线；版本号退出触发逻辑）+monitoring_channel 改 L0/L1/L2 漏斗语义+`tombstones` 字段（0.1.6-alpha.1/alpha.2 superseded-by 0.1.7-alpha.1）+10 条 open 债 carried_log r77 显式续债；`upgrade-ledger.md` v2（漏斗重排+改名映射纠偏：rc.2 session-start 本携 source+v1「旧载荷{agent}」修正+L1 预测↔实裁对账+墓碑表+no-qualifying-candidate 结论）；ADR-0078 落档+index regen 78 条；pathlint 自证（round-77 文档全在已登记 doc dirs：handoffs/evidence/reports，config 无需改）。
- **门禁全绿**：`pnpm run check` 8/8；`pnpm run test` 13/13（两测试文件随 turbo 行使）；`node scripts/ship-gate.mjs --skip-matrix` 65 pass/0 fail（含 pack×8、MCP stdio initialize、scrubbed-env fail-open boot、pathlint 300 docs）；`node packages/store/test/closeout-coverage.test.mjs` 46/46 + `governed-json-canonical.test.mjs` 25/25 直跑。
- **进程测活**：`node apps/cli/dist/index.js --version`=0.0.7；`doctor` 25 passed/0 failed。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r76-audit 栈 land a797815a，为本轮历史祖先）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346942
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346911
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346920

## 下一轮候选

- **defer-r73-dsh-event-rename watch 续**（首要）：L0/L1 每上游发版照跑（npm view 全族 + npm pack .d.ts 消费面 diff vs `t0-api-snapshot-rc2.json`）；出闸后（≈2026-09-24 06:0xZ）若有 rc-or-stable 线版本携特征 → L2 彩排（expected-RED=`ctx.on('agent/session-start')` TS2345 单错）；alpha 线版本继续只 L1。
- **#1764 merge 观察哨**：`gh pr view 1764 --repo huggingface/transformers.js` —— 任务书记录其 2026-09-22 仍 open；merge 后核实发布版 manifest 携 `onnxruntime-common` 声明。
- **外发闸**（用户亲手发）：`.scratch/grill-round-75/drafts/pr-1764-comment.md` + `issue-1087-comment.md` 仍待用户审发；发后回录 drafts 头部 Status 行。
- canonical 锁翻案哨兵：`CANONICAL_JSON_FILES` 扩到 n≥5 且含多类型+全仓格式化需求 → 按 ADR-0077 D5 翻案条件迁注册制+prettier。

## Known risks / deferred

- 落选续债 10 条（原名逐字，`carried_log` r77 显式记）：`defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（本轮已处置 watch 义务，债身仍 open 待采纳）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-anysearch-domain-ownership`。
- L1 探针面=6 个 Events-augmenting 包（dsh-agent/llm/session/system-prompt/tools/user-approval）+ cordis 恒 4.0.2 不参 diff；若上游把 Events 合并块挪进新包（如 dsh-workspace）消费面 union 会漏——应对：L1 transcript 每版附 dep-closure 家族清单，新 Events-augmenting 包出现即扩探针面。
- WORKFLOW.md 缺位仍以范本+先例等价覆盖（R60/R70/R75 核销先例；本轮 §4.4 快照 `%TEMP%/r77-scratch-snap-20260922-172728` 在 discard 探针前已备）。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$atomcode-research`（上游再变时补研）· `$but`（版本控制）· `$code-review`（护栏复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用；探针 tarball 与临时脚本留机器临时目录未提交；两个 PROBE commit 已 discard。
