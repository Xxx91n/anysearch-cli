# q2-atomcode.md — R68 Q2 调研原文存档（atomcode stdout+indexed sections，原样归档）

来源：ctx_batch_execute atomcode 单跑，2026-09-17。

---

Executed 1 commands (125 lines, 16.0KB). Indexed 15 sections. Searched 3 queries.

## Commands

- atomcode: `cd /d/Aworker/anysearch-cli && atomcode -p "Follow-up research for the anysearch-cli repo's release-pipeline bot-gate design (round 2). DECISION ALREADY MADE: the round's theme is repo-writing-automation gating, alert-and-block form, NO auto-revert (R68 ledger D-001). NOW DECIDING: gate PLACEMENT. CURRENT PIPELINE (verified from .github/workflows/release.yml): (1) pre-tag job on workflow_dispatch runs an OF-look eval peek then 'git commit + git push' directly to main with contents:write — blind,…`

## Indexed Sections

- atomcode (1.5KB)
- Gate 放置方案调研报告（round 2：placement） (0.1KB)
- Gate 放置方案调研报告（round 2：placement） > 1) 执行摘要（Tl;dr） (1.1KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 (0.0KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.1 轮询哪个 API（a 部分） (1.2KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.2 空窗 race 与超时预算（a 部分，最高优先级的坑） (1.8KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.3 publish 门：断言即刻失败 vs 等待（b 部分） (1.4KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.4 双层是否过度工程（c 部分） (1.2KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.5 告警形态（d 部分） (1.3KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.6 替代门形（e 部分） (1.2KB)
- Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.7 选项集遗漏（f 部分） (0.8KB)
- Gate 放置方案调研报告（round 2：placement） > 3) 对比矩阵 (0.5KB)
- Gate 放置方案调研报告（round 2：placement） > 4) 实现陷阱（按优先级） (0.8KB)
- Gate 放置方案调研报告（round 2：placement） > 5) 完整来源清单 (2.5KB)
- Gate 放置方案调研报告（round 2：placement） > 6) 信息缺口 (0.6KB)

## wait-on-check implementation pitfalls check-runs race

### Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.2 空窗 race 与超时预算（a 部分，最高优先级的坑）
### 2.2 空窗 race 与超时预算（a 部分，最高优先级的坑）

lewagon action 的 **issue #137**（2026-03，已修）精确记录了你们的场景：push 后瞬间查询，目标 check-run **尚未被创建**（尤其带 `needs` 的 job 要等前置 job 完成才创建 check-run），action 直接报 "The requested check was never run against this ref" 退出。修复是加 `checks-discovery-timeout`（默认 60s）先轮到 check **出现**再轮其**完成**。

实现要点排序：

1. **必须分两段轮询**：先等 check “存在”（discovery，预算 ~60-120s，覆盖 workflow queue 排队），再等 “完成”（conclusion，预算 = 两个 workflow 的实际时长 4-8 min × 2 平台取上限，建议 **15-20 min 硬超时**，超时判失败——fail-closed）。
2. **同名多 run 歧义**：lewagon commit b91bfa3 记录了 filter=latest 的非确定性——同名 check（retry/重跑）早完成的失败会误杀等待。若你们有 re-run 习惯，轮询时应取**最新且全部终态**再判，或直接用 `filter=all` 语义。
3. **API 限速**：`wait-interval` 建议 ≥15-30s（lewagon 官方 known limitation 点名 rate limits）；用 `gh api` 手写同样会烧 GITHUB_TOKEN 的 1000 req/h 额度，20min 轮询 30s 间隔 = 40 次，安全。
4. **hand-rolled vs marketplace**：lewagon/wait-on-check-action（395★，v1.9.1，2026 年仍在活跃修 bug）已内置 discovery-timeout / fail-on-no-checks / wait-for-duplicates，**建议直接用**，自己写 shell 轮询容易漏掉 #137 这类空窗。它依赖第三方 action 的供应链风险可用 pin SHA 缓解。备选：`WenweiL/SHA-Allowed-Check`、`release-drafter` 系皆弱于此；`gh pr checks` 只适用于 PR ref，不适用你们直接 push 的场景。

### Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.1 轮询哪个 API（a 部分）
### 2.1 轮询哪个 API（a 部分）

| 维度 | check-runs | commit statuses | check-suites |
|---|---|---|---|
| 粒度 | 每个 job 一条 | 每 context 一条（external CI 用） | 一组 check-runs 的聚合 |
| 读取权限 | GITHUB_TOKEN 可读（写才要 GitHub App `checks:write`） | 任意 read 即可 | 同 check-runs |
| 缺口 | job 未创建时**不存在**（见 2.2 race） | `pending` 当且仅当“无任何 status 或有 pending”——**“无 status”也报 pending**，语义对轮询友好 | 不适合直接轮询 |

**结论：轮询 check-runs**（`GET /repos/{o}/{r}/commits/{sha}/check-runs`），与 ci.yml/ship-gate.yml 这类 Actions workflow 的产出一一对应。commit statuses 是给外部 CI 服务的，你们没人写 status，轮它会永远 pending。这就是 lewagon/wait-on-check-action 的做法（其 README 明言 "uses GitHub's Checks API to poll"）。

**权限陷阱**：只需**读** checks，`GITHUB_TOKEN`（`actions: read` 隐含）足够；若想**写** check-run/status 必须是 GitHub App（官方原文："Write permission for the REST API to interact with checks is only available to GitHub Apps"）。所以自建 polling 不需要申请任何额外 token 权限——这点很多博客讲错。

### Gate 放置方案调研报告（round 2：placement） > 5) 完整来源清单
## 5) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| lewagon/wait-on-check-action README | https://github.com/lewagon/wait-on-check-action/ | Official/Comparative | 维护中(v1.9.1) | 轮 Checks API；discovery-timeout/wait-interval 参数；workflow_run 局限官方表述 |
| issue #137 "fails immediately when check hasn't been created yet" | https://github.com/lewagon/wait-on-check-action/issues/137 | Criticism | 2026-03-17 | 空窗 race 一手记录与根因代码 |
| commit b91bfa3 (wait-for-duplicates) | https://github.com/lewagon/wait-on-check-action/commit/b91bfa3dceac87872c0da7d3f415a8b697f41e72 | Criticism | — | 同名 check filter=latest 非确定性 |
| Commit statuses REST API | https://docs.github.com/en/rest/commits/statuses | Official | — | statuses 聚合语义（无 status=pending）；外部 CI 定位 |
| Checks API 指南 | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks | Official | — | **写权限仅 GitHub App**（`checks:write`），读不需要 |
| Troubleshooting required status checks | https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks | Official | — | required checks 仅在 PR 评估；直 push 不被拦 |
| About protected branches | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/... | Official | — | "…or pushed directly to the protected branch" 直 push 例外原文 |
| Required workflows changelog | https://github.blog/changelog/2023-03-09-github-actions-required-workflows-improvements/ | Official/Currency | 2023-03-09 | org 级 required workflows 可阻直 push（个人 repo 不可用） |
| OneUptime deployment gates | https://oneuptime.com/blog/post/2025-12-20-deployment-gates-github-actions/view | Comparative | 2025-12-20 | environments/reviewers/wait-timer 门形全景 |
| Bitwarden npm 供应链事件 | https://cryptorank.io/news/feed/96092-... | Currency | 2026 | npm 官方推荐 environments+tag protection 控制发布面 |
| gomakethings npm release flow | https://gomakethings.com/articles/how-to-automatically-create-a-new-release-and-publish-to-npm-whenever-package.json-is-updated-using-a-github-action | Community | — | “PR 合并后打 tag” 即 PR-mode 先例 |
| dev.to semantic-release workflow | https://dev.to/seven/automating-npm-package-releases-with-github-actions-14i9 | Community | — | semantic-release 单 workflow 内 needs 链范式 |

## publish gate tagged SHA CI green precedent

### Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.3 publish 门：断言即刻失败 vs 等待（b 部分）
### 2.3 publish 门：断言即刻失败 vs 等待（b 部分）

**两者都要，但形式不同**：

- **pre-tag 自等待**处用 **wait 语义**（这是唯一有意义的等待点——release 动作发生在此刻）。
- **post-tag/publish 前提**处用 **assert-and-fail-fast 语义，但要等待策略**：tag 是在 pre-tag job 刚 wait 完绿树后打的，理论上 tagged SHA 的 ci/ship-gate 大概率仍绿或进行中。但存在两个现实缺口：(i) 两次 push 之间可能有人类直接 push 了新 main（required checks 不拦直接 push，见 §1）；(ii) eval 顺序导致的非确定性。所以 publish 前对 tagged SHA 做 `gh api check-runs` 查询：**全绿 → 放行；有红 → 立刻失败；仍 in-progress → 短轮询（≤10min）收敛后再判**。
- **成熟管线先例**：semantic-release / changesets 的范式是 **"publish 只认自己前面的 job 链"**——即 CI 在同一 run 内做完测试才走到 publish step，本质是把“等待”前置成 workflow 结构（semantic-release 文档化模式：release job `needs` test job）。你们因 publish 挂在 tag-push 独立 workflow 上做不到 `needs`，所以 **B+A 的等待/断言就是手工重建 semantic-release 的 job 依赖语义**——这不是发明，是等价物。（goreleaser 一手表态未查到，标注为缺口；但 GoReleaser 社区共识同样是先 CI 绿再打 tag，属于流程约定而非工具强制。）

### Gate 放置方案调研报告（round 2：placement） > 2) 分点结论 > 2.4 双层是否过度工程（c 部分）
### 2.4 双层是否过度工程（c 部分）

**不过度，理由有事实支撑而非风格偏好**：两层防的是**不同攻击/事故路径**——

- 第 (i) 层（pre-tag 自等待）防：**bot 自己推上去的坏 commit** 被后续人类 push 埋进树里（本次事故形态：sentinel 损坏 → 两次 main push 变红）。
- 第 (ii) 层（publish 断言）防：**tag 到 publish 之间的时间差**里树变红、以及 tag 实际指向的 SHA 与 pre-tag job 验证过的 SHA 不一致（人手补 tag、re-tag）。
- 方案 B（只做 i）挡不住 v0.0.5 的确切形态（publish 无 CI 检查）；方案 C（只做 ii）挡不住坏 commit 污染后续开发树。事故已经各发生了一次，两层各有独立成立性。
- **真正的过度工程信号在 D**：PR-mode/required-checks 结构重排是对的长期形态，但它要重排 bot 的全部写入路径，与“告警阻塞、不自动回滚”的既定主题（R68 D-001）相比成本不成比例。建议作为 ADR 的 "future direction" 记录而非本轮实施。
- 低频不是豁免理由：低频 = 事故发现更晚（等下次 release 才暴露）+ 无肌肉记忆兜底，恰恰更需要自动门。

### Gate 放置方案调研报告（round 2：placement） > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐方案 A（双层），但实现上做减法**：pre-tag 自等待（poll checks API）+ post-tag/publish 前对 tagged SHA 做断言。理由：你们的管线是 **workflow_dispatch → 机器人直接 push main → 另一个 workflow 靠 tag push 触发**，这恰好同时踩中两个 GitHub 的结构性盲区——(i) required status checks / branch ruleset **不阻止直接 push**（它们只在 PR merge 时评估，docs 原文："After all required status checks pass, any commits must either be pushed to another branch and then merged or pushed directly to the protected branch"——直接 push 不被拦）；(ii) tag push 触发的 publish job 与 ci/ship-gate 是**不同 workflow，`needs` 无效**，publish 天然不感知 CI 结论。v0.0.5 红树发布正是这两个盲区的叠加。**Confidence：高**——机制性结论全部来自 GitHub 官方文档原文 + lewagon action 的 issue/commit 一手记录，多源交叉；唯一中置信的是“双层是否过度工程”的判断（见 §4，倾向于不过度，因为有真实事故支撑）。

## dual-layer gate over-engineering verdict

### Gate 放置方案调研报告（round 2：placement）
# Gate 放置方案调研报告（round 2：placement）

### Gate 放置方案调研报告（round 2：placement） > 2) 分点结论
## 2) 分点结论

### Gate 放置方案调研报告（round 2：placement） > 3) 对比矩阵
## 3) 对比矩阵

| 方案 | 挡“bot 坏 commit 污染树” | 挡“红树发版” | 实现成本 | 评价 |
|---|---|---|---|---|
| **A 双层** | ✅ | ✅ | 中（一个 wait step + 一个 assert step） | **推荐**；两层各挡一条独立事故路径 |
| B 仅 pre-tag 自等待 | ✅ | ❌（v0.0.5 形态重现） | 低 | 不完整 |
| C 仅 publish 断言 | ❌ | ✅ | 低 | 不完整 |
| D PR-mode 结构重排 | ✅（根除） | ✅（根除） | 高 | 正确终态，本轮过度；记 ADR future |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: workflow_dispatch, github_token, workflow_run, deployment-gates, troubleshooting, wait-interval, semantic-release, environments, wait-on-check-action, discovery-timeout, wait-for-duplicates, comparative, check-runs, fail-closed, deployment, protection, placement, criticism, community, protected, reviewers, bitwarden, changelog, atomcode, official, currency, post-tag, 双层是否过度工程, ruleset, context, pending, pushed, action, filter, latest, re-run, re-tag, future, round, d-001