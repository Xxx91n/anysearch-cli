# anysearch-cli

[English](README.md) | **简体中文**

> 本文档为翻译件，规范以 [README.md](README.md) 为准。

[![npm](https://img.shields.io/npm/v/@anysearch-cli/cli)](https://www.npmjs.com/package/@anysearch-cli/cli)
[![ci](https://github.com/Xxx91n/anysearch-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Xxx91n/anysearch-cli/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/Xxx91n/anysearch-cli)](LICENSE)

垂直领域信息专家 CLI：search + research + memory + knowledge 合于一个
agent——FTS5 召回、多路 RRF 融合、自动索引结果的 MCP server，以及一道
真正拦得住返回内容的域名 allowlist。

**状态：已发布 npm** — `npm i -g @anysearch-cli/cli`（自 0.0.4 起经 npm
OIDC trusted publishing 发布，含 sigstore provenance；0.0.1/0.0.2 因
`workspace:*` peer 逃逸作废——见 CHANGELOG）。

## 环境要求

- Node.js >= 22（Node 24 已验证）
- pnpm 11.24.0 精确版本（钉死；corepack 自动读取 `packageManager`）
- 真实搜索至少需要一个 provider API key：
  - `EXA_API_KEY` — Exa（支持域名过滤）
  - `TAVILY_API_KEY` — Tavily（支持域名过滤）
  - `ANYSEARCH_API_KEY` — anysearch REST（可选；匿名层可用，无域名过滤）

## 快速上手

```bash
npm i -g @anysearch-cli/cli
ans doctor                                          # self-check: keys, DB path, domain resolution, provider readiness
ans search "tokio JoinSet rust"                     # first search (full fanout across keyed providers)
ANS_DOMAIN=docs ans search "tokio JoinSet rust"     # domain-scoped search

# optional vector arm (peer-optional — never auto-installed):
npm i -g @anysearch-cli/embedding
```

从源码构建（贡献者）：

```bash
git clone <this repo> && cd anysearch-cli
pnpm install --node-linker=hoisted   # Windows: hoisted avoids better-sqlite3 EPERM
pnpm build
node apps/cli/dist/index.js doctor
ANS_DOMAIN=docs node apps/cli/dist/index.js search "tokio JoinSet rust"

# machine-readable output (includes sufficiency / attribution / abstain)
node apps/cli/dist/index.js search "..." --json
```

CLI 在全局安装或 link 后解析为 `ans`；仓库形态下
`node apps/cli/dist/index.js` 是同一入口。

## 域名与弃权（ADR-0062）

*域名（domain）*是 `domains/`（或 `ANS_DOMAINS_DIR`）下的一个 TOML 文件，
声明其 providers 与权威 `urlAllowlist`；`ANS_DOMAIN` 负责选择。

过滤以两道闸运行：

1. **前置过滤（按能力协商）** —— 声明支持域名过滤的 provider 直接收到
   allowlist（`tavily`：`include_domains` 硬过滤模式；`exa`：
   `includeDomains`）；不支持的 provider（如 `anysearch`）诚实降级为
   仅后置过滤——绝不为它们伪造过滤能力。
2. **后置过滤（权威）** —— provider 返回后，kernel 在融合/归因之前丢弃
   所有 URL 不在 allowlist 的结果。deny 规则优先；allow 条目匹配宿主
   及其子域。

当闸门后结果为零，`ans` **弃权（abstain）** —— 一等公民结果，不是错误：

```text
abstain: no results within allowed cold domain(s) (pre-filtered 0, post-filtered 0, gate pre)
```

- 默认退出码 **0**（弃权是成功的策略结果）；`--fail-on-abstain` 为自动化
  返回专用退出码 **3**。
- `--json` 携带 `abstain: { reason, domain, preFiltered, postFiltered, gate }`；
  MCP 工具以 `structuredContent.abstain` + `isError: false` 呈现。
- 每次域名限定搜索在观测轨迹里落地两条审计事件：
  `retrieval.domain_filter.pre` 与 `retrieval.domain_filter.post`。

退出码：`0` 正常/弃权 · `1` 一般失败或无域名策略下的零结果 · `2` 用法
错误 · `3` `--fail-on-abstain` 下的弃权。

## Provider 域名过滤矩阵

| provider | 前置过滤已下发 | 降级模式 |
|----------|-----------------|--------------|
| tavily   | yes（`include_domains`，硬过滤模式） | — |
| exa      | yes（`includeDomains`） | — |
| anysearch| no（REST API 无域名参数） | 仅后置过滤 |

Provider 选择来自域名 TOML 的 `sources.enabled`。缺 key 的 provider 被
跳过而非崩溃（fail-open）；若*没有任何* provider 能注册，搜索是错误
而非弃权。

## MCP 服务器

```bash
node apps/mcp/dist/index.cjs                    # stdio transport (default)
node apps/mcp/dist/index.cjs --transport http --port 3099   # HTTP
```

五个工具：`search_web`、`research_web`、`recall_memory`、`query_knowledge`、
`ans_chat`。`ANS_DOMAIN` 以与 CLI 相同的方式限定 server 范围。
工具绝不向 stdout 输出；server 保持协议通道纯净。

## 已验证 Agent 宿主

| 宿主 | 版本 | 日期 | 范围 | 状态 |
|------|---------|------|-------|--------|
| CodeBuddy Code | 2.151.0 | 2026-09-16 | `mcp.json` 注册（`ans-mcp`，5 工具）· `.codebuddy/settings.json` hooks（`hook_event_name` 契约，`hookSpecificOutput` 信封）· `ans-plugin-server` bin | 实机验证：headless P1–P9 探针矩阵全绿（search/recall/ans_chat/research + 3 事件 hooks + fail-open + 有/无工具对照） |
| Claude Code | 2.1.251 | 2026-09-17 | `mcp.json` 注册（`ans-mcp`，5 工具）· `.claude/settings.json` hooks（官方 schema，`ans-hook-*` bins，`hookSpecificOutput` 信封）· `ans-plugin-server` bin · plugin 骨架（`.claude-plugin/` + `hooks/` + `.mcp.json`；实验性——`CLAUDE_PLUGIN_ROOT` 在 Windows 展开失灵，upstream #16116） | 实机验证（settings 路径）：MCP 连接 + 5 工具 + 真发 `search_web`，SessionStart routing-card 经信封注入，Pre/PostToolUse hook 执行标记实证，deny/envelope 契约哨兵实证，fail-open，`claude plugin validate` 通过 |
| Codex CLI | 0.142.5 | 2026-09-17 | `config.toml` `[mcp_servers.anysearch]`（`ans-mcp`，5 工具）· hooks 经 `.codex/hooks.json`（项目）或 `[[hooks.*]]` config.toml 段——官方 `{matcher, hooks:[{type,command,timeout}]}` schema，`ans-hook-codex` / `ans-hook-session-start --envelope` bins | 实机验证：SessionStart routing-card 信封送达，PostToolUse → `/index` 累积真实结果，URL-policy deny 端到端阻断，fail-open 保持；PostToolUse ctx 注入为同轮可变 |
| Antigravity CLI（`agy`） | 1.2.5 | 2026-09-17 | hooks 经 `~/.gemini/antigravity-cli/hooks.json` 或 `~/.gemini/config/hooks.json`——named-hook map `{ "<name>": { "<Event>": [{matcher, hooks:[{type:"command",command,timeout}]}] } }`，事件经 argv 传入（`ans-hook-antigravity <Event>` bin） | 实机验证（裁剪矩阵）：headless `agy -p` 五事件全触发；严格 protojson 契约哨兵实证（PreToolUse `{}` = DENY、空 = allow、`{decision,reason}` 放行/阻断、`permissionOverrides`）；`injectSteps[].ephemeralMessage` 抵达 transcript（routing-card 端到端注入）；PostToolUse stdin 无工具输出——distill 暂存 pending → 下一 invocation flush；证据 `.scratch/grill-round-68/evidence/t3-*` + SEP-2484 ledger |
| Antigravity IDE | 2.12.2 | 2026-09-17 | `.antigravity/rules/anysearch.mdc`（rules 兜底，首次 hook 调用时写入） | IDE 宿主不执行 hooks（已复现）；.mdc rules 兜底是受支持的面——不要把 `configs/antigravity/hooks.json` 接进 IDE 设置 |

"已验证"指在真实宿主上捕获端到端 transcript（`stream-json`），而非契约
同构。接线方式见 `docs/codebuddy-integration.md` /
`docs/claude-integration.md` / `docs/codex-integration.md`；证据集见
ADR-0066 / ADR-0067 / ADR-0068 / ADR-0069。

## 已知限制

| 限制 | 影响 |
|------------|----------------|
| macOS 在阻断矩阵之外 | 未解决的退出时 `libc++abi` 崩溃使 `ship-gate` 只闸 ubuntu+windows；macOS 以非阻断 probe 车道运行 |
| `anysearch` provider 无法前置过滤 | 其 REST 面没有域名参数——域名 allowlist 下诚实降级为仅后置过滤 |
| 退出时 `libc++abi` 可能覆盖弃权退出码 | 自动化必须读结构化弃权标记（`--json` / `structuredContent.abstain`），不能只看退出码 |

完整记录：[docs/limitations.md](docs/limitations.md)。

## 设计取舍

- **垂直领域** —— 域名是带权威 `urlAllowlist` 的 TOML 策略文件，在
  kernel 内强制执行，不是提示词愿望。
- **弃权优先** —— 闸门后为空是一等公民的弃权结果，绝不编造答案。
- **Fail-open** —— hooks、providers 与可选 peer 诚实降级，不拖垮宿主
  agent。

完整编号决策记录：[docs/adr/index.md](docs/adr/index.md)。

## 面向贡献者

- `CONTEXT.md` —— 领域术语 canonical 表（先读）
- `docs/adr/index.md` —— 生成的决策索引（`scripts/gen-adr-index.mjs`，勿手改）
- `docs/limitations.md` —— 完整已知限制记录
- `docs/agents/` —— domain-doc + 本地 markdown issue tracker 约定
- 仓库布局：`packages/kernel`（引擎）· `packages/store`（FTS5 记忆、
  观测、URL 策略）· `packages/retriever`（provider 适配器 + RRF）·
  `apps/cli` · `apps/mcp` · `apps/plugin`（宿主 hooks）
- 单包测试跑 `node --import tsx --test`；完整门禁 =
  `node scripts/ship-gate.mjs`（净树、测试、打包、安装验证、MCP
  initialize、fail-open 启动）
- 治理：`docs/ponytail-debt-ledger.md`、`.scratch/<slug>/`、`AGENTS.md`
