# ADR-0012: Architecture Grill Round 9 — L0/L1 记忆管道升级 + Per-Platform 验证 (A→B→D)

*Status: Accepted*
*Date: 2026-08-20*
*Grill Round: 9 (Q1-Q20)*

## 背景 (Context)

Post-Round 8 (ADR-0011), SessionStart hook + 三层渐进披露已实现 (04c7950)，
ADR-0008 D4 stateless HTTP 审计修复 (77cd706)。11 ADRs 全部 Accepted，73+ tests 通过。

ADR-0011 Q1=C 延迟了三个架构深化候选：
- A: L0 LLM 压缩升级（pi-runtime.ts 滚动摘要当前是 text slice placeholder）
- B: L1 热冷路径混合注入（transformContext 注入位置有 prefix cache 击穿缺陷）
- D: Per-Platform 集成验证（Claude/Cursor/Codex/Antigravity 真实环境验证）

本轮 grill 前置 4 次 atomcode 调研：
1. A 候选行业调研：Letta self_compact sliding_window 源码级核验（30%/70%、50K 字符、独立摘要模型、前缀缓存）
2. B 候选行业调研：Hermes prefix cache 经济学 + magic-context cache-busting 检测 + pi-agent-core 接缝语义
3. D 候选行业调研：四平台 hooks 官方文档核验（Antigravity 无 SessionStart、Cursor snake_case、已知竞态清单）
4. L0 触发策略学术深挖：19 个一手来源、6 篇学术论文（CoALA、Mem0、Cognitive Scaffold ACL 2026、Memory in the Age of AI Agents、SCM、Lost in the Middle）

关键发现：L0 写 resume_anchors 是 L1 热路径的数据源（写读缝），与 pi-agent-core compact()
窗口管理是两个不同心智模型——学术上对应 CoALA 的 consolidation/retrieval 接口，
工业上与 Mem0 的异步 summary 模块同构。不是重复造轮子。

## 决策 (Decision)

### Decision 1: 优先级 A→B→D (Q1)
先 A（L0 LLM 压缩），再 B（L1 注入修复），最后 D（平台验证）。
理由：A 升级摘要质量后 B 的注入内容才有价值；D 相对独立且需真实环境。

### Decision 2: L0 心智模型澄清 — 写读缝，非造轮子 (Q3)
L0 滚动摘要写 resume_anchors 的目的是给 L1 热路径提供跨轮摘要数据源，不是防止窗口溢出。
pi-agent-core compact()/shouldCompact() 管窗口溢出（修改会话 entry 流），L0 管记忆持久化（旁路写 resume_anchors）。
两个心智模型彻底解耦：不调 compact() 管道，只复用其摘要生成引擎。
学术锚点：CoALA consolidation/retrieval 接口；工业同构：Mem0 异步写同步读。

### Decision 3: L0 触发策略 — 低水位线 + 检索事件 + REUSE/COMPRESS 判别 (Q4)
双轨触发：
1. 低水位线 token 触发：128K（1M 窗口的 ~12.8%）。不等窗口满——context rot 在窗口远未满时就显著劣化（Chroma 技术报告 2025-07：18 模型实证性能随输入长度增长而退化，NIAH 低估真实退化；具体断点数值建议对照报告原文数据表或改定性表述）。128K/~12.8% 为设计参数：方向对齐 MemGPT 70% 预警（memory pressure）与社区提前压缩共识（60% 规则），但无文献给出最优水位、偏激进端，需 ablation 验证（Anthropic cookbook 警告过度压缩丢失微妙上下文）
2. 检索工具调用（search_web/research_web 返回）后触发判别：REUSE/COMPRESS——现有摘要 + 新增 gap 仍 fit 就直接复用（省一次 LLM 调用），否则增量生成（判别机制为工程直觉，无直接文献；邻域同构：Mem0 更新阶段 NOOP——现有记忆覆盖新信息则跳过写入）
废弃纯轮次触发（turnCount % 5 是弱方案，不感知信息量）。
REUSE/COMPRESS 判别算法设计是重点难题，后续心智模型着重设计（阈值、信息量度量）。

### Decision 4: L0 摘要生成 — 复用 generateSummaryWithUsage()，不调 compact() (Q4)
复用 pi-agent-core 的 generateSummaryWithUsage()：原生 previousSummary 参数支持 UPDATE 增量语义
（PRESERVE existing + ADD new + UPDATE progress）。
不调 compact()：compact() 职责是窗口管理（findCutPoint + 修改会话 entry 流），复用会把记忆数据源与窗口腾挪耦合。
摘要模型独立（见 Decision 7），self_compact 模式带 systemPrompt 进摘要请求最大化前缀缓存命中。

### Decision 5: IR 专精 5 段摘要 schema 契约 (Q5)
写入端与读取端共享版本化 schema（修复当前 slice(0,2000) 无契约接缝缺陷）：
1. 已查证证据（检索确认的事实 + 来源）
2. 未决假设（待验证方向）
3. 被否决信源（被否定的假设/来源）
4. 关键数字与来源（数字、效应量、URL verbatim 保留）
5. 工具调用与已读状态（已检索/未读文档状态）
其中已查证/未决/被否决三段跨压缩只增补不覆盖——认知分段的学术原型为 OIDA（decisions vs hypotheses、commitment vs contradicted 的类型化符号图）与 Memanto（arXiv:2604.22085）、survey arXiv:2603.07670（uncertainty-aware memory）；Ontheia（pgvector RAG 平台）无此分段，不作锚点。
学术锚点：Cognitive Scaffold (ACL 2026) 原子约束压缩幻觉 5.3%；Anthropic cookbook IR 指令。

### Decision 6: L0 执行模型 fire-and-forget (Q6)
LLM 摘要调用不 await，后台写 resume_anchors。shouldStopAfterTurn 是 awaited 的，
同步 await 会拖慢 agent 循环。L1 下一轮读最新可用摘要，晚一轮生效可接受。对齐 Letta dreaming 异步心智模型。

### Decision 7: 独立摘要模型 — domain.toml [compaction] 段 (Q2+Q7)
domain.toml 新增 [compaction] 段，model 字段指定摘要模型 id（默认便宜模型如 deepseek-v4-fast）。
createEngine() 读取配置构建摘要模型实例注入 PiAgentRuntime。复用现有 v1/chat/completions 端点只换 model id。
Letta 式：摘要模型独立于 agent 模型，降本。

### Decision 8: L1 注入位置 — 锚定最新 user message (Q9)
修复当前 prepend 到第一条 user message 的缺陷：摘要每轮变化 → 首条消息变化 → 每轮击穿 prefix cache
（Hermes PR #2361：Anthropic 未缓存前缀 $3/MTok vs 缓存 $0.30/MTok，约 10×；33K–100K token 前缀未命中重读 ≈ $0.10–0.30/次，为推算值）。改为 append 到最新一条 user message 末尾：
前缀（systemPrompt + 历史）稳定 → 缓存命中；窗口末端是注意力热区（Lost in the Middle U 型偏置）。

### Decision 9: L1+L2 合并注入 + 标签 + 预算 (Q10+Q11)
transformContext Stage 2 同时读 rolling_summary + l2_recall 合并注入（修复 l2_recall 写读缝断裂：写入但从未被读取）。
标签分隔：[Session Memory]（L1 会话摘要）vs [Research Recall]（L2 深召回），让 agent 区分来源。
预算上限：L1 4000 chars + L2 1500 chars，总注入 ≤ 5500 chars（~1400 token），对齐 Anthropic attention budget（有限注意力预算、最小高信号 token 集）与 Hermes 内存预算先例（MEMORY.md ~2200 chars + USER.md ~1375 chars）；4000/1500 为设计值。

### Decision 10: 冷路径 query 用检索意图，只查内部 FTS5 (Q12)
L2 冷路径 query 从最后一条 user message 原文改为最新检索意图（search_web/research_web 的 tool_input.query 提取）。
理由：FTS5 关键词匹配对自然语言原文效果差——ClawSouls 基准（2026-03，SQLite FTS5 vs FTS+bge-m3 混合，30 题人工评分）显示 paraphrase 类查询 FTS-only 30% vs Hybrid 55%（低 25 个百分点）；局限：社区基准、单语料小样本，建议在自有 FTS5 索引复跑验证（memory-bench 开源）。另有查询改写研究佐证（Elastic BEIR/MLDR/MIRACL 三基准、Query2doc、Rewrite-Retrieve-Read；Perplexity query understanding 减 31% 无关引用）。
冷路径只查内部 FTS5 不查项目索引——项目索引留给 recall_memory MCP 工具的两 stage 管道（ADR-0009 D4 职责分离）。

### Decision 11: RAG note 静态前缀保持首条消息 (Q13)
Stage 1 RAG note 是 domain 级静态配置（session 内不变），保持在第一条 user message 形成稳定前缀
（Anthropic prompt caching 最佳实践：静态内容放前缀开头）。L1/L2 动态内容注入最新 user message（动态热区）。静态动态各得其所。

### Decision 12: 读最新 anchor 修复 (Q14)
修复现存 bug：getAnchors() ORDER BY id 升序 + find() 取到最旧摘要。
读取端改为取最新 rolling_summary anchor（ORDER BY id DESC 或 filter+pop）。写入端保留历史 anchor 可审计。

### Decision 13: D 双层验证分工 + 竞态防御三件套 (Q16+Q17)
双层分工：
1. repo 内 E2E 模拟测试：4 adapter 全量覆盖（spawn hook bundle + pipe JSON stdin + assert stdout/exit code），覆盖确定性契约（事件名映射、snake_case/camelCase、.mdc 生成、fail-open exit 0）
2. 真实客户端验证清单文档：平台侧行为（SessionStart 触发、路由卡注入、竞态命中排查），用户真实环境测试阶段用
竞态防御三件套：① hook 输出幂等（相同输入相同输出）② 超时极短 + .mdc 写入 try-catch 静默 ③ 已知竞态文档化（Claude #28372/#83353、Codex #17532、Antigravity veto/timeout=0）。

### Decision 14: 路由卡共享常量 + 配置覆盖 (Q18+Q19)
ROUTING_CARD/MDC_CONTENT 从 3 文件重复提取到 apps/plugin/src/hooks/routing-card.ts 共享常量模块
（debt ledger 触发条件已满足：4 平台）。一处源多输出。
高阶用户覆盖：项目根 .anysearch/routing-card.json 可选覆盖；JSON 解析失败 fail-open 回退默认 + stderr 警告。
内置 DEFAULT_ROUTING_CARD 保证零配置开箱即用。

### Decision 15: Test 闭环范围 (Q8+Q15+Q20)
A 候选：mock LLM 层（fake generateSummaryWithUsage）+ 摘要 schema 契约测试（5 段字段完整性、三段只增补不覆盖语义、写读端一致性）。
B 候选：注入位置 + 标签 + 预算截断 + 读最新 anchor + fail-open（store 不可用原样返回）。
D 候选：4 adapter E2E + HTTP stateless 集成测试（无 session 头、JSON 响应、连续两次请求独立），锁住 ADR-0008 D4 修复。
真实 LLM 集成测试 + prefix cache 命中验证：放用户真实环境测试阶段（用户自配 LLM + API key）。
MCP 工具注册断言继续 defer（McpServer v1 内部 API 外部约束）。

## 备选方案 (Alternatives Considered)

1. L0 复用 compact() 管道 — rejected: 耦合记忆数据源与窗口腾挪两个心智模型
2. 纯轮次触发（保留 %5）— rejected: 不感知信息量；Mem0 证明事件驱动更优（91% 延迟降低、90% token 节省）
3. 等窗口满才触发（95% 风格）— rejected: Claude Code 自动压缩（旧版/社区报道默认 ~95%，逆向分析现为 ~83.5%，1M 窗口约 967K）是反例教训——触发太晚导致强制压缩丢上下文、甚至压缩死循环（hyperdev 报道；anthropics/claude-code issue #27036）；官方已提供 autoCompactWindow（默认 500K，1M 窗口 50%）提前压缩，社区共识 60% 左右；context rot 远未满窗就劣化
4. L1 frozen snapshot（session 启动固定）— rejected: 摘要不随会话演进；100% 缓存命中但牺牲记忆新鲜度
5. 冷路径也走两 stage（查项目索引）— rejected: 违反 ADR-0009 D4 职责分离
6. RAG note 也移到最新 user message — rejected: 静态内容移到动态末端反而破坏前缀稳定性
7. Anchor 写入端 upsert — rejected: 丢失历史版本；改动大于读取端修复
8. 路由卡环境变量配置 — rejected: hooks 子进程环境变量传递各平台不一致
9. MCP 工具注册断言强测 — rejected: SDK v1 内部 API 约束，升级时会碎裂

## 后果 (Consequences)

正面:
- 写读缝澄清 = L0/L1 心智模型与窗口管理彻底解耦，学术对齐 CoALA/Mem0
- REUSE/COMPRESS 判别 + 低水位线 = 对抗 context rot 与 LLM 调用成本的平衡（判别机制为工程直觉 + Mem0 NOOP 邻域同构，无直接文献，列为待设计项）
- IR 5 段 schema = 证据粒度保真，原子约束抑制压缩幻觉
- 注入热区 + 静态前缀 = prefix cache 命中 + 注意力最优位置兼得
- 路由卡配置覆盖 = 高阶用户定制 + 零配置默认体验
- E2E + 验证清单 = 确定性契约有回归防护，平台侧行为有排查指南

负面:
- REUSE/COMPRESS 判别算法需后续重点设计（mitigated: 心智模型已记录，先用简单阈值）
- 摘要 schema 契约测试增加测试面（mitigated: mock LLM 层，不真实调用）
- 路由卡配置文件增加一个失败面（mitigated: fail-open 回退默认）
- 真实环境验证延迟到用户阶段（mitigated: 验证清单文档提供指导）

关联: ADR-0009 (L0/L1/L2 三层 + Dual DB), ADR-0010 (热冷混合 + L0 升级路径), ADR-0011 (SessionStart + 渐进披露), ADR-0008 (D4 stateless)。
*End of ADR-0012*
