# Round-77 交接 — R76 收口后状态与候选

Date: 2026-09-22. 上轮收口：`.scratch/grill-round-76/handoffs/round-76-closeout.md`；账本 `.scratch/grill-round-76/decision-ledger.md`（D-001~D-005）。Stack：`r76-grill`（xwk）← `r76-impl`（pvz→lpx→ntv→qwu→llq→zwm→报告+本件尾部 commit）。

## R76 落地了什么（下轮须知）

- ship-gate step 1 `stepGovernedJsonCanonical()`：`docs/deferred-registry.json` 字节锁 canonical `JSON.stringify(_,null,1)+'\n'`——**编辑 registry 后必须以 canonical 写入**（normalize 指令在报错里）；不自修。
- ship-gate step 1g leg-b 重写：完成信号=ADR index `Grill Round N` 登记（登记即完成）；三断言 fail-closed；floor=76；最新 dir 未登记→豁免行。新 round 开账顺序：**先 closeout 后 ADR 登记**（倒置=瞬态红）。
- 新模块 `scripts/governed-json.mjs`、`scripts/closeout-coverage.mjs`；新测试 `governed-json-canonical.test.mjs`（19）+`closeout-coverage.test.mjs`（26）随 `turbo test` 行使。
- registry 新记法：`carried_log` 显式续债条（落选≠飘过）。

## 首要观察哨

- **#1764 merge 观察**：`gh pr view 1764 --repo huggingface/transformers.js`——merge 后核实发布版 manifest 携带 `onnxruntime-common` 声明；届时 `defer-r71-transformers-undeclared-dep` 可议关闭 + patch 退役票成立 + `defer-r75-registerhooks-esm-arm` trigger(b) 响。

## 外发闸（红线：Agent 不代发）

- `.scratch/grill-round-75/drafts/pr-1764-comment.md` + `issue-1087-comment.md` ——**仍待用户亲手发**；发出后把链接/状态回录 drafts 头部 Status 行。

## 落选债承接（11 条原名，carried_log 已显式记）

`defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename` / `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-anysearch-domain-ownership`。

## 未完成 follow-up / 哨兵

- canonical 锁翻案哨兵：`CANONICAL_JSON_FILES` 扩到 n≥5 且含 md/ts 多类型+团队全仓格式化需求 → 按 ADR-0077 D5 迁注册制 config+prettier。
- `defer-r75-registerhooks-esm-arm` trigger(c)：Node 地板 ≥22.15 + 真实 ESM 消费者。
- 残余面（ADR-0077 D5 显式接受）：canonical 断言不检「键序重排成 canonical 形态」。
- (c) 空推导断言仅模块层行使（真 gate 被 1b 先行拦截）——若未来 index 生成链路改序，补腿级实测。

## 下轮主题候选（grill 轮定）

- #1764 merge 后的 patch 退役清算（条件达成时的既定动作）。
- registerHooks ESM 臂（trigger(c) 响时）。
- 治理面延伸：pathlint scratchDocDirs 覆盖面复审 / report 目录登记节奏。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$atomcode-research`（上游战场再变时补研）· `$but`（版本控制）· `$code-review`（可选复审）。
