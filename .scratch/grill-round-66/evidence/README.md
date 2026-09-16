# R66 evidence 索引

> e2e 现场 D:\Aworker\e2e-r66-claude（仓外）；runner=scripts/probe-claude.mjs（spawn claude.exe 直启，User env 注入不落盘）。
> 基线=published 0.0.3（registry）；候选体=T2+ pnpm pack tarball。证据命名 t<票>-<探针>.{stream.jsonl,debug.log}。

## T1 部署腿 + 0.0.3 基线（D-002）

| 步骤 | 命令 | 结果 | 证据 |
|------|------|------|------|
| env 存在性 | reg query HKCU\Environment（键名+长度，值未印） | ANYSEARCH_API_KEY/ENDPOINT+ANS_LLM 五件+EXA+TAVILY 全 USER-SET；ctx 沙箱不继承→runner 走 User 层注入 | 会话记录 |
| 安装基线 | npm i -g @anysearch-cli/cli@0.0.3 mcp@0.0.3 plugin@0.0.3 | changed 340 pkgs；plugin bin=null/files=[dist]，mcp files=[dist]（=真 registry 0.0.3，覆盖 R65 tarball 假象） | npm 输出 |
| e2e 接线 | mcp.json（node+npm-global mcp dist，env 空块=继承）；.claude/settings.json 分场景由 scripts/write-settings.mjs 写 | 文件落盘 | e2e 现场 |
| plugin server | 沿用既有 :33333 实例（token 0600 @ e2e/.anysearch-cli/server-token，Sep16 22:04 起）；/health 无 token=401 +Bearer=200 | 活 | server.log/health 实测 |
| P1 tools/list（直拉） | node scripts/mcp-tools-list.mjs | initOk；5 工具；serverInfo anysearch@0.0.3 | t1-mcp-tools-list（索引段） |
| P1 tools/list（真 Claude） | probe-claude.mjs t1-p1-tools | mcp_servers=[anysearch:connected]；5 工具 mcp__anysearch__* 全列；ok exit0 | t1-p1-tools.stream.jsonl |
| P2 域内（直拉 0.0.3） | call-search-urls.mjs search_web docs 域 query | translate.goog×3+github.com×2 入列=**F-10 域灭**；CLI 对照全 allowlist | mcp-003-search-urls / cli-003-urls（索引段） |
| P2 域内（真 Claude） | probe t1-p2e-indomain（冷门 query 触发实调） | toolCalls=[mcp__anysearch__search_web]；结果含 npmjs.com/registry 等 allowlist 外宿主=域灭 live 复现 | t1-p2e-indomain.stream.jsonl |
| hooks 按现状模板接入 | settings.json=模板 {name,command,args} 原样 | **0 anysearch hook_started**；无报错（静默丢） | t1-p2-indomain.stream.jsonl |
| sentinel 对照 | 官方 schema sentinel 独挂→4 钩全起+输出捕获；与模板同挂→被连带抑制回 3 | **R66-B01：非法条目毒化同事件整列** | t1-hooks-sentinel-only / t1-hooks-mixed |
| 合成 stdin 红 | ANS_ADAPTER=0.0.3 claude.cjs，server 活 | **RED CONFIRMED**：hook_event_name→exit0/空/0 索引；event→顶层 updatedToolOutput/+2 索引（F-03+F-04 同证） | t1-synthetic-red（索引段） |

## 探针 prompt 工程注记

- spawn 必须 shell:false 直启 claude.exe（shell:true 会词切 -p 长 prompt，模型只收首词）。
- deepseekpro 对泛 prompt 倾向凭记忆直答不调用工具；冷知识 query（如自指包名）可靠触发 tool_use。
- stream-json init.mcp_servers 报 connected；hook 事件 hook_name 全是 "SessionStart:startup" 形，区分靠 hook_response.output 内容。

## 键位纪律

证据零键值；token 仅脚本读不打印；User env 经 powershell 读长度不落盘。
