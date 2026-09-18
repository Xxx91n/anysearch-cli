# T3 收口证据 — s2 契约裁决 + s3 真机验收 + SEP-2484 exclusion ledger

宿主：agy 1.2.5 (C:/Users/Administrator/AppData/Local/agy/bin/agy.exe)， <!-- machine-local: POSIX host path cited as evidence @ 2026-09-19 -->
认证：OAuth 已登录（applyAuthResult: jinxi2410@gmail.com，cli-20260917_234334.log）。
探针环境：HOME=D:/Aworker/agy-sandbox 隔离（绕开用户 1mcp MCP 挂起——会阻塞 turn 初始化）。 <!-- machine-local: machine-local path cited in committed doc @ 2026-09-19 -->
探针法：sentinel hook dump stdin+argv（spike/dump-hook.cjs）+ 决策/输出形变腿（decide-*/plain/exit2/ctx-*/sysmsg/inject/empty/brace）+ 真 adapter 端到端。

## s2 — L 序裁决结果（agy 1.2.5 实测）

| 腿 | stdout | 实测结果 |
|---|---|---|
| L-empty 空 stdout | （无输出） | 工具放行 — lenient ✓ |
| L-decision 官方形 | {decision:deny,reason} | 工具拦死，reason 上浮到 agent ✓ |
| L-decision allow | {decision:allow} | 放行 ✓ |
| L-brace {} | {} | **DENY** — decision 必填，缺省=deny ⚠️ |
| L-allow_tool legacy | {allow:true} | protojson 未知字段 → 工具 ERROR |
| L-plain-text | SPIKE_PLAIN_TEXT_ALLOW | protojson unmarshal 失败 → 工具 ERROR |
| exit 2 + stderr | — | command failed: exit status 2，stderr 上浮 → 工具 ERROR |
| additionalContext / context / systemMessage / userMessage | — | 全部非 proto 字段 → unmarshal ERROR |

裁决：**非 exit-0-only**。stdout 是严格 protojson 决策对象；空=放行、{}=deny、
决策字段={decision:allow|deny|ask|force_ask|deny_unless_prior_grant, reason?, permissionOverrides?}。

## stdin 契约（实测 dump）

- 全 camelCase：conversationId / toolCall{name,args} / workspacePaths / transcriptPath / artifactDirectoryPath / modelName / stepIdx
- **无 hook_event_name** —— 事件名只能 argv 传回（sentinel argv 收到正确事件名 ✓）
- PostToolUse 只多 error 字段，**toolCall 无 output** —— 宿主不投递工具输出
- Pre/PostInvocation：invocationNum + initialNumSteps；Stop：executionNum/terminationReason/fullyIdle/error
- toolCall.args 的键为 PascalCase（CommandLine/Cwd/TargetFile/CodeContent）

## s3 — 真机验收 6 腿

| 验收腿 | 结果 | 证据 |
|---|---|---|
| 契约端到端（in-domain 放行 + OOD deny） | **passed** | run5 全 5 事件触发+run_command 放行；run6 deny 拦死+reason 上浮 |
| session_id 传播 | **passed(contract)** | conversationId 字段实测存在（dump stdin）；adapter 映射 conversationId→sessionId 经 callServer header —— 契约测试覆盖；真 /index 腿未跑（probe 机无 ans server），见 exclusion |
| fail-open | **passed** | malformed stdin → exit 0（契约测试）；adapter 全路径 exit 0；error 路径 PreToolUse 仍 emit allow |
| PostToolUse {} 合规 | **passed** | dump-brace 发 {} → run SUCCESS；真 adapter PostToolUse 发 {} → e2e run SUCCESS |
| SessionStart 不存在 + mdc 兜底 | **passed** | 5 事件集实测无 SessionStart；adapter 任事件 ensureMdc——mdc 落 hook 进程 cwd（workspacePaths 空时兜底路径，记为已知形变） |
| variance 可选 | excluded(optional) | 未探 |

端到端真 adapter 腿（e2e.ndjson）：agy -p 下 5 事件全挂真 adapter → run_command 放行 + PreInvocation injectSteps.ephemeralMessage 把 routing card 注入轨迹（transcript_full.jsonl 含 "[anysearch plugin active] Tools available (ans_* prefix)..."）✓

## SEP-2484 exclusion ledger

| 腿 | 判定 | 理由/证据 |
|---|---|---|
| P1 配置装载 | passed | hooks_manager loaded 1 named hooks from 2 hooks.json file(s)；named-map 形状才过解析 |
| P2 事件触发 5/5 | passed | dump 落 Pre/PostToolUse + Pre/PostInvocation + Stop（run5 hook-dump.ndjson 7 条） |
| P3 argv 传事件 | passed | stdin 无 hook_event_name；argv[2] 收到事件名 |
| P4 camelCase stdin | passed | 全键 camelCase 实测 |
| P5 decision 契约 | passed | allow/deny 双腿生效；{}=deny、空=allow、未知字段=ERROR |
| P6 injectSteps 注入 | passed | ephemeralMessage 到 transcript（e2e） |
| P7 ans MCP 工具链 | **excluded** | probe HOME 隔离了用户 MCP；ans_* 路径由契约测试覆盖（call_mcp_tool 解包+isAnsTool+pending 暂存），真 MCP 调用腿未跑 |
| P8 会话续传 (-c) | excluded | 未探（非本票范围） |
| P9 IDE hooks | excluded(宿主不执行) | IDE 脑转录无 hook 执行痕迹；README 记 rules-fallback-only |

## adapter 修复落点（相对备份 backups/t3/antigravity.ts）

- 事件源：argv[2] 主，hook_event_name/event 兜底
- 字段：conversationId→sessionId，toolCall.name/args→toolName/toolInput（call_mcp_tool 解 args 内层名），workspacePaths[0]→cwd
- 输出：PreToolUse 恒 {decision:allow}（绝不 {}）；PostToolUse 恒 {}；Pre/PostInvocation injectSteps 或 {}；Stop {}
- context 注入：routing card 走 PreInvocation(invocationNum===0) ephemeralMessage；preheat/distill 产出暂存 <artifactDirectoryPath>/anysearch-pending.jsonl 由下次 invocation flush
- fail-open：异常路径 PreToolUse 仍 emit allow、其余 {}

## 已知形变

- workspacePaths 可为空数组（probe 会话未挂 workspace）→ mdc 落 hook 进程 cwd。生产形态下 IDE/CLI 项目会话应有值；记为 best-effort。
- hooks 双读面：~/.gemini/config/hooks.json 与 ~/.gemini/antigravity-cli/hooks.json 均装载（同名去重）。
