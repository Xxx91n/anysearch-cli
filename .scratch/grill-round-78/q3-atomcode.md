# R78 Q3 — atomcode 深调研存档（PATH_RE env-var 盲区修复形态）

Date: 2026-09-22. Prompt: ./q3-prompt.txt

## 调研日志

# atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-78/q3-prompt.txt)"

我先检索知识库召回，再按五个角度展开三引擎调研。知识库已命中先前 R71/Q2 调研存档（覆盖 Q2-Q4 大半）。现在补足缺口：Q1 的路径形态正则识别先例。先广撒三引擎查询。Tavily 已超限，改用 Exa + AnySearch 双引擎推进。现在补齐 Q2/Q3/Q4 角度的查询并打开高价值原文。继续深挖：打开关键原文验证（rubocop todo 机制、eslint severity、betterer、semgrep baseline），并补查红向 fixture 先例。继续补缺口：Q1 的 env-var/tilde/UNC 检测先例、Q3 的红向 fixture 与 semgrep baseline 原文。继续定点抓取原文核验（semgrep baseline、vale 分级、betterer、detect-secrets、shellcheck、gitleaks）。补一次 semgrep baseline 原文（前两个 URL 404，换正确路径），随后综合输出。searches: 10（Exa×4、AnySearch×5、Tavily×1 已超限弃用） | angles: Official / Comparative / Criticism / Currency / Community 全五类 | full reads: 10+（rubocop、eslint、vale、betterer、shellcheck SC2088、gitleaks、semgrep findings-ci、detect-secrets、spectralint 源码、path-guard.mjs） | gaps: 「env-var 后随分隔符才算 locator」无完全同构的公开先例（见缺口节）

## 1) 执行摘要（Tl;dr）

**推荐形态**：将现有「字面形正则清单」升级为**「通用路径 token + 后随路径分隔符」的组合判定器**，即「env-var 形 / tilde 形 / UNC 形 / 盘符形」四类 token 检出后，**必须紧跟 `/` 或 `\` 才算 locator**；命中即 fail-closed（硬拦），但把「散文中提及变量名」（如 "set the TEMP variable"）这类无分隔符形态归为 surfaced-skip（可见不阻断）。存量违例用**「先全量扫计数 → 机械可修的 retro-fix → 不可机械修的逐条带标记豁免」**的混合路线，不开 blanket baseline 先例——这一直觉站得住，与 detect-secrets / rubocop / betterer 三个独立实践线一致：baseline 文件应作为**被审查、只减不增**的 artifact，而不是一次性的合法性开证。**Confidence：高**（四条实践线——secret scanner、rubocop/betterer 棘轮、ESLint/Vale severity、lint 测试 fixture——全部收敛到同一形状，且均有 ≥2 独立信源）。

---

## Q3 fail-closed 迁移 红向 fixture warn 模式

### Q1：路径形态识别的正则特征与误报边界

各形态的正则特征与边界（来源：regexguide、spectralint 源码、path-guard.mjs、ManageEngine、SC2088 wiki）：

| 形态 | 正则特征 | 误报源 | 现有先例的做法 |
|---|---|---|---|
| Windows env-var `%VAR%` | `%([A-Za-z_][A-Za-z0-9_]*)%` | 百分号字面量（URL 编码、markdown 强调）、未闭合 `%` | ManageEngine 应用控制规则直接把 `%APPDATA%`、`%TEMP%` 等当作合法路径 token；regexguide 提醒该模式「不锚定、非全量校验」 |
| POSIX env-var `$VAR` / `${VAR}` | `\$[A-Za-z_][A-Za-z0-9_]*` | 散文中指代变量本身（"the `$HOME` variable"）、shell 语法 | spectralint 对 `~/` 做「inline code 内跳过 + 已知良性目录白名单」双重豁免 |
| tilde `~/`、`~user/` | `~/` 或 `~[a-z0-9_-]+/` | git 对比行首 `~`、音乐/语义用法、inline code 中的示例 | **SC2088 的核心判定就是「tilde 后随路径段」**——tilde 只有在作为路径前缀时才有意义，这正是你问的启发式的 shellcheck 先例 |
| UNC `\\host\share` | `\\\\[^\\\/]+\\` | markdown 转义、示例文本 | 现有正则清单完全未覆盖 |
| 盘符 `C:\` | `[A-Za-z]:[\\\/]` | `https://` 中的 `s:`（R71 存档已踩过：需锚定或配非路径字符判断） | path-guard.mjs 要求引号包裹（`['"`]C:\\\\`）才命中，即「路径 token 必须出现在路径使用位置」 |

**「env-var 后随分隔符才算 locator」的先例判定：有强类比先例，无逐字同构先例。**

- **shellcheck SC2088/SC2147**：tilde 只有作为路径展开前缀时才被判定——「tilde/变量 + 分隔符 = 路径引用」是 shell 静态分析的既定启发式（已读 SC2088 wiki 原文）。
- **spectralint（docs.rs 已读源码）**：`/(?:home|Users|root)/[a-zA-Z0-9_.-]+` 要求人名段跟在目录词后，同样是「token + 后随内容」的复合判定，而非裸 token。
- **path-guard.mjs（github 已读）**：硬编码路径必须带引号才算（`['"`]\/tmp\//`），把「使用位置」编码进正则——这正是区分「散文提及」与「路径引用」的工业做法。
- **ManageEngine 文档**：在路径规则语境里 `%USERPROFILE%\Downloads` 的书写形就是「变量 + 分隔符 + 子路径」——厂商把 env-var+分隔符定义为路径形态的合成单元。

**误报处理惯例**：散文中提及环境变量名 vs 用作路径引用的区分，工业惯例有三层递进——①要求分隔符后缀（shellcheck 路线）；②排除 inline code（spectralint 的 `insid…

### Q2：存量违规处置的心智模型

工业界两路线的适用条件（全部已读原文验证）：

| 机制 | 先例 | 适用条件 | 已知反模式 |
|---|---|---|---|
| **retro-fix 一次性清零** | R71 自身（317 处转相对 + 93 标记，先红后绿） | 违例机械可转换、数量有限、有自动化转换器 | 无 |
| **todo/baseline 文件** | rubocop `.rubocop_todo.yml`、detect-secrets `.secrets.baseline`、betterer `.betterer.results`、gitleaks `--baseline-path` | 违例不可机械修、数量大到阻塞（rubocop 官方措辞：*"an overwhelming amount of offenses"*） | **rubocop 官方明确警告**：`--regenerate-todo` 在 CI 跑会 *"legitimize every newly introduced offense"*；detect-secrets 的 devops.stackexchange 实证案例显示 baseline 标记与 hook 判定脱节后形同虚设 |
| **diff-aware 扫描** | semgrep baseline commit / `--baseline-commit` | 违例在历史、只关心新增（PR 工作流） | 历史 bug 永久可见化缺失——对文档治理不适用（文档存量本身就是要治理的对象） |
| **棘轮/ratchet** | rubocop `--report-unused-todo-entries`（官方原话：*"safe to run on every CI build as a ratchet that forces the todo list to shrink over time"*）、betterer CI 模式（结果文件必须与现状**精确一致**否则 fail） | 任何存量存在时 | 只加不减（qntm ratchet 批评的「不推动清理」缺陷） |

**「不开豁免机制先例」这条治理直觉是否站得住：站得住，但要精确化表述。** 正确的心智模型不是「不许有豁免」，而是三层区分：

1. **豁免必须是被审查的显式 artifact**——rubocop 官方文档要求 todo 文件进版本库并被 CI 校验；betterer 官方要求 results 文件 *"think of it like a Jest Snapshot file, and review any changes carefully"*；gitleaks 的 `.gitleaksignore` 同样进版本库。你们逐条带 `<!-- machine-local: reason @ date -->` 标记 = 内联化、进 diff、被 review 的豁免 artifact，完全符合。
2. **豁免必须只减不增**——rubocop 的 `--report-unused-todo-entries` 是「单向棘轮」的教科书实现：新违例照常 fail，失效条目也 fail，逼着清单缩小。
3. **baseline ≠ 先例开证**——detect-secrets README 明确其设计哲学是 *"accepting that there may currently be secrets … but preventing this issue from getting any larger, without dealing with the potentially gargantuan effort"*。即 baseline 的合法性来自「显式承认 + 隔离 + 可审计」，而不是「规则本身留后门」。

所以：**不开的是「规则的字面形正则继续留白」这个先例**（那是规则本身的洞，等价于永远合法化环境变量形逃逸）；**开的是「逐条显式标记豁免」**——这不是豁免先例，是规则设计的一部分，且已有 93 处标记的既成实践。

### Q3：fail-closed 迁移与红向 fixture

**先扫后翻的迁移惯例**（对应 rollout/dark-launch）：

- rubocop 的标准迁移剧本（community 博客 + 官方文档一致）：先生成 todo → CI 绿 → 逐 cop 清理 → 棘轮收缩。对应到规则收紧：**新形态识别上线时先以 warn/info 模式全量扫一遍、枚举命中数、决定 retro-fix vs 标记豁免的分配，再翻 fail-closed**。
- detect-secrets 的 `audit` 命令就是「先枚举后人裁」的专用工具——先生成 baseline，再逐条人工标注 true/false positive，然后才把 hook 挂上。
- R71 已实践过同一模式（"先红 330 violations 后绿 224 docs clean"），本次是同一剧本的增量重放，不是新模式。

**红向 fixture 先例**：这是 lint/检测器测试的**标准双重实践**，先例密度很高——

- **ShipLint**（github 已读 commit）：每个规则一条 integration test，正反成对——`clean-project`（零 findings）+ `missing-privacy-manifest`（必须命中），即「绿向 fixture 证不误报 + 红向 fixture 证真会拦」。
- **INCOSE quality rules**（github 已读）：golden test 按 rule ID 分组，每组都有 `test_rXX_flags_*`（红向：必须报 violation）和 `test_rXX_returns_none_for_clean`（绿向）。
- **semgrep 规则测试**生态：规则 YAML 内嵌 `testdata` 正反样例是社区规则仓库的提交规范（gitleaks 仓库同样有 `testdata/` 目录）。
- gitleaks README 的输出示例本身就是红向 fixture 的产物形态（Finding/RuleID/File/Line 四元组）。

**对你们的含义**：两个实证逃逸实例（`%TEMP%/x`、`/c/Users/...`）应当直接固化为红向 fixture——每个新形态 token 一条红向用例（必须命中 + 必须被标记豁免时放行），外加绿向用例（散文提及 `$HOME` 变量名不命中、`https://` URL 不命中、inline code 中示例不命中）。这不是可选的锦上添花，是 lint 规则的可测性下限——**没有红向 fixture 的 fail-closed 规则，其「closed」是未经证的**。

### Q4：分层报告 severity

**先例（全部已读原文）**：

| 工具 | 分级 | 分级语义 |
|---|---|---|
| ESLint | `off/warn/error` | error 影响 exit code（CI 阻断）；warn 官方定位三用途：*"introducing a new rule that will eventually be set to error / flagging something other than a potential buildtime or runtime error / cannot determine with certainty that…

…error` | 官方：*"error-level alerts will result in a non-zero exit code, while warning- and suggestion-level alerts will not. This is useful for controlling which rules will fail CI"*；GitLab docs 实践：*"Vale only reports errors in the Git hook, and does not report suggestions or warnings"* |
| semgrep | severity + finding 状态机 | `OPEN/REVIEWING/PROVISIONALLY_IGNORED/FIXING/IGNORED/FIXED`——把「阻断 vs 不阻断」从 severity 移到 finding 生命周期 |
| spectralint | `default_severity: Severity::Warning`，`strict_only` 开关 | 路径类规则默认 warning，strict 模式升级 |

**哪些形态适合「可见不阻断」vs 必须阻断**（从以上先例归纳的判定规则）：

- **必须阻断（error）**：确定性高 + 是规则核心目标。对你们：带 token+分隔符的 env-var 形、tilde 形、UNC 形、盘符形**裸路径**——特征明确、误报率低（这是检测器自身对确定性的判断，与语义重要性无关）。
- **可见不阻断（warn/info / surfaced-skip）**：ESLint 官方列的第二、三用途逐字适用于 `/x` 这一类——它属于 *"cannot determine with certainty that a problem has been found"*。单段 POSIX 根路径、散文提及变量名、URL 内含路径形字符，都归这层。
- **warn 是临时态不是常驻态**：dev.to 的 "ESLint Warnings Are an Anti-Pattern"（已读）与 ESLint 官方一致——warn 的终局是升级为 error 或关闭，堆着的 warn 是被忽略的 warn（comment 区亦印证…

## 3) 推荐修复形态（综合）

**规则层**：token 检出器 + 分隔符后缀判定，四类 token（`%VAR%`、`$VAR`/`${VAR}`、`~`、`\\host\`）+ 分隔符 → **硬拦**；单段 POSIX 根形（`/x`，无已知前缀）→ **surfaced-skip**（info 级列出但不 fail），避免误报面失控。散文提及（无分隔符后缀）→ 不报。

**存量层**：先 warn 模式全量扫拿命中数 → 机械可修的（有确定性转换规则的，如 `%TEMP%/x` → `$TMP/x` 或仓库相对形）retro-fix → 不可机械修的逐条加现有 `<!-- machine-local: ... @ date -->` 标记 → 翻 fail-closed。**不引入集中 baseline 文件**——标记即豁免，且标记必须可被棘轮审计（定期扫「标记存在但该行已不再命中」的失效标记并要求清除，对应 rubocop `--report-unused-todo-entries` 的单向收缩语义）。

**测试层**：两个实证逃逸实例 + 每类新 token 的红向 fixture（必须命中）+ 绿向 fixture（散文提及、URL、inline code、已标记豁免行）——红绿成对，ShipLint/INCOSE 模式。

**不做的**：不做 blanket grandfather（与 R71 既定路线和 detect-secrets/rubocop 治理哲学一致）；不因 `/x` 误报面而放弃 env-var 形硬拦（误报用分层消化，不用放宽规则消化——secret scanner 教训：高误报规则会被整条关闭，见 checkmarx 分解）。

## 5) 信息缺口

- **「env-var + 分隔符 = locator」的逐字同构公开先例未找到**——找到的是三个类比（shellcheck tilde、spectralint 复合判定、path-guard 位置感知），逻辑同构但都不是文档 pathlint。判定器可能是仓库原创的小设计，风险自担但类比支撑充分。
- **semgrep baseline scan 的官方 doc 页 URL 三次尝试均 404**（域名结构迁移），最终以 `findings-ci` 页 + 第三方文章（stackharbor、augmentcode）交叉覆盖，semgrep baseline 机制本身已双源验证。
- **Tavily 引擎本次超限**，三引擎退化为双引擎（Exa + AnySearch）；关键结论仍满足「≥2 独立信源」，但少了一路独立召回。
- **`/x` 单段 POSIX 根形的误报率无公开数据**——spectralint 只处理 `home/Users/root` 前缀，没人公开处理过裸 `/x` 形；surfaced-skip 层级的选择是基于 ESLint warn 三用途的推理，非实测命中数结论（这正是「先 warn 全量扫拿命中数再定层级」步骤要回答的）。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume 018c6d1f-2435-4590-8eab-f55bbbc7d2e5
