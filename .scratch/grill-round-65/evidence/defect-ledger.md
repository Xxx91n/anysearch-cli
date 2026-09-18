# R65 defect 台账（found/fixed/deferred 三元组）

## found

| ID | 发现 | 证据 | 严重度 | 处置 |
|----|------|------|--------|------|
| F-01 | `apps/plugin` 无 bin——plugin server 须手拉 `node <npm-global>/@anysearch-cli/plugin/dist/server/index.cjs`，陌生人无启动入口 | t1: package.json bin=null；手拉成功（server-stderr.log） | 高 | T3 修（加 `ans-plugin-server` bin） |
| F-02 | `configs/*/hooks.json` 四平台模板 PreToolUse/PostToolUse 全指向 `dist/hooks/{preheat,distill}.cjs`——这两文件是**库**（导 `makePreToolUseDecision` 等，无 main/不读 stdin），照模板接线=静默 no-op，与字段名缺陷无关 | t1: `tail dist/hooks/preheat.cjs`=纯 exports；`grep process.stdin` 仅 session-start.cjs + adapters/* 命中 | 高 | T3 修（模板改指 `adapters/<host>.cjs` 单入口；codebuddy 模板新建） |
| F-03 | 四个适配器读 `stdin.event`，真实宿主（CodeBuddy/真 Claude Code）注入 `hook_event_name` → event="" → 静默 exit 0，hooks 部署即假绿 | t1: `adapters/claude.cjs:213` `stdin.event \|\| ""`；grill 文献 | 高 | T3 修（`hook_event_name ?? event`） |
| F-04 | CodeBuddy stdout 契约要求决策经 `hookSpecificOutput{permissionDecision\|additionalContext\|updatedToolOutput}` 信封；claude 适配器把 additionalContext/updatedInput/updatedToolOutput 写**顶层**（仅 permission 进信封） | t1: claude.ts 源码比对 vs CONTEXT.md Hooks Contract Parity | 中 | T3 修（新 codebuddy 适配器） |
| F-05 | `query_knowledge` 是 stub（返回 adapter=none） | grill 实录（D-003 登记不拦探针） | 低 | deferred——实录为发现 |
| F-06 | CodeBuddy headless 须先账号登录（`Authentication required. Please use /login`），mcp.json 已被拾取（日志 `allServers=[anysearch:connecting]`） | t1: cb-p1-tools.log result.error；logs/2026-09-16 | 阻塞 | 待用户登录（凭证门） |
| F-07 | 键位未供：`ANYSEARCH_API_KEY`/`ANS_LLM_BASE_URL`/`ANS_LLM_API`/`ANS_LLM_API_KEY` shell+User+Machine 三层 unset；`EXA_API_KEY` USER-SET | t1: env 存在性检查（值未印） | 阻塞 | 已解除——用户供齐 User 级键（t2） |
| F-09 | CodeBuddy 真实 `tool_response` 是**数组 content blocks** `[{type:"text",text:"<json>"}]`，适配器只认 string/{content:[]}/object → 落到原样 object → distill `resultCount:0`，PostToolUse 假绿（exit 0、信封合法、0 索引） | t2: p2 会话 debug `01a0a963-...txt` 抓实物 stdin + hook stdout `resultCount:0`；db 6→6 | 高 | 已修：`core.unwrapToolResponse` 共享解包（数组→text block→JSON.parse），codebuddy+claude 适配器接入；契约测试 +2（数组形状）；live 复跑 db 6→16 |
| F-10 | `ans-mcp` 不随包 ship `domains/`，且 `createEngine(ANS_DOMAIN)` 不传 `domainsDirs` → 默认链只有 `<cwd>/domains`（宿主 cwd 永远没有）→ **域向在 MCP 路径全灭**，OOD 查询返回通用结果（Pinterest/Allrecipes）而非 docs 域结果 | t2: p3 实探针 19 条通用食谱结果 vs 同 query 直调 `ans search` 全 modelcontextprotocol.io/typescriptlang.org | 高 | 已修：mcp `files+=domains` + `scripts/sync-domains.mjs`（镜像 cli）+ `server.ts` 域链补 `<pkg>/domains`；live 复跑 OOD 全 MCP 域结果 |
| F-11 | `ans_chat` MCP 工具只读 `ANS_LLM_PROVIDER/MODEL`，不读 `ANS_LLM_BASE_URL/API/API_KEY` → 用户配置的 v1/chat 上游在 MCP 路径不可达（cli chat.ts:40-47 有此逻辑，mcp 漏） | t2: p4 探针报 `LLM not configured`，直调确认上游 /v1/models 200 | 高 | 已修：ans-chat.tool.ts 补齐 env 三件套线程化（session key 含 baseUrl/api；baseUrl 无 api → 显式报错） |
| F-12 | `PiAgentRuntime` 等 `assistantMessageEvent.type==="text"`——pi-ai 根本没有该类型（真实 union：`text_delta.delta`/`text_end.content`）→ **所有 ans_chat 输出静默归零**，返回裸 "Agent completed"；测试从未 run() 驱动事件映射所以全绿假绿 | t2: p4c 直调 ans_chat 返回 `\nAgent completed`；pi-ai types.d.ts:388-435 union 实物；step 模型直出 content 证明上游无恙 | 高 | 已修：`mapAssistantMessageEvent` 纯函数（text_delta→text、text_end 兜底、message_start 重置、thinking/toolcall 不吞）；pi-runtime.test +6 断言；直调+live 复跑出真实正文 |

## fixed

| ID | 修复 | 先红证据 | 后绿证据 |
|----|------|----------|----------|
| F-01 | package.json 加 `bin.ans-plugin-server→dist/server/index.cjs` + server/index.ts 补 shebang | bin=null（t1 实物） | `pnpm build` → dist/server/index.cjs 首行 `#!/usr/bin/env node`；bin 注册待 T4 tarball 验证 |
| F-02 | configs/{claude,codex,antigravity}/hooks.json Pre/Post 改指 `adapters/<host>.cjs`（单入口双事件）；新增 configs/codebuddy/hooks.json（matcher+command schema，`$(npm root -g)` 解析陌生人路径）；`files` 加 `configs`（模板随包发布——原 files:["dist"] 根本不 ship 模板）。**cursor 漏修——F-A1 审计返工补齐** | tail dist/hooks/preheat.cjs=纯库无 main | 模板实物 + codebuddy-contract 20/20（含模板-target 可执行断言） |
| F-03 | 四适配器 + session-start 改 `hook_event_name ?? event`；新 codebuddy.ts 适配器（hook_event_name+hookSpecificOutput 信封+SessionStart 原文） | t1-synthetic-stdin-red.log：hook_event_name→0 索引空输出；event→2 索引 | t3-synthetic-green-{codebuddy,claude}.log：两适配器 hook_event_name 各 +2 索引+正确信封；test/codebuddy-contract.test.ts 10/10 |
| F-04 | codebuddy.ts 决策全进 `hookSpecificOutput{permissionDecision\|additionalContext\|updatedToolOutput}`（顶层零泄漏有测试断言） | claude.ts 源码顶层写字段（t1） | codebuddy-contract.test.ts「decision keys must NOT leak to top level」断言绿 |

## deferred

- F-05 query_knowledge stub：如实入账，不修（D-003 登记）。t2 live 实证：`query_knowledge → "adapter=none (not yet implemented)"`，宿主如实转述为环境缺口而非工具故障。
- F-06 CodeBuddy 登录门：已解除（用户完成 /login；`apiKeySource: www.codebuddy.ai`，model 调用实通）。注意 CodeBuddy 在会话间自升级 2.149.0→2.151.0。
- OIDC trusted publishing：欠条 due 0.0.4，范围外（D-001）。
- `recall_memory` 的 projectIndex 字段在 live 探针中返回空——plugin server 写 `<e2e>/.anysearch-cli/project-index.db`（cwd 锚定），MCP recall 读 `~/.anysearch` 引擎库，两库不同根；是否应汇合是设计问题，非本轮修（如实登记）。
- `search_web` 的 internal `anysearch` provider 在 live 探针中 queried 但 successfulProviders=2/3——内部服务侧未成功返回（凭证已供），fail-open 生效未阻探针；需服务端排查，登记 deferred。
- 真 Claude Code / Cursor / Codex / Antigravity 宿主未实机验证（契约级 + 合成 stdin 绿；CodeBuddy 已 live 绿）。

## T2/T4 live 探针矩阵结论（CodeBuddy 2.151.0，model=fast-model，e2e 现场 D:\Aworker\e2e-r65-codebuddy） <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->

| 探针 | 结果 | 证据 |
|------|------|------|
| P1 MCP 注册 | ✅ `mcp_servers:[{anysearch:connected}]` + 5 工具 `mcp__anysearch__*` 全注册 | t2-p1-tools.stream.jsonl init 事件 |
| P2 域内检索 | ✅ typescriptlang.org 实答 + PostToolUse 索引 6→16 | t2-p2b-indomain-fixed.* |
| P3 OOD 域向 | ✅ 修复前通用结果→修复后全 modelcontextprotocol.io（与 CLI 一致） | t2-p3-ood-abstain.* / t2-p3b-ood-domain.* |
| P4 ans_chat | ✅ v1/chat 上游（model=step）真实一句话回答 | t2-p4d-ans-chat.* |
| P5 recall 往返 | ✅ 10 条召回跨 3 sessionId | t2-p5-recall.* |
| P6 hooks 三事件 | ✅ debug 实物：SessionStart 卡片入 context + PreToolUse(exit0) + PostToolUse 信封 distill | t2-p6-hooks-debug.log（返工 F-A2 拷回，原物在 `~/.codebuddy/debug/<sid>.txt`） |
| P7 断连 fail-open | ✅ server 杀掉后 search 正常、hooks 全 exit 0、distill 仍产出（index 静默跳过） | t2-p7-failopen.* + debug |
| P8 research+knowledge | ✅ research_web 执行；query_knowledge 诚实 stub | t2-p8-research-knowledge.* |
| P9 对照 | ✅ 无工具猜 `pnpm.io/npmrc#node-linker`（错）→ 有工具实检 `pnpm.io/settings/node-modules`（真官方页+更深细节） | t2-p9a/p9b.* |

## 审计返工发现（2026-09-16 审计窗口打回，reports/2026-09-16-audit.md）

| ID | 级别 | 发现 | 处置 | 验证 |
|----|------|------|------|------|
| F-A1 | 高 | `configs/cursor/hooks.json` 仍指 `dist/hooks/{preheat,distill}.cjs` 库文件——T3"四平台"声明虚报（实际 3+codebuddy）；git log 证实 r65 从未碰该文件。测试盲区：原契约测试只断言模板有 preToolUse 键 | **fixed**：模板改指 `adapters/cursor.cjs`；契约测试新增"所有 configs/*/hooks.json target 必须存在且读 stdin"断言堵同类盲区 | codebuddy-contract 20/20（新增断言在 cursor 修复前先红） |
| F-A2 | 中 | P6 hooks debug 摘录未拷回 evidence/（实物留 `~/.codebuddy/debug/`），违 D-006(ii) 证据归档口径 | **fixed**：三会话 executeHooks/Hook input/exit0 摘录落 `t2-p6-hooks-debug.log`（61 行、6 次 hook 调用、0 密钥模式命中） | evidence 实物 |
| F-A3 | 低 | `codebuddy.ts` 信封发 `updatedInput`——超契约三键、与自身注释矛盾、死码 | **fixed**：删除该键 + 注释订正 | tsc 0 错 + 契约测试绿 |
| F-A4 | 低 | `ans-chat.tool.ts` llmSessionKey 不含 ANS_LLM_API_KEY——长驻 MCP 换 key 不重建 session | **fixed**：key 追加 `sha256(ANS_LLM_API_KEY)[:12]`（永不嵌原值） | check 绿；旋转后 session 必然重建（key 不同） |
| F-A5 | 登记 | `unwrapToolResponse` 仅 codebuddy+claude 接入，codex/cursor/antigravity 遇数组形状复现 F-09 | **fixed**：三适配器 PostToolUse 全接入解包；各加数组形状契约用例 | codebuddy-contract 20/20 |
| F-A6 | 低 | 文档漂移：契约测试数 10/14/16 三处不一；ponytail-ledger 未补记；CHANGELOG `### Verified` 非标节名 | **fixed**：统一 20/20；ledger 补 2 条（codebuddy.ts:49、ans-chat.tool.ts:71）；Verified 并入 Changed 单条 | 本文件 + git diff |
| F-A7 | 观察 | D-003"末尾 interactive 抽验"未做 | **deferred**：报告已如实列未验证面；D-006(iv) 明列可挂 | — |
