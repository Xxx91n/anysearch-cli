[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我先建立任务计划，然后召回知识库与本地账本上下文。[rate-limited] auto-continuing in 3s…
知识库已召回：bc0001 已晋升为 golden docs-g0007（域外 tokio 提问 expect abstain），abstain eval 基建已存在于 `packages/store/src/eval/`。转入本地账本读取。继续任务 #2：提取 ADR-0053 abstain 相关段、eval-looks golden 结构与 CONTEXT.md 术语。[rate-limited] auto-continuing in 3s…
本地账本已建立：golden 断言形态为 `expected.verdict: "abstain"`（docs-g0007 已入账本），abstain 探针三层判定（chain/regex/llm）已有实现。转入联网调研阶段。[rate-limited] auto-continuing in 3s…
[rate-limited] auto-continuing in 3s…
任务 #3 材料已齐（POSIX grep exit 三态、MCP isError 契约、empty≠error 三方共识），标记完成并转入 #4，同时用 web_fetch 核验关键原文。任务 #4 还差 You.com 与 LangChain answerability 两个信源，补齐后收口。任务 #4 材料已足（Google CSE、You.com、LangChain `response_if_no_docs_found`、LlamaIndex EmptyResponse 四源齐备），标记完成并转入 #5：eval harness refusal 测试模式。任务 #5 已有 promptfoo/inspect_ai 两路证据，用 web_fetch 核验原文后收口，并同步推进 #6（Tavily include_domains 子域行为）。[rate-limited] auto-continuing in 3s…
任务 #5 的 refusal 测试模式证据已齐（promptfoo llm-rubric/search-rubric 文档 + TMA is-refusal 断言 + inspect_ai #1345 原文），标记完成；转入 #6，核验 Tavily include_domains 语义的一手文档。[rate-limited] auto-continuing in 3s…
[rate-limited] auto-continuing in 3s…
[rate-limited] auto-continuing in 3s…
判据 5 的关键证据已到手：Tavily changelog 原文确认 `include_domains_mode` 双模式语义（boost=软偏好会泄漏域外结果、filter=硬过滤含子域；Research 端点是软偏好）。补最后一次 You.com 原文核验使 web_fetch 达到 6 次，然后收口输出。任务 #7 已达成（web_fetch 原文核验 6 次：MCP spec、ripgrep #2500、inspect_ai #1345、Tavily changelog、promptfoo llm-rubric、You.com docs；三引擎 Exa/Tavily/AnySearch 交叉验证 ≥17 次查询，覆盖 Official/Comparative/Criticism/Currency/Community 五角度）。收口并输出综合结论。# 深调研报告：垂直域 abstain 的呈现形态与验收判据设计

**Sufficiency Gate**: searches: 19（Exa 6 / Tavily 8 / AnySearch 5）| angles: Official + Comparative + Criticism + Currency + Community（五类全覆盖）| full reads: 6（MCP spec 2025-11-25、ripgrep #2500、inspect_ai #1345、Tavily changelog、promptfoo llm-rubric、You.com search docs）| gaps: Perplexity API 无结果形态无一手文档实证（仅有社区佐证）；DeepEval refusal 判据未获一手文档；Google CSE 空结果仅有官方 demo 代码 `else: 'No Results.'` 佐证而非 spec 条文。

---

## 1) 执行摘要（Tl;dr）

**abstain 应建模为「确定性的第一类结果（first-class outcome）」，不是 error 也不是 failure**——业界三方证据（MCP 规范、CLI 工具传统、RAG 框架）收敛于同一心智模型：拒绝是因为“证据边界到此处为止”的正常成功路径。推荐：**a1 = CLI 打印结构化一行消息（含域与被过滤条数）+ exit 0**（grep 式 exit 1 传统有著名的 pipefail 反噬，BDFL 亲自 wontfix 维持但社区代价明确；abstain 是 answer 而非 no-match，语义上更应归 0）；**a2 = MCP/plugin 面走结构化 abstain 字段**（`isError:false` + 自有 `structuredContent.abstain` 载荷），不依赖 audit 留痕做契约。判据 1-5 全部保留，判据 5 从“可选”升为“必做”（Tavily 2026-08 changelog 实锤 include_domains 存在 boost 软模式与 Research 端点软偏好两种泄漏面，探针有真实靶子）。**Confidence：高**（每个关键结论均有 ≥2 独立信源，其中规范/官方文档 4 个）。

## 2) 分点结论

**C1. abstain ≠ error ≠ empty-failure：三层区分的工业共识（Confidence 高）**
- MCP 规范（2025-11-25，已读原文）明确双层错误模型：协议错误走 JSON-RPC error；工具执行错误走 `isError:true`，且其定义是"contain actionable feedback that language models can use to self-correct and retry"。空结果**不在**错误定义内——Tavily 官方集成教程与两份 MCP 教程（ccaf-exam.guide、claudecertificationguide.com）都明确把 "valid query, zero matches" 归为 `isError:false` 的合法空结果："Conflating 'I couldn't run the query' with 'the query returned zero rows' causes the coordinator to retry needlessly"。
- 关键洞察：**域外 abstain 连“空结果”都不完全是**——它是策略性拒绝，语义上比 no-match 更“成功”：系统正确执行了策略。这与 inspect_ai 维护者的裁决同构（issue #1345，已读原文）：refusal 由 provider 的 `stop_reason="content_filter"` 表达，**正常返回 assistant message，不走错误通道**，"agents program explicitly around refusals and scorers take them into account"。

**C2. CLI exit code：grep 传统存在但被明确诊断为负资产（Confidence 高）**
- POSIX spec 三态：0=有选中行，1=无选中行，>1=错误。ripgrep #2500（已读原文，BurntSushi 亲自关闭为 wontfix）系统论证了 return 1 for no-match 的代价：`set -e` 与 `set -o pipefail` 下"no matches is a perfectly normal and successful result"却中断脚本，"scripts appear to work normally, but sometimes fail silently"。ripgrep/grep 保留它仅因 `-q` 存在性测试的历史契约锁死。
- 对 anysearch-cli 的映射：你们的 abstain 有两个可与 grep 类比的候选——(i) “域外无权限”≈ no match → exit 1；(ii) “查询成功执行、答案是拒答”≈ 正常输出 → exit 0。**证据支持 (ii)**：abstain 消息本身是给用户/宿主 agent 的有效输出（等价 grep 输出了零行但语义上 grep 的 -q 用例不存在于此），且 hook/plugin 宿主普遍把非零 exit 当作 hook 失败处理（fail-open 语义会把拒答吞掉，恰好制造你们要防的缺口）。若确需可编程区分，提供 `--strict` 或专用退出码文档，而非默认非零。

**C3. 搜索 API 空结果语义：全部走“结构化空 + 显式状态位”（Confidence 高）**
- Google Programmable Search：`items` 缺省/空数组即无结果，官方 demo 显式 `else: 'No Results.'`——空是 200 响应内的正常分支。
- You.com（已读原文 + SDK 指南）：`results.web`/`results.news` 为 optional 数组，官方要求 "An empty list should produce an explicit no-results state, not an invented answer or a crash. **Keep missing results separate from request exceptions in your metrics** so successful empty responses do not hide authentication failures." ——这句几乎就是你们双 audit 事件 + abstain 字段设计的工业注脚。其 LangChain 指南进一步要求返回 distinct "no results" 消息让 agent “rephrase or answer from knowledge, do not retry the same string”。
- LangChain：`ConversationalRetrievalChain.response_if_no_docs_found` 是检索空时的固定拒答参数——**abstain 是框架内建第一类返回值，不是异常**。
- LlamaIndex：零检索结果产生 "Empty Response" 正常返回（GitHub issue 佐证），社区课程将其归入 graceful degradation 与 error 分开处理。

**C4. refusal 的观测区分：provider 层已有先例（Confidence 中高）**
- inspect_ai：`stop_reason` 枚举含 `content_filter`，scorer/agent 直接编程该字段——refusal 在 transcript 数据结构里有专属槽位，与 `max_tokens`/error 并列。
- You.com 指南：metrics 中 "missing results" 与 "request exceptions" 必须分桶。映射到 ADR-0052 观测闭环：`retrieval.domain_filter.pre/post` 事件之外，abstain 应有一个独立可计数面（见下文 C6 建议），避免 abstain 计数混入 error 计数导致 SRE 式误报。

**C5. eval gate 的 refusal 断言写法（Confidence 高）**
- promptfoo：结构化断言 `is-refusal`（官方断言类型，用于 out-of-scope/unsafe 场景的正向断言）+ `llm-rubric` 泛用判分；其 search-rubric 文档还给出反向警示——拒答在“必须命中”的用例中应判 fail（"gracefully declines" ≠ 提供信息）。即：**must-abstain 与 must-hit 是同一 harness 里的两类显式断言，各写各的 golden**。
- inspect_ai：社区 scanner 模式 `is_refusal(assistant.text)` 直接作为 scorer；且维护者拒绝引入新抽象、编程既有结构化字段——**断言应锚定结构化 verdict 字段而非正文关键词**。
- 仓内既有形态（本地证据）：`packages/store/src/eval/abstain.ts` 已有三层判定（chain_empty → regex → llm judge，ADR-0054 D2/D3 observational-only），`eval-looks.json` 的 docs-g0007 已是 `expected: {verdict: "abstain"}` + `negative:abstain` 维度标签。golden 断言写法与 promptfoo/inspect_ai 惯例天然对齐：**`verdict:"abstain"` 为 must-abstain 断言；`mustHitHosts`+`minResults` 为 must-hit 断言；两者互斥成对出现在账本里**。注意仓内 REFUSAL_RE 关键词判定对中文拒答措辞有覆盖，但对结构化 abstain 输出应优先走 chain tier（域过滤为空 ⇒ 结构上必然 abstain），tier 3 LLM judge 仅留作 observational。

## 3) 对比矩阵：abstain 呈现形态的四个候选面

| 面 | 业界惯例 | 判定/计数语义 | 与 D-002 兼容性 | 推荐 |
|---|---|---|---|---|
| CLI stdout | Google CSE "No Results." / You.com 显式 no-results state | 正常输出，非 stderr 报错 | 兼容（audit 事件独立于呈现） | **一行结构化消息 + exit 0** |
| CLI exit code | grep/rg 传统 no-match=1，但被 rg 维护者确认为历史包袱、社区反复踩坑 | 非零会与真错误在宿主 fail-open 层混淆 | 兼容但有害 | **exit 0**；可编程区分走 flag 不走默认 |
| MCP/plugin 结构化字段 | MCP `isError:false` + 自有 structuredContent；inspect_ai stop_reason 槽位；LangChain response_if_no_docs_found | abstain 可被宿主 agent 程序化消费（rephrase/转域/告知用户） | 兼容（schema 加字段不动 policy） | **必须结构化，仅 audit 留痕不够** |
| audit/观测 | You.com：missing results 与 exceptions 分桶；inspect_ai content_filter 独立 stop_reason | abstain 计数独立于 error 计数 | **直接强化** D-002 双事件 | 双事件 + verdict 维度标签 |

## 4) a1/a2 与判据 1-5 逐条裁决

**a1 — CLI 呈现**：打印一行含 **domain、被过滤条数（pre/post 各自计数）、触发闸（pre-filter negotiated vs post-filter 兜底）** 的消息，例如 `abstain: no results within allowed docs domain(s) (pre-filtered 10, post-filtered 0)`；**exit 0**。理由：C1（abstain 是策略成功）+ C2（非零 exit 在宿主 fail-open 链路里会被当 hook 失败吞掉，恰好破坏你们修复的缺口本身；grep=1 的唯一不可替代用例 `-q` 存在性测试在检索 CLI 无对应物）。若未来有“脚本想知道是否拒答”的需求，加 `--fail-on-abstain` flag，别动默认。

**a2 — MCP/plugin 面**：**结构化 abstain 字段，判 structuredContent 路线**。`isError:false` + `structuredContent: { abstain: true, reason: "domain_filter_empty", domain: "docs", preFiltered: N, postFiltered: M }`。理由：MCP 规范对“模型可自我纠正的失败”要求放进 result 让 LLM 看见——abstain 消息正是宿主 agent 需要消费的信号（转答已知知识/告知边界/换域重试，对应 You.com 的 "do not retry the same string" 指令）；仅 audit 留痕则宿主 agent 只看到空结果，会按 C1/C3 证据中反复出现的失败模式行动（盲目重试或幻觉补答）。audit 事件照发（D-002 不动），但契约靠 schema 不靠日志。

**判据 1（域外探针 abstain + 双 audit 事件齐全）**：✅ 保留，作为 gate 的主断言。写法对齐 C5：断言 `verdict=="abstain"`（结构化，非关键词 regex——tier 2 regex 只作 observational 陪跑）且 pre/post 两事件均存在且字段齐全。
**判据 2（域内正常 + pre-filter 下发证据）**：✅ 保留。这是 must-hit 侧断言（`mustHitHosts`/`minResults` 形态已有先例 docs-g0008）+ pre 事件含下发域清单的证据断言。两判据成对防“过拒”（over-refusal，inspect_ai 社区测试套件明确把 over-refusal 作为独立测试类）。
**判据 3（Brave/AnySearch 降级 golden：capability=false + post-filter 兜住）**：✅ 保留。对齐 ADR-0053 Content Trust 的 fail-closed 语义；注意在 eval 里用 stub provider（ADR-0057 D4 既有机制）保证离线可跑，不依赖真降级。
**判据 4（冷门域 0 结果 golden 入 eval-looks）**：✅ 保留。与 D-002 完全一致；建议复用 docs-g0007 的账本形态（provenance.ref 指向真实 badcase 源），保持 bc→golden 晋升链路。
**判据 5（Tavily include_domains 泄漏实测 INJECT 式探针）**：✅ 保留且**升级为必做**。一手证据（Tavily changelog 2026-08，已读原文）：(i) `include_domains_mode:"boost"` 是官方支持的软模式，"results outside include_domains can still surface"；(ii) Research 端点的 include_domains 本身就是 soft preference；(iii) 子域匹配方向性有明确定义（filter 模式下列域含全部子域、列子域仅精确 host）。探针应测三点：默认 mode 是否等效 boost、子域是否被主域 include 覆盖、Research/搜索端点语义差异。结果入 INJECT Probe Suite 账本，作为 provider pre-filter 能力协商表（capability=false 时禁用该 provider 的 pre-filter、只信 post-filter）的实测依据。

**建议的缺项（判据 6 提案）——abstain 计数观测面**：C4 证据（You.com 分桶要求 + inspect_ai content_filter 独立槽位）指向一个 D-002 未覆盖的缺口：双 audit 事件只记录“过滤发生了”，但** abstain 率本身应作为独立可观测指标**（alert 维度：abstain 率突增 = policy 误配置信号，对应 over-refusal 测试类的运行时镜像）。建议在 ADR-0052 观测闭环里为 abstain 加一个维度标签（如 `outcome:abstain`），成本近零、闭合"refusal≠failure 计数分离"。

## 5) 与决策账本的冲突清单

**无冲突**。a1/a2 与判据 1-5 全部兼容 D-001（未触碰 npm 发布顺延）与 D-002（双闸、双事件、policy 单源、禁 site: 注入、冷门域 golden 全部保留）。唯一**扩展性建议**（非冲突）：a2 的结构化 abstain 字段与上述“判据 6"观测维度，属 D-002 之上的增量条款，若采纳建议以新 D-xxx 记录而非修订 D-002。另提示一处既有事实与判据的耦合：仓内 ADR-0054 已把 abstain smoke 定为 observational-only（never gates），而本轮判据 1 要求 abstain 进 eval gate——两者不矛盾（smoke 是行为探针、golden 是离线断言），但 ADR 行文应显式区分，避免被误读为推翻 ADR-0054 D2。

## 6) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | POSIX grep spec（EXIT STATUS 三态） | pubs.opengroup.org/onlinepubs/9799919799.2024edition/utilities/grep.html | Official | 2024 edition | exit 0/1/>1 语义一手规范 |
| 2 | grep(1) man page | man7.org/linux/man-pages/man1/grep.1.html | Official | 2026-09 | 0/1/2 三态交叉验证 |
| 3 | MCP Tools 规范 2025-11-25 | modelcontextprotocol.io/specification/2025-11-25/server/tools | Official | 2025-11-25 | isError 双层错误模型一手定义（已读原文） |
| 4 | ripgrep issue #2500 | github.com/BurntSushi/ripgrep/issues/2500 | Community/Criticism | 2023-04 | exit 1 for no-match 的系统批评 + wontfix（已读原文） |
| 5 | Tavily Changelog | docs.tavily.com/changelog | Official/Currency | 2026-08 | include_domains_mode boost/filter、子域匹配方向性、Research 软偏好（已读原文） |
| 6 | You.com Web Search API docs | you.com/docs/guides/search.md | Official | 2026 | 空结果显式状态、missing vs exceptions 分桶（已读原文） |
| 7 | promptfoo llm-rubric 文档 | promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric | Official | — | LLM judge 断言结构 pass/score（已读原文） |
| 8 | TMA Solutions: promptfoo metrics | tmasolutions.com/insights/llm-evaluation-metrics-in-cyber-security-outsourcing-services-with-promptfoo-framework | Comparative | 2025-07 | `is-refusal` 断言类型存在性佐证 |
| 9 | inspect_ai issue #1345 | github.com/UKGovernmentBEIS/inspect_ai/issues/1345 | Official/Community | 2025-02 | stop_reason="content_filter" 表达 refusal（已读原文） |
| 10 | inspect_scout custom scanner | meridianlabs-ai.github.io/inspect_scout/custom_scanner.html | Official | — | is_refusal() 作 scorer 的实现模式 |
| 11 | LangChain issue #13414 | github.com/langchain-ai/langchain/issues/13414 | Community | 2023-11 | `response_if_no_docs_found` 框架内建拒答参数 |
| 12 | langchainjs issue #3478 | github.com/langchain-ai/langchainjs/issues/3478 | Community | 2024 | 检索空→"I don't know" 直返模式 |
| 13 | ccaf-exam.guide MCP Integration | ccaf-exam.guide/docs/06-mcp-integration | Comparative | — | "valid empty result ≠ error" 四类错误分类表 |
| 14 | claudecertificationguide 2.2 | claudecertificationguide.com/learn/2-tool-design-mcp/2-2-structured-error-responses | Comparative | — | 空 resultCount:0 与 access failure 结构分野 |
| 15 | Google Programmable Search Element API | developers.google.com/custom-search/docs/element | Official | — | 官方 demo `else: 'No Results.'` 空分支 |
| 16 | Tavily-python issue #21 | github.com/tavily-ai/tavily-python/issues/21 | Community/Criticism | 2024 | include_domains 多域失败史（探针必要性旁证） |
| 17 | LlamaIndex graceful degradation（Neural Base） | theneuralbase.com/llamaindex/learn/advanced/graceful-degradation-when-retrieval-fails/ | Comparative | — | 空列表 len==0 显式检查 vs exception 分流 |
| 18 | LlamaIndex Empty Response issue（llama_deploy #250） | github.com/run-llama/llama_deploy/issues/250 | Community | 2024-09 | 零检索结果→"Empty Response" 正常返回语义 |

## 7) 信息缺口

1. **Perplexity API 无结果/拒答的一手文档形态未获得**（仅社区帖佐证 API 与 UI 行为差异）——若 anysearch-cli 未来接 Perplexity provider，判据 3 的降级 golden 需实测补位。
2. **DeepEval 官方 refusal 判据文档未抓到一手页**（搜索引擎仅返回二手转述）——对本报告结论无影响（promptfoo/inspect_ai 双源已足够支撑 C5），但如需三家 harness 对齐可后补。
3. **Google CSE `items` 缺省 vs 空数组的 spec 条文级区分**：现有一手证据仅到官方 demo 代码层面；对 anysearch 设计无实质影响（两者都归“结构化空"）。
4. **MCP 规范对空结果 + isError 的组合无明文**（规范只定义 isError 双层，空结果合法性由教程/集成指南确认）——a2 的 structuredContent 方案属规范允许的扩展区（`structuredContent?: { [key: string]: unknown }`），无标准阻力但无标准背书，属业界惯例而非协议强制。

继续此会话，运行：atomcode -p "…" --resume e78cb55e-3aa6-4399-b238-3b2d00f5aba8
