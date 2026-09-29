# R89 T4 — r72 两票定形（设计记录，不实现）

> 定形 = 解法案 + 落点 + 依赖解除状态随判词与实装态写明。判词 = soak-until-stable（upgrade-ledger v3）。
> 约束：不实现；若轮内裁为提前实现须先过 L2 安装彩排 expected-RED 闸再单开票。

## defer-r72-dsh-native-tools —— ctx.tools 原生注册五 ans_* 工具

### 解法案

1. **注册落点**：`apps/dsh-plugin/src/index.ts` `apply(ctx)`。`inject=['tools','systemPrompt']` 已声明 `tools` 服务——`ctx.tools` 即 `ToolRuntime`，原生注册 API = `register(definition: ToolDefinition): () => void`（scoped/global 双层；scoped 经 `agent.ctx`）。
2. **五 ans_* 工具映射**：`ans_search_web / ans_research_web / ans_recall_memory / ans_query_knowledge / ans_ans_chat`（注册名全名，AGENTS.md whitelist）各自经 `defineTool<S,O>({name,description,parameters,execute})` 产 `ToolDefinition`：
   - `parameters` 用 ParameterSchemaSpec 直写各工具入参（现 JSON Schema 已在 apps/mcp tool-schemas.ts 单源，可投影转换）；
   - `execute` 体内零业务逻辑——HTTP IPC 调 anysearch server（`callServer` + 传播三头 + fail-open，承 hooks 层同一契约）；
   - 返回值映射 `ToolExecutionResult`（content/isError）。
3. **绕过 mcp__anysearch_ 桥**：`cordis.patch.yml` 的 `mcp-anysearch` 行（`@deepseek-ai/dsh-mcp-client` → `ans-mcp` stdio）目前以 `mcp__anysearch__<tool>` 命名空间暴露五工具；原生注册后工具以 `ans_*` 裸名出现（仅卸 `mcp__anysearch__` 前缀），桥行退役或留作回滚位（实施票裁）。`isAnsTool` 正则 `/(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/` 后缀匹配已覆盖 `ans_*` 裸名（`_` 分隔命中），hooks 层不改。
4. **测试闭环**：`apps/dsh-plugin/test` mock-Cordis ctx 断言五工具注册+执行路径；预执行钩子在裸名下仍走 URL-policy/preheat/distill/index 四面。

### 落点包

`apps/dsh-plugin`（唯一落点；dependencies={} 不变量不破——注册 API 经 type-only devDep 编译期引用，运行时由宿主注入）。

### 依赖解除状态

- 触发器原文：「the tool-registration API stabilizes upstream」（registry evidence）。
- **L1 实测：API 三代同形**——`register/defineTool/restrict` 在 0.1.5-rc.2（R72 时代钉版）/0.1.7-rc.1（现钉）/0.2.0-rc.1（候选）签名逐字相同（.pnpm 已装实例 + 双侧 tarball 互证）。
- 判定：**触发器实质已响**（API 面稳定可考，非 0.2.0 新增）；若从严读「稳定化=上 stable 线」则待 0.2.0 stable。两读法差异随判词呈报；解除/维持 defer 的登记动作依 T5 registry 更新。

## defer-r72-dsh-web-interactive-matrix —— web-profile 交互矩阵

### 解法案

1. **browser-driven turn**：以 web-profile 组合态驱动一整轮浏览器 turn（注入 transcript + preheat marker 已在 R72 头部态覆盖；本票补交互态）。
2. **patchReload:live**：live-edit 配置补丁热重载面观测与契约化。
3. **approval-channel**：`approval/request` 事件（dsh-user-approval，waterfall + ApprovalOutcome）在交互面的端到端行为。

### 落点

dsh web-profile 组合工程/探针（轮内不实现；落点包判为 spike/eval 域而非 dsh-plugin 本包——交互矩阵是宿主侧行为验证）。

### 依赖解除状态

- patchReload:live：**两版 .d.ts 均 ABSENT**（0.1.7-rc.1/0.2.0-rc.1 全无该键面）→ 上游面不存在，依赖未解除。
- browser-turn 专用面：**ABSENT**（browser 命中仅文档注释级）。
- approval-channel：dsh-user-approval 包在架且签名稳定（仅 +displayReason 附加字段）→ 该分项依赖已解除，可独立前置。
- 判定：**维持 defer**，依赖状态按分项写明（approval 可拆可前置、patchReload/browser-turn 待上游出面）。
