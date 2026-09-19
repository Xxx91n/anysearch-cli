# atomcode 调研存档：anysearch-cli × DeepSeek Harness 集成路径 A/B/C（R72 Q1）

> ctx_batch_execute 输出原文（exec 后台运行拿回）

我先做一轮多引擎检索验证 dsh / Cordis 的事实基础，再对比 A/B/C 三条路径。继续深挖一手文档：dsh 插件/事件模型、MCP 桥接插件、以及生态对比。补足核验配额：抓取 MCP bridge 原文、dsh 插件开发指南与第三方 Cordis 分析。再补两类角度（批评/社区 + 工具管线事件语义）后合成结论。最后核验工具执行管线（pre-execute/guards/post-execute 顺序），然后综合输出。# anysearch-cli × DeepSeek Harness（dsh）集成路径评估：A vs B vs C

**Sufficiency Gate** — searches: 6（Exa 3 / Tavily 1 / AnySearch 3，角度覆盖：Official、Comparative、Criticism、Community、Currency 全五类）| full reads: 6（dsh 官方架构 reference、cordis-primer、dsh-in-depth MCP 页、floatboat Cordis 长文、HN 官方帖、tool-execution-pipeline 官方页）| gaps: 未能直接打开 packages/mcp/mcp-client/README.md 原文（429，已由 dsh-in-depth.com 全文转述页替代核验，该页声明逐字取自该 README + src）；尚未实测 `dsh plugin install` 的 pnpm 安装行为（只有文档与社区插件证据）。

---

## 1) 执行摘要（Tl;dr）

**推荐路径：C（混合），但按修正后的形态** —— 即“**先 B 落地、后 A 收编**”的两阶段 C：**第一天就用官方 dsh-mcp-client 桥接交付 5 个工具（B 作为基线，一 行 cordis.yml 即通），同时立即启动 contract-discovery spike（pinned `@deepseek-ai/dsh` 0.1.x），验证通过后交付一个薄 native Cordis bundle 只承载 hooks 层（memory injection / preheat / distillation / URL-policy guard），工具调用仍走 MCP stdio 桥（复用现有 MCP server 二进制）而非 ctx.tools 原生注册**。这样 A 的“全量原生 5 工具注册”降级为可选演进项，而不是首发义务。**Confidence：高** —— 依据是一手文档交叉验证：dsh 的 MCP 桥是官方一等公民且命名形态（`mcp__server__tool`）与 Claude Code/Codex 完全一致（dsh-in-depth + 官方 README 转述双源），而 dsh 官方作者在 HN 明示“会有大量 rough edges 和破坏性变更”（HN 帖 + 官方 repo 双源），两个事实合起来指向：**工具面用最稳定的标准化协议（MCP），差异化价值（hooks 层）用必须 in-process 才能实现的 native 插件承载，且薄到可以在 breaking change 时低成本重写**。

## 2) 对比矩阵

| 项 | A（全量原生 Cordis 插件） | B（仅 MCP 桥） | C（MCP 工具 + 薄 hooks 插件，推荐） |
|---|---|---|---|
| 工具交付 | 5 工具原生注册 ctx.tools，schema 进 prompt assembly | 5 工具经桥注册为 `mcp__anysearch__*`，与 Claude Code/Codex 命名一致 | 同 B（工具走桥） |
| Memory injection / preheat / distillation | ✅ 全覆盖（agent/created + systemPrompt sections + tools/* 瀑布） | ❌ 完全无（桥只桥接 tools，"Resources and Prompts have no harness consumer"） | ✅ 全覆盖（薄 bundle 监听 events） |
| URL-policy 拦截（allow/deny/ask） | ✅ tools/pre-execute short-circuit + guard | ❌ 无 | ✅ 薄插件 short-circuit deny |
| 预览期 churn 暴露面 | **最大**：整个 5-工具注册 + 全部事件契约 + bundle 打包字段（`dsh.bundle`/`dsh.profile`）都在 breaking-change 风险区 | **最小**：一个 config row；桥自身由 DeepSeek 维护、随 dsh 版本走 | 中：只暴露事件签名 + patch row id，工具契约不暴露 |
| In-process 信任边界 | 全部 our 代码 in-process，越出 workspace sandbox | 桥是官方代码 in-process，our server 仍是独立子进程（stdio），**our 代码零 in-process 面** | 仅薄 hooks 层 in-process，检索/RAG 重逻辑留在子进程 HTTP IPC 之后 |
| 复用现有资产 | 需把 HTTP IPC 客户端嵌进 bundle；MCP server 成冗余 | 100% 复用（现有 MCP server 直接被桥 spawn） | 复用 MCP server（工具）+ 复用 HTTP IPC server（hooks，同现有 4 个 host 的 adapter 模式） |
| 用户安装成本 | `dsh plugin add` npm bundle（需 pnpm≥10） | 一段文档化 cordis.patch.yml 行 | 插件安装 + 一行配置（与现有 host 的“注册 MCP + 装 hooks”双步模型同构） |
| 与现有 4 host 的心智模型一致性 | 低（新编程范式） | 高 | 高（等价于现有“MCP + adapter hooks”模型） |
| 能力差异对用户可见吗 | 无差异 | 明显缩水（无注入/预热/蒸馏——你们的差异化卖点） | 无差异 |

## 3) 分点结论（含对选项形态的修正）

**结论 1 —— 行业成熟形态是“标准协议承载工具面 + host 原生扩展承载宿主生命周期钩子”，即 C 的修正形态，而不是 A 的全量原生。** 证据：dsh 自己的官方桥接插件就把外部 MCP server 工具呈现为与 Claude Code/Codex 完全相同的 `mcp__<server>__<tool>` 形态，且 README 明言“the same server-qualified shape Claude Code and Codex use"（dsh-in-depth.com/capabilities/mcp；官方 README 转述，双源）。这意味着 **B 的 `mcp__anysearch__search_web` 用户可见面与 A 的原生注册面，对模型和使用者几乎等价**——A 相对 B 在工具层的增量只剩“schema 直入 assembly 的 KV-cache 细节”和省一跳 stdio。为一个边际增量承担整个 5-工具注册契约的 preview churn（官方作者原话："Expect lots of rough edges and compatibility-breaking changes"，HN 作者帖，双源确认）不成熟。社区甚至反向演化出"one proxy tool instead of dumping every MCP schema into context"的 dsh-mcp-adapter（NexusAgentX/dsh-mcp-adapter），说明工具 schema 注入方式本身在生态里仍是活跃争论点——过早绑定 ctx.tools 注册形态风险实打实存在。

**结论 2 —— 修正 A：A 真正不可替代的不是工具注册，而是四个 in-process 专属面。** 经官方架构文档核验（deepseek-harness.github.io/en/reference/ + tool-execution-pipeline 页）：
- **memory injection** → `agent/created`（serial init）+ `ctx.systemPrompt` section 注册，且注入必须走 `agent.inject()` 才会进入下一个 admitted request；MCP 桥明确"Tools are the only bridged MCP capability"，Resources/Prompts 均无 consumer——**任何只靠 MCP 的方案（B）在结构上无法注入记忆**。
- **preheat** → `tools/pre-execute` waterfall（在 monotonic guards 之前运行）。
- **distillation/indexing** → `tools/post-execute`（accept/block/replace/addContext）+ `tools/result`（观察 immutable outcome）。
- **URL-policy deny** → pre-execute 瀑布 listener 可"return without next() to short-circuit"，这正是 deny 语义；cordis-primer 明确"For single-decision events, short-circuiting is the design"。

这四项都必须 in-process，因此纯 B（选项描述正确）确实只能是 reduced host。但正确的产品分层是：**检索/RAG 的重逻辑继续留在现有 127.0.0.1 HTTP IPC server 子进程**，native bundle 只是现有四家 adapter 的第五个兄弟——薄 adapter 调 IPC，不在 dsh 进程里跑业务逻辑。这同时回答了信任边界问题：用户安装的插件"run in-process OUTSIDE the workspace sandbox"，把 our 代码最小化 in-process 是对用户负责的形态，也是 A 原案（“thin adapter reusing our existing HTTP IPC plugin server"）已经隐含、值得显式写进决策的约束。

**结论 3 —— Cordis waterfall 事件模型的具体风险（必须在 spike 中逐项验证）：**
- **异步语义**：waterfall listener "must call next() to delegate"，但 dispatch mode 表标注 waterfall 为 **Not awaited**（cordis-primer 表格：waterfall Awaited? = No）。这意味着我们的 pre-execute 里做“检索预热”这类异步 IPC 调用时，**不能依赖 waterfall 的返回值传播来承载异步结果**——预热 fire-and-forget 没问题，但任何需要“异步完成后再放行”的策略（如 URL-policy 查询远端策略服务）必须确认 listener 内部 await 后再调 next() 是否被 runtime 正确序列化，否则 deny 语义会出现竞态。这是 spike 的第一优先验证项。
- **Denial veto ordering**：管线顺序固定为 `tools/pre-execute waterfall → monotonic guards → approval(ask) → tools/execute → tools/post-execute → finalizeContent → tools/result`（官方 tool-execution-pipeline 页）。注意两点修正：(a) **ctx.approval 的 ask 解析发生在 monotonic guards 之前**，而“owner policy that must not be reordered"才注册为 guard——我们的 URL-policy 应做成 pre-execute short-circuit 或 guard，而不是 approval listener；(b) **guards 是 monotonic 的**（"monotonic ctx.tools.guard denies"，与你们掌握的信息一致）——deny 一旦发生不可被后续 listener 翻转，这是好事（策略确定性），但也意味着我们的 deny 必须精确，没有“先 deny 再撤回”的余地。
- **systemPrompt 组装面**：prompt 是 durable session event（system/message），"Model-visible means logged" 且有 runtime invariant 强制从 log 可重建。我们的 memory-injection 走 `agent.inject()` 落下一个 session event——**注入内容会永久写入用户 session log**（隐私/体积双重考量：注入的记忆文本随 fork/resume/transcript 全程跟随）。B/C 的插件必须把注入量做小、做节流，这是四个现有 subprocess-hook host 都没有的新约束（子进程 hook 注入不落宿主日志）。
- **headless vs web profile parity**：shipped `web` profile 是 live patch reload，`headless/sdk/acp` 只在启动时应用一次所有 layer（官方架构文档）。我们的 bundle 在 headless（one-shot probe）与 web 下的激活路径不同：headless 无 server、无 HMR，preheat 的“跨调用摊销”价值在 one-shot runner 里天然缩水——**C 的价值主张在 web profile 最强，headless 探针要单独验证不劣化启动延迟**（pnpm install into profile + 5 个工具桥接 discovery 各有启动税；MCP SDK discovery 默认 60s timeout 是已知限制）。
- **Bundle install 机制**：`dsh.bundle` 字段指向 patch file，包经 profile 目录内的 pnpm 工程（`dsh plugin --profile X add <npm 包>`，需系统 pnpm≥10，Composio 插件指南 + 官方架构文档双源）。风险：我们仓库已 pin pnpm 11.24.0 且 dsh 桌面端自带 bundled pnpm 在保留目录安装——**profile 内 node_modules 的 pnpm 版本与我们产品包的 engines/packageManager 声明可能冲突**；且第三方插件"cannot register a card in Settings → Plugins"（NexusAgentX adapter 实测）——**配置入口只有 cordis.patch.yml / cordis.yml 行**，我们的 token/设置 UI 期望要按“纯配置文件”收缩。

**结论 4 —— 修正 B 的形态描述：B 不完全是“零产品代码”，且它的空缺比描述的还多一点。** 除无 hooks 外，桥也不桥接 Resources/Prompts，且 dsh 官方还 ship 了三个**默认关闭的第三方记忆服务器参考配置**（memorix / mcp-reference-memory / engram，在 `apps/cli/config/examples/mcp-memory/`）——这说明 dsh 官方对“外部记忆产品”的预期集成面就是 B（MCP 工具），我们的竞品记忆类产品很可能都止步于 B。**这恰恰是机会**：C 让 anysearch 在 dsh 上成为唯一具备“记忆注入 + 检索预热 + 结果蒸馏”闭环的检索产品，这是在其余四 host 上因为 subprocess-hook 模型反而做不出差 异化的点吗——不，四家也有 hooks，但 dsh 的 `agent.inject()` + systemPrompt sections 是更深的一等公民接口（直接进入 prompt assembly 与 durable log），C 在 dsh 上的注入保真度高于 subprocess-hook 场景。

**结论 5 —— churn containment 的具体机制（对推荐路径的落地要求）**：(a) spike 必须锁定 `@deepseek-ai/dsh` 精确版本并断言事件签名的类型测试（tsc 会在 declaration merging 的事件 map 上，于 dsh 升级时立即给出编译期断裂信号——这本身是免费的 churn 报警器）；(b) bundle 的 patch row 只用 id-replace 而非整文件复制，升级时 diff 我们的 row 即可；(c) 已有先例表明 breaking rewrite 真会发生（“DeepSeek Harness released a breaking rewrite" @ZhihuFrontier，两周前；repo discussions #2450 记录 v0.1.0-rc.5 文档大面积漂移）——C 的薄 hooks 层是唯一能在“一次 breaking rewrite 后一周内重写完”的量级。

## 4) 推荐路径与理由（汇总）

**推荐：C（两阶段）。阶段 1 = B 立即发布**（一条文档化的 `cordis.patch.yml` 行：stdio spawn 我们的 MCP server，`serverName: anysearch`，复用 `mcp__anysearch__*` 命名与 Claude Code/Codex 一致）；**阶段 2 = spike 通过后发薄 native bundle**（`dsh.bundle` npm 包），只做四件事：`agent/created` + `agent.inject()`/systemPrompt section（memory injection）、`tools/pre-execute`（preheat fire-and-forget + URL-policy short-circuit deny）、`tools/post-execute`/`tools/result`（distillation/indexing）、全部经 127.0.0.1 HTTP IPC（复用现有 server，业务逻辑不进 dsh 进程）。A 的“5 工具原生 ctx.tools 注册”降级为 backlog：等 1) dsh API 趋稳、2) 出现桥接层无法满足的工具层需求（如 KV-cache prefix 控制、guard 级策略）再评估。

否决 A 的核心理由：preview 期把整个工具契约暴露在 breaking-change 区，换取的仅是工具层边际增量；否决纯 B 的核心理由：结构上无法实现 hooks 层（官方桥"Tools are the only bridged capability"），而 memory/RAG 差异化正是产品本体。

## 5) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| DeepSeek Harness Architecture（官方 reference） | deepseek-harness.github.io/deepseek-harness/en/reference/ | Official | profile/bundle/patch 机制、事件域划分、turn flow、extension 表 |
| Tool Execution Pipeline（官方） | deepseek-harness.github.io/.../reference/tool-execution-pipeline | Official | pre-execute→guards→approval→execute→post-execute→result 顺序 |
| deepseek-harness/docs/cordis-primer.md | github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md | Official | 5 种 dispatch 模式、waterfall 语义、short-circuit 即决策 |
| DeepSeek Harness in Depth: MCP Client | dsh-in-depth.com/capabilities/mcp | Official（转述 README+src） | 桥的全部配置字段、命名契约、只桥 tools、60s discovery、已知限制 |
| Cordis — The Plugin Kernel Behind DeepSeek Harness（floatboat） | floatboat.ai/blog/cordis-plugin-framework | Comparative/解析 | Koishi 四年沉淀、Cordis v4、ctx.effect/服务/事件三机制 |
| HN：DeepSeek Harness developer preview | news.ycombinator.com/item?id=49285244 | Community | 作者原话"rough edges and compatibility-breaking changes" |
| What DeepSeek Harness Gets Right（Medium, Minh Le） | medium.com/@minhle_0210/what-deepseeks-open-source-agent-harness-gets-right-b85f57533802 | Criticism | 9 类插件能力清单、架构领先于产品的批判视角 |
| NexusAgentX/dsh-mcp-adapter | github.com/NexusAgentX/dsh-mcp-adapter | Community/Criticism | schema 上下文成本争论、out-of-tree 插件无设置 UI、与官方桥不可同挂 |
| Best plugins for DeepSeek Harness（Composio） | composio.dev/content/best-deepseek-harness-plugins | Comparative | `dsh plugin --profile X add` 安装机制、pnpm≥10 要求 |
| DeepSeek Harness 官网 | deepseek.com/harness/en | Official | "Agent = Model + Harness"、dev preview 定位 |
| dsh findings & gaps（discussions #2450） | github.com/.../discussions/2450 | Criticism | rc.5 文档漂移、AGENTS.md 缺失 15 组 |
| @ZhihuFrontier 破坏性重写推文 | x.com/ZhihuFrontier/status/2094348274291691531 | Currency | 已发生 breaking rewrite 的实例 |

（以上 URL 均为本轮 search 命中且关键页经 web_fetch 全文打开核验；Medium/X 两篇未 fetch 全文，仅作趋势旁证，不作技术论断依据。）

## 6) 信息缺口

1. **waterfall 异步 listener 的精确 await 语义**：dispatch 表标注 waterfall "Not awaited"，但 listener 内部 async + next() 的序列化行为文档未明说——spike 必须用 headless probe 实测（这决定 URL-policy deny 是否需要改成 guard）。
2. **mcp-client README 原文**：429 未直接打开，dsh-in-depth 页声称逐字取自该 README，但 commit `47f9438` 与 master 的差异未核验。
3. **`dsh plugin add` 在 Windows 上的行为**：所有安装证据来自类 Unix 环境；与better-sqlite3 预编译路径的兼容性未验证。
4. **profile 内 pnpm 版本冲突**：dsh 桌面端 bundled pnpm 与我们 pin 的 11.24.0 在 CLI profile 场景是否互不干扰，需实测。
5. **dsh 版本节奏**：preview 期发版频率（决定 spike 锁版策略是按 minor 还是按 rc 锁）数据不足。
