# q1-atomcode.md — R68 Q1 调研原文存档（atomcode stdout+indexed sections，原样归档）

来源：ctx_batch_execute atomcode 单跑，2026-09-17。resume id: 37861c02-bc1a-4b7f-bc7b-65d0b52d218a

---

Executed 1 commands (88 lines, 13.4KB). Indexed 9 sections. Searched 3 queries.

## Commands

- atomcode: `cd /d/Aworker/anysearch-cli && atomcode -p "Research question for a release-engineering governance decision in the anysearch-cli repo (an information-specialized agent CLI published on npm as @anysearch-cli/*, latest 0.0.5, with three real agent-hosts verified: CodeBuddy, Claude Code, Codex CLI). CONTEXT: the project's own release pipeline bot (anysearch-release-bot) pushed a commit to main via a GitHub Actions pre-tag workflow_dispatch job (contents: write, git commit+push). That commit's read-…`

## Indexed Sections

- atomcode (1.9KB)
- 调研报告：release-bot 提交治理门禁设计 (0.1KB)
- 调研报告：release-bot 提交治理门禁设计 > 1) 执行摘要（Tl;dr） (0.8KB)
- 调研报告：release-bot 提交治理门禁设计 > 2) 分点结论 (1) (3.6KB)
- 调研报告：release-bot 提交治理门禁设计 > 2) 分点结论 (2) (0.6KB)
- 调研报告：release-bot 提交治理门禁设计 > 3) 对比矩阵：四种 bot-commit 门禁设计 (1.1KB)
- 调研报告：release-bot 提交治理门禁设计 > 4) 推荐：选 (B)，带权重 (2.2KB)
- 调研报告：release-bot 提交治理门禁设计 > 5) 完整来源清单 (2.5KB)
- 调研报告：release-bot 提交治理门禁设计 > 6) 信息缺口 (0.7KB)

## theme recommendation bot gate vs host verification

### 调研报告：release-bot 提交治理门禁设计 > 4) 推荐：选 (B)，带权重
## 4) 推荐：选 (B)，带权重

**Bot-gate 治理主题为主线（约 80% 票量），Antigravity 为同轮次级票（约 20%）**，main-heal 是 ticket 0：

1. **T0 灭火**：恢复 eval-looks.json 的 schema_version sentinel，重跑 ci+ship-gate，拿到双绿 run URL（这正是上一轮遗漏的交接字段——先补上）。
2. **T1 gate（本轮核心 ADR）**：release-bot 的 pre-tag workflow 拆成 commit-push → wait-on-check（ci+ship-gate）→ 才允许继续 tag/publish；红则**告警并阻断发布**（不自动 revert——本仓库发布频率低、共享 main 上 revert 竞态收益不抵风险，与矩阵结论一致）。ADR-0020 的 D1/D2 门禁族谱上新增 D3=bot 自证门。
3. **T2 人工收口字段机器化**：ship-gate 加一个 lint 步骤校验收口文档的 green-run-URL 字段存在且指向本轮 run（require-checklist 模式的本地化）。
4. **T3 Antigravity 第四宿主（次级）**：先 spike 验证本机 Antigravity.exe 的 hooks/`-p` 面与文档一致（第三方 hooks 细节未经官方证实），然后把已有的 `adapters/antigravity.ts` 走完 r56 已建的 session_id 传播验收路径。**不单独成轮**——它的验收基建（hook 测试、install-smoke 模式）本轮已建好，边际成本低。

**外部评审处方中的弱点，需在 ADR 里明示**：
- **(2) "auto-rollback or alert on red" 二选一是假的**：在共享 main 上自动 revert 被社区明确标注为高风险（some-natalie.dev），而 Renovate/Dependabot/SRE 生态的成熟答案全都是 *先验证后落盘*（wait/required-checks），事后回滚只是兜底。应裁决为 **alert-and-block，不做自动 revert**，把 revert 留给人。
- **(1)+(2) 顺序对但缺了第三层**：这次事故同时暴露 bot 层和 **human closeout 层**（漏填 green run URL）两个缺口，评审只开了 bot 侧的药；清单强制（T2）便宜且直接对症，必须同轮进票。
- **(3) "Antigravity as verifiable host" 低估了合同差异**：hooks 返回信封语义与 Claude Code 不同（顶层 `{allow_tool}` vs `hookSpecificOutput`），ADR-0068 的教训（信封问题导致 ~80% 丢弃）应提前写进验收判据，否则会复演同一类坑。

### 调研报告：release-bot 提交治理门禁设计 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐方案 (B)——双主题：bot-gate 治理（含 main-heal 作为 ticket 0）+ Antigravity 第四宿主验证**，但把 Antigravity 降级为次要票。理由：main 现在是红的，任何下一步工作（包括 Antigravity 验证）都要在一个可信任的主干上做；bot-gate 是修复“看门人无人看守”的结构性缺陷，且这次事故恰好暴露了三层缺口（bot 提交无回读、分支保护未覆盖 bot 推送、人工收口字段无机器校验）。Confidence：**高**——设计空间有成熟的业界模式（wait-on-check、required checks、auto-revert watchdog），且 Antigravity 官方文档确认其插件/hooks/CLI 合同面与 Claude Code 高度同构，接入成本低，可作为同一轮的轻量收尾票而非独立轮次。

### 调研报告：release-bot 提交治理门禁设计 > 2) 分点结论 (2)
**(d) 人工强制字段模型**
- 成熟做法都是**把模板合规变成机器闸门**而非约定：`mheap/require-checklist-action`（有未勾选 checkbox 就 fail PR）、`pr-template-enforcer`（required-sections 非空 + 与模板 diff 相似度 >95% 视为未填 + 可按 bot 用户豁免）（两个 GitHub Action README，已抓）。映射到本项目：收口票的 "green run URL" 字段应做成 **CI lint**——脚本 grep 收口文档中的 URL/字段，缺失即 ship-gate 失败。这与本项目"deliverable 绝对路径纪律"同构，是纯机械校验，成本极低。

## CI bot commit governance industrial mental models

### 调研报告：release-bot 提交治理门禁设计 > 3) 对比矩阵：四种 bot-commit 门禁设计
## 3) 对比矩阵：四种 bot-commit 门禁设计

| 方案 | 拦截时机 | 成熟度/采用者 | 主要风险 | 适配本项目 |
|---|---|---|---|---|
| workflow 自等 checks（wait-on-check） | 发布前，同一 workflow 内 | 高：marketplace 标准 action，Renovate 类 bot 的 PR 变体 | 只看 bot 自己那次 run；等待有超时 | ★★★★★ 改动最小，pre-tag workflow 里加一个 wait job 即可 |
| 分支保护 required-checks | push 落 main 之前由平台拦 | 最高：Renovate/Dependabot 全走此路 | 本项目 bot 用 contents:write 直推 main，需改成 PR 或 merge-queue 模式 | ★★★★ 结构最正确但动 release 流程 |
| post-commit watchdog auto-revert | 落 main 之后事后修 | 中：社区有先例但作者自标 questionable | 递归回滚震荡、与人工热修竞态、只回滚代码不回滚环境 | ★★ 仅作二线兜底 + 告警，不做静默 revert |
| 告警即阻断（alert-and-block） | 红→通知人→冻结发布 | 高：SRE 默认形态 | 依赖人在线响应 | ★★★★ 与“watchdog 只告警不 revert”组合为本轮落地形态 |

### 调研报告：release-bot 提交治理门禁设计 > 4) 推荐：选 (B)，带权重
## 4) 推荐：选 (B)，带权重

**Bot-gate 治理主题为主线（约 80% 票量），Antigravity 为同轮次级票（约 20%）**，main-heal 是 ticket 0：

1. **T0 灭火**：恢复 eval-looks.json 的 schema_version sentinel，重跑 ci+ship-gate，拿到双绿 run URL（这正是上一轮遗漏的交接字段——先补上）。
2. **T1 gate（本轮核心 ADR）**：release-bot 的 pre-tag workflow 拆成 commit-push → wait-on-check（ci+ship-gate）→ 才允许继续 tag/publish；红则**告警并阻断发布**（不自动 revert——本仓库发布频率低、共享 main 上 revert 竞态收益不抵风险，与矩阵结论一致）。ADR-0020 的 D1/D2 门禁族谱上新增 D3=bot 自证门。
3. **T2 人工收口字段机器化**：ship-gate 加一个 lint 步骤校验收口文档的 green-run-URL 字段存在且指向本轮 run（require-checklist 模式的本地化）。
4. **T3 Antigravity 第四宿主（次级）**：先 spike 验证本机 Antigravity.exe 的 hooks/`-p` 面与文档一致（第三方 hooks 细节未经官方证实），然后把已有的 `adapters/antigravity.ts` 走完 r56 已建的 session_id 传播验收路径。**不单独成轮**——它的验收基建（hook 测试、install-smoke 模式）本轮已建好，边际成本低。

**外部评审处方中的弱点，需在 ADR 里明示**：
- **(2) "auto-rollback or alert on red" 二选一是假的**：在共享 main 上自动 revert 被社区明确标注为高风险（some-natalie.dev），而 Renovate/Dependabot/SRE 生态的成熟答案全都是 *先验证后落盘*（wait/required-checks），事后回滚只是兜底。应裁决为 **alert-and-block，不做自动 revert**，把 revert 留给人。
- **(1)+(2) 顺序对但缺了第三层**：这次事故同时暴露 bot 层和 **human closeout 层**（漏填 green run URL）两个缺口，评审只开了 bot 侧的药；清单强制（T2）便宜且直接对症，必须同轮进票。
- **(3) "Antigravity as verifiable host" 低估了合同差异**：hooks 返回信封语义与 Claude Code 不同（顶层 `{allow_tool}` vs `hookSpecificOutput`），ADR-0068 的教训（信封问题导致 ~80% 丢弃）应提前写进验收判据，否则会复演同一类坑。

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research question for a release-engineering governance decision in the anysearch-cli repo (an information-specialized agent CLI published on npm as @anysearch-cli/*, latest 0.0.5, with three real agent-hosts verified: CodeBuddy, Claude Code, Codex CLI). CONTEXT: the project's own release pipeline bot (anysearch-release-bot) pushed a commit to main via a GitHub Actions pre-tag workflow_dispatch job (contents: write, git commit+push). That commit's read-…

我将按“comparison/默认混合”模式执行：先召回知识库，再三引擎多角度检索（bot 提交治理 / 门禁设计对比 / Antigravity 合同面 / 人工交接清单），定点抓原文核验，最后给出主题选择建议。知识库已召回本地背景（r63 收口、antigravity adapter 已有雏形）。现在三引擎并行发起第一阶段广泛搜索。第一阶段检索完成，开始定点抓取原文核验（Antigravity 官方 docs、auto-revert 博文、等待检查模式等）。继续第二阶段：补充 SRE 治理、Renovate/Dependabot 自动合并门禁、人工交接清单强制机制三个角度，并交叉验证 Antigravity CLI headless/AGENTS.md 支持。补足配额：人工交接清单强制模型 + Renovate 官方 automerge 语义核验。最后补一次官方原文核验（Antigravity headless/CLI 模式），然后综合输出。## 配额自查

searches: 8（web_search ×3 / tavily ×3 / anysearch ×2）| angles: Official、Comparative、Criticism、Currency、Community（5 类全覆盖）| full reads: 6（antigravity.google/plugins、antigravity.google/cli/headless、some-natalie.dev、Medium hooks 指南、computingforgeeks cheat sheet、docs.renovatebot.com）| gaps: Antigravity 桌面版（IDE 非 CLI）与 CLI 的 hooks 配置共享程度未实测，仅有官方插件文档 + 第三方指南双源支撑

## antigravity IDE hooks MCP contract surface

### 调研报告：release-bot 提交治理门禁设计 > 2) 分点结论 (1)
## 2) 分点结论

**(a) 业界治理心智模型**
- **Renovate/Dependabot 模式**：bot 从不直推主干，只开 PR；automerge 的前提是 *所有 required status checks 通过*——bot 的提交由 GitHub 的分支保护机制“替它看”，bot 本身不做事后自检（docs.renovatebot.com；tenthirtyam.org 对比文）。这是"who watches the watcher"的最低成本答案：**让平台层当看守，bot 不自证**。
- **wait-on-check 模式**：当 bot 必须直推（如本项目的 pre-tag workflow_dispatch），标准做法是在同一 workflow 内用 `lewagon/wait-on-check-action` 轮询 Checks API，等 CI 全绿后才继续 publish 步骤——marketplace 文档明说这正适合"publish 前等 tests"的场景（github.com/marketplace/actions/wait-on-check）。**本项目的 release-bot 缺的正是这一步：commit+push 后盲走。**
- **Google SRE 模型**：发布流程“reproducible, automated, changes intentional”；CRE 经验强调每次 release 都是事故来源，必须预设回滚路径（sre.google/sre-book/release-engineering；cloud.google.com CRE life lessons）。SRE 的对应做法不是“bot 自检”，而是**金丝雀 + 预授权回滚**——映射到 git 即：bot 提交后由独立 watchdog 验证，红则 `git revert`。
- **Watchdog auto-revert 模式**：社区有完整可复用先例——`needs: [check]` + `if: failure()` + `git revert ${{ github.sha }}` 推回主干（some-natalie.dev，2022 首发 2025 更新）。但作者自己标了 "questionable-ideas" 标签并列出风险（见下）。

**(b) 设计空间对比**（见矩阵）。关键点：**auto-revert 在共享 main 上有真实风险**——(1) 递归回滚：revert 本身又是一次 push，若 revert 提交也红，会震荡，必须用 GITHUB_TOKEN（不触发递归 workflow）+ 路径/事件过滤 + "只 revert 触发本次 run 的那个 SHA"；(2) 与人工 push 竞态：bot revert 和人类热修并发时可能 revert 掉别人的修复；(3) 回滚的是“代码”而非“环境状态”。因此成熟项目普遍**首选 required-checks 平台门禁，auto-revert 只作为二线**（some-natalie.dev 自述 + Renovate/Dependabot 全部走 required-checks 路线）。

**(c) Antigravity 合同面——可行性结论：可作第四宿主**
- **Hooks**：官方插件体系包含 `hooks.json`（antigravity.google/docs/plugins，已抓原文）；第三方深度指南确认 CLI 的 hooks 机制是 `{matcher, hooks:[{type:"command",command,timeout}]}` 结构，全局在 `~/.gemini/antigravity-cli/hooks.json`，项目级在 `<project>/.agents/hooks.json`（Medium/Google Cloud 社区，2026-06）。**注意与 Claude Code 的两个差异**：返回 payload 须顶层 `{allow_tool, deny_reason}` 而非 `hookSpecificOutput` 信封；脚本须恒 exit 0。这与本仓库 ADR-0068 记录的 codex 宿主信封问题同类——adapter 层需要一次 env-shim，且仓库里已有 `apps/plugin/src/hooks/adapters/antigravity.ts` 骨架（知识库召回证实）。 <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
- **MCP**：`mcp_config.json` 挂在插件根，`agy plugin import claude` 可直接导入 Claude 配置（computingforgeeks cheat sheet，2026-09 更新）。
- **Headless/CLI**：`agy -p` 单发退出，`--output-format json/stream-json`、`--json-schema` 结构化输出、CI 示例文档化（antigravity.google/docs/cli/headless，已抓原文）——**eval harness 接入面与 claude -p 同构，接入成本低**。
- **规则注入**：`GEMINI.md`/`AGENTS.md` 原样识别（cheat sheet）。
- 缺口：上述 hooks 细节来自第三方指南而非官方文档（官方只给了插件目录结构），落 ticket 前应先在本机做一次 spike 验证。

### 调研报告：release-bot 提交治理门禁设计 > 5) 完整来源清单
## 5) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Wait on check — GitHub Marketplace | github.com/marketplace/actions/wait-on-check | Official/Comparative | — | workflow 自等 checks 的标准实现与适用场景 |
| Undo a commit on a failed GitHub Actions job | some-natalie.dev/blog/undo-commit-on-failure | Criticism/Community | 2022-11（2025-03 更新） | auto-revert watchdog 全码 + 作者自述风险（递归、竞态、"questionable"） |
| Google SRE Book — Release Engineering | sre.google/sre-book/release-engineering | Official | — | 发布流程可复现性、变更意向性原则 |
| Reliable releases and rollbacks — CRE life lessons | cloud.google.com/blog/products/gcp/reliable-releases-and-rollbacks-cre-life-lessons | Official | — | 每次发布即潜在事故源、预授权回滚心智 |
| Renovate Configuration Options | docs.renovatebot.com/configuration-options/ | Official | 当前 | automerge 与 status-check 的关系；vuln-fix 特例 |
| Dependabot vs Renovate (tenthirtyam) | tenthirtyam.org/dispatches/2026/05/13/dependabot-vs-renovate... | Comparative | 2026-05 | required-checks/merge-queue 下 bot 等待行为对比 |
| Antigravity Docs — Plugins | antigravity.google/docs/plugins | Official | 当前 | hooks.json/mcp_config.json/AGENTS.md 官方合同面 |
| Antigravity Docs — Headless mode | antigravity.google/docs/cli/headless | Official | 当前 | `agy -p`、json/stream-json、CI 集成示例 |
| A Developer's Guide to Agent Hooks in Antigravity CLI | medium.com/google-cloud/a-developers-guide-to-agent-hooks-in-antigravity-cli-4c1440febd11 | Community/Official-ish | 2026-06 | hooks 配置路径、信封差异（顶层 allow_tool）、exit-0 语义 |
| Antigravity CLI Cheat Sheet | computingforgeeks.com/antigravity-cli-cheat-sheet/ | Community/Currency | 2026-09 | agy flags、`plugin import claude`、GEMINI.md/AGENTS.md 承接 |
| require-checklist-action | github.com/mheap/require-checklist-action | Official(tool) | — | 清单未勾即失败的机器强制模式 |
| pr-template-enforcer | github.com/rohitjmathew/pr-template-enforcer | Official(tool) | 2025-04 | required-sections 非空 + 模板相似度检测 + bot 豁免 |
| GitHub Auto-Merge / Mergify | mergify.com/blog/github-auto-merge-when-native-is-enough | Comparative | 2026-04 | 平台层自动合并的 required-checks 语义 |
| Software Engineering at Google ch23 (CI) | abseil.io/resources/swe-book/html/ch23.html | Official | — | continuous build/test 门禁的组织级实践 |

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research question for a release-engineering governance decision in the anysearch-cli repo (an information-specialized agent CLI published on npm as @anysearch-cli/*, latest 0.0.5, with three real agent-hosts verified: CodeBuddy, Claude Code, Codex CLI). CONTEXT: the project's own release pipeline bot (anysearch-release-bot) pushed a commit to main via a GitHub Actions pre-tag workflow_dispatch job (contents: write, git commit+push). That commit's read-…

我将按“comparison/默认混合”模式执行：先召回知识库，再三引擎多角度检索（bot 提交治理 / 门禁设计对比 / Antigravity 合同面 / 人工交接清单），定点抓原文核验，最后给出主题选择建议。知识库已召回本地背景（r63 收口、antigravity adapter 已有雏形）。现在三引擎并行发起第一阶段广泛搜索。第一阶段检索完成，开始定点抓取原文核验（Antigravity 官方 docs、auto-revert 博文、等待检查模式等）。继续第二阶段：补充 SRE 治理、Renovate/Dependabot 自动合并门禁、人工交接清单强制机制三个角度，并交叉验证 Antigravity CLI headless/AGENTS.md 支持。补足配额：人工交接清单强制模型 + Renovate 官方 automerge 语义核验。最后补一次官方原文核验（Antigravity headless/CLI 模式），然后综合输出。## 配额自查

searches: 8（web_search ×3 / tavily ×3 / anysearch ×2）| angles: Official、Comparative、Criticism、Currency、Community（5 类全覆盖）| full reads: 6（antigravity.google/plugins、antigravity.google/cli/headless、some-natalie.dev、Medium hooks 指南、computingforgeeks cheat sheet、docs.renovatebot.com）| gaps: Antigravity 桌面版（IDE 非 CLI）与 CLI 的 hooks 配置共享程度未实测，仅有官方插件文档 + 第三方指南双源支撑


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: mcp_config, workflow_dispatch, allow_tool, hookspecificoutput, require-checklist-action, pr-template-enforcer, required-sections, questionable, alert-and-block, release-engineering, computingforgeeks, some-natalie, required-checks, comparative, tenthirtyam, stream-json, merge-queue, criticism, community, main-heal, ship-gate, atomcode, contents, official, currency, bot-gate, required, sre-book, adr-0068, adapters, project, adapter, lessons, 2026-06, 2026-09, gemini, plugin, import, action, agent