# R66 closeout handoff — 2026-09-17

接棒人下一轮（R67 或续跑）从这里开始。完整报告：`../reports/2026-09-17-report.md`。

## 一句话状态

T1–T6 完成；T7 停在授权点。**唯一外部阻塞：Claude 模型代理 127.0.0.1:15721 宕机（ECONNREFUSED ≥45min，用户侧托管进程）**——恢复后 10–15min 可补齐 T4 末三项探针。

## 已完成的票（分支 r66-t1..t6）

- T1 基线（xyt）：published 0.0.3 三探针 + 合成红对 + 台账建账
- T2 tarball 全矩阵（pty）：P1–P9+P6x/P10/P11；信封契约三腿哨兵钉死；http hooks 终结论；ER-1/2/3 确认红
- T3 修复（yol+wvq+rpo）：信封迁移 `hookSpecificOutput`、官方 schema 模板、`ans-hook-*` bin、plugin 骨架单源生成、claude-contract 10 测；126 测绿/lint clean
- T4 复跑（部分）：template 接线绿（SessionStart 真触发+信封实发）、plugin validate 绿（含 repository:string+SKILL frontmatter 两处新修复）、--plugin-dir 加载绿（plugin:anysearch:anysearch:connected）
- T5 文档（qsp）：ADR-0067、claude-integration.md、README、CHANGELOG、publishing.md
- T6 发布工程（uzr）：0.0.4 bump、release.yml OIDC TP job、TP 逐字指令、t6-pack dry-run 四包验证

## 待办（按序）

1. **恢复代理 127.0.0.1:15721**（用户侧）。验证：`curl http://127.0.0.1:15721/`
2. 补 T4 末三项（probe-claude.mjs 即可）：
   - `t4-p6-template`：prompt 要求引用注入的路由卡首行 trigger rule
   - `t4-p5-realcall`：真实 search_web 成功调用→`rowsBefore/rowsAfter` 行增量
   - `t4-p9b`：P9 第二跑方差
   - （可选）plugindir 模型级会话重验
3. T7 授权点：npmjs.com 四包 trusted publisher（`docs/publishing.md` §OIDC 逐字照抄）→ 用户当场授权 tag `v0.0.4` + push → gate → publish → `npm view`+provenance+净机冒烟 → ADR-0067 Closure 四段回填

## 关键事实（勿重查）

- Claude Code 2.1.251：决策键必须全在 `hookSpecificOutput` 内（顶层被静默吞）；settings 钩子须官方 schema（非法条目毒化同事件整列）；Pre/PostToolUse headless 真跑但零事件（副作用观测）；`type:"http"` settings 钩子被静默丢；MCP 工具调用触发钩子正常
- `CLAUDE_PLUGIN_ROOT` 本机展开正常（与上游 #16116 链预期相反，可能已修或面相关）——plugin 通路仍按 experimental 标
- 代理宕机期间 `claude -p` init/MCP/hook 链路完整产出（api_retry 循环），=隔离验证插件加载的免费旁路
- `probe-claude.mjs` 新增 `--plugindir <path>`；`write-settings.mjs template` 现=出厂配置原文

## 红线复述

- 键值永不进对话/证据/提交物；publish/tag/push 当场授权（硬停）
- VC 全走 `but`；B 段不绿不 bump；`${CLAUDE_PLUGIN_ROOT}` 不进 Windows settings 通路
