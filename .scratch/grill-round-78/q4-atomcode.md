# R78 Q4 — atomcode 深调研存档（票序设计）

Date: 2026-09-22. Prompt: ./q4-prompt.txt

## 调研日志

# atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-78/q4-prompt.txt)"

我先召回知识库，再启动三引擎外部调研。知识库未命中本主题，启动三引擎联网调研。Tavily 配额已耗尽，改用 web_fetch 深读 + AnySearch 作第三引擎。现在打开关键原文并补齐缺口查询。SAFe 原文需登录，改用第三方详述源补证。继续定点深读并补缺口查询（错过时间窗教训、依赖驱动排序）。再补两路定点深读：依赖驱动排序惯例与「错过窗口」教训。发现与项A直接相关的 48 小时 cooldown 一手资料，深读补证。配额自查：searches: 12（web_search×4 + Tavily×2[配额拒绝，换 AnySearch 兜底×6]）| angles: Official / Comparative / Criticism / Currency / Community 全五类 | full reads: 6（scaledagile.com、kanbantool.com、kaizenko.com、agilehour.org、stepsecurity.io、pnpm.io）+ 3 个长文 artifact 索引 | domains ≥ 10 | 缺口：Tavily 引擎未参与交叉验证（配额耗尽），「错过窗口的知名教训」无单一标志性 case（用 Kanban intangible→expedite 机制 + NX/cooldown 供应链案例侧证）。

## 1) 执行摘要

三个工作项构成教科书式的 WSJF 场景：项A 同时吃满「Time Criticality（48h 窗口 = 硬性外部截止）+ RR/OE（实验产出是 B、C 的决策输入）+ 小 Job Size（纯取证不提交代码）」三项，WSJF 得分必然最高；Kanban 视角下项A 属「Fixed-date / 窗口衰减型 CoD」——错过窗口不是价值递减而是**价值归零**，属最优先处理类别；项C 依赖 A/B 结果，依赖驱动排序直接后置。唯一要防的是 A 以「spike」名义无限膨胀——必须严格 timebox 在窗口内。

## 2) 分点结论

**① WSJF 对「时效窗口收窄类」的裁决：Time Criticality 主导，A 排第一。**
- SAFe 官方定义 WSJF = CoD/Job Size，CoD = 用户业务价值 + Time Criticality + RR/OE（framework.scaledagile.com/wsjf，已读原文，正文需登录但定义段完整可引）。
- Time Criticality 的典型触发就是「fixed deadline / market window」：错过不是渐进损失而是惩罚性损失（climbtheladder.com：*"Failing to deliver a highly time-critical item can result in permanent loss"*；kaizenko.com 90 天合规案例中 TC 打 13 分独占鳌头，已读原文）。
- 项A 特殊在**三项同时高**：TC=窗口关闭即标本失效（永久错过，要等下次上游发版）；RR/OE=A 的产出是 B/C 的证据输入；Job Size=纯取证、零代码提交，极小。CoD 大 / Size 小 → WSJF 必然居首。
- 警示（Criticism 角度）：WSJF 的已知缺陷是 *doesn't account for dependencies*（kaizenko 原文明言）——这正支持把 C 后置，而非把 B 提前：B 对 A 无依赖。

**② Kanban class of service：「过期即失效」= Fixed-date 衰减型，优先于 Standard。**
- kanbantool.com（已读原文）：Fixed-date CoS 的特征是「date on which the economic impact shoots up」，入场政策应 *enforce early commitment*；四类中 Fixed-date/Expedite 均优先于 Standard（B）与 Intangible（C 的债登记册部分）。
- 该文还给出关键反直觉点：Standard 项最大的威胁是「被伪紧急事项系统性挤占」——但 A 不是伪紧急，其 CoD 曲线是真实的悬崖型。
- 依赖裁决惯例：Kanban 里 Fixed-date 项 *uses up planned slack*，Standard 项 *preserves throughput*——即标准做法是用富余产能/空档做标准项（B），把确定性的紧急窗口让给 A。

**③ 依赖驱动 vs 价值驱动冲突：evidence-before-action 胜出，C 锁死最后。**
- WSJF 本身不管依赖（两源一致：kaizenko、ituonline），业界惯例是依赖映射必须叠加在 WSJF 之上（*Dependency mapping has to happen alongside WSJF scoring*）。
- C 的内容显式依赖 A 与 B 的结果（你的设定），属于典型的「上游产出是下游输入」——无论价值打分多高，依赖链决定它只能在最后。这与本仓库 ADR-0029 的 grill-round 惯例也吻合：ADR 收口在证据落地之后。
- B 与 A 无相互依赖，B 排第二是「A 等待窗口内不能空转」的填充排序（若 A 取证与 B 可并行人手，B 可并行启动；单人串行则 A→B）。

**④ Spike 先行的工程惯例：先取证后决策是标准打法。**
- agilehour.org（已读原文）：spike 的存在理由是 *"buy clarity fast, before uncertainty turns into rework"*；spike 的合法终点是「a decision you can act on in the backlog」——A 的产出（闸对 repin 拦截行为的取证）直接决定 B 的 lint 判定器怎么写和 C 的 ADR 写什么。
- LogRocket/SAFe 两源一致：spike 输出应转化为 backlog 变更与决策记录；SAFe 把 spike 归入 RR/OE 分量——**A 的 RR/OE 高分不是自我美化，是公式设计的本意**。
- Pre-mortem/Mountain Goat（搜索确认，原文超时未读，标为中等置信）：pre-mortem 属「先推演失败再动手」家族，与 spike 同属「降低不可逆决策风险」的先行类工作。它们排在实施前，因为**此时改方案的成本最低**。
- 本仓库自身先例：R72 T0 spike report（ctx_search 命中）就是「先取证、产出证据目录、再决策」的既有实践，A 与之一脉相承。

**⑤ 票据粒度：一行配置加固挂进 B 的主题票，单独 commit。**
- Atomic commit 惯例（github.com/yonatangross/orchestkit atomic-commit.md，已读 artifact）：*Feature + config change → Different review concerns → Separate unless config IS the feature*。B 的场景恰是「config IS the feature」（一行配置加固是 lint 判定器重构的加固腿），同一票、**独立 commit**（`chore:`/`fix:` 与 `refactor:` 分开），满足「一个 commit 一个可独立 revert 的逻辑变更」与「and 测试」。
- 挂进 C（文书票）则违反 commit 语义纯度：functional change 不混入 docs commit——Conventional Commits 的类型分离（feat/fix/chore vs docs）即为此设（nrdxp predicate commit-hygiene skill，artifact 已索引）。
- 即：**一票（主题：lint 判定器加固），三 commits（refactor 重构 / fix 存量清理 / chore 配置行）**，C 另立 docs-only 票。

**⑥ 「错过窗口导致验证永久延期」的教训与反向先例：**
- 直接同构案例（高置信）：**npm 供应链 cooldown 机制**——StepSecurity 的 NPM Package Cooldown Check（已读原文）与 pnpm `minimumReleaseAge` 官方文档（已读原文）都以 48h/24h 发布龄期为闸。你的项A 验证的正是这个机制，且实验标本「发布未满 48h 的版本」本身就是稀缺资源——**过了窗口，标本自动「毕业」，验证被迫永久延期到下次上游发版**。这不是假设性教训，是这个领域的工作方式本身。
- Kanban 文献的机制性教训：intangible/deferred 项的 CoD 曲线「flat right until it suddenly isn't」，延期常以更高代价的 expedite 收场（kanbantool 原文）；固定日期类错过截止是「penalty, not missed opportunity」（kaizenko）。
- 未找到单一的「错过验证窗口永久延期」标志性 named case（诚实缺口）；但上述两源机制 + WSJF 的 TC 定义（*permanent loss of potential revenue*，climbtheladder）三方侧证结论一致：时敏窗口型工作后置的代价是经济学上公认的最大排序错误类别。

## 3) 对比矩阵

| 项 | CoD 曲线形态 | Kanban CoS | WSJF 关键分量 | 依赖 | 排序 |
|---|---|---|---|---|---|
| A 受控实验（48h 窗口） | 悬崖型：窗口关闭价值归零 | Fixed-date（近 expedite） | TC 高 + RR/OE 高 + Size 小 | 无（B/C 依赖它） | **1** |
| B lint 重构+清理+配置 | 线性温和 | Standard | 价值中、TC 低 | 无（依赖 A 的结论才开工更稳） | 2 |
| C 文书收口 | 平坦直至依赖解除 | Intangible→固定 | 价值高但不可先行 | 依赖 A+B 结果 | 3（最后） |

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-78/q4-prompt.txt)"

我先召回知识库，再启动三引擎外部调研。知识库未命中本主题，启动三引擎联网调研。Tavily 配额已耗尽，改用 web_fetch 深读 + AnySearch 作第三引擎。现在打开关键原文并补齐缺口查询。SAFe 原文需登录，改用第三方详述源补证。继续定点深读并补缺口查询（错过时间窗教训、依赖驱动排序）。再补两路定点深读：依赖驱动排序惯例与「错过窗口」教训。发现与项A直接相关的 48 小时 cooldown 一手资料，深读补证。配额自查：searches: 12（web_search×4 + Tavily×2[配额拒绝，换 AnySearch 兜底×6]）| angles: Official / Comparative / Criticism / Currency / Community 全五类 | full reads: 6（scaledagile.com、kanbantool.com、kaizenko.com、agilehour.org、stepsecurity.io、pnpm.io）+ 3 个长文 artifact 索引 | domains ≥ 10 | 缺口：Tavily 引擎未参与交叉验证（配额耗尽），「错过窗口的知名教训」无单一标志性 case（用 Kanban intangible→expedite 机制 + NX/cooldown 供应链案例侧证）。

### 推荐排序：A（时效实验）→ B（lint 重构）→ C（文书收口）——Confidence：高 > 2) 分点结论 (2)
**⑤ 票据粒度：一行配置加固挂进 B 的主题票，单独 commit。**
- Atomic commit 惯例（github.com/yonatangross/orchestkit atomic-commit.md，已读 artifact）：*Feature + config change → Different review concerns → Separate unless config IS the feature*。B 的场景恰是「config IS the feature」（一行配置加固是 lint 判定器重构的加固腿），同一票、**独立 commit**（`chore:`/`fix:` 与 `refactor:` 分开），满足「一个 commit 一个可独立 revert 的逻辑变更」与「and 测试」。
- 挂进 C（文书票）则违反 commit 语义纯度：functional change 不混入 docs commit——Conventional Commits 的类型分离（feat/fix/chore vs docs）即为此设（nrdxp predicate commit-hygiene skill，artifact 已索引）。
- 即：**一票（主题：lint 判定器加固），三 commits（refactor 重构 / fix 存量清理 / chore 配置行）**，C 另立 docs-only 票。

**⑥ 「错过窗口导致验证永久延期」的教训与反向先例：**
- 直接同构案例（高置信）：**npm 供应链 cooldown 机制**——StepSecurity 的 NPM Package Cooldown Check（已读原文）与 pnpm `minimumReleaseAge` 官方文档（已读原文）都以 48h/24h 发布龄期为闸。你的项A 验证的正是这个机制，且实验标本「发布未满 48h 的版本」本身就是稀缺资源——**过了窗口，标本自动「毕业」，验证被迫永久延期到下次上游发版**。这不是假设性教训，是这个领域的工作方式本身。
- Kanban 文献的机制性教训：intangible/deferred 项的 CoD 曲线「flat right until it suddenly isn't」，延期常以更高代价的 expedite 收场（kanbantool 原文）；固定日期类错过截止是「penalty, not missed opportunity」（kaizenko）。
- 未找到单一的「错过验证窗口永久延期」标志性 named case（诚实缺口）；但上述两源机制 + WSJF 的 TC 定义（*permanent loss of potential revenue*，climbtheladder）三方侧证结论一致：时敏窗口型工作后置的代价是经济学上公认的最大排序错误类别。

## 排序

### 推荐排序：A（时效实验）→ B（lint 重构）→ C（文书收口）——Confidence：高 > 3) 对比矩阵
## 3) 对比矩阵

| 项 | CoD 曲线形态 | Kanban CoS | WSJF 关键分量 | 依赖 | 排序 |
|---|---|---|---|---|---|
| A 受控实验（48h 窗口） | 悬崖型：窗口关闭价值归零 | Fixed-date（近 expedite） | TC 高 + RR/OE 高 + Size 小 | 无（B/C 依赖它） | **1** |
| B lint 重构+清理+配置 | 线性温和 | Standard | 价值中、TC 低 | 无（依赖 A 的结论才开工更稳） | 2 |
| C 文书收口 | 平坦直至依赖解除 | Intangible→固定 | 价值高但不可先行 | 依赖 A+B 结果 | 3（最后） |

## 4) 来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Extended Guidance – WSJF (SAFe 官方) | framework.scaledagile.com/wsjf/ | Official | WSJF 定义与四分量，Reinertsen 引语 |
| WSJF Prioritization Method – CLIMB | climbtheladder.com/what-is-wsjf-… | Official/批评 | TC 定义「permanent loss」、game 防范 |
| WSJF and Cost of Delay – Kaizenko | kaizenko.com/wsjf-and-cost-of-delay-… | Official/对比 | 合规案例打分表、**WSJF 不管依赖**的明文局限 |
| Classes of Service & Work Item Types – Kanban Tool | kanbantool.com/kanban-guide/classes-of-service | Official | 四类 CoS 全文、CoD 曲线形态、失败模式表 |
| Class of Service in Kanban – AgileFever | agilefever.com/… | Comparative | Reinertsen W18、CoS 动态迁移（intangible→fixed→expedite） |
| Spike Work in Agile – AgileHour | agilehour.org/blog/spike-work-in-agile-… | Official/Community | spike 先行理由、验收=可行动决策、Kanban 中 spike 作 CoS 管理 |
| Agile Spike Stories – LogRocket | blog.logrocket.com/product-management/agile-spike-stories/ | Community | spike 防返工、timebox 纪律 |
| Atomic Commit Rules – orchestkit | github.com/yonatangross/orchestkit/…/atomic-commit.md | Official(社区规范) | *Feature+config → separate unless config IS the feature*、and-测试 |
| Commit Hygiene SKILL – predicate | github.com/nrdxp/predicate/…/commit-hygiene/SKILL.md | Community | Conventional Commits 类型分离、逻辑边界提交 |
| NPM Package Cooldown Check – StepSecurity | stepsecurity.io/blog/introducing-the-npm-package-cooldown-check | Currency | 48h cooldown 闸、NX 供应链案例、**与项A 同构的时效窗口** |
| Mitigating supply chain attacks – pnpm 官方 | pnpm.io/supply-chain-security | Official | `minimumReleaseAge`（默认 1440min）——本仓库治理域的一手文档 |
| Pre-Mortem – Scrum.org / Mountain Goat | scrum.org/…（fetch 超时，搜索确认） | Official | pre-mortem 先行惯例（中等置信，原文未读） |
