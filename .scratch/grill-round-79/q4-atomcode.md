# atomcode 调研存档 — R79 Q4 收口判据

Date: 2026-09-23 · prompt: `q4-prompt.txt` · 引擎: Exa+AnySearch（Tavily 配额缺席）· Confidence: 高

## 1) 执行摘要（TL;DR）

拟定三段式收口判据**结构正确、无明显过度项**，业界先例（ESLint RuleTester 严格化、OPA policy-testing、Stryker mutation testing）均支持「契约文本+实现行为+一致性测试同批收敛」且「红绿成对」是负向断言的标准校准纪律。**3 个漏项**：①红绿证据对缺「反例锚定」（防 fixture 放行了错误语义）；②取证段结论缺「无异常=零 diff 也是结论」的显式格式化；③文书段缺可追溯锚（判据条目↔证据产物的一一映射）。

## 2) 分点结论

### 问题 1：契约/规则变更的 DoD——三者同批收敛

- ESLint PR #20125（TSC 裁决记录）：契约+实现+测试同 PR 收敛的治理流程先例。
- OPA Policy Testing 官方文档：每条规则↔成对 allowed/denied test 一一映射惯例。
- ESLint v10 migration（RuleTester 严格化）：valid 用例不得携带静默放行属性——契约可验证性先例。
- ContextSafe DEFINITION_OF_DONE：AC 须覆盖 fail-closed 路径、N/A 需显式理由。
- 信息缺口注：「契约变更单独验证清单」无逐字命名标准，结论为 ESLint/OPA 流程惯例的强归纳。

### 问题 2：红绿成对 fixture 的防失真校准

「fixture 放行了但放行的不是目标语义」= mutation testing 核心问题，三惯例：

1. **变体排除（mutant discrimination）**：Stryker 文档——只断言 `isAdult(25)===true` 的测试对 `return true` 突变体不设防（绿色假象）；须补 `isAdult(17)===false` 邻近负例杀死。映射 T1：**每个豁免 fixture 至少一对（豁免样本+一线之差非豁免样本）**，否则放行的可能是「判定器坏了」而非「豁免生效」。
2. **先红纪律精确表述**：先红不只是跑失败，要确认失败原因是契约本身（红于改前、绿于改后、红因与豁免条款语义一致）；CircleCI mutation 指南把「绿基线先行」列第一步——红次运行应记录失败输出片段作证。
3. **等价突变标注**：改前红不了的 fixture 若确认等价语义，显式标注 equivalent 并从红绿要求豁免（Stryker：equivalent mutant 不计分）。**建议判据加：每个红绿对须声明其红状态可被「非豁免近邻 fixture」区分，不可区分者显式标注 equivalent。**

### 问题 3：例行观测回合的验收锚

快照+diff+显式结论三件套必要但不充分：

- Google SRE ch6：每次观测回合产出必须可行动；「无异常」本身必须是显式记录的结论而非沉默通过；email/噪音式记录是反模式。
- **零发现回合也须产出格式化结论行**（如 `L0 snapshot: X versions observed, 0 content diffs, no action required @ date`）——on-call handoff 惯例「watch items 即使为空也列入交接」的直接对应。
- Renovate Dependency Dashboard=「例行观测回合完成定义」最接近先例：每轮产出显式持久观测状态面板（含无需处理部分）。
- **补第四件：观测回合时间戳与观测窗口声明（「截至何时」）**，否则下轮无法判断快照新鲜度。

### 问题 4：五件套文书清单的漏项

| 拟定五件套 | 业界对应惯例 | 判定 |
|---|---|---|
| ADR | ADR 惯例须含 rejected alternatives+consequences | **需补**：被拒绝替代方案留痕 |
| 债登记册续记 | risk register | 覆盖 |
| 词表 | 术语表 | 覆盖 |
| 交接文档 | on-call handoff | 覆盖 |
| 版本控制干净 | audit trail | 覆盖 |
| （缺）**审计 trail 映射** | compliance closeout 核心项 | **漏项 1**：判据↔证据产物可追溯映射（evidence mapping），缺了收口无法被事后审计 |
| （缺）**度量回写** | KRI 惯例 | **漏项 2（轻）**：豁免域数/fixture 红绿对数/存量扫描基线数一行回写供趋势对比 |
| （缺）**镜像文档与 ADR 一致性检查** | — | **漏项 3**：契约两载体（ADR+AGENTS.md 镜像）一致性纳入 CI 断言（如 grep 断言三豁免域关键词两处都出现） |

无过度项：「风险登记」已被债登记册覆盖；CI 全绿已在契约段；存量回归扫描（零新增违例）=ESLint `eslint:recommended` 更新时「存量 lint pass」标准做法，保留。

## 3) 推荐的收口判据修订稿（增量 diff）

- **(i) 取证段 +**：结论格式化——「零发现」也须产出显式一行结论（含观测窗口时间戳）并声明快照新鲜度。
- **(ii) 契约段 +**：每个豁免域 fixture 为**近邻成对**（豁免样本+一线之差非豁免样本），红状态须可被非豁免近邻区分，不可区分者显式标注 equivalent；**+** ADR 与镜像文档两处契约文本一致性纳入 CI 断言。
- **(iii) 文书段 +**：判据-证据映射表（每条判据↔佐证文件/commit/run URL）；**+** 一行度量回写（豁免域数、红绿对数、存量基线违例数）；**+** ADR 内含 rejected alternatives 段。

## 4) 完整来源清单

| # | 标题 | URL | 贡献 |
|---|---|---|---|
| 1 | Stryker Mutator 官方文档 | stryker-mutator.io/docs | 突变杀死/存活定义、邻近负例杀死 `return true` 突变 |
| 2 | CircleCI: What is mutation testing | circleci.com/blog/what-is-mutation-testing | 绿基线先行、boundary/负例断言、equivalent mutant 处置 |
| 3 | OPA Policy Testing | openpolicyagent.org/docs/policy-testing | 规则↔成对 allowed/denied test 一一映射 |
| 4 | ESLint v10 migration（RuleTester 严格化） | github.com/eslint/eslint migrate-to-10.0.0.md | valid 用例不得携带静默放行属性 |
| 5 | ESLint PR #20125（TSC 裁决记录） | github.com/eslint/eslint/pull/20125 | 契约+实现+测试同 PR 收敛治理流程 |
| 6 | Google SRE Book ch6 Monitoring | sre.google/sre-book/monitoring-distributed-systems | 观测产出可行动、零发现显式记录 |
| 7 | Renovate Dependency Dashboard | docs.renovatebot.com/bot-comparison | 例行观测回合持久显式状态面板 |
| 8 | On-call handover guide (shiftctl) | shiftctl.com/blog/on-call-handover-guide | 交接模板含 watch items+sign-off |
| 9 | ContextSafe DEFINITION_OF_DONE | github.com/ChelseaKR/contextsafe | AC 覆盖 fail-closed 路径、N/A 显式理由 |
| 10 | AWS Prescriptive Guidance: ADR process | docs.aws.amazon.com/prescriptive-guidance adr-process | decision log 完整性（摘要级） |

## 5) 信息缺口

- Tavily 全程配额耗尽→Exa+AnySearch 双引擎交叉；关键结论均 ≥2 独立信源。
- 「契约变更单独验证清单」无逐字命名标准——ESLint/OPA 流程惯例强归纳。
- on-call handoff 信源为社区博客非厂商权威，仅佐证低争议结论。
