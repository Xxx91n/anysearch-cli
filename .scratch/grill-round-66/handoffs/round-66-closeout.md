# R66 closeout handoff — 2026-09-17

接棒人下一轮（R67 或续跑）从这里开始。完整报告：`../reports/2026-09-17-report.md`。

## 一句话状态

**R66 全闭环**：T1–T7 全部完成——0.0.4 经 OIDC trusted publishing 发布（四包 latest=0.0.4 + sigstore provenance + 净机冒烟 25/0/0）。

## 已完成的票（分支 r66-t1..t6）

- T1 基线（xyt）：published 0.0.3 三探针 + 合成红对 + 台账建账
- T2 tarball 全矩阵（pty）：P1–P9+P6x/P10/P11；信封契约三腿哨兵钉死；http hooks 终结论；ER-1/2/3 确认红
- T3 修复（yol+wvq+rpo）：信封迁移 `hookSpecificOutput`、官方 schema 模板、`ans-hook-*` bin、plugin 骨架单源生成、claude-contract 10 测；126 测绿/lint clean
- T4 复跑（部分）：template 接线绿（SessionStart 真触发+信封实发）、plugin validate 绿（含 repository:string+SKILL frontmatter 两处新修复）、--plugin-dir 加载绿（plugin:anysearch:anysearch:connected）
- T5 文档（qsp）：ADR-0067、claude-integration.md、README、CHANGELOG、publishing.md
- T6 发布工程（uzr）：0.0.4 bump、release.yml OIDC TP job、TP 逐字指令、t6-pack dry-run 四包验证

## 待办（按序）

1. ~~恢复代理 127.0.0.1:15721~~ 已完成
2. ~~T4 末三项补跑~~ 已完成（全绿/host-variable 结论）
3. ~~T7 授权点~~ **已执行**：TP 配好 → `but move r66-t5-docs --above r66-t6-release` 归并 → `but push` 6 分支 → `git tag v0.0.4 0d86db6` + push → gate 18s 绿 → publish job 1m11s（OIDC TP 首发成功）→ 四包 latest=0.0.4 + provenance + 冒烟 25/0/0 → ADR-0067 Closure 已回填

**遗留观察项**（下轮可选）：ans_chat 空正文（本环境 ANS_LLM_* 上游缺端点——环境项）；引擎 verdict 恒 ambiguous 时 PostToolUse 合法跳索引（机制已验）。

## 关键事实（勿重查）

- Claude Code 2.1.251：决策键必须全在 `hookSpecificOutput` 内（顶层被静默吞）；settings 钩子须官方 schema（非法条目毒化同事件整列）；Pre/PostToolUse headless 真跑但零事件（副作用观测）；`type:"http"` settings 钩子被静默丢；MCP 工具调用触发钩子正常
- `CLAUDE_PLUGIN_ROOT` 本机展开正常（与上游 #16116 链预期相反，可能已修或面相关）——plugin 通路仍按 experimental 标
- 代理宕机期间 `claude -p` init/MCP/hook 链路完整产出（api_retry 循环），=隔离验证插件加载的免费旁路
- `probe-claude.mjs` 新增 `--plugindir <path>`；`write-settings.mjs template` 现=出厂配置原文

## 红线复述

- 键值永不进对话/证据/提交物；publish/tag/push 当场授权（硬停）
- VC 全走 `but`；B 段不绿不 bump；`${CLAUDE_PLUGIN_ROOT}` 不进 Windows settings 通路
