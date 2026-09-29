# ADR-0091: Grill Round 90 — dsh 原生工具面实施轮（五 ans_* 经 ctx.tools.register 原生注册 + mcp-anysearch 桥退役 + approval-channel 拆票）

## Status

Accepted (grill round r90; 主轴票 dsh-native-tools-impl). Records T0–T7 per task book `.scratch/grill-round-90/handoffs/next-round.md`. Ledger: `.scratch/grill-round-90/decision-ledger.md` (D-001~D-002). Evidence root: `.scratch/grill-round-90/`（evidence/t0-* + t2-expected-red.log + t3-green.log + t5-approval-surface.log + reports/）。

## Context

R72 用官桥（dsh-mcp-client→ans-mcp stdio）零代码交付工具面，留下 defer-r72-dsh-native-tools：原生 ctx.tools 注册留待「工具注册 API 上游稳定化」触发器。R89 探针实证触发器实质已响（ToolRuntime.register/restrict/defineTool 自 ≥0.1.5-rc.2 三代签名逐字同形），ADR-0090 判词 soak-until-stable 管版本轴不约束消费轴（T1 补 pending-repin 第四行立法）。本轮实施原生面并独立退役桥行。

## Decision

### D1（=D-001）原生注册面：literal ToolDefinition，不经 defineTool

任务书字面条款要求 `defineTool({name,description,parameters,execute})→register`。实物裁决：defineTool 是 @deepseek-ai/dsh-tools 的**运行时值**——运行时导入会违反 apps/dsh-plugin 零依赖契约（dependencies:{} + external 仅 node:* builtin，AGENTS.md 不变式）；内联打包则冻结上游拷贝、废掉「编译期搅动告警」设计目的。裸 ToolDefinition 字面量消费**同一** ToolRuntime.register 契约（register 只校验 output.schema/render，parameters 直通 schemas() 模型面投影）。代价=放弃 DSL 自带 validateArgs 客户端校验——参数校验本就留在服务端 kernel TypeBox SSOT，register/dispatch 双端均不做 arg 校验，零功能损失。

### D2 单源投影：kernel 子路径导出，旁路 barrel

parameters 直接赋 KernelJsonSchemas[wire]（TypeBox→plain JSON Schema 逐字投影，additionalProperties:false/minLength/minimum 零损——dsh ParameterSchemaSpec DSL 无法表达这些关键字）；description 收敛为新 SSOT KernelToolDescriptions（tool-schemas.ts），apps/mcp 五 .tool.ts 同步改消费——模型面文案自此单源。消费路径=`@anysearch-cli/kernel/tool-json-schemas` 新子路径导出（exports 叶件），kernel barrel（index.ts 牵 retriever/store/better-sqlite3）不进零依赖 bundle。

### D3 传输面：callServer→ans-mcp HTTP /mcp，握手进程级缓存

execute=纯传输：POST {ANS_MCP_URL||http://127.0.0.1:3001}/mcp 无态 MCP JSON-RPC——initialize（按 base|token 键缓存 Promise）→notifications/initialized→tools/call。传播三头（Authorization Bearer=ANS_MCP_KEY||server-token、traceparent、x-anysearch-session-id）经共享 callServer 发送；callServer 获三个加性槽位（headers/timeoutMs/signal）且空体 2xx 由抛错改返 {}（通知帧 202 响应的正当形态）。session 类 RPC 错（-32001/-32600）清缓存重握手重试一次。

### D4 fail-open 契约延展到工具面

transport 失败（握手失败/调帧 null/重试耗尽）→ {content:[]} 空结果降级，不抛入宿主；upstream isError:true 与一般 RPC error → throw 物化为 tool error 结果（可达端点的诚实错误面，不是可达性降级）。超时预算按工具分级（search 30s/recall 15s/knowledge 60s/research+chat 300s），exec.signal 经 AbortSignal.any 前向。

### D5 桥退役独票 + 版本轴消费轴分工

T3（fix）与 T4（refactor）分票落地：实施与退役是两个独立回滚单元（rollback=revert T4 即复桥）。T3 commit 题注携 D-001 附件①正例声明：本票消费现钉 0.1.7-rc.1 在架 API，零 repin 依赖。TC 条件票未触发（T0 dist-tags 复观：next 仍 0.2.0-rc.1，无 stable 晋升）。

### D6 r72-web-matrix 复核裁决：拆

approval-channel 拆出为 defer-r72-dsh-approval-channel（dsh-user-approval@0.1.7-rc.1 tarball .d.ts 复验 approval/request|asked|decided|policy|invariant 键面在架——唯一依赖已解除分项，可独立前置）；defer-r72-dsh-web-interactive-matrix 收窄为 patchReload:live+browser-turn 维持 defer。defer-r72-dsh-native-tools status→closed。

## Consequences

- dsh 宿主五工具以裸名 ans_* 直接出现在 ctx.tools（isAnsTool 后缀正则天然命中，钩子四面契约不变）。
- ans-mcp 须以 --transport http 常驻才可执行工具调用；端口/凭证经 ANS_MCP_URL/ANS_MCP_KEY 环境变量，缺省 127.0.0.1:3001。
- dsh-plugin 新增 devDep @anysearch-cli/kernel（build 时打包叶件；运行时外部导入仍仅 node:*）。
- rollback=revert T4（桥行恢复）；revert T3+T4 回 R72 全桥态。

## Evidence

.scratch/grill-round-90/evidence/：t0-dist-tags.json + t0-family-versions.log + t0-baseline.log（check/test 全绿，ship-gate 仅 clean-tree 中态红）+ t2-expected-red.log（15p/6f 预期红）+ t3-green.log（21/21）+ t5-approval-surface.log（0.1.7-rc.1 tarball 键面复验）。
