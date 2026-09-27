# Q2 atomcode 调研存档 — 红门修法裁决（closeout-claims 机器本地声明）

调研时间：2026-09-27 · 问题原文见 q2-prompt.txt · 来源清单见 §4

## 1) 执行摘要（TL;DR）

**推荐：方案 A（证据指纹清单入库），并随本轮同落随票项。** Confidence：**高**。理由：(a) checksum manifest（大产物不入库、指纹清单入库）是工业界极成熟心智——lockfile/SHA256SUMS/SBOM 哈希清单/SRI manifest 全部是这个模式：断言对象从「大文件本身」换成「小、可入库、可 diff 的指纹文件」，SLSA 官方还规定「有 expectations 但无 provenance = 验证失败」的 fail-closed 语义，与本轮红门诉求完全同构；(b) 方案 B 给合约开第五种「只验形状不验存在」的 kind，等于在验证器里立法一个不可验的断言类，工业界同类问题（CI 不可验的机器本地产物）的成熟答案都是**改变断言对象指向可入库证据**而非给不可验断言开豁免通道；(c) 随票项「签字 commit 上 ship-gate exit 0」对应的「门必须同步阻塞签字」是 CI 审计文章里点名的第一大失守模式（gate 跑了但没人没等它），应随本轮同落。

## 2) 分点结论

**① Checksum manifest 惯例成熟度：非常高，直接支持方案 A。**
- SRI Guide（2026-08 CI 完整性门教程）：小 JSON 含 path/SHA-384/byte size，明确建议「记录 commit 而非 generatedAt 时间戳」（时间戳破坏 diff；只留 commit——它「因真实变化而变化」）。注意：清单里 generatedAt 字段恰好踩了这个 gotcha，入库清单建议把判读器配置 hash/环境指纹放里面但让判读器容忍该字段的每次变化，或改成可重导出的字段。
- GitHub release checksums.txt 是多年惯例（cloudflared、insomnia 等项目 issue 均以「发布 checksums.txt 是 quick win」为共识）。
- lockfile 本身就是「内容哈希清单入库」的原型：学术论文（arXiv 2505.04834，Monperrus 组）定性 lockfile 为「verify integrity of resolved packages + reproducibility across environments」的标准载体；CI 上 npm ci/cargo --locked/go.sum diff 检查是标准防漂移做法。

**② SLSA/attestation：fail-closed 验证语义 + 证据与断言分离，支持 A、反对 B/C。**
- SLSA 官方验证规范原文：「If expectations are defined for a package but no provenance exists for the artifact, this MUST result in verification failure」——即：不能因为「被验对象在 CI 环境里拿不到」就把验证放行或跳过，正确形态是把期望值本身（expectations/指纹）做成可分发、可验证的一等 artifact。这正是方案 A 的形态：清单文件就是 machine-local 产物的「expectation」，CI 上验证器验证「清单存在且自洽」而非「原件存在」。
- SLSA FAQ：in-toto attestation 是「为 software supply chain 表达事实的载体」——事实记录与可验证性是一体设计，不存在「只验形状不验内容」的 attestation 类。

**③ 合约扩展 vs 断言重述的取舍先例：业界一致倾向「不动验证器合约、改断言对象」。**
- kuryzhev CI/CD checklist（2026-07）：「Gate configuration lives in version control」——门与门配置必须入库、可 review、防静默漂移。给 closeout-claims 加 kind:machine-local 相当于给门合约加一条不可执行分支，恰是文中「SonarQube 扫了但 exit code 恒 0」失守模式的合约版。
- WITNESS monograph（executable evidence for engineering claims）：工程声明的成熟形态是「claim + source revision + canonical receipt digest」绑定，negative/blocked 结果也是一等证据——直接支持方案 A 中「阴性结果原始证据最小入库」的定位；ClaimBound evidence cards 同样把 hashes/protocol/claim boundary 做成入库小卡片，明言「Blocked cards…are not hidden failures」。

**④ CI 中「机器本地产物断言」的正确形态。**
- 工业先例共识：不可在 CI 复现的产物，其断言应以「指纹/清单/收据」形态入库（SLSA subject+digest、SRI manifest、WITNESS receipt、ClaimBound card），验证器验证清单与声明一致；原件留在机器本地通道由 governance marker（ADR-0072 已有 <!-- machine-local: ... --> 词汇）管。不需要发明 kind:machine-local——pathlint 的 governed marker 词汇 + 指纹清单 = 完整同构，且「豁免本身是被 lint+review 看见的 artifact」这条既有原则天然覆盖。
- 方案 C（symbol kind 指向 decision-record 里的文件名 token）被 SLSA 语义直接否定：把可证伪断言重述成近恒真记录检查 = expectations 变成空集，验证器失去牙齿。方案 D（跑批产物入库）违反驻留分级且开坏先例；方案 E（删声明）覆盖归零，违背 fail-closed。

**⑤ 签核 checklist「签字前门绿」防呆项：随本轮同落。**
- Momentic QA release checklist（2026-09）原文：「Close every step with named ownership and binary evidence, such as a green CI run, a matching build hash」——签字必须绑定 binary evidence 是成文标准；kuryzhev 把「gate 跑了但没人等它」列为审计他人 pipeline 的第一大常见失守；SRE checklist 类文章均把 pre-deploy gate 列为硬门。「审计窗踩红签字」正是该失守模式，防呆项成本一行命令、收益是堵住本类事故的复发路径——随本轮同落，不留清障轮。

## 3) 对比矩阵

| 方案 | 工业同构 | CI 可验性 | 合约面 | 先例强度 |
|---|---|---|---|---|
| **A 指纹清单入库** | lockfile / SHA256SUMS / SRI manifest / SLSA expectations | ✅ 双平台绿 | 零扩展 | 最强（三源以上交叉） |
| B kind:machine-local | 无直接同构；近似「不可验断言类」 | ❌ 形状即过 | +1 kind | 弱，反向先例（SLSA fail-closed） |
| C symbol 重述 | expectations 置空 | ✅ 但近恒真 | 零扩展 | 反向先例（验证器失去牙齿） |
| D 产物入库 | 反 lockfile 惯例（build output 不入库） | ✅ | 推翻驻留分级 | 弱 |
| E 删声明 | 无证据即无 claim | ✅（空过） | 覆盖归零 | 违 fail-closed |

## 4) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| SLSA Verifying Artifacts | https://slsa.dev/spec/v1.0-rc1/verifying-artifacts | Official | spec v1.0-rc1（现行 v1.2） | expectations 无 provenance = MUST fail |
| The Design Space of Lockfiles (arXiv 2505.04834) | https://arxiv.org/html/2505.04834v3 | Official(论文) | 2025-10 v3 | lockfile=完整性+可复现清单的学术定性 |
| Generating an SRI Manifest in GitHub Actions | https://www.subresource-integrity.com/asset-hashing-dynamic-script-injection/ci-cd-integrity-gates/generating-an-sri-manifest-in-github-actions/ | Official(教程)+Currency | 2026 | manifest 字段设计、generatedAt gotcha、不入库建议 |
| CI/CD Checklist: Quality Gates, Approvals, Rollback | https://kuryzhev.cloud/2026/07/23/ci-cd-checklist-quality-gates-approvals-and-rollback-paths/ | Criticism+Community | 2026-07-23 | 门配置入库、gate 不阻塞=第一大失守 |
| QA Release Checklist: 12 Steps | https://momentic.ai/blog/qa-release-checklist | Comparative | 2026-09-25 | 签字必须绑定 binary evidence（green CI run/build hash） |
| What Is Lock File Drift | https://sbomify.com/2024/07/30/what-is-lock-file-drift/ | Criticism | 2024-07-30 | --locked/npm ci 防漂移标准 CI 模式 |
| cloudflared issue #1617 / insomnia #3312 / community #23512 | 见 tavily 检索结果 | Community | 2022–2026-03 | checksums.txt 发布惯例共识 |
| WITNESS Technical Monograph | https://asp53826.github.io/witness/publications/WITNESS-Technical-Monograph.pdf | Official(方法论) | — | claim+receipt digest 绑定、阴性结果一等证据 |
| ClaimBound evidence cards | https://github.com/ClaimBound/claimbound-evidence | Community | — | blocked 结果入库为 evidence card 先例 |
| 知识库：SLSA FAQ / R80 发布就绪同构评估 / R71 governed marker glossary | ctx_search 召回 | 会话记忆 | — | in-toto 关系、marker 词汇、release gate 三段同构 |

## 5) Sufficiency Gate 与缺口

searches: 6 | angles: Official / Comparative / Criticism / Currency / Community（5/5 全覆盖） | full reads: 6（slsa.dev、arxiv、kuryzhev、momentic、sbomify、SRI guide，其中两页经 tavily_extract 全文） | gaps: ①kind:machine-local 无直接工业同构先例可引（本身即反对 B 的证据）；②「阴性结果证据入库」除 WITNESS/ClaimBound 外无大型组织正式规范（属新近实践）；③未找到与本仓库 closeout-claims 机制完全同形的开源 quality-gate 声明器做逐条对表。

## 落地要点（A 方案 + 随票项）

1. claim 改指 .scratch/grill-round-85/ 下的指纹清单 JSON（sha256/size/来源 commit/判读器配置 hash）；原 kind:path 声明改为对该清单文件自身的 path 断言——合约四种 kind 原封不动。
2. 清单文件内对降格件原件路径行加既有 <!-- machine-local: ... --> governed marker（复用 ADR-0072 词汇，豁免被 review 看见）。
3. 清单内避免裸 generatedAt（SRI guide gotcha：破坏 diff）；如必须保留，判读器须容忍其变化。
4. 随票项同落：审计签字 checklist 加硬项「签字 commit 上 ship-gate --quick exit 0」——证据：Momentic binary-evidence 标准 + kuryzhev 失守模式 #1。
