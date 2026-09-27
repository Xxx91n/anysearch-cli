## R87 Q1 调研报告：发布收口 vs 裁量清障 vs 战略重议

**Sufficiency Gate**： searches: 9（AnySearch batch×5 + AnySearch 单发×2 + Exa×2）| angles: Official（npm docs 系/PostHog/Beefed 引 DORA·Fowler·SRE）+ Comparative（canary vs smoke、deployment vs release）+ Criticism（staged-not-shipped 风险、kill-criteria 缺失症）+ Community（Reddit 被人机墙拦截，已换 MindTheProduct 补位）+ Currency（MindTheProduct 2026-09、flaviocopes 课程现行版）| full reads: 6 篇原文全文 + 知识库 3 组历史调研命中（R63 发布收口判据、R81 Q5、backlog/DoR 心智模型）| gaps: Tavily 引擎额度耗尽（三引擎降为双引擎，关键结论均以 ≥2 独立信源补偿）；Reddit 原文被人机验证墙挡（未读，不引用其内容）；「npm unpublish 后 latest 仍是坏版」的具体止血惯例（deprecate/dist-tag）本轮未深挖，列为缺口。

## post-publish

### atomcode > 3) 候选对比矩阵
### 3) 候选对比矩阵

| 项 | 工业界判据评估 | 与 D-001~D-005 冲突 | 推荐度 |
|---|---|---|---|
| **A′ 发布收口轮**（A 修订） | 完全吻合五阶段清单的 execution+post-release 形态；post-publish 实物验证有 flaviocopes/R63 双源支撑；顺收项属 retrospective 记账惯例 | **无冲突**（详见第 4 节） | ★★★★★ |
| B 裁量清障轮 | F-6 混排违反一轮一主题；「等授权」=已知毒药留架（registry latest=0.0.8 公开可装），无 hidden 前提 | 不冲突但**违背 D-005 T0-T6 票序精神**（票序把发布排在最前） | ★★ |
| C 战略方向轮 | 判据未触发即重开 goalposts，mindtheproduct 点名反模式；无「闭环前重议」先例 | 与 **D-004** prefer-capable 具名重开条件**隐性冲突**：重开条件未满足即重议方向，架空预承诺判据 | ★（问题合法、时机错误，顺延至 R88） |

### atomcode > 2) 分点结论（附来源与交叉验证） (1)
### 2) 分点结论（附来源与交叉验证）

**2.1 发布授权与发布前 gate 的成熟心智模型**
- LaunchDarkly 五阶段 25 步清单中，「release execution」阶段就是「pre-deployment checks → 执行 → initial validation → 全量 → 通知」一条直线，**不与治理/重构任务混排**；post-release 是独立第 21–25 步（监控、验证、复盘）。【LaunchDarkly，已全文读】
- Promotion pipeline 的铁律：「通过 QA 的 artifact 必须就是部署到生产的同一个 artifact，绝不中途重建」——对应本仓 D-005 的「v0.1.0 钉版就位后不再动包」。【Exa 检索 promotion-pipeline 文，摘要级，与 LaunchDarkly/beefed.ai 引用的 DORA「immutable artifact + promotion gates」互证】
- 本仓现状恰好是教科书形态：ship-gate 门绿、artifact 钉版、只差最后一步「授权→推」。工业界对这种状态的标准动作就是收口，而不是往同一轮里塞别的事。

**2.2 发布后验证（A 主线的后半段）**
- 「`npm publish` 返回成功不是最终证明；registry 上的 artifact 和一次从 npm 的净机安装才是」——发布后验证必须从 registry 拉取，测的是「registry 端到端分发正确」，与发布前测「pack 产物正确」是**两个不同事实**。惯例动作：净机 temp 目录安装、`npm view <pkg> version dist-tags` 复核、tarball integrity sha512 前后比对、发布后等 replication 再冒烟。【flaviocopes publish-and-verify，已全文读；与知识库 R63「post-release 三段论」调研互证】
- Smoke test 定位：发布后立刻跑的「最关键功能二值通过/失败」检查，与 canary（真实流量渐进放量）**是先后关系不是替代关系**。对本仓这种 CLI 包发布，canary 维度不存在（npm 包无流量切片），**post-publish 实物验证（拆包验 /mcp 端点、陌生人安装路径、install-smoke 对已发布件）就是 smoke 层的全部职责**——A 主线设计的验证面恰好全覆盖。【Unleash canary vs smoke，已全文读】
- 交叉验证：flaviocopes（实务课）与知识库 R63 报告（npm unpublish 政策、registry 不可变事实源）对「registry 是最终事实源」结论一致。

**2.3 「staged but not shipped」的库存风险（这是压倒 B 的关键判据）**
- 工业界把「部署了但未发布」当作**受控的中间态**来管理（feature flag/dark launch），其前提是：(a) 有 flag 随时可放行或回滚；(b) 中间态**不对公众可见**。而 npm 包的 staged 态不同：**你无法把 v0.1.0 「半发布」**——registry 上的 latest 仍是 0.0.8，其 tarball 内含已被实测测绘证明 404 的 /v1/search 死端点。这比 PostHog 语境更糟：PostHog 的 unreleased 代码藏在 flag 后面，而本仓的「毒药」**已经公开在货架上被任何人 `npm install`**。【PostHog decouple-deployment-from-release，已读原文（raw 抓取成功）；Etsy「deployed but unreleased for weeks」对照说明其前提是 hidden，本仓不满足】
- 发布轮 cadence 文献（release train）：train 的价值在于「把 scope/risk 决策在最后一公里之前变得显性、可见、可审计」——刻意不载客的列车会退化成「藏拙的 backlog 瓶颈」。B 候选让毒药继续留架一轮，正是「已知风险货物滞留站台」的反模式。【beefed.ai release-train-orchestration，已读全文含 Sources 引 DORA/Fowler/SRE】


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: staged-not-shipped, publish-and-verify, post-publish, decouple-deployment-from-release, release-train-orchestration, prefer-capable, retrospective, kill-criteria, install-smoke, launchdarkly, deployment, comparative, unreleased, 2026-09-10, criticism, promotion, immutable, dist-tags, atomcode, official, pipeline, artifact, adr-0029, 2026-09, tarball, 陌生人安装路径, unleash, feature, sources, netflix, tavily, reddit, staged, launch, 具名重开条件, prereg, reopen, airbnb, batch, 发布收口轮
### 5) 最终推荐：A′（A 的修订版）

**主线不变**：用户授权 → v0.1.0 tag push + npm publish → 发布后实物验证（npm 拉真实 tarball 拆包验 /mcp 端点在列、dsh-plugin 陌生人安装路径、install-smoke 对已发布件、npm view dist-tags/integrity 复核）→ registry/CHANGELOG/ADR 收口。

**修订三处**：
1. F-3 裁量收敛为「改判据表述」单选，不把三选一整包带入轮内议程（减少一轮内的开放决策点，符合发布轮最小扰动）。
2. F-6 refactor 候场不进本轮——立项为 R88 独立 refactor 轮候选（或与 C 的方向重议轮按 ADR-0029 分轮排布）。
3. 预留 registry 止血小项：发布 0.1.0 后对 0.0.3–0.0.8 做 npm deprecate（标注死端点、指向 0.1.0）。这是本次调研的缺口外推（未深挖 deprecate 惯例原文），故仅作候选项由用户裁定，不作硬票。

**理由分层**：
- 调研支持的结论：发布后验证三段论（双源）、staged-not-shipped 无 flag 前提下不构成安全中间态（PostHog+beefed）、发布轮不混排工程项（LaunchDarkly+beefed）、预承诺判据未触发不得重开（mindtheproduct）。
- 我的推理：NO-GO 是裁决线信号而非发布阻断（从 D-004 健康闸/裁决线分离条款推出）；F-3 选「改判据表述」的三选一裁决；deprecate 止血项；C 顺延至 R88 的具体排布。

### 6) 信息缺口

- Tavily 引擎额度耗尽（三引擎降为双引擎，关键结论均以 ≥2 独立信源补偿）。
- Reddit 原文被人机验证墙挡（未读，不引用其内容）。
- 「npm unpublish 后 latest 仍是坏版」的具体止血惯例（deprecate/dist-tag）本轮未深挖，列为缺口——故 deprecate 项仅作候选。

### 7) 来源清单

1. Release management checklist (LaunchDarkly) launchdarkly.com/blog/release-management-checklist/ — 五阶段 25 步全清单；execution/post-release 分离；retrospective 记账惯例（全文读）
2. Canary release vs smoke testing (Unleash) getunleash.io/blog/canary-release-vs-smoke-test — 发布后 smoke 与 canary 的先后关系（全文读）
3. Publish and verify (Flavio Copes npm course) flaviocopes.com — 「publish 成功≠最终证明」；净机安装+npm view+integrity 复核惯例（全文读）
4. The case for kill criteria (MindTheProduct) mindtheproduct.com — kill/reopen 判据四要素；goalposts 不可移动；80% kill 率先例（全文读）
5. Decouple deployment from release (PostHog) posthog.com — staged 态安全的前提=hidden/flag；Netflix/Etsy/Airbnb 先例（raw 全文读）
6. How to Run a Reliable Release Train (beefed.ai) — train 载客纪律；不载客列车退化为 backlog 瓶颈；引 DORA/Fowler/SRE（全文读含 sources）
7. Promotion pipeline / release architecture（Exa 摘要级） — immutable artifact、promotion gates 铁律
8-10. 知识库命中：R63 发布收口判据调研 / R81 Q5 npm 发布形态 / DoR-DoD 与 release readiness 心智模型
