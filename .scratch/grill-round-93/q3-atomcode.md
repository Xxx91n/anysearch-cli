# Q3 atomcode 调研归档 — R93 票序+commit 结构

时间戳: 2026-09-30 | 题面: .scratch/grill-round-93/q3-prompt.txt | 命令: atomcode -p

## 1) 执行摘要（Tl;dr）

**Confidence：高**（结构判断有工业先例强支撑；纯本仓惯例判断属项目内裁定，标注为推断）。工业界对「熔断触发后走替代路径还是终止」有成熟双态心智模型：**circuit-breaker 触发 fallback（降级继续）vs fail-fast（终止）取决于 fallback 是否有业务可用的替代品**——对应 R93 的 T-B：r88-candidate 开庭议程是一个**已预注册的真实替代路径**，所以 T-B 应取「熔断→fallback」形态而非「熔断→终止」形态。条件票纯度问题上，GitHub Actions / Azure Pipelines 的正解是：**把条件的求值（T0 定死 TC、T2 判词）与条件触发的工作体分离**——T-B 保持「登记+议程」两个纯记账动作、不含任何无条件工作，即是干净的；a放任何「顺手做」的内容才违反纯度。

## conditional job dependency GitHub Actions Azure gates

### ① T-B 条件转向票：结构是否干净？

**结论：结构干净，但必须锁死为「双态记账票」，禁止携带实施工作。Confidence：高。**

- **正据 1（熔断器双态语义）**：工业界 circuit breaker 的核心纪律是「breaker 保护的是调用者」；open 后的出路是 (a) 预定义 fallback（degraded but functional）或 (b) fail-fast 终止——但「fallback 必须是业务决策预先定好的，不能 open 之后再发明」（CodeBegun/Talent500/Dev.to 多源交叉）。R93 的 D-001/D-002 已经**预注册**了 r88-candidate 开庭议程，所以 T-B 的转向不是「open 之后现场发明 fallback」，完全符合先例。
- **正据 2（条件求值与工作体分离）**：GitHub Actions `needs` + `if:` 语义——上游失败时下游默认跳过，除非显式 `failure()` 条件；Azure 同构（`condition: failed()`）。工业惯例中「failure-triggered job」被广泛接受为合法结构，**前提是该 job 内容是预声明的**（post-mortem、notification、rollback）。社区共识（GitHub 社区 issue 长讨论）也指出了陷阱：`always()` 会连 cancelled 都触发——映射到 R93：T-B 的触发条件必须是「链尽判词成立」这一**显式判词**，不能写成「T2 未绿就触发」（否则环境违规/429 也会错误触发转向——这正是 D-002 里 429=环境违规不计 N 条款的意义）。
- **反驳论据（诚实的风险面）**：T-B 本身是「条件+转向」双态，工业反例是「failure-handler job 变成垃圾桶」——一旦 T-B 里塞了任何「开庭准备工作」之外的实质内容（如顺手起草开庭文书），它就变成隐藏的无条件工作。守门方式：T-B 的 commit 类型 docs、内容白名单=①F-bug 登记（defer 条目）②轮内启动开庭议程（议程文本引用预注册条款，不现场拟新措辞）。这与你仓里 R92 Q3 已裁决的「条件票不带立法不现场拟措辞」纪律同构。
- **一个结构改进建议**：GitHub/Azure 的做法是把「成功路径下游」和「失败路径下游」写成**两个都挂在同一上游上的条件票**（`succeeded()` / `failed()`），而不是让失败票从成功票内部派生。映射：T-B 应显式声明 `needs: T2`，且 T3/T4（成功路径条件票）的触发条件里要写「T2 绿且 T-B 未触发」——否则会出现 Azure 文档警告的经典 bug：中间票 skipped 时下游求值状态混乱（Azure `succeeded()` 在上游 skipped 时返回 false，导致整链静默跳过）。**建议在 ADR-0094 里显式写明 T3/T4/T-B 三张条件票的求值谓词各自独立于 T2 判词，避免「T-B 触发后 T3 是否还算数」的歧义。**
- **信息缺口**：未找到直接讨论「fallback 分支与主分支 commit 粒度隔离」的专门文献；本仓 Bridge-Retirement 独票纪律（R90）+两源熔断语义是我能给出的最强组合证据。

### ② T4 机器腿取证：独立票 vs 并入 T3/T6

**结论：保持独立条件票（现状正确），但加一条「README 未改时的 shadow-run 兜底」。Confidence：高。**

- **正据**：工业 pipeline 惯例中，「新产物首次真实验证」是独立 gate 而非顺带动作——GitHub/Azure 的 condition 语义本质就是「每个 gate 有独立可跳过的求值身份」。R92 Q3 调研（知识库召回，batch:atomcode-r92-q3）已裁决：接线成功需要一次非阻塞 shadow/dry-run 取证，防止脚本 bug 潜伏到下轮。这个裁决直接适用于 R93：**T4 独立票 + README 真改动时升格为天然标的实测，未改时 T2/T3 期间做 shadow-run**。
- **并入 T3 的反驳**：T3 是 docs 类型（README 誊抄），T4 是 evidence 类型——一票一 commit 类型不混是你们已验证的纪律，并入即混型。**并入 T6 的反驳**：T6 收口批已是全轮最重的票（ADR 完成体+词块+registry+轮报+CHANGELOG+锚定修复+词汇归一），再塞机器腿取证会稀释焦点、且失败时没有独立回滚单元——违背 Bridge-Retirement 粒度纪律。
- **反驳论据（反向）**：T4 独立票在 README 未改场景下会变成空壳票。解法不是合并而是**条件内容二态预注册**：README 改→真跑取证；未改→shadow-run+挂账 R94，两种态都产出 evidence 工件，票永远不空。这与 D-001 预注册④「rider 链条件化」同构。
- **信息缺口**：无——本仓两轮先例（R92 Q3 裁决+ADR-0092 两拍立法）已闭环。

### ③ 锚定纪律立法修复并入 T6：是否稀释收口票焦点？

**结论：并入 T6 可接受，但要在 T6 commit message 内以子清单显式分节，且 R92 审计挂账的另三项应做差异化处置。Confidence：中高。**

- **正据**：工业界 postmortem 的「Readiness 阶段」惯例：复盘产出的 action items 在下一个发布周期统一收口（Rootly 指南：postmortem 输出变成 actionable items 进入下轮）。锚定纪律修复是 R92 审计发现的文档修复（docs 性质、无行为风险），与 T6 的「完成体+词块+CHANGELOG」同为 docs 归档性质，同票合理。
- **反驳论据**：T6 已经过载——提案里塞了 9 项。ADR-0029 的 scope discipline 说「due chores ship as separate refactor commits」——**但注意：一票一 commit 的「票」与「commit」在本仓纪律中是否同物？**若 T6 允许多 commit（同类型 docs），则锚定修复独立成 commit 即可，焦点稀释问题消解于 commit 层而非票层。建议：T6 内部 commit 序列为 ①ADR-0094 完成体 ②CONTEXT 词块+registry ③closeout-claims+轮报+终态戳 ④CHANGELOG ⑤锚定纪律修复（R92 挂账清偿）⑥常驻债词汇归一——每 commit 独立可 revert。
- **风险项**：R92 审计挂账的「CI-only 强制令 vs 本机门禁证据效力口径」是**待用户裁定项**——这不是文档修复，是规则制定，**不应混入 T6**，应走 d7 挂项处置（见⑤）。
- **信息缺口**：本仓 commit-per-ticket 与 commit-per-unit 的精确映射惯例，需查 .scratch/grill-round-93 内现有批注确认。


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: policy-sunset, circuit-breaker, fallback-model, bridge-retirement, atomcode-r92-q3, commit-per-ticket, commit-per-unit, reauthorization, launchdarkly, grill-round-93, regulatorycouncil, r88-candidate, comparative, ballotpedia, criticism, community, anysearch, microsoft, provision, fail-fast, pipelines, succeeded, changelog, deprecate, ship-gate, atomcode, official, currency, incident, deadline, circuit, breaker, skipped, general, release, tavily, claude, always, readme, devops

### ④ sunset 条款（r88-candidate，R95 前强制开庭）：hard deadline 还是 rolling？

**结论：维持 hard deadline（R95 前强制开庭），搭配「提前一轮预通知」。Confidence：高。**

- **正据 1**：Wikipedia + Ballotpedia 交叉：sunset 条款工业级有效性取决于「过期后默认失效 + 续期需主动行动（reauthorization）」的反向默认；rolling sunset（Texas/Colorado 式定期复审）的经典缺陷是「复审变橡皮图章——多数条款以无修改或化妆性修改续期」（Wikipedia 引 Kouroutakis/Davis 两学术源）。r88-candidate 的死刑复核若用 rolling（每轮可开可不开），会精确复刻这个反例：**永远「这轮忙，下轮再开」**。
- **正据 2**：regulatorycouncil 政策日落最佳实践：sunset 日期必须配「提前通知 + 指定 owner + 文档留痕」。映射到 R93：建议 ADR-0094 在 r88-candidate sunset 条款里加「R94 收口批必须将 R95 开庭列入 registry 挂账并点名 owner」——即**触发条件=条件票（R95 T-B 同构）+预通知义务（R94 挂账）**的双保险。
- **反驳论据**：hard deadline 的已知缺陷（Wikipedia）：自动过期会降低法律确定性、可能绕过长期约束。映射风险：若 R93/R94 主轴仍深陷 L3 修复，R95 被迫开庭可能打断修复线。缓解：开庭≠翻案——sunset 触发的是**议程**（comprehensive review），维持现状也是合法判词之一（「维持 sunset」本来就是复审三种结果 reaffirm/revise/retire 之一）。
- **反例证据（rolling 的失败面）**：Ballotpedia 引 Mercatus 2015——35 州立 general sunset law，但实际被裁撤的机构极少；即 rolling 复审的存续率天然接近 100%，正是 r88-candidate 这种「方向性疑案」最怕的结局。
- **信息缺口**：软件行业（非立法领域）内 sunset 执行的工程化先例偏少，多为 feature-flag deprecation（LaunchDarkly kill-switch 模式——永久布尔旗+设计期预定义 fallback 行为），可作为 deprecate 三型枚举立法时的参照（AWS DevOps Agent 博客明确要求 kill-switch 立法时写明「flag 关掉后 fallback 路径是什么」——映射：deprecate 权限三型枚举里应补「每型的 fallback 行为」字段）。

### ⑤ d5/d7 挂项处置惯例

**结论：d5 默认纯备准（现状正确）；d7 本轮裁定优于顺延，但裁定形式应为 T1 立法内一小节而非独立票。Confidence：中。**

- **d5（deprecate 权限到位否，未答默认纯备准）**：与 R92 Q3「无权限纯备准」裁决一致；增强建议如④——三型枚举每型补 fallback 行为字段，使 R96 真执行时无歧义。
- **d7（CI-only 强制令 vs 本机门禁证据效力）**：**反对顺延**。理由：这是「证据效力口径」问题——证据口径不定的状态下，T2/T7 产出的 evidence 在未来轮次的审计中效力存疑，属于**本应由用户裁定、但已拖过一轮的开放项**。工业惯例（Azure gates、release train 排期护栏）：护栏规则的模糊性应在下一次规划窗口（=本轮 T1）内消除，而非带着模糊继续跑。**但**裁定本身是规则制定——推荐放 T1（ADR-0094 内一节「证据效力口径」）而非 T6，理由同②：立法先于行为，且不稀释收口票。若用户缺席裁定，则默认保守口径（本机门禁证据=advisory 不=blocking）并显式登记下轮复核，避免静默默认。
- **信息缺口**：d7 的两个选项各自的技术可行性（CI 上跑 ship-gate 的成本）本报告未调研——这是仓内事实问题，建议 grill 面询时补一个「CI 跑 ship-gate 的历史耗时数据」再裁定。

## sunset hard deadline enforcement

## 3) 对比矩阵

| 项 | 工业先例形态 | R93 提案现状 | 推荐处置 | 备注 |
|---|---|---|---|---|
| T-B 转向票 | `failed()` 条件 job（GH/Azure）+ 预定义 fallback（熔断） | 条件转向票，双态 | 保留；内容白名单=登记+议程；显式声明与 T3/T4 的互斥谓词 | 触发谓词必须含判词，防 429 误触发 |
| T4 机器腿 | 独立 gate（condition 语义）+ shadow-run 先行 | 独立条件票 | 保留独立；预注册 README 改/未改两态产出 | 未改时 shadow-run+挂账 |
| 锚定修复入 T6 | postmortem action item 下轮收口 | 并入 T6 | 保留并入；T6 内多 commit 分节 | CI-only 裁定（d7）不并入 |
| r88-candidate sunset | hard sunset + 主动 reauthorization（立法模式） | R95 前强制开庭 | 维持 hard deadline；R94 加预通知义务 | rolling 反例：橡皮图章存续率~100% |
| d5/d7 | 挂起项需 owner+日期+复审机制 | d5 默认备准、d7 待裁定 | d5 维持；d7 本轮 T1 内裁定，缺席则保守默认+登记 | 证据口径影响本轮 evidence 效力 |

## 4) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Using jobs in GitHub Actions（官方） | docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs | Official | 常青 | `needs`+`if` 失败/跳过传播语义原文 |
| Azure Pipelines conditions（官方） | learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions | Official | 2025-10-27 | `failed()/succeeded()/always()` 正式谓词+skipped 连锁 bug 警告 |
| Circuit Breaker Pattern（CodeBegun） | codebegun.com/learn/microservices/resilience/circuit-breaker-pattern | Official/教学 | 2026-07-15 | fallback 须预定义、breaker 保护调用者、三态语义 |
| Policy Sunset（GRC glossary） | regulatorycouncil.org/glossary/policy-sunset | Official | 常青 | sunset=触发复审而非自动删除；owner+提前通知+留痕最佳实践 |
| Sunset provision（Wikipedia） | en.wikipedia.org/wiki/Sunset_provision | Criticism | 动态 | rolling 复审橡皮图章反例；自动过期降低确定性 |
| Sunset provision（Ballotpedia） | ballotpedia.org/Sunset_provision | Comparative | 常青 | 35 州 general sunset law 实际裁撤率极低（Tavily 引用） |
| SRE Incident Management 2026（Rootly） | rootly.com/sre/guide-sre-incident-management-best-practices-2026 | Currency | 2025-12-14 | 五阶段 lifecycle、postmortem→action item 下轮收口惯例 |
| DCC Incident Management Policy（GOV.UK PDF） | assets.publishing.service.gov.uk/...Annex_E | Official | — | Problem 关闭三条件：permanent fix / acceptable workaround / 停止调查——「降级+议程」惯例的政府级文本 |
| Resilience patterns（Dev.to, GeeksforGeeks, groundcover） | dev.to/frosnerd/... 等 | Community | 2019–2026 | 熔断+fallback 组合的多源交叉验证 |
| LaunchDarkly kill-switch docs | launchdarkly.com/docs/home/flags/killswitch | Official | — | kill-switch=永久旗+预定义 fallback 行为（AnySearch 引用） |
| R92 Q3 裁决报告（本仓知识库） | ctx batch:atomcode-r92-q3 | 本仓 | 2026-09-29 | T4 shadow-run 先例、条件票纪律先例 |

### atomcode-q3
# atomcode-q3

$ cd <repo-root> && atomcode -p "$(cat .scratch/grill-round-93/q3-prompt.txt)"

我先召回知识库，再启动三引擎多角度检索。知识库已命中 R92 Q3 同源报告。启动第一阶段广泛搜索（角度标签：Official / Criticism / Comparative / Community）。继续第二阶段定点深挖：事故管理惯例与 sunset 执行反例。补足配额：再深挖事故管理惯例与 kill-switch/功能开关的「就地降级+转向」先例。Sufficiency Gate 自查：searches: 7（web_search×2、tavily×2、anysearch×3）| angles: Official / Comparative / Criticism / Community / Currency 全五类 | full reads: 6（docs.github.com、learn.microsoft.com、Wikipedia sunset provision、regulatorycouncil policy-sunset、CodeBegun circuit-breaker、Rootly incident guide）| gaps: release-train 排期护栏一手 SAFe 文档未深读、Claude Code fallback-model 链生产实践仅摘要、kill-switch 文档未全文打开。

## 5) 信息缺口（汇自各节）

- fallback 分支与主分支 commit 粒度隔离无专门文献（本仓 Bridge-Retirement 独票纪律+熔断语义为最强组合证据）。
- 本仓 commit-per-ticket 与 commit-per-unit 精确映射惯例待查批注。
- d7 两选项的 CI ship-gate 耗时数据未调研（仓内事实，grill 面询补）。
- 软件行业内 sunset 工程化先例偏少（LaunchDarkly kill-switch 为最近似）。
