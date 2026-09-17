# R67-Q1 atomcode 调研存档（主题定界：Codex 验证+0.0.5 双主题）

> ctx_batch_execute 输出原文存档。调研结论经辩证吸收进 D-001/D-002；本文件仅为溯源凭证。

Executed 1 commands (66 lines, 9.0KB). Indexed 6 sections. Searched 5 queries.

## Commands

- atomcode: `atomcode -p "为一个信息专精 agent CLI（垂直领域检索工具，通过 MCP server + agent hooks 接入各家宿主 agent）裁决下一轮工程主题。背景：已发布 npm 0.0.4（OIDC trusted publishing + slsa provenance 已实证）；两个宿主已真机验证——CodeBuddy 2.151.0 与 Claude Code 2.1.251（验证方法：headless stream-json 探针矩阵 P1-P9，测 MCP tools/hooks 三事件/fail-open/拒答/效果对照）；已发现 published 0.0.4 带一个已知缺陷：session-start hook 无 --envelope 旗标时只输出 hookSpecificOutput 信封，破 Codex 裸契约（顶层字段），in-tree 修复已在 main 但未送达用户；本机已装 Codex CLI 0.142.5。候选：A=先验证真 Codex 宿主（第三宿主，可实测 0.0.4 缺陷真实影响面），再用已实证的 OIDC 通道发 0.…`

## Indexed Sections

- atomcode (1.8KB)
- atomcode > 1) 执行摘要（Tl;dr） (0.5KB)
- atomcode > 2) 分点结论 (1) (3.5KB)
- atomcode > 2) 分点结论 (2) (0.8KB)
- atomcode > 3) 完整来源清单 (1.8KB)
- atomcode > 4) 信息缺口 (0.5KB)

## 推荐 排序

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐 A（Codex 验证 + 0.0.5 送达修复）**，且 A 的成本比上轮 Claude 验证更低、收益更高：Codex 的 headless JSONL（`codex exec --json`）、MCP stdio、五事件 hooks（含 PreToolUse deny 信封）均已 GA 且官方文档完整（Confidence：高——官方文档一手 + 两个独立三方源交叉）。缺陷修复的发布节奏：业界标准是“已知缺陷尽快随最近一次发版送达”，既然本轮 A 天然要发 0.0.5，修复随车即是惯例正解，无需独立发 0.0.4.1。

## Codex CLI hooks MCP 契约

### atomcode
# atomcode

$ atomcode -p "为一个信息专精 agent CLI（垂直领域检索工具，通过 MCP server + agent hooks 接入各家宿主 agent）裁决下一轮工程主题。背景：已发布 npm 0.0.4（OIDC trusted publishing + slsa provenance 已实证）；两个宿主已真机验证——CodeBuddy 2.151.0 与 Claude Code 2.1.251（验证方法：headless stream-json 探针矩阵 P1-P9，测 MCP tools/hooks 三事件/fail-open/拒答/效果对照）；已发现 published 0.0.4 带一个已知缺陷：session-start hook 无 --envelope 旗标时只输出 hookSpecificOutput 信封，破 Codex 裸契约（顶层字段），in-tree 修复已在 main 但未送达用户；本机已装 Codex CLI 0.142.5。候选：A=先验证真 Codex 宿主（第三宿主，可实测 0.0.4 缺陷真实影响面），再用已实证的 OIDC 通道发 0.…

我先召回知识库，再按五角度展开三引擎检索。知识库已命中上轮宿主验证台账。现在三引擎并行检索四大主题。核心事实已浮出：Codex 已有 hooks（SessionStart/Stop/UserPromptSubmit/PreToolUse/PostToolUse）、MCP stdio、`codex exec --json`。现在定点深挖官方文档原文验证。官方 hooks 文档确认了 MCP tool hooks 与 plugin-bundled hooks。再补两个定点抓取：AGENTS.md 注入与 codex exec --json 细节。**Sufficiency Gate**: searches: 7+（Exa 1 + Tavily 1 + AnySearch batch 5）| angles: Official / Criticism / Currency / Community / Comparative | full reads: 6（learn.chatgpt.com hooks、non-interactive-mode.md 全文、config-reference、agents-md、backgrind.com notify 详解、symposium.dev）| domains ≥5（learn.chatgpt.com、backgrind.com、symposium.dev、blakecrosley.com、github.com、stackoverflow）| gaps: 未见针对“第 N 个宿主才够”的成文工业标准（该数字本质是判断题，下面给出惯例依据）。

### atomcode > 3) 完整来源清单
## 3) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Hooks（官方） | https://learn.chatgpt.com/docs/hooks | Official | 2026-05 后 | 五事件、hooks.json、mcp_tool hook、信任机制 |
| Non-interactive mode（官方，.md 全文已读） | https://learn.chatgpt.com/docs/non-interactive-mode | Official | 当前 | `exec --json` JSONL、--output-schema、required MCP fail-fast |
| Config Reference（官方） | https://learn.chatgpt.com/docs/config-file/config-reference | Official | 当前 | MCP stdio 键、features.hooks 开关 |
| AGENTS.md（官方） | https://learn.chatgpt.com/docs/agent-configuration/agents-md | Official | 当前 | 注入顺序与 fallback 机制 |
| Codex notify 详解 | https://backgrind.com/blog/codex-cli-notifications/ | Criticism/源码 | 2026-08-02 | argv 非 stdin、stdin null、repo 级拒载 |
| Codex CLI agent-details | https://symposium.dev/design/agent-details/codex-cli.html | Comparative | 持续更新 | hooks v0.114 起源、输入 schema |
| Codex hooks 演进 | https://ai.sulat.com/codex-hooks-just-gave-you-back-complete-control-over-your-code-57d044bcae1b | Currency | 2026-03 后 | PR #14626、五事件时间线 |
| Hooks GA 宣告分析 | https://blakecrosley.com/blog/codex-hooks-make-the-harness-real | Currency | 2026-05 | hooks GA、远程 SSH GA |
| headless 请求 issue | https://github.com/openai/codex/issues/4219 | Criticism | 2025-09 | 早期 headless 痛点（已解决） |
| MCP detection issue | https://github.com/openai/codex/issues/9676 | Criticism | 2026-01 | config.toml MCP 加载陷阱 |
| exec JSONL 存档问答 | https://stackoverflow.com/questions/79734991/ | Community | — | JSONL 会话日志佐证 |
| Hooks 参考 | https://agenticcontrolplane.com/blog/codex-cli-hooks-reference | Comparative | 2026-04-30 | PreToolUse deny 脚本样例 |

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**Q1 宿主逐个验证的 rollout 惯例**（Confidence：中——无成文标准，从多源实践归纳）
- 工业界没有“几个宿主算够”的成文数字；惯例是**按契约族（contract family）覆盖，而非按宿主数量**。每个 hooks/注入 schema 不同的宿主就是一个独立验证单元。你们已覆盖 CodeBuddy + Claude 两个契约族；Codex 是第三个独立的 hooks 事件/信封 schema（见 Q3），必然需要单独一轮。
- 选下一个宿主的三条通行标准（symposium.dev 的 agent-details 系列即按此为各宿主建参考页）：① 用户基数/需求拉动（Codex 是当前三大宿主之一）；② 协议分歧度——分歧大的宿主优先验，因为 fail 模式最多；③ 验证成本（有无 headless 等价物、hooks 是否 GA）。Codex 三条全占优。
- “够”的判据建议：覆盖到你们 hooks 层的两类信封形态（envelope 型 hookSpecificOutput 与裸顶层字段）各有至少一个真宿主实证——这正好是你们已知缺陷的判别面。

**Q2 已知缺陷的发布节奏**（Confidence：高）
- Semver 语义（semver.org + freedCodeCamp/stackexchange 交叉）：patch = 纯 bugfix，无功能变化。两种惯例并存：**安全/影响用户的已知缺陷 → 立即 patch**；**修复已在 main 且下一次发版临近 → 随车**。判别变量是“缺陷造成的用户损失 × 时间窗”。
- 你们的情况：缺陷已实证破 Codex 裸契约、修复已在 main、发布通道（OIDC trusted publishing）已实证零边际成本——**无需为修复单独插一个 0.0.4.1**，随 0.0.5 在同一轮送达即符合“fix rides the next release”惯例。反过来说：B（只 bump 不修不验）是反模式——既不送达修复也不验证，浪费一轮。

**Q3 Codex 0.142.5 契约成熟度**（Confidence：高——官方文档 + 源码级三方分析双源）

| 维度 | 现状（2026-09） | 对验证成本的影响 |
|---|---|---|
| headless 等价物 | `codex exec --json` = JSONL 事件流（thread.started/turn.*/item.*/error），**无需 --verbose**（Claude 那个坑不存在）；另有 `-o`、`--output-schema`、`--ephemeral`、`exec resume` | 低——探针矩阵 P1-P9 可近乎直移 |
| MCP stdio | 一等公民：`config.toml` `[mcp_servers]`，`codex mcp list`；支持 `required = true`（初始化失败则 exec 直接报错退出——注意这**不是** fail-open，探针 P7 预期结果不同） | 低 |
| hooks | 已从 beta 长成五事件：SessionStart / Stop / UserPromptSubmit / PreToolUse / PostToolUse（PR #14626，~v0.117 起 Pre/PostToolUse）；hooks.json + `/hooks` 信任机制；PreToolUse 支持 `permissionDecision: deny`（与 Claude 信封同形）| 中——需实测 Codex SessionStart 信封到底吃 `hookSpecificOutput.additionalContext` 还是顶层字段，这正是 0.0.4 缺陷的裁决点 |
| legacy notify | 旧式 `notify` 配置：JSON 走 **argv 末参而非 stdin**，且 stdin 被 null 接管；repo 级 `.codex/config.toml` 拒载该键 | 低——但意味着早期 Codex 集成样例对你们无参考价值 |
| AGENTS.md 注入 | 原生：AGENTS.override.md > AGENTS.md > fallback 列表，`project_doc_max_bytes` 截断；每次 run 重建无缓存 | 低——你们 AGENTS.md 中的 ans_* 前缀说明可被直接注入 |
| Windows | 早期（v0.114）hooks 不支持 Windows；现行文档已出现 `windows_managed_dir`，说明已补 | 本机即 Windows，需在探针里验证 hooks 事件是否真触发 |

## 宿主验证 rollout 惯例

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**Q1 宿主逐个验证的 rollout 惯例**（Confidence：中——无成文标准，从多源实践归纳）
- 工业界没有“几个宿主算够”的成文数字；惯例是**按契约族（contract family）覆盖，而非按宿主数量**。每个 hooks/注入 schema 不同的宿主就是一个独立验证单元。你们已覆盖 CodeBuddy + Claude 两个契约族；Codex 是第三个独立的 hooks 事件/信封 schema（见 Q3），必然需要单独一轮。
- 选下一个宿主的三条通行标准（symposium.dev 的 agent-details 系列即按此为各宿主建参考页）：① 用户基数/需求拉动（Codex 是当前三大宿主之一）；② 协议分歧度——分歧大的宿主优先验，因为 fail 模式最多；③ 验证成本（有无 headless 等价物、hooks 是否 GA）。Codex 三条全占优。
- “够”的判据建议：覆盖到你们 hooks 层的两类信封形态（envelope 型 hookSpecificOutput 与裸顶层字段）各有至少一个真宿主实证——这正好是你们已知缺陷的判别面。

**Q2 已知缺陷的发布节奏**（Confidence：高）
- Semver 语义（semver.org + freedCodeCamp/stackexchange 交叉）：patch = 纯 bugfix，无功能变化。两种惯例并存：**安全/影响用户的已知缺陷 → 立即 patch**；**修复已在 main 且下一次发版临近 → 随车**。判别变量是“缺陷造成的用户损失 × 时间窗”。
- 你们的情况：缺陷已实证破 Codex 裸契约、修复已在 main、发布通道（OIDC trusted publishing）已实证零边际成本——**无需为修复单独插一个 0.0.4.1**，随 0.0.5 在同一轮送达即符合“fix rides the next release”惯例。反过来说：B（只 bump 不修不验）是反模式——既不送达修复也不验证，浪费一轮。

**Q3 Codex 0.142.5 契约成熟度**（Confidence：高——官方文档 + 源码级三方分析双源）

| 维度 | 现状（2026-09） | 对验证成本的影响 |
|---|---|---|
| headless 等价物 | `codex exec --json` = JSONL 事件流（thread.started/turn.*/item.*/error），**无需 --verbose**（Claude 那个坑不存在）；另有 `-o`、`--output-schema`、`--ephemeral`、`exec resume` | 低——探针矩阵 P1-P9 可近乎直移 |
| MCP stdio | 一等公民：`config.toml` `[mcp_servers]`，`codex mcp list`；支持 `required = true`（初始化失败则 exec 直接报错退出——注意这**不是** fail-open，探针 P7 预期结果不同） | 低 |
| hooks | 已从 beta 长成五事件：SessionStart / Stop / UserPromptSubmit / PreToolUse / PostToolUse（PR #14626，~v0.117 起 Pre/PostToolUse）；hooks.json + `/hooks` 信任机制；PreToolUse 支持 `permissionDecision: deny`（与 Claude 信封同形）| 中——需实测 Codex SessionStart 信封到底吃 `hookSpecificOutput.additionalContext` 还是顶层字段，这正是 0.0.4 缺陷的裁决点 |
| legacy notify | 旧式 `notify` 配置：JSON 走 **argv 末参而非 stdin**，且 stdin 被 null 接管；repo 级 `.codex/config.toml` 拒载该键 | 低——但意味着早期 Codex 集成样例对你们无参考价值 |
| AGENTS.md 注入 | 原生：AGENTS.override.md > AGENTS.md > fallback 列表，`project_doc_max_bytes` 截断；每次 run 重建无缓存 | 低——你们 AGENTS.md 中的 ans_* 前缀说明可被直接注入 |
| Windows | 早期（v0.114）hooks 不支持 Windows；现行文档已出现 `windows_managed_dir`，说明已补 | 本机即 Windows，需在探针里验证 hooks 事件是否真触发 |

### atomcode
# atomcode

$ atomcode -p "为一个信息专精 agent CLI（垂直领域检索工具，通过 MCP server + agent hooks 接入各家宿主 agent）裁决下一轮工程主题。背景：已发布 npm 0.0.4（OIDC trusted publishing + slsa provenance 已实证）；两个宿主已真机验证——CodeBuddy 2.151.0 与 Claude Code 2.1.251（验证方法：headless stream-json 探针矩阵 P1-P9，测 MCP tools/hooks 三事件/fail-open/拒答/效果对照）；已发现 published 0.0.4 带一个已知缺陷：session-start hook 无 --envelope 旗标时只输出 hookSpecificOutput 信封，破 Codex 裸契约（顶层字段），in-tree 修复已在 main 但未送达用户；本机已装 Codex CLI 0.142.5。候选：A=先验证真 Codex 宿主（第三宿主，可实测 0.0.4 缺陷真实影响面），再用已实证的 OIDC 通道发 0.…

我先召回知识库，再按五角度展开三引擎检索。知识库已命中上轮宿主验证台账。现在三引擎并行检索四大主题。核心事实已浮出：Codex 已有 hooks（SessionStart/Stop/UserPromptSubmit/PreToolUse/PostToolUse）、MCP stdio、`codex exec --json`。现在定点深挖官方文档原文验证。官方 hooks 文档确认了 MCP tool hooks 与 plugin-bundled hooks。再补两个定点抓取：AGENTS.md 注入与 codex exec --json 细节。**Sufficiency Gate**: searches: 7+（Exa 1 + Tavily 1 + AnySearch batch 5）| angles: Official / Criticism / Currency / Community / Comparative | full reads: 6（learn.chatgpt.com hooks、non-interactive-mode.md 全文、config-reference、agents-md、backgrind.com notify 详解、symposium.dev）| domains ≥5（learn.chatgpt.com、backgrind.com、symposium.dev、blakecrosley.com、github.com、stackoverflow）| gaps: 未见针对“第 N 个宿主才够”的成文工业标准（该数字本质是判断题，下面给出惯例依据）。

## patch release 节奏

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**Q1 宿主逐个验证的 rollout 惯例**（Confidence：中——无成文标准，从多源实践归纳）
- 工业界没有“几个宿主算够”的成文数字；惯例是**按契约族（contract family）覆盖，而非按宿主数量**。每个 hooks/注入 schema 不同的宿主就是一个独立验证单元。你们已覆盖 CodeBuddy + Claude 两个契约族；Codex 是第三个独立的 hooks 事件/信封 schema（见 Q3），必然需要单独一轮。
- 选下一个宿主的三条通行标准（symposium.dev 的 agent-details 系列即按此为各宿主建参考页）：① 用户基数/需求拉动（Codex 是当前三大宿主之一）；② 协议分歧度——分歧大的宿主优先验，因为 fail 模式最多；③ 验证成本（有无 headless 等价物、hooks 是否 GA）。Codex 三条全占优。
- “够”的判据建议：覆盖到你们 hooks 层的两类信封形态（envelope 型 hookSpecificOutput 与裸顶层字段）各有至少一个真宿主实证——这正好是你们已知缺陷的判别面。

**Q2 已知缺陷的发布节奏**（Confidence：高）
- Semver 语义（semver.org + freedCodeCamp/stackexchange 交叉）：patch = 纯 bugfix，无功能变化。两种惯例并存：**安全/影响用户的已知缺陷 → 立即 patch**；**修复已在 main 且下一次发版临近 → 随车**。判别变量是“缺陷造成的用户损失 × 时间窗”。
- 你们的情况：缺陷已实证破 Codex 裸契约、修复已在 main、发布通道（OIDC trusted publishing）已实证零边际成本——**无需为修复单独插一个 0.0.4.1**，随 0.0.5 在同一轮送达即符合“fix rides the next release”惯例。反过来说：B（只 bump 不修不验）是反模式——既不送达修复也不验证，浪费一轮。

**Q3 Codex 0.142.5 契约成熟度**（Confidence：高——官方文档 + 源码级三方分析双源）

| 维度 | 现状（2026-09） | 对验证成本的影响 |
|---|---|---|
| headless 等价物 | `codex exec --json` = JSONL 事件流（thread.started/turn.*/item.*/error），**无需 --verbose**（Claude 那个坑不存在）；另有 `-o`、`--output-schema`、`--ephemeral`、`exec resume` | 低——探针矩阵 P1-P9 可近乎直移 |
| MCP stdio | 一等公民：`config.toml` `[mcp_servers]`，`codex mcp list`；支持 `required = true`（初始化失败则 exec 直接报错退出——注意这**不是** fail-open，探针 P7 预期结果不同） | 低 |
| hooks | 已从 beta 长成五事件：SessionStart / Stop / UserPromptSubmit / PreToolUse / PostToolUse（PR #14626，~v0.117 起 Pre/PostToolUse）；hooks.json + `/hooks` 信任机制；PreToolUse 支持 `permissionDecision: deny`（与 Claude 信封同形）| 中——需实测 Codex SessionStart 信封到底吃 `hookSpecificOutput.additionalContext` 还是顶层字段，这正是 0.0.4 缺陷的裁决点 |
| legacy notify | 旧式 `notify` 配置：JSON 走 **argv 末参而非 stdin**，且 stdin 被 null 接管；repo 级 `.codex/config.toml` 拒载该键 | 低——但意味着早期 Codex 集成样例对你们无参考价值 |
| AGENTS.md 注入 | 原生：AGENTS.override.md > AGENTS.md > fallback 列表，`project_doc_max_bytes` 截断；每次 run 重建无缓存 | 低——你们 AGENTS.md 中的 ans_* 前缀说明可被直接注入 |
| Windows | 早期（v0.114）hooks 不支持 Windows；现行文档已出现 `windows_managed_dir`，说明已补 | 本机即 Windows，需在探针里验证 hooks 事件是否真触发 |

## session-start envelope

### atomcode
# atomcode

$ atomcode -p "为一个信息专精 agent CLI（垂直领域检索工具，通过 MCP server + agent hooks 接入各家宿主 agent）裁决下一轮工程主题。背景：已发布 npm 0.0.4（OIDC trusted publishing + slsa provenance 已实证）；两个宿主已真机验证——CodeBuddy 2.151.0 与 Claude Code 2.1.251（验证方法：headless stream-json 探针矩阵 P1-P9，测 MCP tools/hooks 三事件/fail-open/拒答/效果对照）；已发现 published 0.0.4 带一个已知缺陷：session-start hook 无 --envelope 旗标时只输出 hookSpecificOutput 信封，破 Codex 裸契约（顶层字段），in-tree 修复已在 main 但未送达用户；本机已装 Codex CLI 0.142.5。候选：A=先验证真 Codex 宿主（第三宿主，可实测 0.0.4 缺陷真实影响面），再用已实证的 OIDC 通道发 0.…

我先召回知识库，再按五角度展开三引擎检索。知识库已命中上轮宿主验证台账。现在三引擎并行检索四大主题。核心事实已浮出：Codex 已有 hooks（SessionStart/Stop/UserPromptSubmit/PreToolUse/PostToolUse）、MCP stdio、`codex exec --json`。现在定点深挖官方文档原文验证。官方 hooks 文档确认了 MCP tool hooks 与 plugin-bundled hooks。再补两个定点抓取：AGENTS.md 注入与 codex exec --json 细节。**Sufficiency Gate**: searches: 7+（Exa 1 + Tavily 1 + AnySearch batch 5）| angles: Official / Criticism / Currency / Community / Comparative | full reads: 6（learn.chatgpt.com hooks、non-interactive-mode.md 全文、config-reference、agents-md、backgrind.com notify 详解、symposium.dev）| domains ≥5（learn.chatgpt.com、backgrind.com、symposium.dev、blakecrosley.com、github.com、stackoverflow）| gaps: 未见针对“第 N 个宿主才够”的成文工业标准（该数字本质是判断题，下面给出惯例依据）。

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**Q1 宿主逐个验证的 rollout 惯例**（Confidence：中——无成文标准，从多源实践归纳）
- 工业界没有“几个宿主算够”的成文数字；惯例是**按契约族（contract family）覆盖，而非按宿主数量**。每个 hooks/注入 schema 不同的宿主就是一个独立验证单元。你们已覆盖 CodeBuddy + Claude 两个契约族；Codex 是第三个独立的 hooks 事件/信封 schema（见 Q3），必然需要单独一轮。
- 选下一个宿主的三条通行标准（symposium.dev 的 agent-details 系列即按此为各宿主建参考页）：① 用户基数/需求拉动（Codex 是当前三大宿主之一）；② 协议分歧度——分歧大的宿主优先验，因为 fail 模式最多；③ 验证成本（有无 headless 等价物、hooks 是否 GA）。Codex 三条全占优。
- “够”的判据建议：覆盖到你们 hooks 层的两类信封形态（envelope 型 hookSpecificOutput 与裸顶层字段）各有至少一个真宿主实证——这正好是你们已知缺陷的判别面。

**Q2 已知缺陷的发布节奏**（Confidence：高）
- Semver 语义（semver.org + freedCodeCamp/stackexchange 交叉）：patch = 纯 bugfix，无功能变化。两种惯例并存：**安全/影响用户的已知缺陷 → 立即 patch**；**修复已在 main 且下一次发版临近 → 随车**。判别变量是“缺陷造成的用户损失 × 时间窗”。
- 你们的情况：缺陷已实证破 Codex 裸契约、修复已在 main、发布通道（OIDC trusted publishing）已实证零边际成本——**无需为修复单独插一个 0.0.4.1**，随 0.0.5 在同一轮送达即符合“fix rides the next release”惯例。反过来说：B（只 bump 不修不验）是反模式——既不送达修复也不验证，浪费一轮。

**Q3 Codex 0.142.5 契约成熟度**（Confidence：高——官方文档 + 源码级三方分析双源）

| 维度 | 现状（2026-09） | 对验证成本的影响 |
|---|---|---|
| headless 等价物 | `codex exec --json` = JSONL 事件流（thread.started/turn.*/item.*/error），**无需 --verbose**（Claude 那个坑不存在）；另有 `-o`、`--output-schema`、`--ephemeral`、`exec resume` | 低——探针矩阵 P1-P9 可近乎直移 |
| MCP stdio | 一等公民：`config.toml` `[mcp_servers]`，`codex mcp list`；支持 `required = true`（初始化失败则 exec 直接报错退出——注意这**不是** fail-open，探针 P7 预期结果不同） | 低 |
| hooks | 已从 beta 长成五事件：SessionStart / Stop / UserPromptSubmit / PreToolUse / PostToolUse（PR #14626，~v0.117 起 Pre/PostToolUse）；hooks.json + `/hooks` 信任机制；PreToolUse 支持 `permissionDecision: deny`（与 Claude 信封同形）| 中——需实测 Codex SessionStart 信封到底吃 `hookSpecificOutput.additionalContext` 还是顶层字段，这正是 0.0.4 缺陷的裁决点 |
| legacy notify | 旧式 `notify` 配置：JSON 走 **argv 末参而非 stdin**，且 stdin 被 null 接管；repo 级 `.codex/config.toml` 拒载该键 | 低——但意味着早期 Codex 集成样例对你们无参考价值 |
| AGENTS.md 注入 | 原生：AGENTS.override.md > AGENTS.md > fallback 列表，`project_doc_max_bytes` 截断；每次 run 重建无缓存 | 低——你们 AGENTS.md 中的 ans_* 前缀说明可被直接注入 |
| Windows | 早期（v0.114）hooks 不支持 Windows；现行文档已出现 `windows_managed_dir`，说明已补 | 本机即 Windows，需在探针里验证 hooks 事件是否真触发 |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: userpromptsubmit, non-interactive-mode, config-reference, blakecrosley, stackoverflow, agent-details, --output-schema, hookspecificoutput, sessionstart, publishing, provenance, posttooluse, comparative, confidence, antigravity, codebuddy, fail-open, criticism, community, agents-md, backgrind, atomcode, official, currency, required, fallback, trusted, chatgpt, windows, github, schema, config, cursor, p1-p9, learn, 14626, stdin, 探针矩阵, 修复已在, main