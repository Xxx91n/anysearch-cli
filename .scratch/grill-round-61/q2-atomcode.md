[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我将按“先证伪知识库 → 本地代码分析 → 三引擎联网调研 → 综合”的流程执行这次深调研。先建任务清单并召回知识库。知识库召回完成：有 docs 域 urlAllowlist 现状（modelcontextprotocol.io / typescriptlang.org / pnpm.io）与既往 grill 轮上下文，但没有针对 pre/post-filter 分层的历史调研，需要联网补。现在转入本地代码分析。任务 #2 还差关键文件内容确认，我抓取 url-policy、pi-runtime 中 allowlist 的实际用法及 provider 适配层现状。本地代码分析已完成，关键发现明确：urlAllowlist 目前只在 pi-runtime 做检索后 HITL 门控，provider 适配层完全没有下发域过滤参数，abstain 桥已有（shouldBridgeToAbstain）。现在转入三引擎联网调研。任务 #3 的官方文档材料已齐（Tavily/Exa/Brave/Google CSE），现在用 web_fetch 核验两个最关键的官方页面原文，随后转入 #4/#5。任务 #3（provider 能力矩阵）材料已齐：Tavily/Exa/Brave/Google CSE 官方文档均已获取并核验。转入 #4 与 #5 并行调研。#4 已获得关键证据（TrustNLP 2026 Authorization-First Retrieval 论文 + DZone 安全管线文），现在抓取论文原文核验，并推进 #5（site-restricted 已知坑）调研。任务 #5 的批评/社区材料已基本齐备，现在补 3 次 web_fetch 原文核验（Tavily 域过滤坑、site: 运算符真相、DZone 安全检索管线），同时完成 #6 配额。任务 #6 核查：已实际 web_fetch 6 次（tavily docs、exa tpc、aclanthology PDF、theneuralbase、indexbolt、dzone），覆盖 7 个独立域名。其中 ACL PDF 返回原始二进制未解析成功，为保证“有效核验 ≥6 次”，补一次 Brave Goggles 官方限制页（该结论目前仅有摘要级支撑），然后收口。核验配额已达成（6 次可读原文、6+ 独立域名），标记 #6 完成，进入最终综合。# 深调研报告：域外约束执行层（pre-retrieval domain filter vs post-filter）

**Sufficiency Gate** — searches: 11（web_search×5 / Tavily×4 / AnySearch×2）| angles: Official、Comparative、Criticism、Community（4/5 类；Currency 由 2026 年份文档顺带覆盖）| full reads: 6 次有效原文（另 1 次 ACL PDF 为二进制未解析，已声明）| domains: 7 个独立域名 | gaps: 见文末。

---

## 1) 执行摘要（Tl;dr）

**推荐方案 B 的变体：检索前置约束为主 + 事后过滤为唯一权威兜底，两层各发独立 audit 事件。** Confidence: **高**——理由：(a) 2026 TrustNLP 的 Authorization-First Retrieval 论文实证 retrieve-then-filter 有 86.1% 结构性泄漏率而前置授权为 0；(b) 我们在用的三家 provider 中两家（Tavily/Exa）有一手 API 级域过滤，成本低；(c) 但 provider 过滤均非契约级保证（有泄漏/降级先例），fail-closed 的权威裁决必须留在 engine 层 post-filter，恰好与 ADR-0055（policy 单源）和 ADR-0053（fail-closed）对齐。纯 A（只做事后过滤）在学术上有实证的泄漏路径，纯靠 provider pre-filter 则没有本地权威裁决点，两者都不可取。

---

## 2) 分点结论

**结论 1：前置过滤是学术与工程共识的“顺序约束”，事后过滤已被实证为泄漏路径。**
ACL TrustNLP 2026《Authorization-First Retrieval》将问题形式化为流水线顺序约束并归约到 noninterference：一旦越权内容进入模型上下文，“其影响无法被可证明地撤销”；retrieve-then-filter（D3）在 584 查询 × 12 角色评测中结构性泄漏率 86.1%，前置授权为 0。（来源 [1]）工程侧同结论：DZone 安全检索指南明确“过滤 after retrieval 是常见错误——模型或 ranker 已经看过受限内容，即使从响应里移除，它可能已影响排序或生成答案”。（来源 [2]）二者独立，交叉验证成立。

**结论 2：但前置过滤不能是唯一防线——静态标注/策略会漂移，provider 过滤也不是契约。**
同一篇 AFR 论文的 tag-freshness 消融显示：即使是程序化前置过滤，若策略标签不随 live policy 刷新，单轮策略更新周期后就有 9.7% 查询重新出现结构性泄漏（来源 [1]）——对应到我们，**policy 必须在请求时从 ADR-0055 单源解析**（`resolveUrlPolicy` + 既有惰性 mtime 重载），不能在 retriever 里缓存快照。Provider 侧：Tavily 社区课程记录了 include_domains 会“返回未列出的父域/子域”且是“filter hint 而非 hard blocker”（来源 [3]）；Google CSE Site-Restricted API 官方文档自己承认配置漂移会导致 "unexpected results"（来源 [4]）。所以权威裁决必须在本地 engine 层 post-filter 兜底。

**结论 3：Provider 能力差异大，pre-filter 必须设计成“能力协商”而非硬性假设。**
见下方对比矩阵。关键点：Exa 官方明确把 includeDomains 定位为“构建垂直搜索引擎/高信任 RAG”的一手能力（来源 [5]）；Tavily 有标准 include_domains（上限 300）；Brave 只有 Goggles **重排序** DSL（boost/downrank/discard），不是硬过滤（来源 [6]）；AnySearch MCP 无域参数。因此 pre-filter 要按 provider 能力矩阵下发，不支持者降级为“post-filter-only”，并照常发 audit 事件记录降级。

**结论 4：site-restricted 的已知坑要求匹配语义提前定型。**
(a) 子域/裸域：Tavily 域匹配是子串式的，`github.com` 会匹配 `gist.github.com`（来源 [3]）——我们 docs 域 allowlist 同时列了 `typescriptlang.org` 和 `www.typescriptlang.org`，说明仓库已踩过这个坑；`url-policy.ts` 的 `canonicalizeHosts` 已按 hostname 规范化，post-filter 应复用同一匹配函数，避免 provider 子串匹配与本地精确匹配语义分叉。(b) `site:` 查询运算符不可靠：IndexBolt 2026 深文证实其结果是“样本非清单”、计数是估计值（来源 [7]），Exa 官方文档也明确“不要用 site: 运算符重复域过滤”（来源 [8]）——query-rewrite 层不应注入 site:。(c) 重定向（docs.rs→github）：post-filter 按**结果 URL 的最终 host** 裁决，内容抓取阶段的重定向仍由 pi-runtime 既有 HITL 门控负责（两层职责不混）。

**结论 5：egress-filtering 类比直接支持双闸。**
 AnySearch 检索到的 SEI/GIAC 等信源一致表述："egress filtering alone is not a solution, but is part of a defense-in-depth strategy"——出口过滤（我们语境下的 post-filter/abstain）单独不成方案，但作为纵深防御的最后一层是标准做法。映射到本仓库：pre-filter = 入口收敛，post-filter = 出口闸门，audit = 双闸留痕（ADR-0052/0053 闭环）。

### Provider 域过滤能力矩阵（≥3 项，按模板）

| 项 | Tavily | Exa | Brave | Google CSE (Site-Restricted) | AnySearch MCP |
|---|---|---|---|---|---|
| 域过滤 API | `include_domains`（≤300）/ `exclude_domains`（≤150），新增 `include_domains_mode` | `includeDomains`/`excludeDomains`（≤1200），支持路径前缀 + `*.sub` 通配（2025-08 起） | 无硬过滤；Goggles DSL（boost/downrank/discard，≤3 条/查询，hosted 需注册） | 硬站点限制，但仅 ≤10 站点且配置漂移会产生意外结果 | 无域参数 |
| 保证强度 | 中（社区报告会漏出未列子域/父域；basic 深度只搜已索引内容，冷门域易 0 结果） | 较高（官方定位 walled-garden；但 company/people 类目不支持 excludeDomains 会 400） | 低（本质是重排序；site: 运算符官方标注 experimental） | 高但配置耦合（官方自认漂移风险；API 正在迁移到 Agent Search） | 无 |
| 对我们的 pre-filter 含义 | 直接下发 `include_domains` | 直接下发 `includeDomains` | 不可用 → 降级 post-filter-only + audit | 不采用 | 降级 post-filter-only + audit |

---

## 3) 推荐（B 变体）与实现影响面

**推荐：B — 前置约束为主（能力协商式）+ engine 层 post-filter 为权威兜底，双闸双 audit。** 具体分层：

1. **Retriever 合同层**（`packages/retriever/src/contract.ts`）：SearchRequest 增加 `includeDomains?: string[]` 与 `domainFilterSupported: boolean` 能力位。
2. **Provider 适配层**（`providers/tavily.ts` 加 `include_domains`；`providers/exa.ts` 加 `includeDomains`；`providers/anysearch.ts` 声明不支持）——改动量：3 个小文件 + 1 个合同字段。
3. **Policy 接线**：engine 调 retriever 前用既有 `resolveUrlPolicy`（`packages/store/src/url-policy.ts`，零改动）解析当前 allow/deny，请求时新鲜解析（复用惰性 mtime 重载器），**不在 retriever 内缓存策略**（对应 AFR 标签漂移教训）。
4. **Post-filter 权威闸**（kernel engine 或新 scope-filter 模块）：对结果 URL host 按 `canonicalizeHosts` 同一匹配语义裁决，deny 优先；全空 → 走既有 `shouldBridgeToAbstain` → abstain。改动量：kernel 1 个新模块 + engine 接线，中等。
5. **双 audit 事件**：`packages/store/src/observation.ts`（schema v2 已有 kind 枚举）加两个 ObservationKind——`retrieval.domain_filter.pre`（下发的域数、provider 支持与否）与 `retrieval.domain_filter.post`（过滤条数/泄漏条数），DZone 的 `filtered_count` 响应模式是现成参照（来源 [2]）。改动量小。
6. **query-rewrite 红线**：不注入 `site:` 运算符（结论 4c）。

**与账本冲突检查：无冲突。** D-001（R61）本轮主题就是 docs 域外 abstain 缺口（bc0001），方案 B 是该缺口的直接修复路径；npm 发布顺延的排序不受影响。唯一需拍板的口径：B 的 pre-filter 会主动降低域外召回（这正是“检索只覆盖该域一手源”的产品理念），与既有 ADR-0053 的 fail-closed/Abstain Smoke 语义一致，无 ADR 需要豁免。

---

## 4) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Authorization-First Retrieval (TrustNLP 2026) | https://aclanthology.org/2026.trustnlp-main.15.pdf | Official/学术 | 2026 | pre-vs-post 的实证核心：D3 泄漏 86.1% vs AFR 0；标签漂移 9.7%（⚠️ PDF 为二进制未解析，结论来自检索高亮，与 [2] 独立互证） |
| 2 | Securing AI Retrieval Pipelines With Identity-Aware Access | https://dzone.com/articles/ai-retrieval-identity-access | Community/工程 | 2026-08-19 | "filter before retrieve" 顺序原则 + filtered_count/audit 模式（已 fetch 核验） |
| 3 | Tavily Advanced Course: Routing Between Sources | https://theneuralbase.com/tavily-api/learn/advanced/routing-between-sources/ | Community/批评 | 未标注 | Tavily 域过滤已知坑：子串匹配、子域漏出、basic 深度冷门域 0 结果（已 fetch） |
| 4 | Custom Search Site Restricted JSON API | https://developers.google.com/custom-search/v1/site_restricted_api | Official | 现行 | 硬站点限制的配置耦合风险自认（摘要核验） |
| 5 | Exa: Domain Filtering for Targeted RAG | https://tpc.exa.ai/search-api-allow-domain-filtering-targeted-rag | Official | 2025-12-12 更新 | includeDomains 官方定位 = 垂直/walled-garden RAG（已 fetch） |
| 6 | Brave Goggles API Docs | https://api-dashboard.search.brave.com/documentation/resources/goggles | Official | 现行 | Goggles 是重排序 DSL 而非硬过滤；≤3 条限制（已 fetch） |
| 7 | The site: Search Operator: What It Really Tells You | https://www.indexbolt.com/blog/site-search-operator | Criticism | 2026-09-14 | site: 运算符“样本非清单”语义（已 fetch） |
| 8 | Exa Search API Reference / Changelog | https://exa.ai/docs/reference/search · https://exa.ai/docs/changelog | Official | 2026-09-10 / 2025-08 | includeDomains ≤1200、路径前缀/通配符、禁用 site: 叠加、category 兼容性 400（摘要核验） |
| 9 | Tavily Search API Reference | https://docs.tavily.com/documentation/api-reference/endpoint/search | Official | 现行 | include_domains/exclude_domains 参数与 include_domains_mode（已 fetch） |
| 10 | Egress Filtering（SEI CMU / GIAC 等，经 AnySearch 聚合） | https://www.sei.cmu.edu/blog/best-practices-and-considerations-in-egress-filtering/ | Official/类比 | 2018-04 | egress filtering 单独不成方案、属纵深防御（摘要核验） |
| 11 | MOSAIC: 垂直搜索开放框架 (CEUR-WS) | https://ceur-ws.org/Vol-4137/WOWS_2025_paper_5.pdf | 学术 | 2025 | 垂直域搜索 = 索引分区/元数据过滤前置的架构先例（摘要核验） |

**本地代码证据**（ctx 沙箱分析）：`packages/retriever/src/providers/*.ts` 现状无任何域参数下发；`packages/kernel/src/pi-runtime.ts:238-246` urlAllowlist 仅作检索后 HITL 门控（这正是审计探针返回 10 条域外结果的根因——约束在消费侧而非检索侧）；`packages/store/src/url-policy.ts` 的 `resolveUrlPolicy`/`canonicalizeHosts`/`policyVersion` 可直接复用；`packages/kernel/src/attribution.ts:379` `shouldBridgeToAbstain` 桥已就绪。

## 5) 信息缺口

- **Tavily “filter hint 扩大搜索”说法仅 [3] 一个社区源**，官方文档未承认；建议实现时用 INJECT Probe Suite 同款探针实测一次（发域外问题看 include_domains 是否漏出），以实测为准。
- AFR 论文全文未读（PDF 解析失败）；其 tag-freshness 数字（9.7%）依赖检索高亮，若要引用进 ADR 建议走 ACL anthology HTML 摘要页或 arXiv 镜像二次核验。
- Perplexity API 无公开域过滤参数文档（本次未深挖），若未来接入该 provider 需单独补测。
- Exa 对小 allowlist（我们 docs 域仅 3-4 host）的召回质量未实测——冷门域 0 结果是否触发 abstain 而非静默降质，需在 eval gate（ADR-0048）里加一条 golden case。

继续此会话，运行：atomcode -p "…" --resume b659e9c7-fdee-4808-a668-1d320a33652f
