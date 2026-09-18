# T3 s0+s1 spike 证据 — 2026-09-17

## s0 — agy CLI 安装（用户授权后执行）

- 安装器：官方 https://antigravity.google/cli/install.ps1 下载后人工审读（172 行：manifest 拉取 → SHA512 校验二进制 → LOCALAPPDATA/agy/bin 落位 → User PATH 注册表写入+广播）——非盲 iex。
- 结果：`agy --version` = **1.2.5**（≥1.1.10 ✓），装至 D:/Users/Administrator/AppData/Local/agy/bin/agy.exe（实际 C: 盘 Users/Administrator）。 <!-- machine-local: POSIX host path cited as evidence @ 2026-09-19 -->
- `agy -p "..."`：返回 exit 0 但**零输出**——cli.log 证 `error getting token source: You are not logged into Antigravity`（认证缺口，见 s0.5 断点）。
- IDE 已装于 C:/Users/Administrator/AppData/Local/Programs/antigravity/Antigravity.exe（用户提示路径核实存在）。 <!-- machine-local: POSIX host path cited as evidence @ 2026-09-19 -->

## s0.5 断点（诚实记录，非 verified 宣称）

agy 无 auth 子命令、无 --api-key 旗标；无头认证两路：交互式 OAuth（OS keyring 缓存 token）或 GEMINI_API_KEY + settings.json modelProvider:gemini（官方 docs/cli/install）。用户选 OAuth 自登。认证就绪前 s3 不可全绿——本行即断点环号。

## s1 — 双探结果（装后实测）

| 探针 | 结果 |
|---|---|
| ~/.gemini/config/hooks.json | **存在**——Gemini 形制 {hooks:{PreToolUse:[{matcher,hooks:[{type:command,command}]}]}}，已挂 context-mode 三钩（pretooluse/posttooluse/stop，matcher=run_command|view_file|grep_search|web_fetch|read_url_content） |
| ~/.gemini/antigravity-cli/hooks.json | 首跑前不存在；**首次 agy 运行后 ~/.gemini/antigravity-cli/ 目录被创建**（cli.log/log/brain/cache/conversations/installation_id 等）——CLI 自己的数据根确立 |
| 项目 .agents/hooks.json | 仓库根无 .agents/ 目录、无项目级 hooks.json（repo 内仅 apps/plugin 分发用 configs/） |
| hooks 装载实证 | agy 日志 hooks_manager.go:53 loaded 1 named hooks from 1 hooks.json file(s)——**agy CLI 进程内确有 hooks 加载面**（与「IDE 不执行 hooks」既有裁决不矛盾：这是 CLI 宿主自己的加载器） |
| transcriptPath/brain | ~/.gemini/antigravity-cli/brain/ 存在（CLI session 转录根）；IDE 侧 ~/.gemini/antigravity/brain/ 另有 20+ session 目录——两宿主数据根分离 |
| IDE 复测 | IDE 2.5.5 hooks 腿待复测（顺手腿，认证后在 s3 窗口做） |

## 待办（认证后）

s2 契约裁决（L0-L3 重排：L-empty→L-decision 官方顶层形→L-allow_tool legacy→L-plain-text exit 语义；审计点=hook_event_name 不注入须 argv 传回+camelCase 字段+exit-0-only）→ s3 agy -p headless hooks 触发+可观测输出 → 验收 6 腿（契约端到端/session_id 传播/fail-open/PostToolUse {} 合规/SessionStart 不存在+mdc 兜底/variance 可选）+ SEP-2484 exclusion ledger。
