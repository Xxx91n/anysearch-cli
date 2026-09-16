# R65 实施续跑交接（2026-09-16，凭证门卡点）

## 给下一个 session 的零上下文摘要

任务书=`.scratch/grill-round-65/handoffs/next-round.md`（六票 T1-T6，账本 decision-ledger.md D-001~D-006 全 current）。本交接=实施轮断点续跑指南。

**已落地（勿重做）**：T1 部署腿全绿 + T3 修复全绿（契约级）+ T4 ship 通道段（pack→npm i -g tarball→ans-plugin-server 测活）+ T5 文档（ADR-0066/README verified-hosts/CHANGELOG/codebuddy-integration.md）+ 本地 ship-gate 9/9。
**唯一卡点**：CodeBuddy 账号未登录 + ANYSEARCH_API_KEY/ANS_LLM_* 未设——T2/T4 活探针（P1-P9）与 T6 收口段全堵在此。

## 续跑第一步（凭证就位后）

```bash
cd D:\Aworker\e2e-r65-codebuddy   # e2e 现场（仓外，勿挪进仓）
# server 应在跑；若无：ans-plugin-server &
codebuddy -p "<probe>" --output-format stream-json --mcp-config mcp.json --strict-mcp-config -d api,hooks --max-turns 5 -y
```

探针矩阵（D-003，每探针独立断言，transcript 拷回 `.scratch/grill-round-65/evidence/`）：
- P1 MCP 注册+tools 列表（init 事件 mcp_servers 应含 anysearch 且 5 工具）
- P2 docs 域内 search_web（expect: allowlist 宿主结果）
- P3 域外 abstain（参考 CLI 观察：域过滤在检索层，abstain 语义需宿主侧实测）
- P4 ans_chat v1/chat（需 ANS_LLM_*）
- P5 recall_memory 往返
- P6 hooks 三事件实证：SessionStart 路由卡进上下文 / PreToolUse additionalContext / PostToolUse distill→server /index 行数差——**修后应绿**（e2e settings.json 已指 codebuddy.cjs）
- P7 server 断连 fail-open（kill server 重跑探针，host 不受影响）
- P8 research_web 多轮 + query_knowledge stub 实录
- P9 对照（D-006iv）：同题有/无 --mcp-config 双跑 stream-json，对账引用质量/拒答/工具轨迹

## 环境实物状态

- 全局 npm：`@anysearch-cli/*@0.0.3`（cli/mcp 发布版）+ plugin = **本地 tarball**（含 T3 修复，版本号仍 0.0.3）
- e2e 现场：`D:\Aworker\e2e-r65-codebuddy\` → `.codebuddy/settings.json`(codebuddy 适配器,$(npm root -g) 路径) / `mcp.json`(env 空块) / `.anysearch-cli/server-token`(0600) / `.anysearch/project-index.db`
- server：127.0.0.1:33333 bearer（token 在 e2e/.anysearch-cli/）
- 复跑脚本：`.scratch/grill-round-65/scripts/{mcp-tools-list,synthetic-stdin-red}.mjs`（后者 ANS_ADAPTER 可换适配器路径）

## 分支栈（but，勿裸 git）

r65-grill → r65-t1-deploy → r65-t3-codebuddy-hooks → r65-t5-docs。探针证据/报告续提 r65-t2t4-probes（新分支），文档状态翻转（verified）并进 r65-t5-docs 追加提交。

## 探针转绿后必做（T6 收口）

1. README verified-hosts 表 CodeBuddy 行 status 翻 verified + 日期/范围
2. ADR-0066 closure (ii)(iv) 回填实证
3. defect-ledger.md F-06/F-07 销账；P6 hooks live 红绿对补齐
4. `node scripts/ship-gate.mjs --skip-matrix` 复跑留痕
5. main tip CI 绿 run URL 回填（publish/push 须用户当场授权，D-001）

## Suggested skills

- `$implement`（续跑入口）、`$handoff`（再交接）、`gitbutler`（全部写操作）、`atomcode-research`（仅当 CodeBuddy 契约再存疑——例如 hookSpecificOutput 是否要求内嵌 hookEventName 字段，live 探针先裁决）

## 红线提醒

键值永不进对话/证据/提交物；e2e 现场留仓外；publish/tag/push 等外部副作用须用户授权；不拿 initialize 绿当全链路绿；stub 不当通过。
