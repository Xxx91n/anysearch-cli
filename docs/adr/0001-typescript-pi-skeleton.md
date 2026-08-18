# ADR-0001: TypeScript 内核 + @earendil-works/pi-* 骨架

日期: 2026-08-18
状态: Proposed

## 背景 (Context)

本仓库（anysearch-cli）是一个信息检索密集型的垂直 Agent CLI。底层选型需要在以下三者间取舍：
1. TypeScript + 现成 agent 框架包（Mastra、earendil-works/pi、Agentica）
2. Rust 单二进制 + rig/rmcp 库组装（paperfoot search-cli 的 13-provider/RRF 模式）
3. 从零自研编排内核

团队的前期实验阶段是在 atomcode 内部用 hook + readonly_gate + research 注入协议跑通了 "ctx 沙箱内 run 调研 CLI、结果自动索引、不污染上下文" 这套栈；用户在反馈中明确以两个 TS 项目作为骨架参考：
- `earendil-works/pi`（MIT；packages: pi-ai 多 provider LLM API、pi-agent-core agent runtime+tool calling+state、pi-tui TUI、pi-telemetry 厂商中立遥测契约、pi-coding-agent 编码 agent CLI 范本）
- `volcengine/SearchCLI`（Apache-2.0；命令骨架 `vs auth/llm/doctor/skill/item/app/dataset/data/search/chat/recommend`，skill 安装分发，`--dry-run/--confirm-review/--wait-ready/--run-trials` reviewable execution model）

## 决策 (Decision)

采用 **TypeScript 作为内核语言**，并以 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 作为 agent loop + 多 provider LLM API + tool calling + state management 的底座骨架。可能时引 `@earendil-works/pi-telemetry` 走厂商中立遥测；视交互需求选 `pi-tui`。**不引 `pi-coding-agent`**（那是别人家的完整 coding agent，不是骨架），自己出 CLI 包名。

命令骨架与工程纪律按 `volcengine/SearchCLI` 的 `vs <verb>` 路线：`ans auth / llm / doctor / skill / search / chat / recommend / domain`；**不引 `vs item / app / dataset / data`**（那是 volcengine 在线数据盘特殊面向，与该 CLI 零-server 安装理念冲突；企业内部数据留到自定义 RAG Adapter 那阶段）。

`paperfoot search-cli`（Rust，13-provider + RRF + agent-info + 退出码）不被算作运行时依赖，但其扇出/RRF/agent-info/退出码 spec 作为 TS 实现移植目标。

为什么不选 Rust：两轮 atomcode 调研确认 Rust 单二进制有性能优势（5x 内存、25-44% 延迟改善、180ms 冷启动 vs 3s+），但与用户给的两个 TS 参考轮子不同栈、与前期 atomcode 实验不同栈（atomcode 是 Rust CLI，但 ctx 是 TS、hook 是 Python，整体是 TS 优先生态）。

为什么不选 Mastra：Mastra 自带 MCP 客户端 + RAG + memory + evals + dev UI，起步快，但它是"agent 框架包着的 agent 本体"，与该 CLI 的 CLI-only MVP 形态不贴合（CLI 是一个进程内部编排，不需要 framework 全家桶）；Mastra 是 first-class MCP 的甜蜜区，留到后期出 MCP server 形态时再考虑是否用其 MCP client / MCPServer 抽象，MVP 阶段不引。

为什么不选从零自研：四轮 atomcode 调研明确"轮子现成，无需自研"；自研 agent loop / LLM multi-provider / state 与 ponytail "look before you write" 矛盾。

## 后果 (Consequences)

正面：
- 复用 pi-ai 的统一多 provider LLM API 能力，不自己维护 OpenAI/Anthropic/Google 的 SDK 差异。
- 与前期 atomcode（ctx 内调）实验同栈，可移植已验证协议。
- 与 SearchCLI 同栈，命令骨架/skill 安装分发/reviewable execution 范本直接对照抄。
- npm 分发天然支持（用户 base 可能已装 Node），且 PI 已把 Bun runtime 验证。
- License（MIT）允许商业借用。

负面：
- TS 单二进制不是真的单二进制（需要 Node 或 Bun runtime）；与 paperfoot 的 6MB Rust 单二进制形态相比，分发冗余、Windows 上 npm shim 已知让 spawn 失败（见 atomcode 交接文档）。
- MCP stdio server 包装需后期做（TS MCP SDK 或 @mastra/mcp），不是像 rmcp 那样官方 Rust SDK 直接 hold 住。
- pi 仍在快速发展（团队规模小），存在 breaking-changes 风险类似于 rig GitHub README 的 "Here be dragons"；mitigate：锁依赖版本（PI README 的 supply-chain hardening spec 同步抄入）。

关联：本 ADR 与 ADR-0002（领域权威）、ADR-0003（代码模式软依赖）共同决定 MVP 走向。
*End of ADR-0001*
