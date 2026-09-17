# q4-atomcode.md — R68 Q4 调研原文存档

来源：ctx_batch_execute atomcode 单跑 2026-09-17 + 后续 ctx_search 节取回。

---

Executed 1 commands (128 lines, 16.2KB). Indexed 15 sections. Searched 4 queries.

## Commands

- atomcode: `cd /d/Aworker/anysearch-cli && atomcode -p "Research round 4 for the anysearch-cli repo — ticket-sequence design for round R68 (theme: repo-writing-automation gating + antigravity secondary ticket, per ledger D-001/D-002/D-003). DECIDED SCOPE: (T0) fire-fix red main — looks-ledger.ts must round-trip root schema_version sentinel + eval-abstain.test.ts:32 needs excludeGroups, then get real double-green ci+ship-gate run URLs; (T1) dual-layer release gate — pre-tag job self-waits via two-phase check…`

## Indexed Sections

- atomcode (1.6KB)
- R68 研究报告（模式：default） (0.0KB)
- R68 研究报告（模式：default） > 1) 执行摘要（Tl;dr） (0.8KB)
- R68 研究报告（模式：default） > 2) 分点结论 (0.0KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (a) schema-versioned ledger 防丢字段：三模式对比（Confidence：高，双引擎+双源） (2.2KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (b) 不烧生产预算演练 release gate（Confidence：高） (2.3KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (c) fire-first 排序（Confidence：高，三源一致） (1.0KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (d) R68 是否产出 postmortem 文档（Confidence：中） (1.0KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (e) F-17 family sweep 方法论（Confidence：高） (1.3KB)
- R68 研究报告（模式：default） > 2) 分点结论 > (f) 缺失票检查 (0.7KB)
- R68 研究报告（模式：default） > 3) ALTERNATIVES 评估 (0.7KB)
- R68 研究报告（模式：default） > 4) 过度/不足 scope 诚实标示 (0.7KB)
- R68 研究报告（模式：default） > 5) 最终推荐序列（含理由一行） (0.2KB)
- R68 研究报告（模式：default） > 6) 完整来源清单 (2.8KB)
- R68 研究报告（模式：default） > 7) 信息缺口 (0.8KB)

## schema versioned file round trip preserve unknown fields

### R68 研究报告（模式：default） > 2) 分点结论 > (a) schema-versioned ledger 防丢字段：三模式对比（Confidence：高，双引擎+双源）
### (a) schema-versioned ledger 防丢字段：三模式对比（Confidence：高，双引擎+双源）

| 模式 | 代表实践 | 优点 | 缺点 | 适用 |
|---|---|---|---|---|
| **preserve-unknown-fields（写端宽容）** | Fowler Tolerant Reader；K8s `x-kubernetes-preserve-unknown-fields: true`；CRD conversion webhook 官方要求 "preserve all unknown fields, dropping silently corrupts data" | 向后兼容、字段零丢失 | 需要单一代码路径读数据；容忍可掩盖 producer bug（arc42 点名 enum 静默默认风险） | **单写者读写同一 JSON 文件 — 推荐** |
| **teach-each-field（严格 schema 绑定）** | K8s 默认 field pruning；结构性 schema | 防脏数据入库 | 正是 F-17 的成因：每次加字段都要改读写代码，漏改即静默丢字段 | 多写者、需防未知数据污染的 API |
| **version-in-schema-string 单写者** | Avro/Schema Registry 兼容性规则（backward/forward/full compatibility，知识库已索引） | 演进有正式协议 | 对单文件 ledger 是重炮；需 registry 基础设施 | 多消费者跨服务 |

**关键交叉验证**：Kubernetes 官方文档（已抓原文）确认 v1 CRD 默认 **prune** 未知字段，必须显式 `x-kubernetes-preserve-unknown-fields: true` 才保留——即业界对"存储数据"的默认是**显式选择保留策略**，而非 Postel 宽容。Kubebuilder 文档同样确认 "By default the apiserver drops unknown fields from the request payload during the decoding step"。

**对本仓库的建议**：looks-ledger / eval-looks.json 是**单写者单文件**，修复应是组合拳：
1. **读端保留未知字段**（raw JSON merge-back，而非重建对象）——Tolerant Reader 原则，"only one bit of code reads data payloads"；
2. **schema_version 哨兵 round-trip 测试**作为契约测试（T0 已定）——对应 arc42 的 "contract tests run against current and previous producer schemas"；
3. 不需要 Avro 式 registry（over-engineering for a single file）。
**单一信源警示**：arc42 页面同时警告宽容读端会掩盖 rename 类 breaking change——所以 round-trip 测试必须断言**未知字段逐字节保留**，不能只断言"能读"。

### R68 研究报告（模式：default） > 6) 完整来源清单
## 6) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Tolerant Reader — Martin Fowler | martinfowler.com/bliki/TolerantReader.html | Official/原则 | 2011-05 | Postel's law 对存储数据的适用性 + "单一读端代码路径" 原则 |
| 2 | Extend the Kubernetes API with CRDs — k8s.io | kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions | Official | 持续更新 | 默认 prune 未知字段、`x-kubernetes-preserve-unknown-fields` 显式保留机制 |
| 3 | Tolerant Reader — arc42 Quality Model | quality.arc42.org/approaches/tolerant-reader | Criticism | 2026-07 | 宽容读端的反面：rename 静默漂移、contract test + 字节级保留验收 |
| 4 | test-publish.yml (rac-core) | github.com/itsthelore/rac-core/blob/main/.github/workflows/test-publish.yml | Community/实践 | — | "Same gate as the real release… the rehearsal proves the gate too" 镜像 rehearsal 模式（404 on fetch，摘要级） |
| 5 | publish.yml (featurely) | github.com/gperdrizet/featurely/.../publish.yml | Community/实践 | — | `test_pypi` rehearsal 分支模式、tag-last 顺序 |
| 6 | TESTING-LOCALLY.md (eSheet) | github.com/mieweb/eSheet/blob/main/.github/workflows/TESTING-LOCALLY.md | Community/实践 | — | act + 合成 event + throwaway tag + artifact 留痕的 "gate verified" 证据形态 |
| 7 | Wait for workflow — GitHub Marketplace | github.com/marketplace/actions/wait-for-workflow | Official/工具 | v1.3.0 | SHA 过滤两阶段轮询、conclusion 校验、timeout/fallback、workflow_run 替代方案对比 |
| 8 | Postmortem Culture — Google SRE Workbook | sre.google/workbook/postmortem-culture | Official | — | postmortem 触发原则与文档结构 |
| 9 | SRE postmortem best practices — incident.io | incident.io/blog/sre-incident-postmortem-best-practices | Comparative | 2026-03 | artifact vs meeting 区分、action items with owners |
| 10 | Incident Management That Works — ScaledByDesign | scaledbydesign.com/blog/incident-management-that-works | Community | 2026-05 | "Mitigate first" 规则清单、SEV-1 才强制 postmortem |
| 11 | Incident Triage and Prioritization — ADHDecode | adhdecode.com/reliability-engineering/incident-management/incident-triage-and-prioritization | Criticism | 2026-03 | containment > diagnosis、mitigation > root cause |
| 12 | ast-grep tool comparison / HN | ast-grep.github.io/advanced/tool-comparison.html + news.ycombinator.com/item?id=38590984 | Comparative | 2023-10 | 结构化 bug-class 扫描 vs 文本 grep 的方法论定位 |
| 13 | CRD Versioning & Conversion Webhooks — Medium | medium.com/@rameshavutu/crd-versioning-conversion-webhooks... | Community | — | "Dropping unknown fields silently corrupts data"（摘要级，未全文抓取） |

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research round 4 for the anysearch-cli repo — ticket-sequence design for round R68 (theme: repo-writing-automation gating + antigravity secondary ticket, per ledger D-001/D-002/D-003). DECIDED SCOPE: (T0) fire-fix red main — looks-ledger.ts must round-trip root schema_version sentinel + eval-abstain.test.ts:32 needs excludeGroups, then get real double-green ci+ship-gate run URLs; (T1) dual-layer release gate — pre-tag job self-waits via two-phase check…

我将按照研究流程执行：先召回知识库与本地台账上下文，再三引擎联网调研六个板块，最后给出排序建议。知识库已召回相关历史（looks ledger、gate rehearsal 教训、D-001..D-003 对照）。现在启动联网三引擎调研（阶段一：广泛搜索）。阶段一第二批：补齐剩余角度（fire-first 排序、check-runs 两阶段轮询、同类 bug 扫描方法论）。阶段二：定点深挖——打开 6 个关键原文核验。继续阶段一/二：补足 fire-first 与 postmortem、轮询 pattern 的原文核验。补一轮 (e) 板块的定向搜索（bug-class 扫描工具方法论），然后综合输出。**Sufficiency Gate**: searches: 8（web_search×3 / tavily×3 / anysearch×2）| angles: Official、Comparative、Criticism、Currency、Community 全五类覆盖 | full reads: 6 成功原文（Fowler、K8s 官方、SRE Workbook、wait-for-workflow、incident.io、arc42 释义；rac-core 404 已换源）| gaps: act 本地模拟对"带 preregistered budget 的内部 gate"的可信度只有单一信源级证据；T3 外部不确定性无公开可引材料。

## rehearse release workflow without production cost

### R68 研究报告（模式：default） > 2) 分点结论 > (b) 不烧生产预算演练 release gate（Confidence：高）
### (b) 不烧生产预算演练 release gate（Confidence：高）

业界四种 rehearsal 模式（均已核验原文或完整 raw content）：

| 模式 | 证据 | 烧真实预算？ | 对 R68 可用性 |
|---|---|---|---|
| **镜像 rehearsal workflow**（workflow_dispatch，跑同一 gate 但写 TestPyPI/无副作用） | rac-core `test-publish.yml`（"Same gate as the real release… the rehearsal proves the gate too"）、featurely `publish.yml`（`test_pypi=true` 分支） | 否 | 可借鉴：为 pre-tag gate 写一个 dispatch-able 镜像 job |
| **本地 act 模拟** | eSheet TESTING-LOCALLY.md（`gh act workflow_dispatch -e synthetic-event.json` + throwaway tag + rehearsal-event artifact，"no permanent tag, no DB write"） | 否 | 适合 T1 的 dry-run：合成 event payload 打轮询逻辑 |
| **synthetic event + artifact 留痕** | 同上，throwaway tag run 25636378426 留 rehearsal-record artifact | 否 | **"gate verified" 证据标准 = 绿 run URL + 留痕 artifact**，与本仓库 handoff 术语完全同构 |
| **首跑即验收** | 上述仓库均承认 rehearsal ≠ 真实路径（真实 index/真实 tag 才是终极验证） | 是（一次性） | 与本仓库"defer full live exercise to next real pre-tag"一致——**这是惯例而非妥协** |

**交叉验证**：GitHub Marketplace wait-for-workflow（已抓原文）确认两阶段轮询的工业形态：REST API 按 `sha` 过滤 + `status: completed` + `conclusion ∈ allowed-conclusions`，且明确列出 `workflow_run`/`check_run` 事件驱动是替代方案但"noisier, harder to bind to a specific commit"。int128/wait-for-workflows-action 补充 rate-limit 警示（建议 PAT 而非默认 token）。**对 T1 的直接启示**：固定 SHA 过滤是对的；需注意 (i) warm-up 延迟（run 可能未注册，wait-other-jobs 有 startupGracePeriod 概念）、(ii) 超时 + fallback（wait-for-workflow 无内建 timeout，用 step-level timeout-minutes）、(iii) rate limit（轮询间隔 ≥30s）。

**"gate verified" 证据标准**（综合）：绿 run URL + 合成/真实 event 的留痕记录 + 显式声明验证边界（"dry-run verified; first live exercise at next real pre-tag"）。T1 的验证策略合规且是业界常态，但**必须写进 T2 的 lint 检查项**——这正是 T2 存在的理由。

### R68 研究报告（模式：default） > 6) 完整来源清单
## 6) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Tolerant Reader — Martin Fowler | martinfowler.com/bliki/TolerantReader.html | Official/原则 | 2011-05 | Postel's law 对存储数据的适用性 + "单一读端代码路径" 原则 |
| 2 | Extend the Kubernetes API with CRDs — k8s.io | kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions | Official | 持续更新 | 默认 prune 未知字段、`x-kubernetes-preserve-unknown-fields` 显式保留机制 |
| 3 | Tolerant Reader — arc42 Quality Model | quality.arc42.org/approaches/tolerant-reader | Criticism | 2026-07 | 宽容读端的反面：rename 静默漂移、contract test + 字节级保留验收 |
| 4 | test-publish.yml (rac-core) | github.com/itsthelore/rac-core/blob/main/.github/workflows/test-publish.yml | Community/实践 | — | "Same gate as the real release… the rehearsal proves the gate too" 镜像 rehearsal 模式（404 on fetch，摘要级） |
| 5 | publish.yml (featurely) | github.com/gperdrizet/featurely/.../publish.yml | Community/实践 | — | `test_pypi` rehearsal 分支模式、tag-last 顺序 |
| 6 | TESTING-LOCALLY.md (eSheet) | github.com/mieweb/eSheet/blob/main/.github/workflows/TESTING-LOCALLY.md | Community/实践 | — | act + 合成 event + throwaway tag + artifact 留痕的 "gate verified" 证据形态 |
| 7 | Wait for workflow — GitHub Marketplace | github.com/marketplace/actions/wait-for-workflow | Official/工具 | v1.3.0 | SHA 过滤两阶段轮询、conclusion 校验、timeout/fallback、workflow_run 替代方案对比 |
| 8 | Postmortem Culture — Google SRE Workbook | sre.google/workbook/postmortem-culture | Official | — | postmortem 触发原则与文档结构 |
| 9 | SRE postmortem best practices — incident.io | incident.io/blog/sre-incident-postmortem-best-practices | Comparative | 2026-03 | artifact vs meeting 区分、action items with owners |
| 10 | Incident Management That Works — ScaledByDesign | scaledbydesign.com/blog/incident-management-that-works | Community | 2026-05 | "Mitigate first" 规则清单、SEV-1 才强制 postmortem |
| 11 | Incident Triage and Prioritization — ADHDecode | adhdecode.com/reliability-engineering/incident-management/incident-triage-and-prioritization | Criticism | 2026-03 | containment > diagnosis、mitigation > root cause |
| 12 | ast-grep tool comparison / HN | ast-grep.github.io/advanced/tool-comparison.html + news.ycombinator.com/item?id=38590984 | Comparative | 2023-10 | 结构化 bug-class 扫描 vs 文本 grep 的方法论定位 |
| 13 | CRD Versioning & Conversion Webhooks — Medium | medium.com/@rameshavutu/crd-versioning-conversion-webhooks... | Community | — | "Dropping unknown fields silently corrupts data"（摘要级，未全文抓取） |

### R68 研究报告（模式：default） > 2) 分点结论 > (f) 缺失票检查
### (f) 缺失票检查

| 检查项 | 结论 |
|---|---|
| **T0 缺 sweep 验收项** | 补进 T0 完成定义（见 (e)），不新开票 |
| **T1 缺 rate-limit/warm-up/timeout 设计点** | 补进 T1 票描述（三处实现细节，wait-for-workflow 文档明确列出） |
| **T4 缺 lesson log 条目** | 知识库召回的 ticket-30 教训要求 T1 dry-run 结果留痕——补进 T4 |
| **postmortem 独立票** | 不需要（见 (d)），ADR-0069 承担 |
| **rehearsal 镜像 workflow 票** | 不需要——dry-run 打已 concluded SHAs 已覆盖核心逻辑路径；真实 dispatch 镜像属于 next real pre-tag 时的顺手产物，pre-register 会违反"不烧 OF look"约束的边界 |
| **T5 closure** | 无异议 |

## ticket sequence recommendation verdict

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research round 4 for the anysearch-cli repo — ticket-sequence design for round R68 (theme: repo-writing-automation gating + antigravity secondary ticket, per ledger D-001/D-002/D-003). DECIDED SCOPE: (T0) fire-fix red main — looks-ledger.ts must round-trip root schema_version sentinel + eval-abstain.test.ts:32 needs excludeGroups, then get real double-green ci+ship-gate run URLs; (T1) dual-layer release gate — pre-tag job self-waits via two-phase check…

我将按照研究流程执行：先召回知识库与本地台账上下文，再三引擎联网调研六个板块，最后给出排序建议。知识库已召回相关历史（looks ledger、gate rehearsal 教训、D-001..D-003 对照）。现在启动联网三引擎调研（阶段一：广泛搜索）。阶段一第二批：补齐剩余角度（fire-first 排序、check-runs 两阶段轮询、同类 bug 扫描方法论）。阶段二：定点深挖——打开 6 个关键原文核验。继续阶段一/二：补足 fire-first 与 postmortem、轮询 pattern 的原文核验。补一轮 (e) 板块的定向搜索（bug-class 扫描工具方法论），然后综合输出。**Sufficiency Gate**: searches: 8（web_search×3 / tavily×3 / anysearch×2）| angles: Official、Comparative、Criticism、Currency、Community 全五类覆盖 | full reads: 6 成功原文（Fowler、K8s 官方、SRE Workbook、wait-for-workflow、incident.io、arc42 释义；rac-core 404 已换源）| gaps: act 本地模拟对"带 preregistered budget 的内部 gate"的可信度只有单一信源级证据；T3 外部不确定性无公开可引材料。

### R68 研究报告（模式：default） > 2) 分点结论 > (f) 缺失票检查
### (f) 缺失票检查

| 检查项 | 结论 |
|---|---|
| **T0 缺 sweep 验收项** | 补进 T0 完成定义（见 (e)），不新开票 |
| **T1 缺 rate-limit/warm-up/timeout 设计点** | 补进 T1 票描述（三处实现细节，wait-for-workflow 文档明确列出） |
| **T4 缺 lesson log 条目** | 知识库召回的 ticket-30 教训要求 T1 dry-run 结果留痕——补进 T4 |
| **postmortem 独立票** | 不需要（见 (d)），ADR-0069 承担 |
| **rehearsal 镜像 workflow 票** | 不需要——dry-run 打已 concluded SHAs 已覆盖核心逻辑路径；真实 dispatch 镜像属于 next real pre-tag 时的顺手产物，pre-register 会违反"不烧 OF look"约束的边界 |
| **T5 closure** | 无异议 |

### R68 研究报告（模式：default） > 2) 分点结论 > (c) fire-first 排序（Confidence：高，三源一致）
### (c) fire-first 排序（Confidence：高，三源一致）

- ScaledByDesign 事故管理文（已抓摘要+规则清单）："Rule 1: Mitigate first, root cause later. Stop the bleeding"——T0 在最前无争议。
- ADHDecode（已抓）："In the heat of the moment, the goal is containment. Not diagnosis… mitigation comes before resolution because restoring service is more urgent than understanding root cause."
- **验证基础设施票的排位**：共识是 resolution（永久修复）在 mitigation 之后、postmortem/预防之前，但**"gate 修复其守护的缺陷"这一特例**——工业惯例是 gate 紧跟修复（T1 随 T0），因为 gate 未修期间同类事故可再发。本仓库 T0(修复)→T1(gate)→T2(lint 防再犯) 的梯度恰好是 mitigation→resolution→prevention 的教科书顺序。
- 知识库召回的本地教训佐证：EgressAPIKEY 的 ticket-30 rehearsal 失败教训（force-push 使 pin 失效）说明**真实演练要留教训日志**——T1 的 dry-run 结果应记入 WORKFLOW.md 式 lesson log。

## sweep same-class bugs methodology

### R68 研究报告（模式：default） > 2) 分点结论 > (e) F-17 family sweep 方法论（Confidence：高）
### (e) F-17 family sweep 方法论（Confidence：高）

**Read-modify-write 丢字段站点的系统性找法**（FindBugs 论文传统 + ast-grep/semgrep 结构化搜索，HN 讨论已核验两者定位）：
1. **结构化搜索**（ast-grep/semgrep，非文本 grep）：找所有 `JSON.parse(...)` → 对象展开/重建 → `writeFile` 的管线；本仓库可用 AST pattern 如 `$OBJ = { ...固定字段列表 }` 后接写盘。
2. **数据驱动验证**：对每个 ledger/golden 文件，diff "磁盘上实际字段集" vs "代码里 writer 构造的字段集"——磁盘上有而 writer 不构造的字段 = 潜在受害者。这比静态扫描更可靠（运行时证据）。
3. **excludeGroups 同类**：测试文件缺 excludeGroups 的扫描 = grep 所有加载 golden/config 的测试文件，检查是否传递相同的过滤参数——这类是**参数传递链断点**，用 trace_callers 找 `excludeGroups` 消费点的全部上游。

**建议落点**：sweep 作为 **T0 的完成定义一部分**（不是独立票）——修一处不查同类是 anti-pattern（FindBugs 论文的核心论点：bug 是 class 不是 instance）。但把 sweep 范围**限定在 `eval-looks.json` / golden 文件的读写管线 + 测试加载链**，不扩散到全仓库（scope discipline, ADR-0029：一个 grill round 一个主题）。

### R68 研究报告（模式：default） > 2) 分点结论 > (d) R68 是否产出 postmortem 文档（Confidence：中）
### (d) R68 是否产出 postmortem 文档（Confidence：中）

- Google SRE Workbook（已抓原文）：postmortem 触发无硬性 SEV 门槛，原则是"prevent repeat outages"，written well + acted upon + widely shared。
- incident.io（已抓原文，2026-03 更新）：post-mortem 是 artifact，review 是 meeting，"the artifact should exist before the meeting starts"；结构 = summary/timeline/root cause/impact/action items with owners and due dates。
- ScaledByDesign Rule 5："Every SEV-1 gets a post-mortem… No exceptions"——但 red main + 丢字段不是 SEV-1（无生产事故，是 process/quality bug family）。
- **建议**：**不产出独立 postmortem 文档**（over-scoping），但 F-17 family 的 **sweep 结果（(e) 板块）+ T1 验证边界声明应作为 D-D 记录进 ADR-0069 + ADR 决策台账**——即用本仓库既有的 ledger 机制承担 postmortem 职能，而非新文档类型。若 sweep 发现第二处同类 bug，则升级为独立记录（说明 bug class 有系统性成因，值得 blameless 叙事）。

### R68 研究报告（模式：default） > 4) 过度/不足 scope 诚实标示
## 4) 过度/不足 scope 诚实标示

| 方向 | 判定 |
|---|---|
| T1 dry-run 验证策略 | **合理不足**（intentional under-scope）——业界承认 rehearsal ≠ live，但**验证边界必须显式入账**（T4/ADR-0069），否则违反本仓库 honesty 原则 |
| 独立 postmortem 文档 | **会过度**——用既有 ADR/ledger 机制即可 |
| 全仓库 sweep | **会过度**——限定 F-17 class 的数据管线+测试加载链 |
| Avro 式 schema registry | **明显过度**——单文件单写者 |
| **不足处**：T0 sweep 发现 N>1 处时的处理 | 当前未定义——建议 T0 票内预先写明"N>1 → F-17 family 升级为 T0 内追加修复项，仍不扩轮" |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: schema_version, workflow_run, test_pypi, looks-ledger, excludegroups, x-kubernetes-preserve-unknown-fields, test-publish, testing-locally, scaledbydesign, wait-for-workflow, round-trip, comparative, conversion, kubernetes, eval-looks, marketplace, conclusion, containment, mitigation, two-phase, bug-class, criticism, community, featurely, throwaway, adhdecode, diagnosis, ticket-30, atomcode, official, proposed, tolerant, dropping, silently, corrupts, registry, contract, fallback, mitigate, ast-grep

---

# ctx_search 补取节

## rehearsal 模式 act 镜像 workflow_dispatch

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 2) 分点结论 > (b) 不烧生产预算演练 release gate（Confidence：高）

### (b) 不烧生产预算演练 release gate（Confidence：高）

业界四种 rehearsal 模式（均已核验原文或完整 raw content）：

| 模式 | 证据 | 烧真实预算？ | 对 R68 可用性 |
|---|---|---|---|
| **镜像 rehearsal workflow**（workflow_dispatch，跑同一 gate 但写 TestPyPI/无副作用） | rac-core `test-publish.yml`（"Same gate as the real release… the rehearsal proves the gate too"）、featurely `publish.yml`（`test_pypi=true` 分支） | 否 | 可借鉴：为 pre-tag gate 写一个 dispatch-able 镜像 job |
| **本地 act 模拟** | eSheet TESTING-LOCALLY.md（`gh act workflow_dispatch -e synthetic-event.json` + throwaway tag + rehearsal-event artifact，"no permanent tag, no DB write"） | 否 | 适合 T1 的 dry-run：合成 event payload 打轮询逻辑 |
| **synthetic event + artifact 留痕** | 同上，throwaway tag run 25636378426 留 rehearsal-record artifact | 否 | **"gate verified" 证据标准 = 绿 run URL + 留痕 artifact**，与本仓库 handoff 术语完全同构 |
| **首跑即验收** | 上述仓库均承认 rehearsal ≠ 真实路径（真实 index/真实 tag 才是终极验证） | 是（一次性） | 与本仓库"defer full live exercise to next real pre-tag"一致——**这是惯例而非妥协** |

**交叉验证**：GitHub Marketplace wait-for-workflow（已抓原文）确认两阶段轮询的工业形态：REST API 按 `sha` 过滤 + `status: completed` + `conclusion ∈ allowed-conclusions`，且明确列出 `workflow_run`/`check_run` 事…

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 6) 完整来源清单

…Quality Model | quality.arc42.org/approaches/tolerant-reader | Criticism | 2026-07 | 宽容读端的反面：rename 静默漂移、contract test + 字节级保留验收 |
| 4 | test-publish.yml (rac-core) | github.com/itsthelore/rac-core/blob/main/.github/workflows/test-publish.yml | Community/实践 | — | "Same gate as the real release… the rehearsal proves the gate too" 镜像 rehearsal 模式（404 on fetch，摘要级） |
| 5 | publish.yml (featurely) | github.com/gperdrizet/featurely/.../publish.yml | Community/实践 | — | `test_pypi` rehearsal 分支模式、tag-last 顺序 |
| 6 | TESTING-LOCALLY.md (eSheet) | github.com/mieweb/eSheet/blob/main/.github/workflows/TESTING-LOCALLY.md | Community/实践 | — | act + 合成 event + throwaway tag + artifact 留痕的 "gate verified" 证据形态 |
| 7 | Wait for workflow — GitHub Marketplace | github.com/marketplace/actions/wait-for-workflow | Official/工具 | v1.3.0 | SHA 过滤两阶段轮询、conclusion 校验、timeout/fallback、workflow_run 替代方案对比 |
| 8 | Postmortem Culture — Google SRE Workboo…

---

## fire-first 排序 惯例

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 2) 分点结论 > (c) fire-first 排序（Confidence：高，三源一致）

### (c) fire-first 排序（Confidence：高，三源一致）

- ScaledByDesign 事故管理文（已抓摘要+规则清单）："Rule 1: Mitigate first, root cause later. Stop the bleeding"——T0 在最前无争议。
- ADHDecode（已抓）："In the heat of the moment, the goal is containment. Not diagnosis… mitigation comes before resolution because restoring service is more urgent than understanding root cause."
- **验证基础设施票的排位**：共识是 resolution（永久修复）在 mitigation 之后、postmortem/预防之前，但**"gate 修复其守护的缺陷"这一特例**——工业惯例是 gate 紧跟修复（T1 随 T0），因为 gate 未修期间同类事故可再发。本仓库 T0(修复)→T1(gate)→T2(lint 防再犯) 的梯度恰好是 mitigation→resolution→prevention 的教科书顺序。
- 知识库召回的本地教训佐证：EgressAPIKEY 的 ticket-30 rehearsal 失败教训（force-push 使 pin 失效）说明**真实演练要留教训日志**——T1 的 dry-run 结果应记入 WORKFLOW.md 式 lesson log。

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### atomcode

# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research round 4 for the anysearch-cli repo — ticket-sequence design for round R68 (theme: repo-writing-automation gating + antigravity secondary ticket, per ledger D-001/D-002/D-003). DECIDED SCOPE: (T0) fire-fix red main — looks-ledger.ts must round-trip root schema_version sentinel + eval-abstain.test.ts:32 needs excludeGroups, then get real double-green ci+ship-gate run URLs; (T1) dual-layer release gate — pre-tag job self-waits via two-phase check…

我将按照研究流程执行：先召回知识库与本地台账上下文，再三引擎联网调研六个板块，最后给出排序建议。知识库已召回相关历史（looks ledger、gate rehearsal 教训、D-001..D-003 对照）。现在启动联网三引擎调研（阶段一：广泛搜索）。阶段一第二批：补齐剩余角度（fire-first 排序、check-runs 两阶段轮询、同类 bug 扫描方法论）。阶段二：定点深挖——打开 6 个关键原文核验。继续阶段一/二：补足 fire-first 与 postmortem、轮询 pattern 的原文核验。补一轮 (e) 板块的定向搜索（bug-class 扫描工具方法论），然后综合输出。**Sufficiency Gate**: searches: 8（web_search×3 / tavily×3 / anysearch×2）| angles: Official、Comparative、Criticism、Currency、Community 全五类覆盖 | full reads: 6 成功原文（Fowler、K8s 官方、SRE Workbook、wait-for-workflow、incident.io、arc42 释义；rac-core 404 已换源）| gaps: act 本地模拟对"带 preregistered budget 的内部 gate"的可信度只有单一信源级证据；T3 外部不确定性无公开可引材料。

---

## postmortem R68 是否产出

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 2) 分点结论 > (d) R68 是否产出 postmortem 文档（Confidence：中）

### (d) R68 是否产出 postmortem 文档（Confidence：中）

- Google SRE Workbook（已抓原文）：postmortem 触发无硬性 SEV 门槛，原则是"prevent repeat outages"，written well + acted upon + widely shared。
- incident.io（已抓原文，2026-03 更新）：post-mortem 是 artifact，review 是 meeting，"the artifact should exist before the meeting starts"；结构 = summary/timeline/root cause/impact/action items with owners and due dates。
- ScaledByDesign Rule 5："Every SEV-1 gets a post-mortem… No exceptions"——但 red main + 丢字段不是 SEV-1（无生产事故，是 process/quality bug family）。
- **建议**：**不产出独立 postmortem 文档**（over-scoping），但 F-17 family 的 **sweep 结果（(e) 板块）+ T1 验证边界声明应作为 D-D 记录进 ADR-0069 + ADR 决策台账**——即用本仓库既有的 ledger 机制承担 postmortem 职能，而非新文档类型。若 sweep 发现第二处同类 bug，则升级为独立记录（说明 bug class 有系统性成因，值得 blameless 叙事）。

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 6) 完整来源清单

…ESTING-LOCALLY.md | Community/实践 | — | act + 合成 event + throwaway tag + artifact 留痕的 "gate verified" 证据形态 |
| 7 | Wait for workflow — GitHub Marketplace | github.com/marketplace/actions/wait-for-workflow | Official/工具 | v1.3.0 | SHA 过滤两阶段轮询、conclusion 校验、timeout/fallback、workflow_run 替代方案对比 |
| 8 | Postmortem Culture — Google SRE Workbook | sre.google/workbook/postmortem-culture | Official | — | postmortem 触发原则与文档结构 |
| 9 | SRE postmortem best practices — incident.io | incident.io/blog/sre-incident-postmortem-best-practices | Comparative | 2026-03 | artifact vs meeting 区分、action items with owners |
| 10 | Incident Management That Works — ScaledByDesign | scaledbydesign.com/blog/incident-management-that-works | Community | 2026-05 | "Mitigate first" 规则清单、SEV-1 才强制 postmortem |
| 11 | Incident Triage and Prioritization — ADHDecode | adhdecode.com/reliability-engineering/incident-management/incident-triage-and-prioritization | Criticism | 2026-03 | containment > diagnosis、mitigation > root cause |
| 12 | ast-grep tool comparison / HN | ast-grep.github.io/advanc…

---

## F-17 sweep ast-grep 方法论

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 2) 分点结论 > (e) F-17 family sweep 方法论（Confidence：高）

### (e) F-17 family sweep 方法论（Confidence：高）

**Read-modify-write 丢字段站点的系统性找法**（FindBugs 论文传统 + ast-grep/semgrep 结构化搜索，HN 讨论已核验两者定位）：
1. **结构化搜索**（ast-grep/semgrep，非文本 grep）：找所有 `JSON.parse(...)` → 对象展开/重建 → `writeFile` 的管线；本仓库可用 AST pattern 如 `$OBJ = { ...固定字段列表 }` 后接写盘。
2. **数据驱动验证**：对每个 ledger/golden 文件，diff "磁盘上实际字段集" vs "代码里 writer 构造的字段集"——磁盘上有而 writer 不构造的字段 = 潜在受害者。这比静态扫描更可靠（运行时证据）。
3. **excludeGroups 同类**：测试文件缺 excludeGroups 的扫描 = grep 所有加载 golden/config 的测试文件，检查是否传递相同的过滤参数——这类是**参数传递链断点**，用 trace_callers 找 `excludeGroups` 消费点的全部上游。

**建议落点**：sweep 作为 **T0 的完成定义一部分**（不是独立票）——修一处不查同类是 anti-pattern（FindBugs 论文的核心论点：bug 是 class 不是 instance）。但把 sweep 范围**限定在 `eval-looks.json` / golden 文件的读写管线 + 测试加载链**，不扩散到全仓库（scope discipline, ADR-0029：一个 grill round 一个主题）。

--- [current-session | 2026-09-04 22:07 | batch:pr-view,issue-comments,pr-reviews,review-5114366430,inline-review-comments,git-s] ---
### inline-review-comments

🏁 Script executed:

```shell
printf '%s\n' 'Repository convention scopes:'
find /tmp/coderabbit-repo-knowledge/1mcp-app-agent-17562aa1 -type f -name '*.md' -print
printf '%s\n' 'Relevant script outline:'
ast-grep outline scripts/security/check-permission-modes.mjs
printf '%s\n' 'Relevant script sections:'
sed -n '1,240p' scripts/security/check-permission-modes.mjs
printf '%s\n' 'Nearby tests and references:'
rg -n --glob '!node_modules' 'check-permission-modes|MODE_PATTERN|guard:perms|permission.mode|reasonFor' scripts test tests .github . 2>/dev/null | head -200
```

Repository: 1mcp-app/agent

Length of output: 17496

---

## 缺失票检查

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 2) 分点结论 > (f) 缺失票检查

### (f) 缺失票检查

| 检查项 | 结论 |
|---|---|
| **T0 缺 sweep 验收项** | 补进 T0 完成定义（见 (e)），不新开票 |
| **T1 缺 rate-limit/warm-up/timeout 设计点** | 补进 T1 票描述（三处实现细节，wait-for-workflow 文档明确列出） |
| **T4 缺 lesson log 条目** | 知识库召回的 ticket-30 教训要求 T1 dry-run 结果留痕——补进 T4 |
| **postmortem 独立票** | 不需要（见 (d)），ADR-0069 承担 |
| **rehearsal 镜像 workflow 票** | 不需要——dry-run 打已 concluded SHAs 已覆盖核心逻辑路径；真实 dispatch 镜像属于 next real pre-tag 时的顺手产物，pre-register 会违反"不烧 OF look"约束的边界 |
| **T5 closure** | 无异议 |

---

## ALTERNATIVES 评估 T3 提前 并票

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 3) ALTERNATIVES 评估

## 3) ALTERNATIVES 评估

- **T3 earlier**：**不采纳**。antigravity spike 的外部不确定性（外部依赖行为）无法靠提前排程消除——它不阻塞 T1/T2/T4 的任何依赖边，提前只会打断 fire-first 梯度。唯一收益是"如果 spike 揭示大问题可重排后续票"，但 T4 文档工作内容基本确定，重排风险低。
- **T1+T2 merged**：**部分采纳**。同属 CI surface，但职责不同：T1 是运行时 gate，T2 是静态 lint——lint 防"handoff 缺 URL"这类**人因回归**，gate 防代码回归。合并会让单票验证面过大。建议**保持两票但连续执行、同一 PR 系列交付**，共享 PR 语境。

--- [current-session | 2026-09-13 11:27 | batch:shell-probe,skills-catalog,gitignore,codex-tmp-listing,adr-fulltext,context-md-f] ---
### ADR-0016: Hand-rolled sidecar lifecycle (CoreManager pattern, not plugin) > Alternatives rejected

## Alternatives rejected

- tauri-sidecar-manager plugin: builder config + I/O streaming +
  dual shutdown, but no health poll, no crash restart, no Resin-specific
  handshake. Adapter cost >= hand-roll cost.

---

## 过度不足 scope 标示

--- [current-session | 2026-09-11 05:13 | css-nesting-spec::https://drafts.csswg.org/css-nesting-1/] ---
### CSS Nesting Module Level 1 > 3\. Nesting Style Rules[](#nesting) > 3.3. Nesting Other At-Rules[](#conditionals) > 3.3.1. Nested [@scope](https://drafts.csswg.org/css-cascade-6/#at-ruledef-scope) Rules[](#nesting-at-scope)

#### 3.3.1. Nested [@scope](https://drafts.csswg.org/css-cascade-6/#at-ruledef-scope) Rules[](#nesting-at-scope)

When the [@scope](https://drafts.csswg.org/css-cascade-6/#at-ruledef-scope) rule is a [nested group rule](#nested-group-rules), an [&](#selectordef-) in the [<scope-start>](https://drafts.csswg.org/css-cascade-6/#typedef-scope-start) selector refers to the elements matched by the nearest ancestor style rule.

[](#example-d2d35473)That is, the following code:

.parent {
  color: blue;

  @scope (& > .scope) to (& .limit) {
    & .content {
      color: red;
    }
  }
}

is equivalent to:

.parent { color: blue; }
@scope (.parent > .scope) to (:where(:scope) .limit) {
  :where(:scope) .content {
    color: red;
  }
}

The [&](#selectordef-) selector behaves like `:where(:scope)` in [@scope](https://drafts.csswg.org/css-cascade-6/#at-ruledef-scope) rules.

--- [current-session | 2026-09-17 09:14 | CONTEXT.md-domain-model] ---
### Glossary > Golden Entry Scope（golden 条目 scope 标记）

## Golden Entry Scope（golden 条目 scope 标记）
docs-golden 条目的显式执行层归属 stub|live|both——带 mustHit* 的 answer 条目强制显式声明，无默认兜底（默认值即漂移入口）。离线 stub 层证管道契约（provider 给 X 则 verdict 必须 Y；夹具独立于 expected、取自 badcase observed 现场），在线层证现场真实性（真 provider + URL 硬断言）。_Avoid_: scope 缺省兜底（默认值即漂移入口）；stub 夹具取自 expected 而非 badcase observed 现场（循环论证自证）；live 层无 mustHit* 硬锚。来源：pytest-test-categories 显式分类哲学、Langfuse/Inngest offline-online 双层模型、Speedscale《Your Mock Is Lying》自证预言批判。

---

## 最终推荐序列

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 5) 最终推荐序列（含理由一行）

## 5) 最终推荐序列（含理由一行）

**T0（含 sweep）→ T1 → T2 → T3 → T4 → T5** —— 与 PROPOSED 一致；每票各补一句上述验收项；T1 的部分验证性质必须显式入账而非隐含。

---

## 执行摘要 R68

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 1) 执行摘要（Tl;dr）

## 1) 执行摘要（Tl;dr）

**推荐维持 PROPOSED 的串行 T0→T1→T2→T3→T4→T5**（Confidence：高）。理由：(a) fire-first 是事故响应共识——先止血（T0 red main）再做预防基础设施；(b) T1 的验证策略（对已 concluded check-runs 的 SHA 做干跑轮询 + 首次真实 pre-tag 才全量演练）与业界"staging/rehearsal 工作流 + 首跑即验收"惯例一致，且**不烧 OF look 预算是硬约束下的唯一合规路径**；(c) T3 提前无收益——antigravity spike 的外部不确定性无法通过"提前"消除，且它不阻塞 T1/T2。**诚实标示**：T1 的 dry-run 验证是"部分验证"，gate 在首次真实 pre-tag 前不能宣称 fully verified——这必须写进 T4 的 ADR/记账，不能默认。

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default）

# R68 研究报告（模式：default）

---

## 信息缺口 R68

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default） > 7) 信息缺口

## 7) 信息缺口

1. **act 对自定义 gate 逻辑（check-runs API 轮询）的本地模拟保真度**——只有 eSheet 单一案例级证据，未找到针对"轮询类 step"的 act 局限性系统评测；对本仓库影响有限（T1 dry-run 打真实 API 的已 concluded SHAs，不走 act）。
2. **antigravity (T3) 无公开可引材料**——外部专有生态，spike 本身就是消解该不确定性的手段；无法用调研替代。
3. **two-phase check-runs 轮询的 GH API rate-limit 具体数值**——int128 提到建议 PAT 但未给阈值；T1 实现时需按 `wait-interval ≥ 30s` 保守设定。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume c1614f61-ff44-4057-bc7a-67e833c23c12

--- [current-session | 2026-09-17 12:07 | batch:atomcode] ---
### R68 研究报告（模式：default）

# R68 研究报告（模式：default）

> Throttle: call #1/8 in this window. 2 call(s) before soft cap. Prefer ctx_search(queries: [...]) array form for multi-query workloads — it counts as a single call.