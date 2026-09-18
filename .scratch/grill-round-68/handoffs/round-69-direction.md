# R69 方向指示 — 2026-09-18（audit window 收口，交给下一个 grill round）

上一棒：R68 审计 LOOP 重审 PASS，返工票全项核销，双 land 远端三绿。本文档为 R69 任务书种子。

## 本轮终态锚点（全部已 land 于 main，origin/main=6acc53c+）

- 审计报告：D:\Aworker\anysearch-cli\.scratch\grill-round-68\reports\2026-09-17-audit.md（PASS 带返工票，26 条声明对照表）
- LOOP 重审：D:\Aworker\anysearch-cli\.scratch\grill-round-68\reports\2026-09-18-audit-loop2.md（返工票核销 + L-1/L-2 观察）
- 审计交接：D:\Aworker\anysearch-cli\.scratch\grill-round-68\handoffs\round-68-audit-handoff.md
- 返工 transcript：D:\Aworker\anysearch-cli\.scratch\grill-round-68\evidence\r68-rework-shipgate-transcript.txt（P-V2 补证范式，下轮沿用）
- 决策账本：D:\Aworker\anysearch-cli\.scratch\grill-round-68\decision-ledger.md（D-001~D-005）
- ADR：D:\Aworker\anysearch-cli\docs\adr\0069-architecture-grill-round-68-release-gate-dual-layer-closeout-lint.md

## R69 首推主线（按优先级）

1. **T1 摘 partial 帽——首次真 release 验证双层门禁**
   - 现状：pre-tag wait-on-check（release.yml，pin 36976907）与 post-tag assert-checks-green 均为代码级验证 + dry-run 证据，从未跑过真 dispatch。ADR-0069 自声明 partially verified，首次真 pre-tag dispatch 前不得宣称 fully verified。
   - 动作：走一次真 release（或 tag dry-run）观察 layer-1 等待与 layer-2 断言真跑行为；记录 transcript 到 D:\Aworker\anysearch-cli\.scratch\grill-round-69\evidence\（下轮自建仓）。
   - 关键文件：D:\Aworker\anysearch-cli\.github\workflows\release.yml；D:\Aworker\anysearch-cli\scripts\assert-checks-green.mjs（F-S1 已修：unmodelled conclusion fail-closed，行为夹具范式=node.exe 改名 gh.exe + api 桩文件，见 loop2 报告）。

2. **agy ans-MCP 真链腿（P7）**
   - 现状：SEP-2484 ledger P7 标 excluded（沙箱无 ans server）。README 声明 PostToolUse distill→pending→invocation flush 仅契约测试级。
   - 动作：本机起 ans server（127.0.0.1:33333 契约见 D:\Aworker\anysearch-cli\apps\plugin\AGENTS.md），agy -p 真发工具调用，验证 pending→ephemeralMessage 真注入 transcript。
   - 注意：agy -p headless 会挂在永不完成连接的 MCP server 上（ADR-0069 记录，1mcp 曾触发）——sandbox HOME 或先修好 server。
   - 关键文件：D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\antigravity.ts；D:\Aworker\anysearch-cli\apps\plugin\configs\antigravity\hooks.json。

3. **PR-mode / required-checks 治理**
   - 现状：release gate 假设 trunk-based land；D5 but-land 治理裁决已记 ADR-0069，PR 流所需 required-check 集合与 tag ruleset/environment 关联发现已记但未实现。
   - 动作：定 PR-mode 下 release-gate 如何等 check（PR head vs merge SHA），required checks 名单治理。

## 顺手可选项（审计观察遗留，非阻断）

- **L-1（微）**：D:\Aworker\anysearch-cli\.scratch\grill-round-68\reports\2026-09-17-report.md L43 仍有相对路径「evidence/t3-s2s3-verdict.md」，改绝对路径（deliverable 纪律，AGENTS.md）。
- **L-2（低）**：D:\Aworker\anysearch-cli\scripts\verify-observation.mjs 在 ship-gate step 8b 有时序抖动（审计 3 跑 2 绿，standalone 恒 PASSED）——给 trace 落库加等待/重试窗口，或显式记 deferred 条目。
- F-S4 残留语义：partial-family discovery 现由 timeout-min 兜底（已头注文档化）——若要严格两段式 discovery/completion 截止，单独开票。
- D:\Aworker\anysearch-cli\scripts\ship-gate.mjs 内 gh issue create 双写回退（无 label 兜底）注释可顺手清理。

## deferred 大项池（R68 账本沿用）

cursor adapter 深水区 / F-01a / npm provider / projectIndex / TUI / embedding / cross-OS / plugin / watch——按 D:\Aworker\anysearch-cli\.scratch\grill-round-68\handoffs\next-round.md 与 decision-ledger 沿用，不在本指示展开。

## 验收基线（修后重跑清单，R68 沿用）

pnpm build；pnpm -C packages/store test（62）；pnpm -C apps/plugin test（10 文件：antigravity 13/codebuddy 18/claude 10/codex 11/propagation 41）；pack×7（ship-gate step4）；node apps/cli/dist/index.js --help；MCP initialize + fail-open boot（scrub env）；node scripts/ship-gate.mjs --quick 全绿 + **必须留 committed transcript**（P-V2 范式）；assert-checks-green 夹具（stale→exit≠0，全 allowed→exit0）。

## 纪律提醒

- deliverable 一律绝对路径（AGENTS.md 硬性规则，R68 自破过 F-A1）。
- 版本控制只走 but（commit/land/push/pull），不跑 git 写命令。
- 并行窗口互不影响：本文件所在分支已 land 后可安全删除 lane；新轮起新 slug 目录 D:\Aworker\anysearch-cli\.scratch\grill-round-69\。
- 过程违规单独呈报，不替任何人追认。
