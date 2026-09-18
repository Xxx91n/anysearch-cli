# R71 Q2 AtomCode 调研存档 — 路径类 lint+教义精化形态

日期 2026-09-19 · atomcode resume id: 23b2b94f-44e2-47f9-b871-886f12e2f449

## 裁决

Option A（按引用用途精炼教义+fail-closed lint 腿+声明标记豁免），但做三处修正。

## 分点论证

1. 按用途精炼>一刀切禁令：docs-as-code lint 共识=规则服务具体目标非形式整齐（Netlify TextLint 只管术语大小写；Vale=可配置规则集）。机器本地路径是三类问题非一类：①deliverable 定位符（教义合法目的，绝对路径是 feature）；②库内目标引用（应 repo-relative）；③库外目标（只能声明）。B 压成一禁令必打击①，团队学会绕过 lint（secret-scanner 实践：高误报规则被整条关闭）。
2. Stack/locator 绝对路径只在这一个用途存活；要求=绝对路径不得成为库内内容的唯一引用方式（broken-link 变体，docs lint 经典职责）。
3. 声明标记豁免健全的前提是像 gitleaks baseline 一样被治理：显式/可审查/进版本库——豁免本身是被 lint+review 看见的 artifact。DevSecOps：例外须有 owner/范围/关闭标准否则成 bypass debt。
4. 历史文档机械扫+转换不 grandfather：无损可转换（每个 D:\Aworker\... 都有相对孪生）+修类文化先例；grandfather=缺陷永久合法化，fail-closed gate 上线即红或豁免清单淹没。先扫后启 gate 是唯一自洽顺序。
5. Temp transcript 单独裁决：证据=检索非重建（audit prep becomes retrieval, not reconstruction）——只存审计机 Temp=反模式（screenshots substitute for system records）。默认应提交入库（.scratch/.../evidence/）；一次性产物至少记哈希+「已销毁，结论由 ADR 文本承载」声明。
6. Lint 腿位置：ship-gate fail-closed doc-gate 层与现有 SHA/URL leg 并列（行业=pre-commit 快速反馈+CI 强制兜底，CI 是权威门）。扫面 docs/**/*.md+.scratch/**/{handoffs,reports,ledger}/**/*.md；正则 [A-Za-z]:[\\/]、/Users/、/home/、AppData、/tmp/；注意 ^[A-Za-z]:[\\/] 锚行首或配非路径字符判断避免把 https: 误伤。fail-closed 正确（低噪高保真，误报用声明标记消化）。

## 对 A 的三处修正（采纳 A 时一并做）

1. 声明标记带治理字段：<!-- machine-local: <reason> @ <date> -->；lint 对无日期/无事由裸声明视为违规；每季度审计未关闭声明。
2. Temp transcript 默认提交非二选一——只有确认无保留价值才用「哈希+销毁声明」路径。
3. 扫面加上 .scratch 全部 markdown 的可配置子集：用目录清单配置化，新增文档类型时显式登记（防 evidence/ 等目录遗漏）。

## 信息缺口

- 无专门「monorepo 文档内 repo-relative vs absolute」一手规范，结论由 broken-link lint 惯例+移植性常识类比支撑。
- Vale/rumdl 是否原生支持路径形状正则未验证——本仓已有自研 ship-gate，自实现正则腿即可，不构成裁决风险。

## 来源

1. Netlify Docs Linting in CI/CD（全文）
2. Docsio Vale Linter Complete Guide（全文）
3. gitleaks README（全文：allowlist+baseline+双层强制）
4. Rafter Pre-Commit Hooks for Secret Detection（摘要）
5. CloudAware DevSecOps Compliance（全文：evidence=检索非重建；例外须 time-boxed 带 owner/closure）
6. OneUptime Secret Detection（摘要：detect-secrets baseline artifact）
7. Fern Docs Linting Guide（摘要）
