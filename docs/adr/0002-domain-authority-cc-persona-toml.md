# ADR-0002: 领域权威 = cc-persona TOML 联动模式（不等 MCP Contexts/分组原语）

日期: 2026-08-18
状态: Proposed

## 领域权威的架构是什么

该 CLI 需要支持用户切换"当前领域"，且**一次切换同时改多个下游层**：工具调用白名单、预置提示词包、可用 skill 集、对接的信息源、领域 RAG Adapter。这本质是经典工程-Language 的 Software Product Line variation-point selection，且在 agent 生态里 paralleled by Claude Code cc-persona 的 TOML 模式。

## 决策 (Decision)

采用 **cc-persona 的"一份 TOML + 一条 `use <name>` 命令同时联动四到五端"模式**作为实现模型：
- `~/.config/anysearch/domains/<name>.toml` 一份文件，含 `[settings]` / `[prompts]` / `[skills active=[...]]` / `[sources enabled=[...]]` / `[rag] adapter=<id>` / `[hooks] tool-whitelist=[...]`。
- 切换命令 `ans domain use <name>` 一条命令同时完成深合并、软链切换、enable/disable 模式切换、漂移检测、快照备份（按 cc-persona README 与 v0.2.0 commit 的 spec 移植）。

协议层术语：MCP `Tools / Resources / Prompts` 三原语正好对应"工具白名单 / 信息源+RAG / 预置提示词"；`MCP server-per-domain`（AWS Prescriptive Guidance 官方推荐）+ `Agent Skills`（Anthropic 2025-10-16 发布、2025-12-18 开放为 agentskills.io 跨平台标准）+ Persona/Profile 配置层，三者组合是该问题的成熟工业术语答案。

**不**等 MCP Contexts/分组原语。理由：SEP-1300《Groups and Tags for Tools》提案于 2025-11 起，primitive-grouping-wg 工作组每周一例会；但 **2026-07-28 最新规范全文已读，扩展清单只有 Tasks / Skills over MCP / MCP Apps，没有 grouping/contexts 原语**。本期判断 3-6 个月时效窗口内 contexts 不会合入，落地不等。

## 备选方案 (Alternatives Considered)

1. **每个垂直领域 = 一个独立 MCP Server**：是生态默认组织方式（API/沙箱/数据库 各一个 server，Anthropic SDK 以 `mcp__<server>__<tool>` 前缀区分）。不采用作为 MVP：MVP 是 CLI-only 不出 MCP server；后期 MCP 形态可同时存在 server-per-domain 与 persona 联动两套不冲突。

2. **领域插件系统（可同时挂多领域，retriever fanout 后 RRF 融合）**：被用户在前置一个 frontier 里直接 corresponding 的候选路径，但用户最终在"领域接入模型" frontier 中选了"子命令模式切换"路径（即本 ADR 决策），即"领域互斥、一次一个"形态；被排除。

3. **领域 = retriever 重排层（Brave Goggles 域级重排路径）**：把"领域"仅当成 URL/结果重排的因子，不动工具白名单/提示词/skill。不采用：用户明确要求"在 Agent 各个层面交织落地"，这只覆盖一层。

## 后果 (Consequences)

正面：
- 一份 TOML 是单一权威配置源，漂移可被检测、可被快照回滚（cc-persona 已验证）。
- 切换时五端同时联动，避开"工具全量挂载撑爆上下文"的微软实测 128k 陷阱（16 工具即撑爆）。
- 与 ctx/hook 协议层抽象对齐，未来出 MCP server 形态时 TOML 联动模式不变。

负面：
- 配置散落多处（settings、skills、sources、MCP server 配置、CLAUDE.md 等价物），迁移到 TOML 聚合过程会有 schema 设计成本（需考虑 base+override 继承、与各 CLI 平台原生配置的 mapping）。
- 该 CLI 自身的"hooks"层落地是 TS 内部代码层（不是 Codex 那种 removable hook 模型），需要为每份 TOML 计算一次生效的合并配置并 cache；与 cc-persona 直接修改 LS configuration 不一样，anysearch CLI 的 hook 是进程内 tool whitelist。
- SEP-1300 若 6 个月内合入新规范，需要复核可挪到协议层原语而不再是 persona 客户端层（全局策略与监测要点 record 在 ADR-0002 本身）。

关联：本 ADR 依赖 ADR-0001（TS 内核）；ADR-0003（代码模式软依赖）处理 Active Domain == code 时的本地索引软依赖。
*End of ADR-0002*
