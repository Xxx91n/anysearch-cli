# atomcode 调研存档 — R79 Q1 主题定界

Date: 2026-09-23 · prompt: `q1-prompt.txt` · 引擎: Exa+AnySearch（Tavily 配额缺席）· Confidence 总评: 高/中高

## 1) 执行摘要（TL;DR）

**推荐：R79 = 「pathlint 判定器契约收敛轮」（残账 1+2+3 捆绑），残账 4 单独成 R80「发布龄期闸 lockfile 执法轮」，L0/L1 上游观测作为例行取证义务随轮 ride-along。** 捆绑的凝聚判据不是「同一次审计产出」，而是**同一子系统 + 同一决策类型**：残账 1/2/3 全部落在 pathlint 单一判定器上，且 1/2 都是关于该判定器契约的立法裁决，3 是其实现边缘；残账 4 是不同子系统、不同决策类型（护栏设计 + 可能借力上游 pnpm 修复），混入会稀释裁决质量。

## 2) 分点结论

### 结论 1：审计残账清算按「发现来源」打包是杂物筐反模式；业界按「根因/子系统/修复模式」分组 — Confidence: 高

- 分组心智模型：审计跟进的成熟惯例是把发现 dedup 后按**根因签名、同文件、同修复模式**成批，而不是按「来自同一份报告」成批。腾讯 CloudBase 的 codebase-audit 分类规范批处理规则集：①安全类发现按漏洞类型成批；②同一文件 3+ 相关发现成批；③同一修复模式跨 5+ 文件成批；④无关联发现各自成批，且「If a batch grows too large, split by subdirectory or by sub-pattern」（classification.md）。
- pentest 行业惯例同构：CIS Essential Guide 与 Packetlabs 处置框架都是「报告理解→按严重度/攻击路径排序→分配责任人→短/中/长期路线图」，分组轴是**风险与修复性质**，从不以「同一审计批次」为凝聚轴。
- 应用到本仓：残账 1/2/3 共享**同一个文件/同一个判定器**，符合「same-file + related」成批规则；「同一次审计产出」本身不是凝聚轴——若按来源打包，就会把残账 4 也卷进来，这正是杂物筐的成因。

### 结论 2：实现 vs 文档张力——判据是「哪一侧是深思熟虑的设计、哪一侧是 drift」；裁决方向没有默认答案，但必须显式单向收敛 — Confidence: 中高

- policy-as-code 领域成熟模式=「单一真源+一致性测试」：policy-as-code-ai 的做法=每条规则 severity/message/remediation 都在一个 rules.json，Rego 检测、SARIF 导出、auto-fix 全部从它派生，**一致性测试在 policy 与 catalog 分歧时让 CI 失败**——分歧本身不许长期存在，必须朝单一真源方向解决。Nornyx 把「生成物与契约漂移」做成 CI gate（nornyx drift 哈希比对）。
- 收敛方向判据：问「哪一侧是被明确裁决过的意图记录」。IaC drift 领域同构二分：`Revert`（现实改回声明）vs `Codify`（意图变更写进模板再部署）——取决于差异是「未授权漂移」还是「未记录的有意变更」。
- **应用到残账 1（关键事实修正）**：ADR-0072 文本本身已给 fence 豁免（「A valid marker on the line directly before a fence covers the whole fenced block (transcript excerpts)」），且 Stack: 定位行是文本明文的 bare-absolute 豁免类。实现与 ADR 文本的真实张力只剩「marker 覆盖的 fence 内、仓库内目标的绝对路径不执法」一条，而 fence 内内容主要是机器生成的 transcript 摘录——收紧实现会制造大量 FP 噪音，违背 R78 刚做的噪音校准。**推荐：修订 ADR 文本显式承认豁免域（fence 内 + Stack: 类，注明 fence 内豁免的理由=机器生成摘录类内容），即文档向实现收敛，但以显式立法而非追认**；同时加一条一致性测试/用例把新契约钉死防再漂。同构 NIST 800-53B tailoring 纪律：「降级/豁免控制必须记录 rationale」。

### 结论 3：控制被证伪后的处置光谱——业界对本例的精确先例是「上游已修复 + 验证腿」，护栏判据是 NIST 补偿控制三要件 — Confidence: 高

- 精确先例：残账 4 的绕过路径与 pnpm issue #10438（2026-01）完全一致——「lockfile 已含违规版本时 --frozen-lockfile 静默放行」，该 issue 已关闭并由 #11583 跟进修复；pnpm 11.3+ 的 trustLockfile:false（默认）会在安装时对 lockfile 每个条目**重放** minimumReleaseAge/trustPolicy 校验。即业界对这一确切场景的答案已落地：**上游机器腿**。
- 处置光谱与判据（NIST SP 800-53B 补偿控制框架）：①立补偿/纵深控制——原控制技术可行且成本低时（本仓：CI 扫 lockfile 未成熟版本是小脚本），须提供等价或可比保护并记录 rationale；②风险接受记档——仅当控制技术不可行或成本不成比例，且需显式记录；③NIST 明确「补偿控制不用于规避合规义务」——不能拿「已记档风险」替代可行且廉价的护栏。
- 社区佐证：pnpm 维护者发起的 discussion #11660（2026-05）里「CI Enforcement: 把非 frozen install 当安全事件」列为高优方向；Supabase 官方安全指南建议「commit lockfile + frozen install + minimum release age ≥7 天」组合拳。**推荐残账 4：立机器腿护栏（lockfile 未成熟版检测），并先核对 pnpm trustLockfile 验证腿在新版 pnpm 是否已天然覆盖——若已覆盖，护栏降级为 CI 断言+ADR 记录上游依赖**。纯 risk acceptance 不成立：护栏技术可行且廉价，不满足 NIST 的「不可行/不成比例」门槛。

### 结论 4：「一轮一主题」内聚判据——三个可操作判据，残账 1/2/3 通过、残账 4 不通过 — Confidence: 中高

- 业界判据：「One PR, one concern」可操作化表述=**「If you find yourself writing 'and also…' in the PR description, split it」**（daintree CONTRIBUTING）；PR 审查研究背书小而聚焦的 diff 审得更透（SmartBear ~400 行上限）；社区修正极端 one-concern 为「one problem + 独立 commit 的顺手清理」——恰好支持「同一轮内、commit 粒度分层」的折中。
- 本仓可用的三个内聚判据：①子系统同域（残账 1/2/3=pathlint 同域 ✓；残账 4=依赖管理域 ✗）；②决策类型同类（立法裁决与纯工程修正是否混装——3 可作 1/2 立法落地时的同域 commit，但不能反客为主）；③共享验收面（1/2/3 共用 pathlint 测试矩阵 ✓）。
- 混合风险实证：把立法分叉（残账 1）与护栏设计（残账 4）混装，会让 ADR 同时承载两个互不引用的 Decision entry，违背本仓 ADR-0029「one grill round = one themed topic」纪律。

### 对比矩阵

| 方案 | 内聚判据 | 裁决质量风险 | 业界先例 | 备注 |
|---|---|---|---|---|
| A：全打包（1+2+3+4） | 仅「同审计来源」，子系统/决策类型双不满足 | 高：立法分叉与护栏设计互相稀释 | 违反 one-concern+同报告≠同根因 | 杂物筐反模式 |
| **B：R79=pathlint 契约收敛轮（1+2+3），R80=龄期闸 lockfile 执法轮（4），L0/L1 随轮取证** | 1/2/3 同域+同决策类型+同验收面 ✓；4 拆出 | 低 | 同文件/同根因成批；one PR one concern | **推荐** |
| C：完全拆散每残账一轮 | 过度拆分 | 低但低效 | 极端 one-concern 反例 | 浪费轮次 |
| D：1 立法轮/2+3 工程轮/4 护栏轮 | 立法/工程分离但 2 与 1 同契约 | 低 | 类 C | 强拆制造重复上下文 |

### 推荐的 R79 轮内结构（供裁决文本参考）

1. **立法主轴（Decision entry）**：残账 1+2 合并裁决——pathlint 豁免域契约（fence 内豁免+Stack: 定位类+单段未知根静默），一次 ADR 修订钉死实现与文本的双向收敛，附一致性测试。
2. **同域工程 commit（不进 ADR 主轴）**：残账 3 WORD_CHAR 修复+测试用例（foo_C:\x 不误报），走 refactor commit+CHANGELOG。
3. **ride-along 取证**：L0 快照+L1 diff（新 alpha 观测），纯证据零代码，按本仓排程义务惯例随轮落档。
4. **R80 预告（记入 deferred-registry 或下轮登记）**：残账 4 lockfile 执法轮——先核对 pnpm trustLockfile 验证腿覆盖，再决定自建护栏 vs 引用上游。

## 3) 完整来源清单

| # | 标题 | URL | 贡献 |
|---|---|---|---|
| 1 | pnpm — Mitigating supply chain attacks | https://pnpm.io/supply-chain-security | minimumReleaseAge 官方语义、lockfile 作为供应链控制面 |
| 2 | pnpm issue #10438 — minimumReleaseAge not enforced when dependency already exists in lockfile | https://github.com/pnpm/pnpm/issues/10438 | 残账 4 精确先例：6 组实测矩阵证明 frozen-lockfile 绕过，已确认修复 |
| 3 | pnpm discussion #11660 — How can pnpm mitigate supply chain attacks better | https://github.com/orgs/pnpm/discussions/11660 | 维护者与社区 CI 执法方向共识 |
| 4 | pnpm settings — Dependency Resolution（trustLockfile/minimumReleaseAgeIgnoreMissingTime） | https://pnpm.io/settings/dependency-resolution | trustLockfile 验证腿：lockfile 逐条重放龄期/信任校验 |
| 5 | NIST SP 800-53B — Control Baselines | https://doi.org/10.6028/NIST.SP.800-53b | 补偿控制三要件：可行性、等价保护、记录 rationale |
| 6 | CIS Essential Guide — Remediate Penetration Test Findings | https://essentialguide.docs.cisecurity.org/en/latest/bp/remediate_pen_test_findings.html | 审计发现处置流程 |
| 7 | Packetlabs — How to Remediate Penetration Test Findings | https://www.packetlabs.net/posts/remediating-test-findings/ | 短/中/长期 remediation 路线图 |
| 8 | CloudBase codebase-audit — Classification & Batching | https://github.com/TencentCloudBase/CloudBase-MCP/blob/ef7cf025/skills/codebase-audit/references/classification.md | 批处理粒度规则集 |
| 9 | daintree CONTRIBUTING.md — One PR, one concern | https://github.com/daintreehq/daintree/blob/develop/CONTRIBUTING.md | 「and also… 就拆」可操作判据 |
| 10 | CodeAnt AI — Azure DevOps PR Guide | https://codeant.ai/blogs/azure-devops-pull-request-guide | SmartBear ~400 行审查研究 |
| 11 | Reddit — One Pull Request. One Concern. | https://www.reddit.com/r/programming/comments/4o74h6/one_pull_request_one_concern/ | one-concern 反例修正 |
| 12 | policy-as-code-ai | https://github.com/KatsaounisThanasis/policy-as-code-ai | 一致性测试模式：policy 与 catalog 分歧即 CI 失败 |
| 13 | Nornyx | https://github.com/hanialnaber/nornyx | 生成物 vs 契约 drift gate（哈希比对） |
| 14 | Pulumi Policies 文档 | https://www.pulumi.com/docs/discovery-governance/policy/ | 漂移处置 Revert/Codify 二分 |

**交叉验证记录**：残账 4 事实链=#10438（一手）+pnpm settings 文档+#11660 三源互证；结论 1=classification.md+CIS+Packetlabs 三源互证；结论 4=daintree+CodeAnt+Reddit 三源互证；结论 2=policy-as-code-ai+Nornyx+NIST tailoring 互证。

## 4) 信息缺口

- 「audit finding remediation 批处理粒度」无直接命中的同行评审论文；依赖工程实践文档+PR 审查实证研究。
- Tavily 引擎配额全程不可用，三引擎交叉降级为 Exa+AnySearch 双引擎；关键结论均 ≥2 独立信源。
- 本仓 pnpm 实际版本是否已含 trustLockfile 验证腿的逐条重放语义（v11.3+ 才有），需在 R80 轮内实测核对 lockfile 升级路径，本报告只能给出方向性判断。
