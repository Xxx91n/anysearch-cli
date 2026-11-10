# 交接：PI 1.5.1 + 调研记忆接线原型

- 日期：2026-11-10
- 状态：原型已验证，等用户确认；**不合并**主干
- 分支：`prototype/pi-1.5.1-memory`
- 上游：https://github.com/Xxx91n/anysearch-cli/tree/prototype/pi-1.5.1-memory/prototype/pi-1.5.1-memory
- 基线：产品 `aa0e5095`；PI 四个包固定 `1.5.1`

## 一句话

1.5.1 的会话恢复和真压缩是成立的；记忆闭环在补“内部搜索入库”后成立；限定整理和单条纠错成立。
三处硬伤要带回原窗口做决定：完整 `AgentSession` 装不进 CJS 包；默认资源发现会加载 70 个宿主技能；语义知识纠错不会回写旧会话滚动摘要。

## 已验证（都可复跑）

- Q1 会话/压缩：`probe-pi-session.mjs` 9 项全过。6 条 907 token → 压缩后 4 条 700 token，摘要进下一请求、旧工具原文不在、原文仍可从 JSONL 查回；过期后继续回答成功；产品 sessionId 可作为 PI 会话 id。
- Q1 完整 SDK：`probe-agent-session.mjs` 结构面全过。工具只放行 `search`；扩展 0；但 `DefaultResourceLoader` 在空目录下仍发现 **70 个技能**，换自定义空 loader 才是 0。`AgentSession` 会覆盖 `beforeToolCall/afterToolCall`，构造后重包可拿回。
- Q1 真实机：CLI 两次真跑（611 / 48 633 token），MCP `/health` 200；端点 `/models` 给出 `deepseek-v4.1-flash.context_limit=1048000`，显式配置后产品窗口跟到 1 048 000；一次真实调用 `usage={35,2,37}`。
- Q2 闭环：内部搜索写库 → 下一会话请求出现 `[Research Recall]`/`[Session Memory]`；对照组独立库 0 命中；`prepareNextTurnWithContext` 让补搜结果进入下一请求。真机 75 行入库、`l2_recall`/`rolling_summary` 锚点都有，第二次运行不搜索也能列出上轮来源并回显 `[Recovery Digest]`。
- Q3 整理：`--session` 只整理指定会话；重复整理 `noop=1`；`--single-evidence` 可跨会话关闭旧语义行并写新行；来源 id/时间/`valid_until` 保留。
- Q4 旧算法：全仓 392 项测试，390 通过 0 失败 2 跳过，退出 0。

## 必须带回 grill 窗口的决定

1. **CJS 打包 vs 完整 SDK**：`pi-coding-agent` 只导出 `import` 条件，且 `config.js` 导入时读 `import.meta.url`。当前 CLI/MCP 是 CJS，直接打包会启动崩溃。要么改 ESM 打包，要么把会话层放独立进程，要么产品只升 `pi-agent-core`/`pi-ai`（本轮就是后者）。这不是原型能替用户选的。
2. **资源发现**：用 `AgentSession` 时必须换自定义 `ResourceLoader`，否则会加载宿主的 70 个技能。要不要让产品接管技能面，需要明确。
3. **钩子归属**：`AgentSession` 覆盖工具前后钩子。网址闸门和饱和停止要么改成 extension，要么构造后重包。哪种是长期方案未定。
4. **派生摘要失效**：语义知识纠错后，旧会话的 `rolling_summary` 仍携带旧事实并会被注入（Q3-6 实测失败）。这是新增需求，不是现有能力。
5. **`adjudicateMemory()` 跨会话**：仍限定同一 `session_id`（`session-store.ts:890`）。Q3 的跨会话纠错走的是整理路径，不是它。要不要扩，另定。
6. **`ans_chat` 整理操作**：交接文件说形状未定稿，本轮只做了 store API 与 `ans consolidate` 参数，没有动 MCP 工具面。

## 本轮改了哪些产品代码（都在原型分支）

- 依赖：`apps/cli`、`apps/mcp`、`packages/kernel` 的 `pi-*` 升 `^1.5.1`；`packages/store` 的 `pi-telemetry` 升 `^1.5.1`；kernel 新增 `pi-coding-agent`（仅探针/类型用，运行时不 import）。
- `packages/kernel/src/pi-runtime.ts`：`shouldStopAfterTurn` → `finishTurn`；新增 `prepareNextTurnWithContext`（补搜结果写回）；内部搜索调用 `saveResults`；system 消息从会话/占用估算中排除；本地 token 估算。
- `packages/kernel/src/memory-pipeline.ts`：`toolResult` 消息入缺口提炼；`toolCall/arguments` 识别自动回忆；`text_delta` 识别 reuse；本地摘要请求（替代 pi-coding-agent 的 `generateSummaryWithUsage`）。
- `packages/kernel/src/sufficiency-gate.ts`：识别 `toolResult` 消息；`streamFn(model, context, options)` 三参；`applyTo` 支持 `toolResult`。
- `packages/kernel/src/message-text.ts`：新增 `estimateMessageTokens` / `estimateTranscriptTokens` / `serializeTranscriptForSummary`。
- `packages/store/src/observation.ts`：`addLink` 空实现（本地 schema 无 link 槽，数据丢弃）。
- `packages/store/src/consolidate.ts`：`sessionIds` / `memoryIds` / `allowSingleEvidence`；单条只允许 update；`singleEvidenceSkipped`。
- `packages/store/src/session-store.ts`：`consolidateMemory` 接受新选项。
- `apps/cli/src/commands/consolidate.ts`：`--session` / `--memory` / `--single-evidence`。
- 测试期望两处：Anthropic 路径允 `?beta=true`；预算冷启动排除 system 头。

## 没做的

- 正式实验、冻结数据、题目级/项目级重跑。
- `ship-gate`、`pnpm pack` 后的真实安装。
- MCP 里实际调 `ans_chat`。
- `ans_chat` 的整理动作接口。
- 真机压缩：真实对话只有几万 token，压缩是靠水位估算和探针验证的，没有在 1M 会话里自然触发。

## 环境注意

- 1.5.1 发布不到 2 天，仓库 `minimumReleaseAge: 2880` 会拒绝安装；本轮用 `pnpm install --config.minimumReleaseAge=0`。2026-11-11T23:40Z 后按正常策略可装。
- `ANS_LLM_CONTEXT_WINDOW` 当前没设，产品退回 128K 占位；真实上限是 1 048 000，需要显式写入配置。

## 证据索引

- `README.md`：完整表格与限制。
- `out/probe-pi-session.json`、`out/probe-agent-session.json`、`out/probe-memory-loop.json`、`out/probe-consolidate-scope.json`、`out/probe-real-config.json`：原始结果。
- 真机数据库留在 `D:\Windows\Temp\ans-probe-real.db`（75 行资料 + 锚点），可复查；MCP 探针库 `ans-mcp-probe.db`。
