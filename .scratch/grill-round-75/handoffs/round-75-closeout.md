# Round-75 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
`r75-grill` → `nqs`（账本/goal/任务书定稿）→ `qms`（T0 实证 transcript+T2 护栏双件）→ `kow`（T1 申报文稿 drafts）→ `rot`（T3 收口文书：registry+ADR-0076+pathlint drafts 登记）→ `oyz`（adr index regen 76 条）→ 报告+本交接（尾部 commit，见 git log）

主题：`defer-r71-transformers-undeclared-dep` 判定性清算——上游触发器「半响」判定（4.3.0 仍 bare require + manifest 未声明 → 条件未达成）→ patch 续存 + 在飞修复倡导（#1764 评论文稿，用户亲手发）+ 静态护栏双件 + registerHooks 具名重返票。

## 已完成

- **T0 活证据**：pnpm 隔离 scope fixture（`hoist:false`，`.pnpm/node_modules` 实证 0 项）——4.3.0 `Cannot find module 'onnxruntime-common'`@`transformers.node.cjs:13520:33` exit=1；3.8.1 无 patch 同红（负对照）；3.8.1+自声明+逐字 patch 绿（exit=0）；Leg D 注记：默认 virtual-store hoist 掩盖断裂面。实物 `evidence/t0-pnpm-isolated-scope.{log,md}`（commit `qms`）。
- **T1 申报文稿**：`drafts/pr-1764-comment.md`（#1764 评论全文：4.3.0 复现栈+掩盖面 nuance+消费侧修法不旅行论证+下游≥4 项目造轮子清单 episodic-memory#105/mastra/GitNexus#2069/本项目）+`drafts/issue-1087-comment.md`（可选短评指路）。#1087 全评论已读（xenova 以 repo 内 hoist 结案、uwuclxdy published 消费者补刀、nico-martin 指路）。**递交状态：待用户亲手发**——红线遵守，Agent 未发任何对外动作（commit `kow`）。
- **T2 静态护栏**：`packages/embedding/test/transformers-ghost-dep.test.ts`——(a) src 全树禁裸引（import/from/export-from/import() 禁，createRequire 唯一合法口，注释+`typeof import(…)` 豁免）；(b) 版本配对断言 optionalDependencies.onnxruntime-common ≡ effective onnxruntime-node 内嵌版（1.21.0≡1.21.0，importer-link→.pnpm-store 双锚）。双反例自证红（探针文件+manifest 改错），实物 `evidence/t2-guardrails-selfproof.log`（commit `qms`）。
- **T3 文书收口**：registry 证据刷新（status 续 open 等 #1764 merge）+`defer-r75-registerhooks-esm-arm` 新条目（三触发器）+ADR-0076（含不发布判定显式记录）+index regen(76)+CHANGELOG Unreleased 条目+pathlint 登记 drafts+`origin/r71-grill` 消失核销（`git ls-remote` 2026-09-22：remote 仅剩 main+PR refs）（commit `rot`/`oyz`）。
- **进程测活**：`ans --version`=0.0.7；`ans doctor` 25/0/0（含 `[OK] vector arm (present)`）；ship-gate step 8/9 MCP stdio initialize + scrubbed-env fail-open boot 绿（server=anysearch v0.0.7）。
- **门禁**：`turbo check` 8/8、`turbo test` 13/13（含新护栏 2/2）、ship-gate `--skip-matrix` 9/9 步全绿（pack×8、memory-eval 126/126、pathlint/parity/closeout-lint/adr-index 腿全过）。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r74 栈 land 后，其 headSha 为本轮历史祖先）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481666
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481780
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35512481663

## 下一轮候选

- **#1764 merge 观察哨**（首要）：`gh pr view 1764 --repo huggingface/transformers.js` —— merge 后核实发布版 manifest 确实携带 `onnxruntime-common` 声明（申报成功≠条件达成），届时 `defer-r71-transformers-undeclared-dep` 可议关闭 + patch 退役票成立 + `defer-r75-registerhooks-esm-arm` trigger(b) 响。
- 用户发评论后：发布链接/状态回录 `drafts/` 头部 Status 行。
- `defer-r75-registerhooks-esm-arm` trigger(c)：Node 地板升 ≥22.15 且出现真实 ESM 消费者 → 按 GitNexus#2069 姿势上 registerHooks（fail-open+从 effective onnxruntime-node 动态配对）。

## Known risks / deferred

- `defer-r71-transformers-undeclared-dep`——续 open（本轮处置对象；证据已刷新，等 #1764 merge）。
- `defer-r75-registerhooks-esm-arm`——本轮新增具名重返票。
- 承续续债（名逐字，显式续债非飘过）：`defer-r71-shipgate-1g-coverage`（registry 明示不得再静默飘过——最重）/ `defer-r71-provider-serverside` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename` / `defer-r74-logo-bitmap-matrix` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-anysearch-domain-ownership`。
- 已知工作区行为：pnpm 11 不把 workspace 包 optionalDependencies 物化进自身 node_modules（护栏走 .pnpm store 兜底锚）；pnpm 默认 hoist 掩盖 ghost-dep（T0 Leg D 记档）。
- 外发闸：drafts 两件用户审后亲手发；发布链接后补入 drafts 头部。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$atomcode-research`（上游战场再变时补研）· `$but`（版本控制）· `$code-review`（护栏复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用；机器临时 fixture 未提交（transcript 为归档物）。
