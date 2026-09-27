# Q3 atomcode 调研存档 — defer-r85 根因判别实验设计

调研时间：2026-09-27 · 问题原文见 q3-prompt.txt · 来源清单见 §5

## 1) 执行摘要（TL;DR）

**推荐方案 A（四步微分探针矩阵），但顺序上把 P0 取证与 P3 构建新鲜度断言捆绑为第一批执行**（Confidence：高——工业界心智模型一致支持「先取证、分变量隔离、错误分类归因」，方案 B/C 分别违反 SRE 排障与科学调试法的基本纪律）。臂复活判据「错误类别归因落档 + 连续 5/5 providersFailed 空」对齐 AWS/Airbnb retryable 分类惯例与 Gradle/Testim 连续绿惯例（Testim 用 10 次、本仓 5 次对一次性批跑足够），无需修改。

## 2) 分点结论

**① 最小探针集设计 = 假设-演绎法 + 单变量隔离。** Google SRE Book Ch.12 把排障形式化为 hypothetico-deductive method（hypothesis→test→refine），明确两条通用技术：分层「分而治之」与在组件连接处注入已知测试数据做黑盒探针。五个候选根因天然构成互斥假设集，P0–P3 正是每个假设一个判别性实验。Agans 9 Rules 与 scitools 调试法强调 change one variable at a time + control run——P1 的 env 三分离是教科书式单变量隔离。方案 C 不违反最小性但违反判别性：P0 只能给错误类别，无法区分①vs④（都可能是 4xx/超时）。方案 B=「重启赌恢复」：SRE Ch.12 明确列为反面模式——没有根因就行动，碰巧绿了也无法归因，delta.json 只记旗标不记错误文本，下次同样全灭时仍在原地。

**② 「先取证后修复」有明确先例优势，A 严格支配 B。** SRE Ch.12：「fixing proximate causes needn't always wait for root-causing」承认缓解可先行。但本例关键不对称：P0 一次调用成本 ≈ B 全量批跑的一小片；B 若上游仍 down 则纯烧时间；A 在 P0 结果为 transient 已恢复时退化为 B（零代码修直接核销），在 schema drift / stale dist 时给出可归因证据。即 A 最坏耗时 = B 最好耗时 + 一次探针。工业 postmortem 数据（半数以上事故源于 recent change）支持把「什么变了」（R82→R85 之间发生了迁移）作为 prime suspect——指向③stale dist 假设应优先验证，P3 从「复跑前置工序」提升为第一批执行是唯一建议修正。

**③ Error 分类学归因是成熟做法，五个 throw 类别已具雏形，需补 retryable/permanent 标注层。** behindscale Retryable Error Classification（AWS Builders' Library + Airbnb 双案例）：错误分 temporary（重试可能成功）与 permanent（重试必失败），分类应成为响应契约一部分供机械判定。映射：HTTP 5xx/429→transient（①③），401/403→permanent auth（④），404+session→半永久（现有 SessionExpiredError 重试一次逻辑正确）；SSE 无应答→transient 偏协议层；malformed 缺头→permanent 协议漂移（②）重试无意义。arXiv agentic 故障分类学点名的反模式「generic error wrapping discards root-cause context」精确命中现状——delta.json 只记 providersFailed 旗标不记错误文本。P0 产出（e.name+message 落档）就是对该证据缺陷的直接修补，应成为长期 fixture 而非一次性脚本。

**④ MCP wire-schema 漂移防御有成熟四层惯例，P2 对应第一层。** arika.dev MCP 测试金字塔：protocol contract tests（raw JSON-RPC initialize+tools/call 不用 SDK 高层客户端）→ schema 一致性 → handler 单测 → replay。P2 正是官方推荐 raw client 层（SDK 抽象 hides the protocol details you need to verify）。negiadventures schema drift 三车道（additive/risky/breaking）：P2 拿到 raw 应答后应对照 R82 时期 golden 快照做归一化 diff（键排序归一后 hash 对比），missing '## Search Results' 头属 output contract breaking lane。三源交叉一致：schema 快照+fixture 验证应进 CI 前置而非等运行时失败——对应 P3。

**⑤ 构建产物新鲜度断言：CI 惯例是「产物与源码 hash 绑定」，runner SKIP-not-rebuild 是反模式放大器。** Datadog hashed-key 模式：产物 key 含内容 hash，源码变更后旧产物自动失效；GitLab CI 惯例 build job 产出 dist 作 artifact 显式传给 test job，杜绝 test job 用本地残留 dist。runner「dist 缺失即 SKIP」语义没错（防半成品），但缺反向断言：dist 存在但 stale（mtime 早于最近 src 变更/版本戳不匹配）时应 FAIL 而非静默运行。P3 应实现为：比较 dist 构建 hash（或 git describe 嵌入）与工作区 HEAD，不匹配→硬失败并提示重建——成熟 CI 中是前置 gate 非事后排查项。

**⑥ Transient 恢复证据门槛：5/5 判据位于工业惯例区间内，建议加时间维度。** Gradle「重跑一次消 90% flaky」→5 次连续绿使「瞬时故障恰好连 5 次」概率对单点探针已足够低；Testim 用 10 次连续通过（更保守）；error budget 惯例要求 SLI 在稳定窗口（24–72h）内保持达标才解除冻结——时间维度覆盖批跑间隔外的间歇性故障。建议：5/5 连续 iso 探针绿+错误类别归因落档已可核销当次票据；若根因判为 transient 上游故障，额外在 ADR 记录「若复发则升级为 P2 wire-schema 长期快照测试」，与 error budget policy「单一故障类耗预算→P0 行动项」升级逻辑一致。

## 3) 对比矩阵（要点）

A（微分探针矩阵）：归因可归、成本最低起点、A 最坏=B 最好+一探针——支配性胜出。
B（直接复跑赌恢复）：SRE 反面模式，无归因纯赌，否。
C（只跑 P0）：不违最小性但违判别性，大概率需二轮，否。

## 4) 执行建议（方案 A 两处修正）

- P0 与 P3 捆绑第一批执行（stale dist 是 recent-change prime suspect，先排除最低成本最高嫌疑）。
- P0 取证脚本升格为长期 fixture（错误文本落档修补 generic-wrapping 反模式缺陷）。

## 5) 完整来源清单

| # | 标题 | URL | 贡献 |
|---|---|---|---|
| 1 | Google SRE Book Ch.12 Effective Troubleshooting | https://sre.google/sre-book/effective-troubleshooting/ | 假设-演绎、分而治之、黑盒探针、反面模式 |
| 2 | Testing MCP Servers: Contract Tests, Fixtures, Replay（arika.dev） | https://www.arika.dev/blog/mcp/testing-mcp-servers/ | 四层测试金字塔、raw JSON-RPC client=P2 依据 |
| 3 | Schema Drift Alerts for MCP Tools（negiadventures） | https://negiadventures.github.io/blog/schema-drift-alerts-mcp-tools | schema 快照+hash、additive/risky/breaking 三车道 |
| 4 | Testing MCP Servers for Schema Drift（C# Corner） | https://www.c-sharpcorner.com/article/testing-mcp-servers-for-schema-drift-and-tool-compatibility | 三契约（discovery/input/output） |
| 5 | Retryable Error Classification（behindscale） | https://www.behindscale.com/patterns/retryable-error-classification | AWS/Airbnb：temporary vs permanent 入契约 |
| 6 | How We Handle Flaky Tests in Gradle | https://blog.gradle.org/how-we-handle-flaky-tests-in-gradle | 重跑一次消 90% flaky、quarantine |
| 7 | The Science of Debugging（scitools） | https://blog.scitools.com/the-science-of-debugging/ | control run、单变量隔离 |
| 8 | Failure Root Cause Taxonomy（EmergentMind） | https://www.emergentmind.com/topics/failure-root-cause-taxonomy | 症状 vs 根因形式化分类 |
| 9 | arXiv 2603.06847 Agentic AI 故障分类学 | https://arxiv.org/html/2603.06847v1 | generic error wrapping 丢根因上下文=反模式 |
| 10 | Error Budgets Explained（openobserve） | https://openobserve.ai/blog/error-budgets-explained | 恢复需 24–72h 稳定窗口 |
| 11 | SRE Workbook Error Budget Policy | https://sre.google/workbook/error-budget-policy | 故障类耗预算→P0 升级行动项 |
| 12 | Datadog: Cache purge patterns in CI/CD | https://www.datadoghq.com/blog/cache-purge-ci-cd | hashed-key 使 stale 产物自动失效 |
| 13 | GitLab Job Artifacts Docs | https://docs.gitlab.com/ci/jobs/job_artifacts | build→test 产物显式传递 |
| 14 | Testim flaky docs（10 连绿判据） | https://docs.tricentis.com/testim/content/testops/testops-management/flaky-tests.htm | 10 consecutive passes 惯例 |
| 15 | AutoARTS: Azure incident 根因标签（USENIX ATC'23） | https://www.usenix.org/conference/atc23/presentation/dogga | 大规模事故根因分类学实证 |

## 6) 信息缺口

- 无「MCP 客户端连接中断恢复」专门统计文献；
- gradle flaky 重试惯例迁移到「批跑恢复判据」属类比推理（已标注）。
