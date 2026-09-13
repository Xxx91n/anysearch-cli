[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
我先按研究模式发起三引擎、多角度的并行检索（官方/批评/社区/时效四类角度），再对高价值结果做全文核验。第一轮已覆盖 Harvey 官方、Langfuse/Braintrust/Oneuptime 等工程实践源。现在进入定点深挖：抓取关键原文，并补搜"低基率负例类别（弃答/归因/supersede）如何 bootstrap"这一核心缺口。第一轮广搜+首轮全文核验完成。现在补第二轮定点检索：专家批准真实输入（CRV）、dogfood 最小 golden 阈值、以及“被动负例占比过低如何覆盖”的专门证据。第二轮定点补齐：抓取 cold-start 生产日志转 eval、人工审核 golden、eval manifest 三篇原文完成核验配额。补两个定点搜索：用户点名的 CRV 与 annotation-lite 模式溯源，以及 Hamel Husain 式最小人工标注实践。第三轮验证性检索：验证"公开语料中真实用户提问"这一补充收割源在三个锚定源上确实存在（Stack Overflow / GitHub issue），并确认 MCP transport 变更类真实疑问。## Sufficiency Gate

searches: 12（web_search 4 / tavily 4 / anysearch 4）| angles: Official + Criticism + Community + Currency + Comparative | full reads: 6（Harvey、Langfuse、tianpan、Fireworks、Braintrust、Pranay manifest）| gaps: CRV"专家批准真实输入"原文未直接命中（以 Harvey ALR + Hamel benevolent dictator + Braintrust SME queue 三源等效覆盖）；首批条数区间依赖会话历史实际存量，本调研只读环境未逐一清点（标注为中置信）。

---

# Q5 调研报告：首批 golden "真实提问"来源

## 1) Tl;dr

**推荐 C（混合）**：A 作首批（量不限，现实区间 **8-14 条**），B4 滚动收割为常态来源。纯 B（骨架空跑）被否——B1 自己的验收判据（离线 golden CI 实跑、归因 URL 硬断言）在零 golden 时无法验收，且工业界一致结论是"tens of items"即可启动，不需要凑满 20。**需显式 revised 一处**：D-002 "首批 10-20 条八维切片"隐含"八维首批全收"，与真实流量中被动负例（弃答/supersede/注入）天然稀少的事实冲突——SQuAD 2.0 的 5 万条 unanswerable 全部是 crowdworker **编写**的（即 D-002 定义下的合成），这是领域基准级的先例证明：纯真实收割无法首批覆盖负例维度。**Confidence: 高**（推荐方向三源以上一致）；**中**（条数区间取决于会话历史实际存量）。

## 2) 分点结论

**结论 1 — 工业界 cold start 标准模式 = "小而真的种子集 + 生产失败滚动回灌"，而非"等量凑齐"**。
- Langfuse 官方指南（已全文核验）：起步 **20-50 条 reviewed items** 即可捕获 gross regression；PR gate 只需 tens 到 low hundreds；"coverage of distinct failure modes matters more than raw count: 100 diverse items beat 1000 near-duplicates"。构建顺序明确："real traces first, CSV imports and synthetic generation second"。
- Medium 实战文（已核验检索片段）：**20-30 条起步**，先端到端跑通 eval 管线再扩。
- tianpan（稀疏标注文，已核验检索片段）：种子集 **30-50 条人工标注**即显著优于随机大集。
- 对 D-002 的 10-20：落在工业区间内偏小端，**量本身不是问题**——问题是"八维首批全收"这个隐含承诺。

**结论 2 — Harvey 的真实模式与选项 B 的标签有出入，需澄清**。
已全文核验 Harvey 官方博客：因其隐私承诺"no one on our team sees real customer queries"，其 eval 集由 **ALR（嵌入团队的前执业律师）按真实使用模式出题**——即 Harvey 从来不是"等真实日志积累"（B 的描述），而是"专家批准的模式化真实输入"（更接近 CRV 模式）。这意味着：若按 Harvey 字面执行，ALR 出题在 D-002 字面下属"合成"。我们的处境**优于 Harvey**：会话历史、grill 账本、工作记录是自己的一手日志，无隐私壁垒，可逐字回溯收割——A 路径比 Harvey 的等效物更"真"。

**结论 3 — 被动负例（弃答/supersede/注入）在真实提问中占比过低是结构性事实，工业界两条出路都不违反"禁合成"的精神边界**。
- SQuAD 2.0（Stanford 官方论文，已核验检索结果）：50,000+ unanswerable 问题是 crowdworker 为模仿 answerable 而**编写**的——因为真实弃答类提问在语料内几乎不自然出现。强模型在 1.1 拿 86% F1，在 2.0 掉到 66%，证明这个维度必须测，但也证明它**不是收割来的**。
- 内容审核 golden 指南（Musubi，已核验检索片段）：明确给出两选一——"match real-world base rates" vs "intentionally overweight hard cases for stress testing"，且要求 **"document which approach you're using and why"**。八维切片本质是后者（intentional overweight），后果就是稀有维度需要主动获取渠道，而真实渠道只有三条：自有历史回溯（A）、生产回灌（B4）、外部真实问题语料（SO/GH issues）。
- Harvey review 算法文的"—"弃答机制（已全文核验）：弃答时解释"在哪里搜过、为何没找到"——与我们 D-002 的弃答+归因机制同构，说明弃答负例是真实测得的，但 Harvey 也是用 ALR 专门构造的题目集测它的。

**结论 4 — 纯 B（空跑）会让 B1 自己失明，且 dogfood 等真实日志成熟再启动有已知陷阱**。
- tianpan《Dogfooding Is Not an Eval Strategy》（已全文核验）：内部使用是 smoke test 不是 eval——团队"pre-corrects"自己的提问，系统性欠采样失败区。**但反过来也成立**：把 dogfood 阶段当作 golden 的等待期，等于把 smoke test 升格为唯一防线，两篇文章同指出该阶段 golden 空窗期产品完全无回归防线。
- B1 的验收 A1-A6 中"pack 真实装+离线 golden CI"与"归因 URL 硬断言"直接消费 golden——骨架空跑意味着 B1 验收要么虚设要么推迟，与 D-003 票序（B1 是 M1 里程碑）冲突。

**结论 5 — Fireworks 的 cold-start 解法恰好是 A 的可操作化版本**。
已全文核验：把已有日志（他们用生产 trace，我们用会话历史+社区真实提问）做语义聚类→分层采样→每簇取代表。对我们无需工具链，手动等价操作即可：把 Round-56~59 + MCP/TS/pnpm 工作中的真实技术疑问按八维意图归类，每类取真实出现过的代表问题。

**结论 6 — "缺失维度怎么记"：coverage manifest 是一等公民，不是条目字段**。
- Pranay Suyash《Your LLM Eval Set Needs a Manifest》（已全文核验）：eval set 需要 manifest 层元数据——每个维度/行为组的现状、known failure、expected route、regression risk；"A folder of test files is not an eval set"。
- matric-eval 开源项目（已核验检索片段）：设有"**deliberately deferred work**" roadmap 章节——缺口是显式声明的一等产物。
- 关键设计判断：deferred 是**集合级**属性（该维度暂无条目），不可能挂在不存在条目的字段上——所以必须是独立 manifest 文件/段落，而非 golden item 的 `deferred` 字段；条目级只放 dimension tag。

## 3) 对比矩阵

| 方案 | B1 验收可用性 | 负例维度路径 | 禁合成合规 | dogfood 偏差风险 | 工业界对应 |
|---|---|---|---|---|---|
| A 纯回溯首批 | ✅ 即时可用 | ❌ 被动负例大概率收不齐 | ✅ 全真源 | ⚠️ 专家-shaped（tianpan 警告） | Fireworks 冷启动 / Hamel error analysis |
| B 纯空跑+回灌 | ❌ A1-A6 验收失真 | ⏱ 唯一能自然收齐的路径 | ✅ | 低（等真实流量） | 无先例；Harvey 模式实为"专家出题"非空跑 |
| **C 混合** | ✅ 即时可用 | ✅ 首批实收能收的，manifest 声明 deferred，B4 滚动补 | ✅ | ⚠️ 同 A，须标 provenance | Langfuse/Braintrust 标准生命周期 |

## 4) 推荐输出

### 推荐：C（混合），含一处 D-002 revised

**Revised 显式化**：D-002 "首批 10-20 条按八维切片" → "首批 **8-14 条实收维度**（量不限、全真源）+ **coverage manifest 显式声明未收维度及入账触发**；10-20 作为 Round-60 收官（B4 回灌后）的存量目标而非 B1 上架门槛"。原记录保留，revised 理由：SQuAD 2.0 先例 + Musubi overweight-须-声明原则 + Braintrust "expected 空白条目是反模式"（反向推论：为了凑维度塞入经不起"为什么存在"追问的条目，比缺维度更有害）。

### 首批收割渠道（全真源，逐字可回溯）

1. **自有会话/grill 回溯**（A 主力）：Round-56~59 及 MCP/TS/pnpm 工作中真实提出的疑问。provenance 标 `internal-dogfood`。
2. **外部真实提问**（补 dogfood 偏差）：SO 上真实存在的 tsconfig 疑问（如 "Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7"、"moduleResolution bundler 与 TS4 不兼容"）、GitHub issues（如 modelcontextprotocol/python-sdk #2278 "Mark SSE transport as deprecated" 引发的一串真实迁移疑问）。这些是**逐字真实用户提问**，正好对冲 tianpan 指出的专家-shaped 盲区；SO/issue 页本身作 provenance 证据，归因断言仍指向 spec/tsconfig docs 一手 URL。
3. **B4 badcase 回灌**：常态来源，manifest 中每个 deferred 维度的入账触发。

### 首批条数现实区间：8-14 条

分维估计：意图五类正面 5-8（历史存量最厚）；中文查询 1-2（grill 历史本身中文，天然）；freshness/supersede 1-2（MCP SSE→Streamable HTTP 是已被 Reddit/GH issues 证实真实有人问的 supersede 事件）；claim 级归因 2-3（事实型问题天然携带）；多跳 0-1；**弃答 0-1**（仅当历史上真有超出 allowlist 语料的提问；大概率 0 → deferred）；**注入 0-1**（历史中真实注入尝试罕见 → deferred）。**低置信项**：实际存量需 B1 开工时逐条清点，此区间为结构性估计。

### B1 上架时"缺失维度怎么记"：coverage manifest（一等产物）

- 新增 `eval-looks.coverage.json`（或 eval-looks.json 内独立 manifest 段）：`{dimension, status: covered|deferred, count, harvest_source, entry_trigger, recorded_at}`。
- deferred 条目必须带**入账触发**（B4 回灌 / 真实弃答事件发生 / 真实注入尝试出现），挂到 D-004 已有的滚筒补录机制——不另造轮子。
- manifest 是诚实性小票：deferred ≠ covered，验收时按"声明了没有"而非"收齐了没有"打分——直接服务 D-001 的"反对自封完成"。

### 验收衔接

- **B1 spec**：附 coverage manifest 初版；golden 条目 schema 增 `provenance: {source_type: internal-session|external-community, source_ref}` 字段（全真源可回访）。
- **B1 AC 增补一条**：manifest 中每个 deferred 维度均有具名入账触发与责任票（B4）。
- **D-003 R1 分层裁定衔接**：deferred 维度不阻塞 B1 验收；online/真源校验只对已收条目生效。
- **G1 sunset 复核**：将 manifest 覆盖率（covered/八维）列入 Round-60 ADR 收官核对项；"两 round 无 golden 引用"的 D-004 出圈规则反向对 manifest 的 deferred 项同样生效（两 round 仍无法真实收割的维度，在 ADR 记录为 documented deferral，禁止为凑数转合成）。

## 5) 完整来源清单

| # | 来源 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Harvey: Rebuilding Review Algorithm | harvey.ai/blog/rebuilding-harveys-review-algorithm | Official | 2026-04-21 | ALR 模式全文核验；弃答"—"+reasoning 机制 |
| 2 | Langfuse: Golden dataset evaluation | langfuse.com/resources/engineering/golden-dataset-evaluation | Official | 2026（活跃） | 起步 20-50 条；real traces first；drift 维护 |
| 3 | tianpan: Dogfooding Is Not an Eval Strategy | tianpan.co/blog/2026/05/17/… | Criticism | 2026-05-17 | dogfood 偏差结构性论证；smoke test vs eval |
| 4 | tianpan: Evals from Sparse Annotations | tianpan.co/blog/2026-04-16-evals-from-sparse-annotations | Official/方法 | 2026-04-16 | 种子集 30-50；active learning 优先级 |
| 5 | Fireworks: Turning Production Logs into Evaluation Datasets | fireworks.ai/blog/… | Official | 2026-01-23 | 冷启动=聚类+分层采样已核验全文 |
| 6 | Braintrust: human review golden datasets | braintrust.dev/blog/human-review-golden-datasets | Official | 2026-05-21 | expected 空白反模式；SME queue 生命周期 |
| 7 | Pranay Suyash: Your LLM Eval Set Needs a Manifest | pranaysuyash.medium.com/… | Community/方法 | 2026-06-20 | manifest 一等产物模式 |
| 8 | SQuAD 2.0 (Rajpurkar & Jia, ACL 2018) | arxiv.org/abs/1806.03822 + nlp.stanford.edu/pubs | Official/学术 | 2018 | 5 万 unanswerable 均为编写 → 负例收割不可行性先例 |
| 9 | Musubi: Golden Datasets for Content Moderation | musubilabs.ai/blog/… | Community/方法 | 2026 | base-rate vs overweight 必须声明 |
| 10 | Hamel Husain: LLM Evals FAQ (Shreya Shankar) | hamel.dev/blog/posts/evals-faq/ | Community/权威 | 2025-05-28 | error analysis 先行；benevolent dictator |
| 11 | SO: baseUrl deprecated TS7 / moduleResolution bundler | stackoverflow.com/questions/79923194 等 | Community | 2025-2026 | 外部真实提问可逐字收割的证据 |
| 12 | GH: modelcontextprotocol/python-sdk #2278 等 | github.com/modelcontextprotocol/python-sdk/issues/2278 | Community | 2025-2026 | MCP supersede 类真实疑问存量证据 |
| 13 | matric-eval（integrolabs） | git.integrolabs.net/roctinam/matric-eval | Community | 2026 | "deliberately deferred work" 显式声明模式 |

## 6) 信息缺口

1. **CRV 原文**未直接命中（搜索引擎返回无关结果）；其"专家批准真实输入"主张由 Harvey ALR + Hamel + Braintrust 三源等效覆盖，但 CRV 本身措辞未经原文核验。
2. **首批条数上限 14 的上界**是结构性推算：实际取决于会话历史逐条清点，B1 开工首日应先做一次 30 分钟的 error-analysis 式清点（Hamel 建议的 50-100 trace 审视在本场景可降为 ~100 条会话消息扫描）。
3. Round-56~59 账本中可收割提问的**逐条清单**未在本轮产出（只读模式 + 属 B1 开工工作）——建议作为 B1 spec 附表的第一个任务项。

继续此会话，运行：atomcode -p "…" --resume 10cc1097-cfad-4521-995e-4233b7303a19
