# Round-75 审计收口交接 — 复审通过（一打回一返工一遗留修复闭环）

Date: 2026-09-22. Auditor: 独立审计会话。本文件 = 审计侧终态交接；实施侧交接见同目录 `round-75-closeout.md`。

## 栈态（primary key = change-id）

- `r75-grill`（实施栈）：`nqs` → `qms`（T0 实证+T2 护栏，含返工 amend：regex 加固+语料）→ `kow`（T1 文稿）→ `rot`（T3 文书，含返工 amend：ADR D4 措辞+registry updated+F-7 重排版回退）→ `oyz`（adr index）→ `lql`（报告+交接，含审计窗 amend：备注补二次重排实录）。
- `r75-audit`（审计栈，并行）：`mpz` 首轮审计报告 + 本交接（尾部 commit）。
- 工作区干净（`git status --porcelain`=0）；两栈均未 push（规则内）。

## 审计终态

- 首轮裁决：不通过打回（F-1 ADR-0076 D4「no CHANGELOG entry」伪述 + F-2 registry `updated` 滞留 + F-3~F-6 护栏加固项）——详见 `reports/2026-09-22-audit.md`。
- 返工核验：F-1~F-6 全部核销（逐项亲验：ADR 措辞一致、updated=2026-09-22、14 用例独立探针全命中预期、语料升级 in-test 9 红/5 绿）。
- F-7（返工中新浮出，审计窗经用户批准代修）：registry 整文件 4 空格重排版未申报+报告备注失真 → 已按 `JSON.stringify(·,1)` 恢复最小 diff（+17/−4），备注补实录。
- 验收复跑（审计窗亲跑，同一套）：`check` 8/8 · `test` 13/13 · 护栏直跑 pass（a/a′/b 三腿全行使）· `ship-gate --skip-matrix` 9/9（pack×8、adr-index 76、pathlint 282、memory-eval 126/126、MCP init+fail-open）· `doctor` 25/0/0。
- 过程注记：返工复跑用了 `ship-gate --quick`（跳 turbo 腿）弱于打回清单要求——审计窗以 `--skip-matrix` 补足，不追究已记档。

## 下一个 grill 方向指示

1. **首要：#1764 merge 观察哨** —— `gh pr view 1764 --repo huggingface/transformers.js`；merge 后须核实发布版 manifest 确实携带 `onnxruntime-common` 声明（申报成功≠条件达成），届时 `defer-r71-transformers-undeclared-dep` 议关闭 + patch 退役票 + `defer-r75-registerhooks-esm-arm` trigger(b) 响。
2. **外发闸未解**：`drafts/pr-1764-comment.md` + `issue-1087-comment.md` 待用户亲手发；发后回录链接/状态到 drafts 头部 Status 行。
3. **续债池**（原名逐字，下轮 grill 出候选）：`defer-r71-shipgate-1g-coverage`（registry 明示不得再静默飘过——最重）、`defer-r71-provider-serverside`、`defer-r72-dsh-*` 三件套、`defer-r73-dsh-event-rename`、`defer-r74-logo-bitmap-matrix`、`defer-f16/f17`、`defer-anysearch-domain-ownership`、`defer-r75-registerhooks-esm-arm`（三触发器）。
4. **机制性观察**：`deferred-registry.json` 已被外部进程/编辑工具整文件重排版两次（1→8、1→4 空格）——若再发生，下轮可考虑给该文件加格式锁（lint 腿或 .gitattributes），否则每轮都要人工恢复最小 diff。

## Suggested skills

`$implement`（续作）· `$atomcode-research`（上游再变时补研）· `$but`（栈操作）· `$code-review`（复审可选）· `$domain-modeling`（CONTEXT 新词）。

无秘密值落档；证据/文稿全 repo-relative；fixture 为机器临时目录未提交。
