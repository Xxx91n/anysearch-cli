# q3-atomcode.md — R68 Q3 调研原文存档

来源：ctx_batch_execute atomcode 单跑，2026-09-17。resume id: d48a4d04-d995-4a0a-9279-cb6a1e8b2e42

---

Executed 1 commands (97 lines, 12.7KB). Indexed 10 sections. Searched 4 queries.

## Commands

- atomcode: `cd /d/Aworker/anysearch-cli && atomcode -p "Research round 3 for the anysearch-cli repo — acceptance-criteria design for a SECONDARY ticket (the round's main theme is release-bot gating, already decided). SUBJECT: verifying Google Antigravity as the 4th real agent-host for the project's plugin hooks layer. EXISTING STATE (verified in-repo): apps/plugin/src/hooks/adapters/antigravity.ts exists (Gemini-CLI lineage; 5 events PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop; reads hook_event…`

## Indexed Sections

- atomcode (1.7KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 (0.1KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 1) 执行摘要（Tl;dr） (0.7KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 2) 分点结论 (1) (3.5KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 2) 分点结论 (2) (1.8KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 3) 对比矩阵 (0.6KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 4) 验收标准内容（建议写进 ticket） (1.5KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 5) 不诚实标注风险 (0.6KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 6) 完整来源清单 (1.6KB)
- Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 7) 信息缺口 (0.6KB)

## agy CLI install bundled IDE hooks config location

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 4) 验收标准内容（建议写进 ticket）
## 4) 验收标准内容（建议写进 ticket）

- **Spike exit（全过才进 acceptance；任一失败 → ticket 降级为 host-limitation 证据，ADR 记 D-entry）**
  - s0: agy 经官方 install.ps1 可安装、`agy --version` ≥1.1.10、`agy -p` 能返回。
  - s1: 实测 hooks 配置生效位置（`.agents/hooks.json` vs `~/.gemini/config/` vs `~/.gemini/antigravity-cli/`），以 transcriptPath 目录（`antigravity-cli/brain`）证明执行表面为 CLI。
  - s2: L0-L3 四腿裁决，L-envelope 主腿为顶层 `{"decision":"allow"}`，L-bare 测 `{"allow_tool":false}` legacy 形状，记录 exit-code fallback 语义；结论与官方 docs 冲突处写成显式 finding。
  - s3: `agy -p` 下 hooks 触发 + 输出可观测。
- **Acceptance（reduced matrix，6 腿）**：契约端到端（in-domain search 放行 + OOD abstain 经 `{"decision":"deny"/"ask"}` 生效）、session_id 传播（`conversationId`→header）、fail-open（server 不可达时 `{}`/allow 不挂 agent）、PostToolUse 输出 `{}` 合规、SessionStart 不存在性 re-verification + mdc fallback 仍必要、variance double-run（可选，时间允许）。
- **Verified-hosts 条目措辞**：`Antigravity CLI (agy) — verified (reduced matrix, ledger: <绝对路径>)`; 并列 D-entry：`Antigravity IDE / 2.0 — hooks not executed by host (upstream gap, 2 independent reproductions); rules fallback only`。
- 附 SEP-2484 式 exclusion ledger：P1-P9 每腿 → passed / excluded(reason)。

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 2) 分点结论 (1)
## 2) 分点结论

**(a) agy CLI 事实**

1. **独立安装，非 IDE 内置，非 npm 包**。官方安装器：`irm https://antigravity.google/cli/install.ps1 | iex`，Windows 二进制落在 `C:\Users\<user>\AppData\Local\agy\bin`（[官方 Getting Started](https://antigravity.google/docs/cli/getting-started/)，已读原文）。这与本机 `agy` 不在 PATH、无 `~/.gemini/antigravity-cli/` 完全一致——**s0 的预期结果是"CLI 未装，需先跑官方安装器"**，且装好后 config 根目录才会出现 `~/.gemini/antigravity-cli/`。 <!-- machine-local: user-level agent/tooling config path on build host @ 2026-09-19 -->
2. **hooks.json 位置存在真实分歧，s1 必须实测**（这正是提议设计的价值）：
   - 官方 docs + Atamel 博客（7/16，已读原文）：workspace `.agents/hooks.json` + global `~/.gemini/config/hooks.json` + plugin 目录，三 flavors（AGY/CLI/IDE）通用；
   - Medium/Tanaike 指南（6/26，已读原文）：global 是 `~/.gemini/antigravity-cli/hooks.json`；
   - GitHub issue #49 独立佐证：CLI 实际把 hooks 配置写到 `~/.gemini/antigravity-cli/hooks.json`（官方定性为 path misalignment bug）。
   - → **s1 的 empirical 裁决腿是对的，且要同时探测 `~/.gemini/config/hooks.json` 和 `~/.gemini/antigravity-cli/hooks.json` 两个候选全局位置**。IDE 与 CLI **不共享** session 数据目录（`antigravity-ide/brain` vs `antigravity-cli/brain`），hooks 消息里的 `transcriptPath` 按表面区分目录——这是 s1 判定"哪个表面在执行 hook"的现成探针。
3. **事件列表：官方 5 事件，无 SessionStart**。官方 Hooks 文档（已读全文）明确只有 PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop，字段 camelCase（`conversationId`/`transcriptPath`/`toolCall.args`），**且不注入 `hook_event_name`**（Atamel 独立证实，需从 argv 传回）。ADR-0011 D8 的"无 SessionStart 等价物"结论截至 2026-07 官方文档仍然成立——**验收矩阵里的"SessionStart re-verification"腿应改为"确认 SessionStart 仍不存在 + .antigravity/rules/anysearch.mdc fallback 仍必要"，是证据腿而非通过腿**。
4. **stdout 契约两源冲突（最重要的裁决点）**：
   - 官方 docs（权威）：PreToolUse 输出顶层 `{"decision": "allow"|"deny"|"ask"|"force_ask"|"deny_unless_prior_grant", "reason"?, "permissionOverrides"?}`；PostToolUse 输出 `{}`；PreInvocation 可输出 `injectSteps`；Stop 输出 `{"decision": "continue"}`。AI Dev Forum 的受控复现里 `{"decision":"deny"}` 在 CLI 上实测 hard-block 生效——支持官方形状。
   - Medium 指南：顶层 `{allow_tool: false, deny_reason}`，且强调 `hookSpecificOutput` 包装会 schema 校验失败、reject 时也要 exit 0；非 JSON fallback 语义 = exit 0→allow / exit 1→allow+警告 / 非 0→deny(stdout 为理由)。
   - → **我们 adapter 现在写的契约腿假设（top-level `{allow_tool,deny_reason}`）很可能是 legacy/错误形状**。s2 的 L0-L3 裁决设计完全正确，但腿序应改为：L-empty → L-envelope(top-level `{"decision":...}` 官方形状) → L-bare(`{"allow_tool":false}` legacy 形状) → L-plain-text(exit-code 语义)。**这一条不裁决完，adapter 上线即坏**。
5. **headless 存在**：`agy -p`（print 模式）是官方 headless 路径；1.1.15–1.1.17 新增 stream-JSON print input mode（社区/推文信号，非官方文档——s3 实测确认）。Gemini CLI 已于 2026-06-18 被 Antigravity CLI 取代。

**(b) 分级验证惯例 — reduced matrix 是否诚实**

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research round 3 for the anysearch-cli repo — acceptance-criteria design for a SECONDARY ticket (the round's main theme is release-bot gating, already decided). SUBJECT: verifying Google Antigravity as the 4th real agent-host for the project's plugin hooks layer. EXISTING STATE (verified in-repo): apps/plugin/src/hooks/adapters/antigravity.ts exists (Gemini-CLI lineage; 5 events PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop; reads hook_event…

开始 Round 3 调研：先召回知识库，再三引擎联网调研 Antigravity hooks/agy CLI 与平台验证分级惯例。知识库已召回 Round 56/Round 66 相关上下文。现在进入联网三引擎广泛搜索阶段。搜索命中关键信源。进入定点深挖：抓取官方 hooks 文档、CLI 安装/headless 文档、atamel 博客、IDE hooks 失效论坛帖。已确认关键事实（IDE 不执行 hooks、CLI 单独下载）。继续定点深挖：官方 hooks 文档页、`agy -p` headless 参考、退出码语义。继续定点深挖：官方 Hooks 文档页 + exit-code 语义的 Medium 指南。补两个关键验证：IDE 2.5.5 是否已修复 hooks（关乎本机 IDE-only 验证路径），以及 SEP-2484 分级原文。**Sufficiency Gate**: searches: 6 (web_search ×1, tavily ×1, anysearch search ×1 + batch_search ×3-queries) | angles: Official, Criticism, Currency, Community (4 类) | full reads: 7 (antigravity.google ×2, atamel.dev, discuss.ai.google.dev ×2, medium.com, modelcontextprotocol.io) | domains: 5 个独立信源 | gaps: IDE 2.5.5 是否已修复 hooks 执行（Google 官方仅建议升级、无确认回帖）；`allow_tool` vs `decision` 两源冲突只能靠 s2 实测裁决。

## antigravity PreToolUse contract allow_tool exit semantics

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 2) 分点结论 (1)
## 2) 分点结论

**(a) agy CLI 事实**

1. **独立安装，非 IDE 内置，非 npm 包**。官方安装器：`irm https://antigravity.google/cli/install.ps1 | iex`，Windows 二进制落在 `C:\Users\<user>\AppData\Local\agy\bin`（[官方 Getting Started](https://antigravity.google/docs/cli/getting-started/)，已读原文）。这与本机 `agy` 不在 PATH、无 `~/.gemini/antigravity-cli/` 完全一致——**s0 的预期结果是"CLI 未装，需先跑官方安装器"**，且装好后 config 根目录才会出现 `~/.gemini/antigravity-cli/`。 <!-- machine-local: user-level agent/tooling config path on build host @ 2026-09-19 -->
2. **hooks.json 位置存在真实分歧，s1 必须实测**（这正是提议设计的价值）：
   - 官方 docs + Atamel 博客（7/16，已读原文）：workspace `.agents/hooks.json` + global `~/.gemini/config/hooks.json` + plugin 目录，三 flavors（AGY/CLI/IDE）通用；
   - Medium/Tanaike 指南（6/26，已读原文）：global 是 `~/.gemini/antigravity-cli/hooks.json`；
   - GitHub issue #49 独立佐证：CLI 实际把 hooks 配置写到 `~/.gemini/antigravity-cli/hooks.json`（官方定性为 path misalignment bug）。
   - → **s1 的 empirical 裁决腿是对的，且要同时探测 `~/.gemini/config/hooks.json` 和 `~/.gemini/antigravity-cli/hooks.json` 两个候选全局位置**。IDE 与 CLI **不共享** session 数据目录（`antigravity-ide/brain` vs `antigravity-cli/brain`），hooks 消息里的 `transcriptPath` 按表面区分目录——这是 s1 判定"哪个表面在执行 hook"的现成探针。
3. **事件列表：官方 5 事件，无 SessionStart**。官方 Hooks 文档（已读全文）明确只有 PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop，字段 camelCase（`conversationId`/`transcriptPath`/`toolCall.args`），**且不注入 `hook_event_name`**（Atamel 独立证实，需从 argv 传回）。ADR-0011 D8 的"无 SessionStart 等价物"结论截至 2026-07 官方文档仍然成立——**验收矩阵里的"SessionStart re-verification"腿应改为"确认 SessionStart 仍不存在 + .antigravity/rules/anysearch.mdc fallback 仍必要"，是证据腿而非通过腿**。
4. **stdout 契约两源冲突（最重要的裁决点）**：
   - 官方 docs（权威）：PreToolUse 输出顶层 `{"decision": "allow"|"deny"|"ask"|"force_ask"|"deny_unless_prior_grant", "reason"?, "permissionOverrides"?}`；PostToolUse 输出 `{}`；PreInvocation 可输出 `injectSteps`；Stop 输出 `{"decision": "continue"}`。AI Dev Forum 的受控复现里 `{"decision":"deny"}` 在 CLI 上实测 hard-block 生效——支持官方形状。
   - Medium 指南：顶层 `{allow_tool: false, deny_reason}`，且强调 `hookSpecificOutput` 包装会 schema 校验失败、reject 时也要 exit 0；非 JSON fallback 语义 = exit 0→allow / exit 1→allow+警告 / 非 0→deny(stdout 为理由)。
   - → **我们 adapter 现在写的契约腿假设（top-level `{allow_tool,deny_reason}`）很可能是 legacy/错误形状**。s2 的 L0-L3 裁决设计完全正确，但腿序应改为：L-empty → L-envelope(top-level `{"decision":...}` 官方形状) → L-bare(`{"allow_tool":false}` legacy 形状) → L-plain-text(exit-code 语义)。**这一条不裁决完，adapter 上线即坏**。
5. **headless 存在**：`agy -p`（print 模式）是官方 headless 路径；1.1.15–1.1.17 新增 stream-JSON print input mode（社区/推文信号，非官方文档——s3 实测确认）。Gemini CLI 已于 2026-06-18 被 Antigravity CLI 取代。

**(b) 分级验证惯例 — reduced matrix 是否诚实**

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐：两阶段 reduced-matrix 方案，但需三处修正**（Confidence：高 — 官方文档 + 两个独立受控复现 + MCP 分级惯例三方交叉）。最关键的新事实是：**Antigravity IDE 根本不执行 hooks（两个独立受控复现证实，纯 CLI-only 产品缺口）**，所以验证宿主实际上只能是 agy CLI——这直接改变了 spike 阶段的宿主面定义和 verified-hosts 条目的措辞。另外官方文档的 PreToolUse stdout 契约是**顶层 `{decision, reason}`**，与 Medium 指南的 `{allow_tool, deny_reason}` 存在两源冲突，s2 的 L0-L3 裁决腿恰好是解决它的正确工具，但腿的具体形状要改。

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "Research round 3 for the anysearch-cli repo — acceptance-criteria design for a SECONDARY ticket (the round's main theme is release-bot gating, already decided). SUBJECT: verifying Google Antigravity as the 4th real agent-host for the project's plugin hooks layer. EXISTING STATE (verified in-repo): apps/plugin/src/hooks/adapters/antigravity.ts exists (Gemini-CLI lineage; 5 events PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop; reads hook_event…

开始 Round 3 调研：先召回知识库，再三引擎联网调研 Antigravity hooks/agy CLI 与平台验证分级惯例。知识库已召回 Round 56/Round 66 相关上下文。现在进入联网三引擎广泛搜索阶段。搜索命中关键信源。进入定点深挖：抓取官方 hooks 文档、CLI 安装/headless 文档、atamel 博客、IDE hooks 失效论坛帖。已确认关键事实（IDE 不执行 hooks、CLI 单独下载）。继续定点深挖：官方 hooks 文档页、`agy -p` headless 参考、退出码语义。继续定点深挖：官方 Hooks 文档页 + exit-code 语义的 Medium 指南。补两个关键验证：IDE 2.5.5 是否已修复 hooks（关乎本机 IDE-only 验证路径），以及 SEP-2484 分级原文。**Sufficiency Gate**: searches: 6 (web_search ×1, tavily ×1, anysearch search ×1 + batch_search ×3-queries) | angles: Official, Criticism, Currency, Community (4 类) | full reads: 7 (antigravity.google ×2, atamel.dev, discuss.ai.google.dev ×2, medium.com, modelcontextprotocol.io) | domains: 5 个独立信源 | gaps: IDE 2.5.5 是否已修复 hooks 执行（Google 官方仅建议升级、无确认回帖）；`allow_tool` vs `decision` 两源冲突只能靠 s2 实测裁决。

## tiered verification support levels reduced matrix honest label

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 4) 验收标准内容（建议写进 ticket）
## 4) 验收标准内容（建议写进 ticket）

- **Spike exit（全过才进 acceptance；任一失败 → ticket 降级为 host-limitation 证据，ADR 记 D-entry）**
  - s0: agy 经官方 install.ps1 可安装、`agy --version` ≥1.1.10、`agy -p` 能返回。
  - s1: 实测 hooks 配置生效位置（`.agents/hooks.json` vs `~/.gemini/config/` vs `~/.gemini/antigravity-cli/`），以 transcriptPath 目录（`antigravity-cli/brain`）证明执行表面为 CLI。
  - s2: L0-L3 四腿裁决，L-envelope 主腿为顶层 `{"decision":"allow"}`，L-bare 测 `{"allow_tool":false}` legacy 形状，记录 exit-code fallback 语义；结论与官方 docs 冲突处写成显式 finding。
  - s3: `agy -p` 下 hooks 触发 + 输出可观测。
- **Acceptance（reduced matrix，6 腿）**：契约端到端（in-domain search 放行 + OOD abstain 经 `{"decision":"deny"/"ask"}` 生效）、session_id 传播（`conversationId`→header）、fail-open（server 不可达时 `{}`/allow 不挂 agent）、PostToolUse 输出 `{}` 合规、SessionStart 不存在性 re-verification + mdc fallback 仍必要、variance double-run（可选，时间允许）。
- **Verified-hosts 条目措辞**：`Antigravity CLI (agy) — verified (reduced matrix, ledger: <绝对路径>)`; 并列 D-entry：`Antigravity IDE / 2.0 — hooks not executed by host (upstream gap, 2 independent reproductions); rules fallback only`。
- 附 SEP-2484 式 exclusion ledger：P1-P9 每腿 → passed / excluded(reason)。

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 5) 不诚实标注风险
## 5) 不诚实标注风险

1. **最大风险**：把条目写成"Antigravity verified"而不加表面限定——本机安装的 IDE 表面永远不会触发 hooks，"verified"只对 CLI 成立。README 表若不给 per-surface 拆分，就是虚标。
2. **次风险**：reduced matrix 直接标 "verified" 而无 exclusion ledger——违反 SEP-2484/Pact 惯例；补 ledger 后诚实性成立（Tier 2 80% 先例）。
3. **契约风险**：若 s2 跳过、沿用 `{allow_tool}` 形状直接上线，hooks 会在真实宿主上静默失效（schema 校验失败），而 fail-open 会掩盖它——这正是 expected-red ledger 要预防的。

### Round 3 调研报告 — Antigravity 第 4 宿主验证的验收标准设计 > 3) 对比矩阵
## 3) 对比矩阵

| 方案 | 诚实性 | 成本 | 风险 |
|---|---|---|---|
| **两阶段 reduced-matrix（推荐，修正版）** | 高——附 P1-P9 exclusion ledger + "CLI-verified"限定标签 | 中（spike ~4 腿 + ~5 验收腿） | stdout 契约两源冲突需 s2 实测裁决 |
| spike-only | 中——spike 结论只覆盖契约/配置，端到端未证 | 低 | verified-hosts 表无法诚实加行，跨轮上下文丢失 |
| full P1-P9 parity | 最高 | 高——其中 variance double-run、preheating 等腿对刚破土的宿主收益低 | 过度验证拖延 release-bot 主线 |

## two-stage recommendation verdict

No matching sections found.


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: deny_reason, hook_event_name, preinvocation, postinvocation, modelcontextprotocol, reduced-matrix, getting-started, transcriptpath, sessionstart, conversationid, re-verification, traceability, host-limitation, verified-hosts, antigravity-cli, release-bot, l-envelope, stream-json, 2026-06-18, double-run, anysearch, criticism, community, fail-open, atomcode, official, currency, 两个独立受控复现, variance, discuss, install, windows, getting, started, flavors, tanaike, adapter, d-entry, plugin, search