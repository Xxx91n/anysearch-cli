# R65 → next grill handoff（2026-09-16，审计 PASS 后交接）

## 零上下文摘要

R65 开门轮已收口并**审计通过（LOOP-2 PASS）**：anysearch 三件套（ans CLI / ans-mcp / plugin server+hooks）在真实宿主 CodeBuddy 2.151.0 上 live 验证全绿（headless 探针矩阵 P1-P9），F-01~F-04+F-09~F-12 修复在案，审计返工 F-A1~F-A6 全修（F-A7 interactive TUI deferred）。

事实源：
- 账本：`.scratch/grill-round-65/decision-ledger.md`（D-001~D-006 全 current）
- 实施报告+审计返工节：`.scratch/grill-round-65/reports/2026-09-16-report.md`
- 审计报告（含 LOOP-2）：`.scratch/grill-round-65/reports/2026-09-16-audit.md`
- 缺陷台账：`.scratch/grill-round-65/evidence/defect-ledger.md`
- ADR-0066：`docs/adr/0066-*.md`（closure 四段已回填）

## 分支栈与终态

r65-grill → r65-t1-deploy → r65-t6-closure → r65-t3-codebuddy-hooks → r65-t4-livefixes → r65-t5-docs；末批返工四笔 1f938e5/fe6763d/39f2024/d0fcf47。工作区净，无 push/tag/PR。
全局 npm 三件套为本地 tarball 0.0.3（含全部修复；published 0.0.3 无——**发版必须 bump 到 0.0.4**）。

## 当前能力面（下轮 grill 的事实底座）

- CodeBuddy 契约已实证：hook_event_name + hookSpecificOutput 信封 + tool_response 数组 blocks + SessionStart 原文卡 + Git Bash 强制。
- 5 适配器全支持 hook_event_name??event + unwrapToolResponse 数组形状；模板-target 可执行断言堵死库文件误指。
- e2e 现场 D:\Aworker\e2e-r65-codebuddy\ 可复用（mcp.json/settings.json/server-token/project-index.db 在）；探针跑器 .scratch/grill-round-65/scripts/probe.mjs + mcp-call-tool.mjs。 <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->
- plugin server=ans-plugin-server bin；127.0.0.1:33333 bearer；token <cwd>/.anysearch-cli/server-token 0600。

## 下一 grill 方向指示（deferred 池按优先级排序）

1. **OIDC trusted publishing（欠条 due 0.0.4，紧邻下轮候选，D-001 明列）**——发布工程轮：npm OIDC 免长效 token、版本 bump 通道、0.0.4 发布 rehearse。前置依赖：publish 权限须用户当场授权。
2. **真 Claude Code 宿主验证**——与 CodeBuddy 同构的第二真宿主轮：claude.cjs 适配器+configs/claude 模板已契约级绿但未实机；复用 R65 探针矩阵协议可直接移植。
3. **internal anysearch provider 服务端排查**——live 探针中 queried 但 0 成功（凭证已供，fail-open 未阻）；属服务端议题，需用户侧排查窗口。
4. **projectIndex 双库不同根设计问题**——plugin server 写 cwd 锚定库 vs MCP recall 读 ~/.anysearch 引擎库；是否汇合是架构裁决，宜作 grill 主题而非顺手修。
5. interactive TUI 抽验 / embedding arm 实测 / 跨 OS matrix（CI 委派）——散件，可并入任一上述轮的验收清单。

## Suggested skills

- `$grill` —— 下轮定界（首推主题=OIDC 发布工程或真 Claude Code 宿主）
- `code-review` —— 任何修复 diff 的双轴复核
- `gitbutler` —— 全部版本控制写操作
- `atomcode-research` —— OIDC/npm trusted publishing 契约调研时

## 红线提醒

键值永不进对话/证据/提交物；e2e 现场留仓外；publish/tag/push 须用户当场授权；`> nul` 重定向在 Git Bash 产实体 nul 文件断 but 扫描（用 `>/dev/null`）；审计/修复窗口职责分离须保持。
