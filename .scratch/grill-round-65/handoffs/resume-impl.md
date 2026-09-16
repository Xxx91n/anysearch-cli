# R65 实施交接（2026-09-16 终态）——开门轮已收口

## 零上下文摘要

任务书=`.scratch/grill-round-65/handoffs/next-round.md`（六票 T1-T6，账本 decision-ledger.md D-001~D-006）。
**六票全绿**：T1 部署腿 ✅ / T2+T4 live 探针矩阵 P1-P9 全绿 ✅ / T3 契约修复 ✅ / T5 文档 ✅ / T6 收口 ✅（ship-gate 9/9 修复后复跑绿）。

报告：`.scratch/grill-round-65/reports/2026-09-16-report.md`
台账：`.scratch/grill-round-65/evidence/defect-ledger.md`（F-01..F-04 + F-09..F-12 fixed；F-05 等 deferred 实录）

## 分支栈与物理哈希（git log 实物）

`r65-grill(nsz)` → `r65-t1-deploy(fb397cb)` → `r65-t6-closure(69ebe90, a6e405e, 9e01cd5)` → `r65-t3-codebuddy-hooks(0494da3, cbbc90f)` → `r65-t4-livefixes(af5db3e)` → `r65-t5-docs(36926f3, 12d9c60, 2ddb075)`。
工作区净；无 push/PR/tag（未授权）。

## live 抓出并已修的四个缺陷（本探针轮的真正产出）

- F-09 CodeBuddy `tool_response` 数组 content blocks → `core.unwrapToolResponse` 共享解包；契约测试钉死实物形状。
- F-10 `ans-mcp` 不 ship `domains/` + 域链缺包内回退 → 域向 MCP 路径全灭 → `sync-domains.mjs`+files+`domainsDirs`。
- F-11 `ans_chat` 丢 `ANS_LLM_BASE_URL/API/API_KEY` → env 三件套线程化（session key 含端点签名）。
- F-12 pi-runtime 等不存在 `type:"text"` → `mapAssistantMessageEvent`（text_delta/text_end 兜底/message_start 重置）。

## 环境实物状态

- 全局 npm：cli/mcp/plugin 均为**本地 tarball 0.0.3**（含全部修复；published 0.0.3 无这些修复——发版时须 bump）。
- e2e 现场 `D:\Aworker\e2e-r65-codebuddy\`：`.codebuddy/settings.json`（codebuddy 适配器，$(npm root -g) 路径）/ `mcp.json`（env 空块继承）/ `.anysearch-cli/server-token`（0600）/ `.anysearch/project-index.db`（66 行实证）。
- plugin server：`ans-plugin-server` bin 直拉，127.0.0.1:33333 bearer。
- CodeBuddy：2.151.0（会话间自 2.149.0 自升级），已登录，headless 用 `--model fast-model`（gemini-3.5-flash 网关 429）。
- 上游 v1/chat：可用模型经 `GET <base>/models` 实测——`step`(5s content 直出)/`glm1`(reasoning 模型)/`nvdia`(26s)；`deepseek`/`gpt`/`qwen`/`meituan`/`claude`/`ces` 当前 5xx 或超时；ans_chat 需 `ANS_LLM_PROVIDER=custom`+`ANS_LLM_MODEL=<上游id>`。

## 续跑工具

- `.scratch/grill-round-65/scripts/probe.mjs <label> "<prompt>" [--nomcp] [--maxturns N] [--model M]`：CodeBuddy headless 单探针，transcript+debug 落 evidence，自动注入 User env（不落盘），报 project_index 行差。
- `.scratch/grill-round-65/scripts/mcp-call-tool.mjs <tool> '<jsonArgs>'`：绕过宿主的 tools/call 直调（隔离工具行为）。

## 仍 deferred（如实）

- internal anysearch provider live 查询 0 成功（fail-open 未阻；需服务端排查）。
- recall_memory projectIndex 与 session 库不同根（cwd 锚定 vs ~/.anysearch 引擎库）——设计问题。
- 真 Claude Code/Cursor/Codex/Antigravity 宿主未实机；interactive TUI 未验；embedding arm 未验；跨 OS 委派 CI matrix。
- OIDC trusted publishing 欠条 due 0.0.4。

## 红线提醒

键值永不进对话/证据/提交物；e2e 现场留仓外；publish/tag/push 须用户当场授权；`> nul` 重定向在 Git Bash 会产实体 `nul` 文件并断 but 全栈扫描（本轮复发 ×2，见报告别再踩）。
