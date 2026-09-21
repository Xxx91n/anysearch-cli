# Round-75 常驻任务书 — transformers 未声明外部债判定性清算

> 零记忆接手文档：本文件+decision-ledger.md 即全部权威输入。每条任务标注覆盖的 D-xxx。

## 背景一句话

`@huggingface/transformers` 3.x/4.x 的 node 入口顶层 `require("onnxruntime-common")` 均未在 manifest 声明——pnpm 隔离 scope 下 load-time 崩。本包（packages/embedding）现行修法=optionalDependencies 自声明 `onnxruntime-common@1.21.0`+scoped `Module._resolveFilename` patch（`packages/embedding/src/index.ts`）。本轮判定上游删除条件未达成→patch 续存+主动申报上游+静态护栏。

## 现状事实（已实证，勿重查）

- transformers 4.3.0 tarball 解剖：`dist/transformers.node.cjs` 顶层 `require("onnxruntime-common")`（line ~13520）与 `require("sharp")`（line ~19821）均 eager；manifest 未声明 common。3.8.1 同构（sharp 3.8.1 已有——非 4.x 新增）。
- 上游战场（gh 实证 2026-09-21）：#1087 issue CLOSED（6 评论，uwuclxdy 补刀 published 消费者仍炸）；#1088/#1089 社区一行修 PR CLOSED 未合；#1701 维护者 knip PR CLOSED 未合（含同款 hunk）；**#1764「Added knip to the test pipeline」nico-martin OPEN（2026-09-03）仍含 `"onnxruntime-common": "1.24.3"` 声明**——修复在飞。
- dsh `latest`/`next`=0.1.5-rc.2，`alpha`=0.1.6-alpha.2——0.1.6-rc.1 未发。
- 本包 Node 承诺面 `>=22`（README）；registerHooks 需 ≥22.15。
- 机制边界（调研实证）：运行时 patch 唯一随行保护消费者；packageExtensions/patchedDependencies 不随包旅行。

## 票序（D-005 裁决：四票串行）

### T0 — 活证据补强【覆盖 D-002】

- pnpm 隔离 scope fixture 实测 transformers@4.3.0：`require("onnxruntime-common")` 在 pnpm 布局下仍 `ERR_MODULE_NOT_FOUND`/`Cannot find module`（静态解剖→运行时复现升一档）。
- 对照：transformers@3.8.1 在同 fixture 下经本包 patch 仍绿（现行机制未回退实证）。
- 产物归档 `.scratch/grill-round-75/evidence/`（transcript 文件，fixture 目录不提交或 .scratch 内受控）。
- 验收锚：transcript 实物存在；4.3.0 失败信息逐字摘录；3.8.1 对照绿。

### T1 — 上游申报文稿【覆盖 D-002/D-004】

- 起草 #1764 评论全文（英文）：4.3.0 仍顶层 bare require 的 pnpm 复现（T0 证据）+published 消费者裸奔说明+下游 ≥4 项目各自造轮子清单（episodic-memory#105/mastra packageExtensions/GitNexus#2069/本项目 scoped patch）+关联 #1087+礼貌推合并优先级。
- 可选起草 #1087 短评（指路 #1764，服务后来检索者）。
- **先读 #1087 全部评论**（避免复述已驳回论点——调研信息缺口项）。
- 文稿落 `.scratch/grill-round-75/drafts/`；**用户审阅闸**：用户亲手发，轮内完成=文稿实物+递交记录，发布链接后补。
- 红线：不用 gh 代发；不自交 PR；不新开 issue。
- 验收锚：文稿实物存在、含 T0 实证引用、含 #1087/#1764 关联、用户审阅记录。

### T2 — 静态护栏双件【覆盖 D-003】

- 禁裸引断言：embedding src（及消费方如有需要）禁止 `import`/`from`/动态 `import()` 直引 `@huggingface/transformers`——唯一合法入口=createRequire().require()。选型按 repo 既有 lint 形态（eslint no-restricted-imports / grep 型 ship-gate 步 / node:test 断言，票内看现状定）。
- 配对断言单测：自声明 `onnxruntime-common` 版本 ≡ effective `onnxruntime-node` 的 dependencies 版本（读 node_modules 实物或 lockfile 断言）。
- `turbo check`+`turbo test` 绿。
- 红线：不动 packages/embedding/src/index.ts 现有 patch 逻辑；不加 registerHooks；不改 transformers 版本。
- 验收锚：两条断言实物+违例时确实红（自证一次反例）+全套件绿。

### T3 — 文书收口【覆盖 D-002/D-003/D-006】

- `docs/deferred-registry.json` 的 `defer-r71-transformers-undeclared-dep` 条目证据刷新：4.3.0 解剖结论+#1764 在飞链接+版本配对纪律+watch 改 >4.3.0；**status 保持 open**（#1764 未 merge 条件未达成）。
- ESM 缺口记录：registry 新条目或 limitations/ADR 记缺口+三条重返触发器（ESM import 路径出现/#1087 修复落地/Node 地板≥22.15+真实 ESM 消费者）+registerHooks 具名重返票。
- 落选债显式续债条入本文件遗留段或收口记录：shipgate-1g/provider-000/dsh 三件套/bitmap/f16/f17/domain-ownership 原名续 deferred。
- ADR-0076：判定逻辑（半响触发器）+申报策略（advocate 在飞修复）+静态护栏教义+版本配对契约+不发布判定（无发布态代码增量→不 bump）。
- CONTEXT.md 新词已随 grill 整理落（Grill Round 75 块）；如发现新凝结词补记。
- CHANGELOG：按仓库惯例判定是否需要条目（无发布态变更——记录判定）。
- found/fixed/deferred 逐条闭环；handoff 含 #1764 merge 观察哨。
- `scripts/ship-gate-pathlint.config.json` 登记 grill-round-75 目录+本轮文档自身过 lint。
- but commit 后工作区干净。
- `origin/r71-grill` 已消失事实呈报核销（remote 仅剩 main——上轮列报项）。
- 验收锚：四段收口证据齐（实证 transcript/文稿递交记录/护栏绿/文书全件）。

## Suggested skills

- `$implement`（T0–T3 续作驱动）· `$code-review`（T2 护栏双轴复审）· `$handoff`（T3 收口交接）· `$but`（全程栈操作）· `$atomcode-research`（若上游战场再生变需补研）· `$domain-modeling`（T3 CONTEXT 新词收口）

## 红线（跨票共用）

- 不外发：所有对外 GitHub 动作（评论/PR/issue）由用户亲手执行，Agent 只产文稿。
- 不动 packages/embedding/src/index.ts 的 patch 机制本体（除非护栏断言本身需要，且只允许加注释级澄清）。
- 不改 transformers/onnxruntime-* 版本字段（迁移是另一轮的题）。
- 不扩面：只此一个 ghost specifier，不泛化成通用 shim。
- 落选债原名续 deferred，不改名不静默关闭。

## Deferred 承接（原名不动）

- `defer-r71-transformers-undeclared-dep` —— 本轮处置对象；T3 刷新证据但 status 续 open（等 #1764 merge）。
- `defer-r71-shipgate-1g-coverage` / `defer-r71-provider-serverside` —— 落选续债（显式续债条入收口）。
- `defer-r72-dsh-*` 三件套 / `defer-r73-dsh-event-rename` / `defer-r74-logo-bitmap-matrix` / f16 / f17 / domain-ownership —— 落选续债。
- 新增 deferred：`defer-r75-registerhooks-esm-arm`（D-003 重返票）。

## 证据与判定备忘

- 「删除条件未达成」判定依据=目标 specifier（onnxruntime-common）的 manifest 声明缺失+顶层 bare require 仍在——不看「上游动了什么」看「目标 specifier 声明没有」（Half-Fired Trigger）。
- 申报成功 ≠ 条件达成：#1764 merge 落地才算；merge 后还须核实发布版本确实携带声明。
- 发布判定：本轮无发布态代码增量（patch 不动+护栏是 repo 侧控件）→不 bump 版本，判定写进 ADR-0076 显式记录。
