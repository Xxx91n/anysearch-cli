# Round-76 审计收口交接 — 复审通过（一打回一返工闭环）

Date: 2026-09-22. Auditor: 独立审计会话。本文件 = 审计侧终态交接；实施侧交接见同目录 `round-76-closeout.md` 与 `next-round.md`。

## 栈态（primary key = GitButler change-id）

- `r76-grill`（定稿栈）：`xwk`。
- `r76-impl`（实施栈，叠于其上）：`pvz`（T0 canonical 锁）→ `lpx`（T1 1g 重写；消息已 reword 27→26 带失真更正注记）→ `ntv`（T2 文书批）→ `qwu`（index regen 77）→ `llq`/`zwm`/`mon`/`knv`（closeout+证据+报告+终跑）→ `pwx`（审计返工 F-1~F-6 核销）→ `wwt`（返工终跑证据）→ `tqt`（backlog 记档）。
- `r76-audit`（审计栈，并行）：`uxq`（打回审计报告）→ `vrn`（修复窗代补 pathlint marker，审计内容未动）→ 本交接（尾部 commit）。
- 工作区干净（`git status --porcelain`=0）；三栈均未 push（规则内）。

## 审计终态

- 首轮裁决：不通过打回——F-1 `27/27` 计数失真扩散 4 处永久记录 + F-2 `isCloseoutName` 过宽晋级 fail-closed oracle（`release-closure.md` 冒充路径 live 可证）。详见 `reports/2026-09-22-audit.md`（含 19 条声明对照表+D-001~005 逐项核对+双轴评审摘要）。
- 返工核验：F-1~F-6 全部核销，逐项亲验（三处记录更正 36/36、registry evidence 编辑走 canonical 写入=过锁实证、isCloseoutName 收紧 `^round-\d+-.*closeout` 探针全中、round-63 `hasCloseout` true→false、豁免行移 `fail()` 前、scoped 空集判红模块层实测、ADR-0077 D2 补返工加固段）。
- 验收复跑（审计窗亲跑，同一套）：`check` 8/8 · `test` 13/13 · 直跑 36/19 · `ship-gate --skip-matrix` 9/9（canonical-json/closeout-coverage `1 registered / 1 completed`/pathlint 292/pack×8/eval 126/126/MCP init/fail-open/`ship gate green`）· `--version` 0.0.7 · `doctor` 25/0/0。
- 过程注记：审计报告自犯 pathlint（机器绝对路径引述未带 marker），修复窗补钉——审计窗产出 .md 下次应先自跑 `--quick` 再交。
- 显式 backlog（记档非飘过，见 closeout Known-risks 末行）：F-5⑥ parser 行形状与 gen-adr-index render 措辞耦合；F-5⑦ lock 条目缺 sibling 字段；spec 残余：`titleRound` 误登记面、`grill-round-<非数字>` dir 隐形、coverage fail 压 leg-(a) lint 诊断序。

## 下一个 grill 方向指示

1. **首要：#1764 merge 观察哨**（续挂）——`gh pr view 1764 --repo huggingface/transformers.js`；merge 后核实发布版 manifest 确实携带 `onnxruntime-common` 声明（申报成功≠条件达成），届时 `defer-r71-transformers-undeclared-dep` 议关闭 + patch 退役票 + `defer-r75-registerhooks-esm-arm` trigger(b) 响。
2. **外发闸未解**：`.scratch/grill-round-75/drafts/` 两文稿仍待用户亲手发；发后回录链接/状态到 drafts 头部 Status 行。
3. **续债池**（11 条原名，`carried_log` 显式记，下轮 grill 出候选）：`defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside` / `defer-r72-dsh-*` 三件套 / `defer-r73-dsh-event-rename` / `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm` / `defer-f16` / `defer-f17` / `defer-anysearch-domain-ownership`。
4. **机制性观察**：canonical 锁翻案哨兵（`CANONICAL_JSON_FILES` n≥5+多类型→注册制 config+prettier，ADR-0077 D5）；registerHooks trigger(c)（Node≥22.15+真实 ESM 消费者）；新开账顺序纪律——**先 closeout 后 ADR 登记**（倒置=瞬态红）；审计窗自产 .md 先 `--quick` 自证再过手。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$atomcode-research`（上游战场再变时补研）· `$but`（栈操作）· `$code-review`（复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用。
