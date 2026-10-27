# GLOSSARY

本仓唯一权威术语表：术语 → ≤2 句定义。实现细节读代码；决策历史看 git log，未决事项看 GitHub Issues。

## 产品与领域

- **Vertical Agent（垂直 Agent）**——本产品定位：站在水平检索供应方（Perplexity/Exa 等）之上做垂直深度研究，不自建索引。Agentic Search 是能力模块，不是产品本身。
- **Active Domain（当前领域）**——agent 被专精到哪个领域的权威单元，持有一份 TOML。切换它联动五个下游层：Hooks Tool Whitelist、Prompt Skill Selection、Skill Active List、信息源白名单、RAG Adapter。
- **Retroaererd Engine（检索专精引擎）**——anysearch 内核：多 provider fanout + RRF 融合 + 充分性门禁 + 预算闸。纯编排，不含 LLM 判定。
- **Info Source Provider（信息源头供应方）**——对接单一检索后端（anysearch 通道/Exa/Tavily/Brave）的实现；domain 的 `[sources]` 决定启用哪几个及融合权重。
- **RAG Adapter（领域专属检索适配器）**——企业内部数据的加载/检索配置位（`[rag] adapter=<id>`）；仅占位，未实施。
- **Code Mode（代码开发模式）**——`domain="code"` 特殊值：软依赖用户已装的 context-mode / codegraph 做本地仓索引，CLI 不内置索引实现。
- **Kernel Distribution（内核分发形态）**——三阶段路线：独立 CLI（`ans`）→ MCP server 包同一 kernel → 宿主 hooks 插件。三形态共享同一 kernel。
- **Anysearch Plugin**——宿主侧插件形态：hooks + 长驻 MCP server + 项目级 FTS5 索引，可配置进各 agent 宿主。
- **Skill Active List / Prompt Skill Selection / Hooks Tool Whitelist**——domain 切换时联动的三份名单：激活的 skills、作为提示词载体的 skill、工具调用白名单（hooks.toolWhitelist 是安全过滤器）。

## 引擎与运行时

- **Composition Root（组合根）**——`createEngine(domain?)` 纯函数统一入口：按域过滤 providers、构造引擎；CLI/MCP/plugin 三端共享，替代散装 new+register。
- **Seam Wiring（接缝接线）**——把已定义未连通的 kernel port 接到实际实现的过程；接缝接通后端口成为可测试、可替换的合约边界。
- **Budget Ledger（预算账本）**——reserve-then-settle 预算强制：检索前预留、检索后结算，SQLite 非负约束固化。Billing Dimension 分 per-call（已接线）与 token（类型占位）两维。
- **Sufficiency Gate（充分性门禁）**——检索质量下界（minProviders/minResults/minDomains/crossEngineVerify），post-hoc 判定；与 budget 上界、fanout 延迟三维度互不打架。
- **PiAgentRuntime（PI Agent 运行时）**——kernel 内 AgentRuntime 的实现：pi-agent-core 驱动 agent loop，把 engine.search() 包成自定义工具，事件桥接到自有 AgentEvent 类型。
- **Domain Full-Stack（领域全栈消费）**——domain 配置五层在 runtime 的完整映射：sources→provider、hooks→工具白名单、prompts→systemPrompt、skills→AgentTool、rag→transformContext 注入。
- **Dual Session（双会话并存）**——pi-agent-core 管对话记忆（短期上下文），SqliteSessionStore 管 FTS5 知识仓（长期可搜索资产）；每轮结束同步 append。
- **MCP Tool Layer（MCP 工具层）**——apps/mcp 暴露的 5 个意图级工具：search_web / research_web / recall_memory / query_knowledge / ans_chat，按检索层×深度切分。
- **Dual Transport / MCP Factory**——MCP server 同时支持 stdio 与 Streamable HTTP；`buildServer()` 纯函数每请求新建实例，工具注册逻辑只写一次。
- **Dual Era Compatibility（双时代兼容）**——同时服务 2025-era legacy 与 2026-07-28 无状态规范客户端，靠 SDK 内建能力，不手写兼容层。
- **MCP SDK 桥接三件套**——TypeBox Bridge（kernel TypeBox schema 经 `fromJsonSchema` 进 MCP 注册，零双写）、Capability Detection（按接口存在性而非版本号探测）、Standard Schema Trigger（v2 SDK 就位即启用）。
- **Tool Schema Registry / Per-tool Barrel**——kernel 集中导出 5 个工具的 TypeBox 输入 schema 作单一事实源；apps/mcp 每工具一个 `.tool.ts`，barrel 数组一次装配。
- **LlmSession Deep Module / Lazy Session Cache**——`createLlmSession({provider,model})` 藏住 pi-ai 装配细节、禁止 kernel 读 env；LLM client 进程级惰性初始化+缓存，不每调用新建。

## 记忆与检索

- **Memory Tier（记忆三层架构）**——L0 缓冲（会话工作记忆）→ L1 窗口管理（transformContext 管道：RAG 注入→记忆注入→compaction）→ L2 持久层（FTS5 + 时间衰减）。独立于 MCP 可工作。
- **Research Memory（调研记忆层）**——FTS5 仓里的历次调研结果（网页内容、蒸馏结论、RAG 私有数据），是三层检索源之一。
- **Time Edge Effect（时间边缘效应）**——调研记忆的时间机制：指数半衰期衰减 + 双时态失效（新证据关闭旧记录 valid_until）+ QDF 式时间敏感查询临时 boost + pinned 豁免。
- **Fused Freshness Factor（融合新鲜度因子）**——检索期唯一时间信号：created_at 衰减 + last_accessed 近因 + access_count 频率压成一个 [0.3,1.5] 乘子乘进 BM25；禁多层时间乘子叠乘。
- **Explicit Invalidation via Write Path（显式失效走写路径）**——「这条过时了」走既有 valid_until/quarantine 通道，不加 TTL；软衰减管「不再相关」，写时失效管「事实已过期」。
- **Year-Free QDF Trigger（无年份 QDF 触发器）**——QDF 正则禁含具体年份字面值（会静默过期）；kernel 必须 import store 导出的分类器，禁内联复制。
- **Project Index（项目级索引）**——hooks 拦截 MCP 工具输出蒸馏成结构化摘要并索引进 FTS5；按项目共享、跨会话。没有 MCP 调用就没有项目索引。
- **Dual DB / Two-Stage Recall**——项目索引与内部记忆物理分离两个 .db；recall_memory 先查内部（带新鲜度）不足再查外部项目索引，跨层带 provenance 标签不混合打分。
- **FTS5 Column Weight（FTS5 列权重）**——bm25 列权重让 title 匹配优先于 snippet；UNINDEXED 列权重 0。
- **FTS5 Query Tokenization（FTS5 查询分词）**——空白/标点切词 + 词前缀匹配 + AND 连接，整句保留为 OR 分支；禁整句加引号（退化为精确短语匹配）。
- **Entity Configurable（实体可配置）**——NormalizedResult 可选 entity 字段覆盖 URL 默认值，支撑「同实体多 URL」聚合（about/pricing/blog 同族）。
- **MemoryPipeline（记忆管线深模块）**——kernel 内独立深模块承载全部 L0/L1/L2 逻辑，接口三方法 attach/inject/consolidate，领域语义命名，绝不反向依赖 agent loop。
- **NOOP Adjudication / REUSE-COMPRESS 判别**——检索返回后用 LLM 二元裁决：新结果已被现有 IR 摘要覆盖则 REUSE 跳过摘要，否则 COMPRESS 增量生成；裁决与压缩均 fire-and-forget。
- **Gap Distillation（gap 蒸馏）**——裁决输入只取检索工具消息与现有摘要（不取闲聊/推理），控 token 成本。
- **Consecutive Reuse Cap（连续 REUSE 上限）**——连续 3 次 REUSE 后第 4 次强制 COMPRESS，防裁决偏差导致摘要长期过期。
- **IR Summary Schema（IR 专精摘要契约）**——滚动摘要五段：已查证证据/未决假设/被否决信源/关键数字与来源/工具调用与已读状态；前三段跨压缩只增补不覆盖。
- **Injection Hot Zone（注入热区）**——动态内容锚定最新 user message 末尾（注意力热区 + 前缀缓存稳定），静态内容保持首条；注入总预算 ≤5500 chars。
- **Hot-Cold Injection / Write-Read Seam**——热路径同步速召回当轮生效，冷路径异步深召回下轮生效；写读两端共享版本化摘要 schema 契约。
- **记忆管线纯函数化五件套**——Temporal Decoupling（evaluate/applyTo/consolidate 显式数据流）、ConsolidationState（决策状态纯数据对象可序列化）、Claim-Ticket Injection（编排层不碰 envelope 内部）、Functional Shell（纯函数决策 + shell 做 I/O）、State Anchor Upsert（状态锚 UPSERT + version CAS，历史锚 append-only）。
- **STALE Probe Suite（过期记忆探针集）**——回归断言 valid_until 非空的记忆不再出现在检索结果（SR/PR/IPA 三探针子集）。
- **T0 Hot Zone（T0 热区 / MEMORY.md 偏好层）**——三层之上的零延迟常驻层：SQLite 表是唯一事实源，MEMORY.md 是物化投影（原子重生成），1500 字符+200 行硬上限。
- **C-prime Promote Gate（C-prime 提升闸门）**——T0 提升双通道：用户显式 /remember 或跨会话纠正计数 ≥2；LLM 自报置信度不可作闸门。
- **Key-Level Override Merge（键级覆写合并）**——项目级与全局 MEMORY.md 同键取项目值、异键合并，投影单份文件。

## 巩固、遗忘与实体关系

- **Episodic-to-Semantic Consolidation（情景到语义巩固）**——陈旧 episode 蒸馏为 semantic_memories（每簇一次有界 LLM 摘要 + 忠实度 gate）；语义行永不因 TTL 归档，只经 supersession 演化。
- **Signal-Gated Consolidation Trigger（信号门控巩固触发器）**——批的提出权在确定性信号，执行权在手动 CLI（--dry-run/--apply）；无常驻后台进程。
- **Soft Archive with Undo Log（软归档与撤销日志）**——遗忘 = archived 标志位 + archive_log 快照，undo 位级可逆；判定四因子全确定性、零 LLM。
- **Entity Link Layer（实体链接层）**——扁平 FTS5 行之上的「实体 → 记忆」引用层：entities 全局表 + memory_entity 桥接，图只是关系表的只读视图。
- **Reversible Entity Merge（可逆实体合并）**——合并记录完整快照、被并实体 valid_until 关闭而非删除；unmerge 只回滚合并自身副作用（补偿语义），override 记录防再合并。
- **Candidate Review Belt（候选待审带）**——中带候选写 entity_merge_log kind="candidate" 由人工 keep/drop；合并遥测只观测不进门禁。
- **KG-lite Fifth Arm（关系第五臂）**——实体关系落 edges 边表（闭集谓词 + 系统时态 supersede），作为 RRF 第五臂召回增强；永不替代纯图检索。
- **Closed Predicate Table（闭集谓词表）**——谓词为闭集 taxonomy，CHECK 约束 + 三元组约束 + 后置过滤三重把关；新谓词经 eval 评审迁移入库。
- **回填纪律（backfill-vectors / backfill-relations）**——默认 dry-run（回滚式事务内真跑，产出精确预测而非估计）、--apply 实写幂等可断点续跑；永不 --reset。
- **Conditional Arm Activation（臂条件激活）**——召回臂信号缺失时整臂退出融合，不分泌零分稀释；禁 always-on 弱臂。

## 充分性与答案归因

- **MVSS（最低可行信号集）**——sufficiency 元数据四段：verdict（三态聚合）+ agreement（rank 派生）+ volume（卫生信号）+ spread + perProvider 原生分数（不跨源归一化）；只承诺 escalate 决策。
- **Dual-Output Sufficiency（单计算源双输出）**——单个 computeSufficiency() 纯函数双路输出：内部 fanout 早停布尔 + 外部暴露的 MVSS 元数据。
- **Sufficiency Gate Placement（门禁架构归属）**——LLM 判断层（named gap 生成 + 定向重搜）在 PiAgentRuntime agent loop，engine 保持无 LLM 纯净。
- **Named Gap Re-search（命名缺口定向重搜）**——gate 输出「缺什么」回灌定向二次检索，有界循环；仍不达标返回 annotate verdict=ambiguous。
- **MCP Sufficiency Annotate（MCP 信号注解层）**——MCP 路径不做 LLM 循环，只在返回 JSON 追加 sufficiency 对象（content 文本 + structuredContent 双通道）。
- **Answer Mode / Answer Provenance**——provider 原生 answer 能力透传不合成；envelope.answers 保持 string[]，provider 归属进 metadata.providerAnswers。
- **Sufficiency Gate Preserved**——answer 不参与 sufficiency 四维计算（避免 false confidence）。
- **Claim-Level Attribution（断言级归因）**——答案拆成断言序列，每条带 supported|uncertain|unsupported 标签 + ≤3 条证据；缺证落 uncertain，被反证才落 unsupported。
- **Signal-Gated Claim Proposal（信号门控 LLM 提案）**——确定性碎片信号先筛，仅可疑句升级 LLM 分解；非法输出 fail-open 退整句。
- **Unsupported Named-Gap Escalation**——unsupported 断言红标直出原句（不改写不剔除），生成断言级 gapQuery 进有界重搜。

## 域过滤、弃答与安全

- **Dual-Gate Domain Filtering（双闸域过滤）**——pre-filter 能力协商式下发 + post-filter engine 层权威出口闸（空即 abstain）；红线：query-rewrite 禁注入 site: 运算符。
- **First-Class Abstain（第一类拒答）**——abstain 是策略成功的第一类结果：CLI 结构化消息 + exit 0，MCP 走 isError:false + structuredContent.abstain；abstain 计数独立观测维度，绝不混入 error。
- **Content Trust Boundary（内容信任边界）**——一切「非用户所写」内容（检索/工具/记忆）统一视为不可信：概率层分类 + 确定性层收口组合，无单一注入检测器。
- **Source Label（来源标签）**——`{source, traceId}` 双轴：source 管信任（untrusted 胜出不可剥离），traceId 只管关联。
- **Sanitization Pipeline（净化管道）**——检索内容字符净化迭代到不动点：NFC → 零宽剥离 → Unicode Tag 解码重扫 → bidi 剥离。
- **Retrieval Content Schema（检索内容 schema）**——净化后经 TypeBox 封闭白名单校验；形状违规 fail-closed，内容可疑降级 stripped summary。
- **Fail-Closed Authorization（fail-closed 授权）**——三个默认 deny 点：记忆写入、URL 消费、LLM 判定输入；判定全确定性、零 LLM。
- **INJECT Probe Suite（注入探针套件）**——5 族 golden 探针（不可见字符/指令注入/egress/记忆投毒/自适应），canonicalPayload 指纹 + passRate==1 硬门禁。
- **Abstain Smoke（拒答烟雾）**——LLM-in-the-loop 拒答行为观测轨；abstainRate 与 falseAbstainRate 成对 report-only，永不进 gate。
- **Assert Judgment Input（断言判断输入）**——五个 LLM 判断边界共享同一断言函数，强制输入是 tagged RetrievalContent。
- **HITL Review Queue（HITL 待审队列）**——requiresHitl 的 URL 持久化待审：headless block+enqueue，TTY 停机询问；`ans hitl review` 处置。
- **Policy Single Source / Append-Only Merge / Policy Version**——URL 授权唯一源是 TOML `[sources].urlAllowlist`；多层合并只增不减、deny 独立通道最后评估；合并集内容寻址版本（sha256 canonical）做 drift 检测。
- **Read-Side Secret Guard（检索侧 secret 兜底）**——containsSecret 共享检查挂全部写入口与检索出口；已知盲区文档化，不宣称全覆盖。

## 宿主集成与 hooks

- **Hook Layer（HOOKS 层）**——平台无关 core handler + per-platform adapter；hook 子进程只读项目感知 + 窄 IPC 调长驻 server + 输出 JSON 决策，重操作全下沉 server。
- **Progressive Disclosure（渐进披露）**——三层分发：SessionStart 路由卡（轻量指针）+ SKILL.md 按需加载 + AGENTS.md 最小常驻；注入太少 skill 永不触发，太多会话崩溃。
- **Routing Card（路由卡）**——SessionStart 注入的静态路由指令四块：插件声明 + 5 工具用途 + 触发规则 + fail-open 说明；内容单一源，多路输出共享。
- **Routing Card Override（路由卡配置覆盖）**——`.anysearch/routing-card.json` 可选覆盖内置卡；解析失败 fail-open 回退默认。
- **Fact-Process Split（事实流程分置）**——AGENTS.md 放每会话事实，SKILL.md 放多步流程；强制语义 = AGENTS.md 声明意图 + hook 代码实现。
- **Cursor Dual Channel / MDC Fallback / Fire-and-Forget**——Cursor 双通道注入（additional_context + .mdc 规则文件兜底官方竞态 bug）；无 SessionStart 的平台由 hook 动态生成 .mdc（alwaysApply）；hook 执行不阻塞 agent loop。
- **Fail-Open（放行策略）**——hooks/server/索引任一故障都放行工具调用直出原始结果，stderr 告警；增益层挂了不拖垮基础检索。
- **Session Identity / Propagation / Client Attribution**——`~/.anysearch-cli/session` 是 session_id 磁盘主源（写时引用、永不回读）；session_id/trace_id 跨 CLI/hook/MCP 透传，MCP 协议级 session 保持置空；client_id 从 _meta clientInfo 尽力提取。

## 评测与发布门禁

- **Memory Eval Harness（记忆评测台）**——golden dataset + 确定性指标门禁 + judge 校准通道；eval 是度量能力本体。数据集指纹随报告，变集必须重校准；基线只手工升、CI 永不自动降。
- **Golden Entry Scope / Difficulty Tier / Paraphrase Slice**——golden 条目显式声明执行层（stub|live|both，无默认兜底）；难度分层只报告；paraphrase 变体轻档必须配正向断言。
- **Provenance RefStatus（证据锚状态）**——`provenance.ref` 缺省即活锚（仓库磁盘可解析）；`"historical-local"` 只标记随治理层拆除的 `.scratch/` 本地历史证据（未跟踪、CI 取不到），保留证据链而不回填假活锚。双向收紧：`.scratch/` ref 必须带标记，带标记的 ref 必须是良构 `.scratch/` 路径。
- **Integer Allowance / Rank-of-Relevant Gate**——容差用「允许挂 N 个 op」整数表达（小样本下连续 margin 无意义）；检索断言用 expectRankOf 整数名次，聚合 MRR/nDCG 只报告。
- **Judge 校准线**——judge 与人一致性用独立盲标冻结集度量（AC1 CI 下界等判据预注册）；未校准 judge 不进任何 gate；校准 revision 内容寻址不可变 + 指针原子切换 + journal 对账，promote 是人工冻结动作。
- **归因校准线**——claim 级 gold 标签与 relevance 线物理隔离；fused score 经校准映射为后验概率再按预注册双阈值分流；校不准回退 legacy 阈值 + degraded 告警。
- **臂增益判定纪律**——臂增益走 drop-arm 反事实 RoR + 预注册 minGain；weakest-link 单侧 harm 检验；sanity 指标永不进门禁；「未显著为正」永不为红。
- **融合治理**——记忆五臂与 web 三源两套 RRF 实例统一注册纪律（k_fusion/weights/缺失语义入注册表），零数据共享；fused score 只是 rank 信号，不充当置信度/阈值；换算法必须预注册，禁顺手换。
- **Access Events 与防篡改链**——access_events append-only + prev_hash 哈希链 + 创世锚；verify-access-events 全量重算 fail-closed；插桩写入失败计数告警不静默。
- **Tau 观测层与显式 skip**——tau 参数不动只配观测（access-age 直方图/BG-NBD/PSI），观测值永不进门禁；数据不足走显式 skip 原因码，不占升级计数。
- **Switch State Machine（S0–S4）**——合成轨与生产轨间五阶段迁移：晋级走预注册复合阈值，退化分级回退，完整性失败 fail-closed 而非回退；预注册载荷绑定 SHA-256 校验。
- **Synthetic/Observational 分账**——合成轨只喂机器不冒充生产信号，与 consumed 轨严格分账；每 gate 条款配 pass/fail 成对 fixture。
- **Ship Override 机制**——critical 红可凭封闭 reasonCode 放行一次/纪元（指纹对定纪元），强制重钉基线 + 限期复盘义务；账本 append-only。
- **Ship Gate / Product Smoke Gate**——发布阻断闸门：静态断言 → build/test → pack → 真安装 → stdio 冒烟；conformance heartbeat 报告存在但不阻断；native 冒烟矩阵只装不编（prebuild 缺失显形）。
- **工具链钉版**——packageManager 精确钉版 + pnpm-workspace.yaml `pmOnFail: error`（版本不匹配立即报错，不静默自愈合）。
- **发布形态**——bundled-CLI：私有 workspace 包被 bundler 吞进 app dist、只在 devDependencies 如实声明；重型可选能力走 peer-optional + 守卫式动态 import（缺席即降级 FTS-only）。
- **Scope Discipline / Module Extraction**——一轮一个主题，顺手改是反模式；提取=搬家 commit 行为逐字节守恒，债务修复=独立 commit。

## 上下文工程总纲

- **Context Engineering（上下文工程总纲）**——token 策展统一总纲：记忆与注入是 curation，多臂融合与充分性是 assembly，预注册评测是 measurement，观测闭环是 telemetry。
- **Observability Closed Loop（观测闭环）**——本地优先 SQLite trace 资产连接 runtime/eval/experiment；内部表示版本化，只在导出边界映射 OTLP `gen_ai.*`（自定义属性用 `anysearch.*`）。
