# Round-65 → implementation handoff（grill finalized 2026-09-16）

## 零上下文摘要

主题（D-001）：真实可用性收口「开门」轮——本机部署 anysearch-cli（内部服务 API key + 上游 v1/chat OpenAI 兼容端点）→ 全栈部件部署到另一 agent host「CodeBuddy」→ headless 探针实测效果。

实测载体 = published npm @anysearch-cli/*@0.0.3（npm i -g / npx，真陌生人路径）。首个真实用户 = CodeBuddy 上的真实集成。

唯一事实源：`.scratch/grill-round-65/decision-ledger.md`（D-001~D-006 全 current）。

## 机制事实（grill 期实物核实）

- 部署单元：apps/cli → bin `ans`（dist/index.js）；apps/mcp → bin `ans-mcp`（dist/index.cjs，stdio 默认 / --transport http --port，5 工具 search_web/research_web/recall_memory/query_knowledge/ans_chat）；apps/plugin → hooks（dist/hooks/{preheat,distill,session-start}.cjs + adapters/{claude,cursor,codex,antigravity}.cjs）+ plugin server（dist/server/index.cjs，127.0.0.1:33333 bearer token，/recall /index /health /purge——**无 bin，启动缺口已登记 T3**）。
- CodeBuddy Code 2.149.0 已装本机：`~/AppData/Roaming/npm/codebuddy`；家目录 `~/.codebuddy/`（settings.json 现={trustedDirectories,language:简体中文,model:glm-5.3}）。 <!-- machine-local: user-level agent/tooling config path on build host @ 2026-09-19 -->
- CodeBuddy hooks 契约：stdin 注入 `hook_event_name`（非 event）+tool_name/tool_input/tool_response/session_id/cwd；stdout 决策经 `hookSpecificOutput`{permissionDecision|additionalContext|updatedToolOutput}；SessionStart 的 stdout 原文进上下文；settings schema={matcher,hooks:[{type:"command",command:<bash 字符串>}]}；Windows 上 hook 命令强制 Git Bash；文档标 Beta（≥v1.16.0）。
- CodeBuddy headless：`codebuddy -p --output-format stream-json --mcp-config <file|string> --strict-mcp-config -d api,hooks --max-turns <n>`——实测协议全可脚本化；`-y/--dangerously-skip-permissions` 或 `--permission-mode` 供非交互跑。
- 潜伏假绿（T1 预期实证）：apps/plugin/src/hooks/adapters/claude.ts 读 `stdin.event`——真实宿主发 `hook_event_name` → event="" → 静默 exit 0 → hooks 部署了但什么都不做。T3 修 `hook_event_name ?? event`（真实 Claude Code 同发 hook_event_name，修正全体受益）。
- `query_knowledge` 是 stub（返回 adapter=none）——实录为发现不拦探针。
- 键位：`ANYSEARCH_API_KEY`（内部服务）+`ANS_LLM_BASE_URL`+`ANS_LLM_API=chat`+`ANS_LLM_API_KEY`（v1/chat 上游）由用户现场设 Windows 用户级 env；`EXA_API_KEY` 已在场。**键值永不进对话/transcript/证据/提交物**（D-004 红线）。
- engine 读 `ANS_DOMAIN`（apps/mcp/src/server.ts:38）；CLI 包随带 domains/{default,docs,research}.toml——演示域 `ans domain docs`。
- e2e 现场放**仓库外** scratch 目录（防宿主读 AGENTS.md 污染）；证据拷回 `.scratch/grill-round-65/evidence/`。

## 票序（D-005 evidence-first 六票，串行）

### T1 部署腿 [D-001 D-002 D-004]
- `npm i -g @anysearch-cli/cli@0.0.3` → `ans --version` → `ans doctor` → `ans domain docs`
- 验 env 键存在性（只查 SET/unset，不印值）→ `ans mcp` / ans-mcp stdio tools/list 烟测
- plugin server 手拉：`node <npm-global>/node_modules/@anysearch-cli/plugin/dist/server/index.cjs`（记「陌生人须手拉」=可用性发现）
- e2e scratch 目录建项目级 `.codebuddy/settings.json`，hooks 先挂 claude 适配器条目试接（预期 no-op 运行实证）
- 验收锚：每步命令+输出摘录落 evidence；部署缺口清单初稿

### T2 探针首轮 [D-003]
- P0 安装/doctor、P1 MCP 注册+tools 列表、P2 域内 search（docs 域）、P3 域外 abstain、P4 ans_chat v1/chat、P5 recall_memory 往返、P6 hooks 三事件（预期红=假绿实证）、P7 server 断连 fail-open、P8 research_web 多轮 + query_knowledge stub 实录
- keys 到位是硬前置（用户现场供）；每探针 stream-json transcript+verdict
- 验收锚：defect 台账建账（found/fixed/deferred 三元组）；hooks no-op 先红证据

### T3 修复票 [D-002 D-004 + T2 缺陷]
- `apps/plugin/src/hooks/adapters/codebuddy.ts` 新适配器（hook_event_name 契约 + hookSpecificOutput 信封）
- claude 及其余适配器 contract 修正 `hook_event_name ?? event`（全体受益）
- `apps/plugin/configs/codebuddy/hooks.json` 模板（{matcher,hooks[type:command]} schema，Git Bash 兼容命令）
- `apps/plugin/package.json` 加 bin `ans-plugin-server` → dist/server/index.cjs
- 合成 stdin 契约单测（按 CodeBuddy 真实 stdin 形状逐事件构造）+ T2 其余 defect 修复或挂 deferred-registry
- 验收锚：每修复对应 T2 红证据；pnpm check/test 干净

### T4 探针复跑 [D-003 D-005]
- `pnpm pack` 本地 tarball → `npm i -g <tgz>`（含 T3 修复，验真实 ship 通道——不用发布版因修复不在 0.0.3）
- 全矩阵复跑转绿：hooks 三事件注入实证（SessionStart stdout 进上下文 / preheat additionalContext / distill→recall_memory 命中）+ `ans-plugin-server` bin 可用
- 验收锚：先红后绿证据对齐全；evidence/ 目录完整

### T5 文档 [D-002 D-003 D-004 D-006]
- `docs/adr/0066-architecture-grill-round-65-*.md`（主题+三件套部署+契约修正+缺口分叉修+探针矩阵+closure 回填位）
- README：verified-hosts 表（CodeBuddy=首个真宿主 verified+日期+版本+验证范围）+Known Limitations 口径更新
- CHANGELOG + CONTEXT.md 新词已写（Grill Round 65 Terms，7 词各带 _Avoid_）+ CodeBuddy 集成文档
- 验收锚：不把未验证面写成已验；新词全带 _Avoid_

### T6 收口 [D-006]
- 四段：(i) 部署证据可复跑记录 (ii) evidence/ 全 transcript+逐项 verdict+hooks 实证 (iii) defect triplet 清零/挂账 (iv) verified-hosts 表+P9 对照（同题有/无工具双跑 stream-json）+未验证面清单（真 Claude Code 未验/interactive TUI 未验/embedding arm 未验）
- main tip ci+ship-gate 绿 run URL；ADR-0066 closure 四段回填
- 验收锚：D-006 四条成文义务逐条满足

## 范围外（D-001 登记）

- OIDC trusted publishing（欠条 due 0.0.4，紧邻下轮候选）
- watch 观测窗值守=运行中义务（g0001/4/5/6/9/10 CI 翻转→既有 TTL 通道重入，不占票）
- en 双宿主新案例 harvest；真 Claude Code 宿主验证；interactive TUI 实测；embedding arm 实测
- publish/tag/push 等外部副作用须用户当场授权

## 环境备忘

- Windows 11 + Git Bash 优先；pnpm 11.24.0 pinned（pmOnFail:error）；Node 在 PATH
- `ans` 当前未全局安装（T1 第一动作）
- GitButler：写操作一律 `but`（but diff 取 ID → but commit -b <branch>）；本轮栈 r65-*；grill 文档在 r65-grill
- .gitignore 已含 `!.scratch/grill-round-65/**` 白名单

## Suggested skills

- `$implement` —— T1–T6 实施入口
- `$handoff` —— 中断点交接
- `atomcode-research` —— 仅当 CodeBuddy 契约再有疑义
- `gitbutler` —— 全部版本控制写操作
