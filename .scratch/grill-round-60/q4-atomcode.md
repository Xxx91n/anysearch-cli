[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我先建立任务清单，然后并行回顾本地账本与 ADR，再启动三引擎调研。先定位 decision-ledger 与关键 ADR/CONTEXT 内容。任务 #1 还差账本与 ADR 原文，继续读取。#2 完成：`domains/default.toml` 无 `urlAllowlist` 字段（默认域全 provider 开放），allowlist 机制本体在 ADR-0053 D4-B / ADR-0055（TOML `[sources].urlAllowlist` 单一权威源 + mergeAllowlist 共享求值），docs 域的 allowlist 就是往该 TOML 写值——落点确认。进入调研。任务 #3 正在进行中——现在启动外部调研。按规程先证伪知识库，同时发起三引擎第一轮检索。继续任务 #3：先取回被截断的第一轮搜索结果全文（拿 URL），同时补第二轮多角度查询。任务 #3 仍在进行——搜索配额已达成（5 查询、三引擎、多角度），现在按规程定点深挖：对高价值结果做 web_fetch 原文核验（第一批）。任务 #3 继续执行中：补齐第 5–8 次原文核验（覆盖 MCP/TS/pnpm 官方源本体 + 检索治理策略页）。配额自查已达标（5 次搜索 × 3 引擎、8 次全文核验、8 个独立域名、关键结论均有 ≥2 源），任务 #3 完成，进入 #4 综合。# Round-60 Q4 · docs 域语料 allowlist 圈定 — 调研报告

**Sufficiency Gate**: searches: 5 | angles: Official / Comparative / Criticism / Currency | full reads: 8 | gaps: Glean/Coveo 等企业级产品内部治理细节仅得厂商博客二手材料（已降低其证据权重）；D-001/D-002/D-003 账本原文按题面背景采纳，未回读 `.scratch/grill-round-60/`（不存在，round-60 ADR 尚未落盘，不构成证据缺口）。

## 1) 执行摘要（Tl;dr）

**推荐：C（滚筒扩展）为账本正式决策，A（三源）作为 C 的首批实例化结果同时落 B1 spec** —— 即“规则先行、URL 跟票”的双层结构：Round-60 ADR 只固化为入圈/出圈规则 + freshness class 机制，首批三源 URL（MCP/TS/pnpm）作为 B1 spec 的附表实例化，不进 ADR 正文行数（D-001“治理不挤正文行数”约束的直接兑现）。Confidence：**高** —— 规则优先于清单与仓库既有信任边界架构（ADR-0053 D4-B/ADR-0055 TOML 单一权威源）同构，且与三引擎调研收敛出的工业界治理共识（准入门槛 + 按源分级 freshness + 周期复审）完全一致；唯一低置信点是“首批恰好是这三个源”的验证深度（三官方源均已在原文核验可达，但八维 golden 切片覆盖率需 B1 实现期回验）。

## 2) 分点结论

**结论 1：三个候选不是三选一，而是“规则层 vs 实例层”——C 是规则层正确答案，A/B 是实例层数量问题。**
工业界调研一致指向：语料治理的成熟心智模型是“准入判据（inclusion bar）+ 命名 owner + 按源类分级 refresh cadence + 复审时出圈”，而非一次性人工圈定清单。[RAG corpus governance 一手分析， artifact 242cd65e] 明确说“retrieval index 不是一次性的工程问题，是持续问‘这些源还配在索引里吗’的治理问题”；[Heeya KB Engineering 2026] "Ingest selectively — not every document belongs in your KB, a smaller high-quality corpus outperforms a large noisy one"（→ 排除 B 宽圈：turbo+tsup+node 全量入圈没有对应的团队日常依赖强度证据，且 D-002 约束的是“窄切片”）；[Parallel Source Policy 官方文档，原文核验] 从 API 层面反向印证：include_domains "can significantly reduce result quality by excluding relevant pages —— use only when absolutely necessary: compliance-bound corpora, single known publisher"（→ 白名单是合规工具不是质量工具，圈要小而理由要硬，支持 A 的“最小可辩护集”作为首批）。

**结论 2：allowlist 机制本体已建好，C 的规则层落点就是往既有 TOML 写规则化字段——不造轮子。**
仓库事实：ADR-0053 D4-B 建立 URL fail-closed 授权（user-sourced 或 `[sources]` TOML static domain allowlist，retrieved-derived 走 HITL）；ADR-0055 把策略收敛到 TOML 单一权威源 + `mergeAllowlist` 三方共享求值；CONTEXT.md "Policy Single Source" term 明确 env 只是加法覆盖层。因此 Q4 的真实决策面不是“建 allowlist 系统”而是“docs 域 TOML 写什么值”。[OWASP RAG Security Cheat Sheet §1，原文核验] 提供安全侧佐证："Maintain an allowlist of trusted document sources + approval workflows for new sources before ingestion"——与 ADR-0053 的 fail-closed 授权完全同构，规则化的入圈审批流程正是该 cheat sheet 的 "Do" 项。

**结论 3：freshness/supersede 检测按 freshness class 分级是工业标准做法，且与本仓既有 supersession 状态机同构。**
[Ground Freshness 文档，原文核验]：staleness budget 按源类分级——API specs 7-14 天 / code repos 14-30 天 / **stable docs 30-90 天**；[Waxell Retrieval Policy，原文核验]：`max_source_age_days` 默认 90、`action_on_stale_source` 默认 block、`blocked_sources` 兜底；[Coalent Provenance] 提出"事件驱动优于定时器"：源变更时只失效引用它的单元（surgical, not timer-based）——对 docs 域的启示：规范类源（MCP spec）跟版本日历走，参考类源跟 changelog 走，不必统一 cron。本仓已有 Corrective Supersession 状态机（ADR 唯一合法自更正出口）+ No-Grandfathering——docs 语料的 supersede 检测可以直接映射到同一心智模型：**旧版本 URL 不删除，翻 superseded 状态并指回新 URL，正文 append-only 保留**。

**结论 4：D-002 与 C 无冲突，但需一条显式 revised 澄清“权威单元是规则不是 URL 清单”。**
D-002 current 写“语料锚定团队日常依赖的一手文档（MCP 规范/TypeScript/pnpm 等）”——注意原文有“等”字，且列举的是**示例**。选择 C 不改向、不推翻 D-002，只是把“锚定”从隐含的 URL 列表显式化为“锚定入圈规则，URL 是规则的当前输出”。为避免静默改向，账本记法见第 4 节。

## 3) 对比矩阵

| 项 | 圈定单元 | D-001 治理行数约束 | 与 ADR-0053/0055 架构关系 | B1 阻塞风险 | 工业界对标 |
|---|---|---|---|---|---|
| A 最小圈（3 源） | 硬编码 URL 清单 | ❌ 清单写进决策正文即挤占正文行数 | 兼容但无规则化字段，扩源须再开 ADR | 低（可立即实施） | Parallel "compliance-bound corpus" 模式 |
| B 宽圈（6 源） | 硬编码更大清单 | ❌ 同上且更肥 | 同上 | 低 | Heeya："large noisy corpus outperformed by small clean one" 明确反例 |
| C 规则化滚筒 | 入圈/出圈判定条件 + freshness class 机制 | ✅ 规则进 ADR（决策本体），首批 URL 进 B1 spec 附表 | 同构：TOML urlAllowlist 本就是策略声明，规则是其生成函数 | 中（B1 spec 多写一节，但 D-003 本就要求 spec 定义归类） | OWASP 允许源审批工作流 / Ground+Waxell 按源类 staleness budget / Coalent 事件驱动 supersede |

## 4) 推荐 + 入圈/出圈判定（可执行）

### 推荐：C，首批以 A 三源实例化

**理由（收敛）**：① D-001 明令治理不挤正文行数——只有 C 把清单从 ADR 正文移到 B1 spec 附表；② ADR-0055 的 TOML 策略源天然适合承载“规则 + 生成清单”而非手抄 URL 常量；③ 调研三源交叉（corpus governance 长文 / OWASP / Parallel+Ground+Waxell 产品文档）一致支持"准入判据 + 分级 freshness + 周期复审"三件套，这是既不造轮子（复用 supersession 状态机与 HITL 出口）又不自封完成（出圈条件可被 badcase 回灌 B4 触发）的形态；④ D-002 语料锚定"团队日常依赖的一手文档"——A 的三源正是 C 规则下的首批通过者，选 C 不牺牲 A 的起步速度。

### 入圈判定条件（全部满足才进）

1. **一手性**：URL 域为该项目/规范的官方源（规范本尊、官方 docs 域、官方 settings 参考），二手转述、教程站、社区 wiki 一律不入——对齐 Parallel "prefer steering over include when you only want preference"（偏好靠 prompt/skill，白名单只圈权威）；
2. **日常依赖**：B1 spec 撰写期间团队可举出 ≥1 个真实使用场景（本轮 D-002 已对 MCP/TS/pnpm 举出）；
3. **可回访**：URL 可公网回访且提供稳定锚（版本化路径或 permalink），满足 D-002 golden 全真源约束；MAJOR.MINOR 锚定，MAJOR bump 由 supersede 流程跟进；
4. **八维切片有增益**：新源必须承诺覆盖 `eval-looks@2` 现有 10-20 条 golden 补不了的至少一个维度切片，否则仅进"观察名单"不进 allowlist（防 B 宽圈式的顺手全收）。

### 出圈判定条件（任一触发即翻状态）

1. **官方 supersede**：上游发布替代版本/迁移公告 → 旧 URL 翻 `superseded`，指回新 URL，按 Corrective Supersession 状态机 append-only 保留（No-Grandfathering：旧 URL 不再作为 golden 真源）；
2. **staleness 超期**：按 freshness class 分级检测超期未复核（规范类 90 天 / 参考类 180 天，Ground 的 "stable docs 30-90" 档放宽因 golden 有离线快照兜底，D-003 已裁定 URL 硬断言走 online 层）——超期不自动出圈，翻 `stale` 进入复审；
3. **golden 无消费**：连续两个 round 无任何 golden 八维切片引用该源 → 出圈候选，复审时决定（对齐 corpus governance "sources without owners get retired by default"）；
4. **回访失败**：连续 N 次在线核验 404/410 且无重定向 successor → 立即出圈（fail-closed，对齐 ship-gate 的 failUnverifiable 纪律），golden 若引用它则该条 golden 按 D-003 分层降级为快照 fixture 或重锚。

### 首批 URL 清单（C 规则下 A 三源的实例化，freshness class 附注）

| URL | 源 | freshness class | 检测节奏 |
|---|---|---|---|
| `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`（及同版本化同源页面） | MCP 官方规范 | spec-major：版本日历锚定，90 天复核 | MAJOR bump 触发 supersede |
| `https://www.typescriptlang.org/tsconfig/` | TS 官方参考 | reference-stable：180 天复核 | TS 发版季抽查 |
| `https://pnpm.io/settings` | pnpm 官方 settings | reference-active：90 天复核（本仓 ADR-0026 强依赖其字段，团队日常依赖最重） | pnpm minor 版抽查 |

（三源均于本轮原文核验可达；freshness 分级依据 Ground 官方档位 + 本仓依赖强度调整。）

### 账本冲突显式声明（不静默改向）

- **D-002 revised（澄清性，非改向）**："语料锚定团队日常依赖的一手文档" 补一条：**锚定单元 = 入圈规则，URL 清单是规则的当前输出（首批：MCP/TS/pnpm），随 B1 spec 附表演进**。原句的"等"字由本条收口。
- **D-003 无冲突**：B1 spec 增补"allowlist 圈定规则 + 首批 URL 附表（freshness class）"一节，属 D-003 已要求的 spec 定义范围。
- **D-001 无冲突**：首批 URL 附表落 B1 spec 与 domains TOML，不占 Round-60 ADR 正文行数。

## 5) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Parallel — Source Policy（官方） | https://docs.parallel.ai/resources/source-policy | Official | include/exclude 是合规工具非质量工具；圈小而理由硬；偏好靠 steering ✅原文核验 |
| OWASP RAG Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html | Official/Criticism | §1 允许源审批工作流、来源 hash + provenance；与 ADR-0053 fail-closed 同构 ✅原文核验 |
| Ground — Freshness & Staleness（官方） | https://docs.trygroundai.com/concepts/freshness | Official | staleness budget 按源类分级：stable docs 30-90 天 ✅原文核验 |
| Waxell — Retrieval Policy（官方） | https://waxell.ai/docs/observe/governance/retrieval | Official | max_source_age_days=90 默认 block、blocked_sources 兜底、warn/block 两级动作 ✅原文核验 |
| llms.txt Format Spec（llmtxt.info） | https://llmtxt.info/llms-txt-format/ | Official/Currency | 策展 10-30 条 vs 全量 sitemap 的分工——反 B 宽圈 ✅原文核验 |
| MCP 规范 Transports（官方） | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports | Official | 首批源之一本体核验：版本化路径锚定可行 ✅原文核验 |
| TypeScript TSConfig Reference（官方） | https://www.typescriptlang.org/tsconfig/ | Official | 首批源之二本体核验 ✅原文核验 |
| pnpm Settings（官方） | https://pnpm.io/settings | Official | 首批源之三本体核验：pnpm-workspace.yaml 为权威配置面 ✅原文核验 |
| Corpus governance 长文（检索治理，Exa 检索原文） | （artifact 242cd65e73f6f7b2 内） | Criticism | "ingestion-time editorial decision"、authority tier、owner + inclusion bar + cadence + deletion path、复审制 |
| Heeya — KB Engineering 2026 | https://heeya.fr/en/blog/knowledge-base-engineering-for-ai-chatbots-2026 | Comparative | "Ingest selectively"：小而净优于大而噪 → 反 B |
| Ground AI docs — Freshness（Tavily 首得） | 同 Ground 条目 | Currency | 三引擎交叉：Tavily 与 Exa 均命中，双引擎支持 |
| Coalent — Provenance & freshness | https://coalent.ai/docs/freshness | Currency | 事件驱动 supersede 优于定时器：源变更只失效引用单元 |

## 6) 信息缺口（开放问题）

1. Glean/Coveo 等企业搜索产品的**内部**语料白名单治理细节只有厂商博客二手材料，未取得其客户案例原文——已按低权重处理，不影响主结论（主结论由一手产品文档 + OWASP 支撑）；
2. "首批恰为这三源对八维切片的覆盖度”无法在调研期验证——需 B1 实现期用 `eval-looks.json` 现状回验，若某维度（如弃答族）无源覆盖，按入圈条件 4 从观察名单提升，而非现在预支；
3. turbo/tsup/node 文档是否真的"团队日常依赖强度不足”是本轮基于 D-002 窄切片理念的推断，未经团队使用数据证实——若后续 badcase 回灌（B4）显示缺源，滚筒规则本身就是补录通道，这正是选 C 的自愈价值。

继续此会话，运行：atomcode -p "…" --resume 02c13f4b-2ad0-4059-befd-2ec10bb22c9c
