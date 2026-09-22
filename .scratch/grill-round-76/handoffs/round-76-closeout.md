# Round-76 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
`r76-grill` → `xwk`（账本/goal/任务书定稿+CONTEXT六词+q2/q3存档）；`r76-impl`（叠于其上）→ `pvz`（T0 canonical 锁+测试）→ `lpx`（T1 1g leg-b 重写+测试+t0 证据）→ `ntv`（T2 文书批：ADR-0077+registry 收口+CONTEXT+CHANGELOG）→ `qwu`（adr index regen 77 条）→ 报告+本交接（尾部 commit，见 git log）

主题：`defer-r71-shipgate-1g-coverage` + registry 格式漂移的同构清算——治理面静默漂移（治理机器自己 silent-report-green）：1g leg-b 完成信号改 ADR index 登记（登记即完成+三断言 fail-closed+floor=76+豁免显式化）；registry 字节锁（canonical `JSON.stringify(_,null,1)+'\\n'` + 不自修+normalize 指令）。

## 已完成

- **T0 registry 格式锁**：`scripts/governed-json.mjs`（canonicalJsonBytes/firstDifferingLine/normalizeCommand/governedJsonViolation）+ ship-gate step 1 内 `stepGovernedJsonCanonical()`（不开新编号腿）+ `CANONICAL_JSON_FILES=["docs/deferred-registry.json"]` 硬编码。验收实测：注入 8 空格重排 → `[fail] canonical-json: ... first differs at line 2 — normalize: node -e "..." — governed list: CANONICAL_JSON_FILES in scripts/ship-gate.mjs`（`evidence/t0-canonical-inject.log`，临时 commit 行使后 discard）；normalize 指令亲跑恢复 15065B canonical。registry `note` 自文档锁定声明落盘。`governed-json-canonical.test.mjs` 19/19。
- **T1 1g 修复**：`scripts/closeout-coverage.mjs`（CLOSEOUT_COVERAGE_FLOOR=76 规则生日 + isCloseoutName + parseRegisteredRounds fail-loud 解析器 + scanRoundDirs + assessCloseoutCoverage 三断言）；leg-b 重写完成信号=index 登记，字段 lint 面不动（仍只最新含 closeout dir）。实测：在飞态 `awaiting closeout: round 76 (ADR not yet registered)` + `0 registered / 0 completed at floor 76`（`evidence/t1-inflight-exemption.log`）；断言 (a) 登记后无 closeout 真红 `round 76: registered ... has no closeout doc`（`evidence/t2-assertion-a.log`）；断言 (b) 未登记 closeout 注入真红（fixture commit 注入 round-77 closeout 实测，`evidence/t2-assertion-b.log`）；断言 (c) 空推导/不可解析在模块层行使（真 gate 被 1b regenerate-and-diff 结构先行拦截，报告记诚实注记）。`closeout-coverage.test.mjs` 27/27。
- **T2 文书收口**：ADR-0077 落档（floor=76 规则生日/键序 V8 插入序禁排序/登记即完成/双向校验/豁免语义/不自修/prettier 翻案条件 n≥5 多类型/不 bump 判定）+index regen(77)+registry 核销+立项+11 条续债条+CONTEXT `Carried Log` 新词+CHANGELOG Unreleased 条目+pathlint 自证（round-76 文档全在已登记 dirs，scratchDocDirs 无需改）。
- **进程测活**：`node apps/cli/dist/index.js --version`=0.0.7；`doctor` 全绿；ship-gate step 8/9 MCP stdio initialize + scrubbed-env fail-open boot 绿。
- **门禁**：`turbo check`/`turbo test` 全绿（两新测试随 turbo test 行使）；ship-gate `--skip-matrix` 全绿（两条腿实证含在内）；`but` commit 干净、无 push。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r74 栈 land 后，其 headSha 为本轮历史祖先）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481666
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481780
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481663

## 下一轮候选

- **#1764 merge 观察哨**（首要）：`gh pr view 1764 --repo huggingface/transformers.js` —— merge 后核实发布版 manifest 确实携带 `onnxruntime-common` 声明；届时 `defer-r71-transformers-undeclared-dep` 可议关闭 + patch 退役票 + `defer-r75-registerhooks-esm-arm` trigger(b) 响。
- 用户发评论后：发布链接/状态回录 `.scratch/grill-round-75/drafts/` 头部 Status 行（两文稿仍 **待用户亲手发**，红线遵守）。
- canonical 锁翻案哨兵：`CANONICAL_JSON_FILES` 若扩到 n≥5 且含 md/ts 多类型+团队全仓格式化需求 → 按 ADR-0077 D5 翻案条件迁注册制+prettier。
- `defer-r75-registerhooks-esm-arm` trigger(c)：Node 地板 ≥22.15 且真实 ESM 消费者出现 → registerHooks fail-open+动态配对。

## Known risks / deferred

- 落选续债（原名逐字，`carried_log` 显式记——本轮新记法，非飘过）：`defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename` / `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-anysearch-domain-ownership`。
- 残余面：canonical 锁断言「文件字节≡canonicalize(文件)」——键序被重排成 canonical 形态不在检测面（ADR-0077 D5 显式接受：两次事故形态均为整文件缩进重排）。
- (c) 空推导断言在真 gate 被 1b（index regenerate-and-diff）结构先行拦截——模块层 probe 行使 + 接线断言兜底，非腿级实测（报告记档）。
- 外发闸：r75 drafts 两件用户审后亲手发；发布链接后补入 drafts 头部。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$atomcode-research`（上游战场再变时补研）· `$but`（版本控制）· `$code-review`（护栏复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用；机器临时 fixture（注入 probe commit）已 discard 未留史。
