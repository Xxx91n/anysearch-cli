# Round-62 审计 → 下一轮交接（audit → rework/land 决策）

日期：2026-09-15（审计窗口）· 产物：`.scratch/grill-round-62/reports/2026-09-15-audit.md`（声明→证据→结论全表 + 双轴评审 + 过程违规呈报，本文不重复其内容）。

Stack（primary key = GitButler change-ids；SHA 时滞后勿引）：

  **已全部 land 到 main（2026-09-15）**——原 16 个平行 stack（root 于 e592cb6）经 `but land`
  串行落盘；landing 产生 rebase 新 SHA，main tip 现 `38a1489`；20 个已合并远端分支已删，
  origin 上仅剩 main。原 stack 变更 id 存档（供追溯）：
  r62-audit(olq+ykr) · r62-t9-chore-help-flag(snt) · r62-t9-chore-version-pin(puq) ·
  r62-t8-tavily-probe(wux) · r62-t7-span-passthrough(stq) · r62-t6-golden-executor(zzk) ·
  r62-t5-offline-governance(kmr) · r62-t4-teardown-macos-probe(wpn) ·
  r62-t3-optional-embedding(nyu) · r62-t2-offline-leg(ysy/pps) · r62-t1-provenance(txv) ·
  r61-audit(vlw) · r61-closeout(rrz) · r62-t9-docs(uor/nwz) · r61-t5-readme(lsk) ·
  r61-t4-golden(rsn) · r61-t3-present(put/mml) · r61-t2-postfilter(ktl) ·
  r62-grill(wvs/ors) · r61-t1-prefilter(nmo) · grill-61-docs(nms/mmx/rxl) ·
  r62-fix-d005-tsx-cwd(wrp，land 后修补)

## 审计结论（速览）

- **判定：通过。拓扑决策已执行（land 完成）、D-009 已见证（main tip 38a1489 双绿）；剩余 5 项文档/断言级返工条件（F-1..F-5）+ 时限项（探针 TTL/quarantine 评审）+ npm go/no-go 终审。**
- 硬验收亲跑全绿：ship-gate 9/9、install-smoke 在线 20/20 + 离线(scrubbed env) 21/21、memory-eval 126/126 fp 4a529f6fbe2096c8、ADR index 63、tsc×7 包 0 fail、CLI/MCP 测活全过。
- T1–T9 逐票声明实物复验为真；D-001..D-011 中 9 条全实证。
- found/fixed/deferred：**6 / 0 / 6**（审计窗口不动手修；F-6 quarantine 为已披露 deferred）。

## 下一轮任务（按序）

1. **r62-rework 小票（建议先落栈）**——F-1 README Known Limitations 补"exit-time libc++abi 可改写 abstain exit code"且注明实证在 Windows（账本 D-003 无条件文档动作的缺口）；F-2 ship-gate.mjs:531 ④断言补强为 job+test:online 步双断言；F-3 `probe-tavily-domains.mjs` OUT_DIR 改指 round-62（当前复跑会覆写 r61 SKIPPED 原件）；F-4 CONTEXT.md 新术语补 `_Avoid_` 行（7 条）；F-5 可选：macos-exit-probe 复现腿钉死 abstain 路径。重跑清单：ship-gate step1 复绿 + 各文件 diff 复核。
2. ~~land/merge 决策~~ **已执行（2026-09-15，用户裁决）**——16 stack 全部 `but land` 到 main；20 个已合并远端分支安全删除（`git cherry` 逐支验证）；main tip `38a1489`。集成后暴露真实缺陷：D-005 覆盖率 spawn `cwd:ROOT` 下 `node --import tsx` 在干净 CI 安装中 `ERR_MODULE_NOT_FOUND`（本地绿系根 node_modules 残留 symlink 污染）；已按用户批准做最小修复（spawn cwd→`packages/store`，commit `38a1489`）。
3. **macos-spillover-probe TTL**：landing 后每次 push 产生一行签名观测；首个数据点（run 34926366596）为红——still-crashing 签名，TTL 连绿计数自 #1 起算；≥5 连绿评估复矩阵（ADR-0059 D4③ onnxruntime≥1.24.1）；仍崩续 defer-f16。
4. **quarantine 评审时钟**：eval-quarantine.json 10 条 30d TTL（2026-10-14 到期）——live 层当前实跑面薄（已披露），评审日 promote/retire。
5. **npm 0.0.1 go/no-go 终审（用户裁决闸）**——D-009 双 workflow 绿已见证（URL 见下），前置证据齐备。

## 环境/权限备忘

- TAVILY_API_KEY：已 `gh secret set`（repo secret，源=User env `1`，全程未明文）；CI test-online 腿可用。
- ci.yml/ship-gate.yml 触发面：push(main)/pull_request(main)/workflow_dispatch——分支 push 不自动产 run；dispatch 需选含全量历史的 ref。
- 两笔已发红 run（r62-audit ref 部分树伪证）：ci 34922566741 / ship-gate 34922570312——详情见审计报告 §6，非产品回退。
- **权威绿 run（main tip 38a1489，D-009 见证）**：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366576 · ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366596 · native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366564；已回填 ADR-0063 §Closure evidence 与审计报告 §8 追记。
- 本机验收日志：`.scratch/audit-r62-{shipgate,installsmoke,installsmoke-offline}.log`（scratch 根未入库，仅存本机）。

## Suggested skills

- `$implement`（rework 小票）· `$but`（land/栈操作）· `$handoff`（下轮收口）·
  `atomcode-research`（若 onnxruntime 升级评估需外部先例）
