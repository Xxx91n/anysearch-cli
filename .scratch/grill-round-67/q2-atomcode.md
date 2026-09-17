# R67-Q2 atomcode 调研存档（Codex 证据轨道策略）

> ctx_batch_execute 输出原文存档。调研结论经辩证吸收进 D-002/D-003；本文件仅为溯源凭证。

Executed 1 commands (152 lines, 16.7KB). Indexed 12 sections. Searched 5 queries.

## Commands

- atomcode: `atomcode -p "为一个垂直领域 agent CLI（npm 包 @anysearch-cli/*，经 MCP server + agent hooks 接入宿主 agent）设计对 Codex CLI 0.142.5（Windows 本机）真宿主验证的证据策略。已知事实：①前两宿主 CodeBuddy 2.151.0 与 Claude Code 2.1.251 已用双轨策略验证——published 包轻量基线（3 探针）+ 本地 tarball 全矩阵（P1-P9 headless 探针，测 MCP tools/hooks 事件/fail-open/域外拒答/效果对照）；②published 0.0.4 带疑似缺陷：session-start hook 无 --envelope 旗标时只输出 hookSpecificOutput 信封（Claude 契约），Codex 是否吃信封还是顶层字段是未验证假设，需实测裁决；③Codex 部署面：codex exec --json（headless JSONL，无需 --verbose）、-c key=value 任意配置覆盖、-p…`

## Indexed Sections

- atomcode (1.6KB)
- 1) 执行摘要 (1.0KB)
- 2) 分点结论 (0.0KB)
- 2) 分点结论 > Q1 双轨证据是否惯例、有无更优分层 —— Confidence：高 (1.9KB)
- 2) 分点结论 > Q2 Codex 探针隔离姿势 —— Confidence：高 (1.9KB)
- 2) 分点结论 > Q3 hooks 部署位置优先级 —— Confidence：中高（机制高置信，采用度为定性推断） (1.8KB)
- 2) 分点结论 > Q4 0.0.4 缺陷裁决探针实验设计 —— Confidence：高 (2.8KB)
- 2) 分点结论 > Q5 推荐证据轨道方案 (1.3KB)
- 3) 对比矩阵 (0.7KB)
- Codex 探针隔离三姿势对比 (0.4KB)
- 4) 完整来源清单 (2.2KB)
- 5) 信息缺口 (1.0KB)

## 推荐 轨道

### 3) 对比矩阵
# 3) 对比矩阵

| 项 | published 轻基线（现状） | published 全矩阵（推荐） | tarball 全矩阵（现状） | canary track | 备注 |
|---|---|---|---|---|---|
| 验证对象 | 用户下载的字节 | 用户下载的字节 | 源码产物 | 真实流量 cohort | published 才是用户拿到的东西 |
| 覆盖深度 | 3 探针 | 契约形态 smoke | P1-P9 | 指标驱动 | smoke 应按契约形态而非数量 |
| 堵住的缺陷类 | artifact drift（部分） | artifact drift（全部） | 逻辑回归 | 真实负载回归 | ER-1 属 drift 类，tarball 轨抓不到 |
| 可复现性 | 高（固定版本） | 高 | 高（绑定 commit） | 中（流量依赖） | Codex 侧靠 `--ignore-user-config`+`-c` |

### 2) 分点结论 > Q2 Codex 探针隔离姿势 —— Confidence：高
## Q2 Codex 探针隔离姿势 —— Confidence：高

| 姿势 | 优点 | 缺点 | 判定 |
|---|---|---|---|
| `--ignore-user-config` + `-c key=value` 注入 | 完全可复现；无机器状态泄漏；单命令自包含 | 不等于任何真实用户路径 | **复现基准轨** |
| 项目级 `.codex/config.toml` | 最接近真实用户路径（trusted project 加载、agenticcontrolplane/1MCP 安装器都写这里）；不污染用户态 | 依赖 project trust 状态，跨机器复现需固定 trust 步骤 | **真实路径旁证轨** |
| `-p` profile | 可复用预设（laozhang 确认 0.134+ profile 独立文件 `review.config.toml`） | 文档明言"any guide that draws a unified precedence ladder is inventing it"（alexdunlop）；profile 层在 trusted project 之下，探针结果可能被静默遮蔽 | 不推荐为主轨 |

三源一致的 precedence 顺序：**CLI flags/`--config` > trusted project config > profile > user config > system > defaults**（vladimirsiedykh、laozhang；alexdunlop 提醒这是从 `overrides.rs` 读出的"层"而非成文 spec——所以探针设计要**每腿单层注入**，绝不在同一条命令里混两层，否则无法归因）。

**推荐**：主证据轨用 `--ignore-user-config -c 'mcp_servers.anysearch.command=...' -c 'mcp_servers.anysearch.required=true' ...`——`-c` 是 dotted-key 层，等价于 CLI 顶层注入，且 `required=true` 给你一个免费的 MCP 初始化哨兵（失败即硬退出，非 fail-open，探针 P7 在 Codex 下预期要改判）。旁证轨用 `.codex/` 目录走真实 trust 流程各跑一遍，验证"`--ignore-user-config` 隔离结果 ≈ 真实路径结果"这一迁移假设本身。**不要**用 `--dangerously-bypass-hook-trust` 做主轨——它跳过 hash 信任，恰好绕开了你们要验证的 hooks 真实路径；只在"trust 弹窗无法 headless 处理"时作为隔离手段，并在证据里显式标注该腿绕过了 trust。

## Codex config.toml 项目级 隔离

### 2) 分点结论 > Q2 Codex 探针隔离姿势 —— Confidence：高
## Q2 Codex 探针隔离姿势 —— Confidence：高

| 姿势 | 优点 | 缺点 | 判定 |
|---|---|---|---|
| `--ignore-user-config` + `-c key=value` 注入 | 完全可复现；无机器状态泄漏；单命令自包含 | 不等于任何真实用户路径 | **复现基准轨** |
| 项目级 `.codex/config.toml` | 最接近真实用户路径（trusted project 加载、agenticcontrolplane/1MCP 安装器都写这里）；不污染用户态 | 依赖 project trust 状态，跨机器复现需固定 trust 步骤 | **真实路径旁证轨** |
| `-p` profile | 可复用预设（laozhang 确认 0.134+ profile 独立文件 `review.config.toml`） | 文档明言"any guide that draws a unified precedence ladder is inventing it"（alexdunlop）；profile 层在 trusted project 之下，探针结果可能被静默遮蔽 | 不推荐为主轨 |

三源一致的 precedence 顺序：**CLI flags/`--config` > trusted project config > profile > user config > system > defaults**（vladimirsiedykh、laozhang；alexdunlop 提醒这是从 `overrides.rs` 读出的"层"而非成文 spec——所以探针设计要**每腿单层注入**，绝不在同一条命令里混两层，否则无法归因）。

**推荐**：主证据轨用 `--ignore-user-config -c 'mcp_servers.anysearch.command=...' -c 'mcp_servers.anysearch.required=true' ...`——`-c` 是 dotted-key 层，等价于 CLI 顶层注入，且 `required=true` 给你一个免费的 MCP 初始化哨兵（失败即硬退出，非 fail-open，探针 P7 在 Codex 下预期要改判）。旁证轨用 `.codex/` 目录走真实 trust 流程各跑一遍，验证"`--ignore-user-config` 隔离结果 ≈ 真实路径结果"这一迁移假设本身。**不要**用 `--dangerously-bypass-hook-trust` 做主轨——它跳过 hash 信任，恰好绕开了你们要验证的 hooks 真实路径；只在"trust 弹窗无法 headless 处理"时作为隔离手段，并在证据里显式标注该腿绕过了 trust。

### Codex 探针隔离三姿势对比
# Codex 探针隔离三姿势对比

| 项 | `--ignore-user-config`+`-c` | 项目级 `.codex/` | profile `-p` | 备注 |
|---|---|---|---|---|
| 复现性 | 最高（单命令自包含） | 中（依赖 project trust） | 中 | |
| 真实用户路径贴合 | 低 | 最高 | 中 | ACP/1MCP 安装器写项目级或用户级 |
| 被遮蔽风险 | 无 | 无 | 有（trusted project 在 profile 之上） | |

### 1) 执行摘要
# 1) 执行摘要

**Tl;dr**：①「published 轻基线 + 候选体全矩阵」双轨是业界惯例，且与 canary/smoke 分层理论同构，可以沿"按信封形态分轨"再优化一档；②Codex 探针隔离最优解是**用户级 `--ignore-user-config` + `-c` 点火注入**作为复现基准、**项目级 `.codex/` 目录**作为真实用户路径旁证；③hooks 部署位置三选一里**项目级 `.codex/hooks.json` 是真实用户最高采用路径**（信任模型同 config、加性合并不被替换）；④0.0.4 缺陷裁决用**四腿对照**（原生基线/envelope 腿/顶层腿/plain-text 腿）即可区分三种假设；⑤推荐维持双轨但把 published 轨升级为"契约形态 smoke"，候选轨按 Codex 专属差异点扩矩阵。

Confidence：**高**（Codex hooks/config 机制有官方文档 + 两个独立第三方参考交叉；双轨惯例有 canary/smoke 工程文献 + 仓库自身 smoke-gate 技能双源；缺陷裁决腿设计由官方输出契约文档直接支撑）。

## hooks.json 部署位置 信任

### 1) 执行摘要
# 1) 执行摘要

**Tl;dr**：①「published 轻基线 + 候选体全矩阵」双轨是业界惯例，且与 canary/smoke 分层理论同构，可以沿"按信封形态分轨"再优化一档；②Codex 探针隔离最优解是**用户级 `--ignore-user-config` + `-c` 点火注入**作为复现基准、**项目级 `.codex/` 目录**作为真实用户路径旁证；③hooks 部署位置三选一里**项目级 `.codex/hooks.json` 是真实用户最高采用路径**（信任模型同 config、加性合并不被替换）；④0.0.4 缺陷裁决用**四腿对照**（原生基线/envelope 腿/顶层腿/plain-text 腿）即可区分三种假设；⑤推荐维持双轨但把 published 轨升级为"契约形态 smoke"，候选轨按 Codex 专属差异点扩矩阵。

Confidence：**高**（Codex hooks/config 机制有官方文档 + 两个独立第三方参考交叉；双轨惯例有 canary/smoke 工程文献 + 仓库自身 smoke-gate 技能双源；缺陷裁决腿设计由官方输出契约文档直接支撑）。

### 2) 分点结论 > Q3 hooks 部署位置优先级 —— Confidence：中高（机制高置信，采用度为定性推断）
## Q3 hooks 部署位置优先级 —— Confidence：中高（机制高置信，采用度为定性推断）

官方 hooks 文档列出四个最有用位置 + plugin 捆绑，关键机制事实：

1. **所有来源加性合并（additive）**：更高 precedence 层不替换低层 hooks；同一层 hooks.json 与 inline `[hooks]` 并存会合并并警告。
2. **项目级 `<repo>/.codex/hooks.json` 只在 project `.codex/` layer 被 trusted 后加载**；不信任时仍加载 user/system hooks。
3. **plugin 捆绑 hooks 走与其他非 managed hooks 完全相同的 trust-review 流**（plugin manifest 或默认 `hooks/hooks.json`），没有免信任通道。
4. 非 managed hook 按**定义 hash 记信任**——hook 一改就回到未信任态，headless 下这是最大的部署摩擦点。

| 位置 | 真实用户采用度 | 信任机制 | 对验证的含义 |
|---|---|---|---|
| 项目级 `.codex/hooks.json` | **最高**——面向 repo 的插件（你们属此类）自然落位；trust 随项目信任一次性完成 | hash 信任 + project trust 前置 | **主验证位置** |
| 用户级 `~/.codex/hooks.json` | 高——全局治理类工具（ACP 安装器默认写这里） | 纯 hash 信任 | 旁证：验证加性合并不冲突 |
| plugin 捆绑 | 低——Codex plugin 生态较新 | 同样 trust-review，无特权 | 覆盖一次即可（信封一致性同源，探针可复用） |
| requirements.toml managed | 企业场景 | policy 信任、不可禁用 | 超范围，不验 |

**部署建议**：探针主轨写项目级 `.codex/hooks.json`（最真实路径），补一腿用户级验证加性合并语义（两个来源同 event 都 fire 且无顺序保证——官方明言"concurrently, no ordering"，你们的 SessionStart 注入探针不能假设独占 stdout）。

### 2) 分点结论 > Q2 Codex 探针隔离姿势 —— Confidence：高
## Q2 Codex 探针隔离姿势 —— Confidence：高

| 姿势 | 优点 | 缺点 | 判定 |
|---|---|---|---|
| `--ignore-user-config` + `-c key=value` 注入 | 完全可复现；无机器状态泄漏；单命令自包含 | 不等于任何真实用户路径 | **复现基准轨** |
| 项目级 `.codex/config.toml` | 最接近真实用户路径（trusted project 加载、agenticcontrolplane/1MCP 安装器都写这里）；不污染用户态 | 依赖 project trust 状态，跨机器复现需固定 trust 步骤 | **真实路径旁证轨** |
| `-p` profile | 可复用预设（laozhang 确认 0.134+ profile 独立文件 `review.config.toml`） | 文档明言"any guide that draws a unified precedence ladder is inventing it"（alexdunlop）；profile 层在 trusted project 之下，探针结果可能被静默遮蔽 | 不推荐为主轨 |

三源一致的 precedence 顺序：**CLI flags/`--config` > trusted project config > profile > user config > system > defaults**（vladimirsiedykh、laozhang；alexdunlop 提醒这是从 `overrides.rs` 读出的"层"而非成文 spec——所以探针设计要**每腿单层注入**，绝不在同一条命令里混两层，否则无法归因）。

**推荐**：主证据轨用 `--ignore-user-config -c 'mcp_servers.anysearch.command=...' -c 'mcp_servers.anysearch.required=true' ...`——`-c` 是 dotted-key 层，等价于 CLI 顶层注入，且 `required=true` 给你一个免费的 MCP 初始化哨兵（失败即硬退出，非 fail-open，探针 P7 在 Codex 下预期要改判）。旁证轨用 `.codex/` 目录走真实 trust 流程各跑一遍，验证"`--ignore-user-config` 隔离结果 ≈ 真实路径结果"这一迁移假设本身。**不要**用 `--dangerously-bypass-hook-trust` 做主轨——它跳过 hash 信任，恰好绕开了你们要验证的 hooks 真实路径；只在"trust 弹窗无法 headless 处理"时作为隔离手段，并在证据里显式标注该腿绕过了 trust。

## 缺陷裁决 实验设计 对照

### 2) 分点结论 > Q4 0.0.4 缺陷裁决探针实验设计 —— Confidence：高
## Q4 0.0.4 缺陷裁决探针实验设计 —— Confidence：高

**先摆清契约事实**（这是设计的基础，来自官方 hooks 文档 + 两个独立参考）：

- Codex hooks **输出解析层同时认识三种形态**：`hookSpecificOutput.permissionDecision/additionalContext`（envelope）、legacy 顶层 `{"decision":"block","reason":...}`（至少对 deny/blocking 等价）、exit code 2 + stderr。symposium 与 agenticcontrolplane 均确认 deny 场景 envelope 与 legacy 等价。
- 但 **SessionStart 注入上下文的场景不对称**：文档只写了 `hookSpecificOutput.additionalContext`，另外 plain text stdout 对 SessionStart/UserPromptSubmit 有效（对 Pre/PostToolUse/Stop 无效）。**顶层裸 `additionalContext` 字段在文档中不存在**——这正是缺陷假设的判别面：Codex 解析器若对未知顶层字段 fail-open，0.0.4 的行为 = 上下文丢失但会话正常。

**四腿对照设计**（每腿同一 stub hook，只换 stdout 载荷；用 `codex exec --json` 收 JSONL，观察 marker 是否进入后续 turn 的指令流）：

| 腿 | stub hook stdout | 预期 marker 进入指令流？ | 判别含义 |
|---|---|---|---|
| L0 基线 | 空 / `{}` | 否 | 哑变量：证明探针管线本身无假阳性（例如 AGENTS.md 注入碰巧携带 marker） |
| L1 | `{"hookSpecificOutput":{"additionalContext":"MARKER-ENV"}}` | 应是 | "Codex 吃信封"假设成立 |
| L2 | `{"additionalContext":"MARKER-TOP"}`（顶层裸字段，0.0.4 现状） | ? | **裁决腿** |
| L3 | `MARKER-PLAIN`（plain text） | 应是 | 第三种已知有效形态，防止"啥都不吃"被误诊为 L2 载荷格式问题 |

三假设的判读：
- **只吃顶层**：L1 否 + L2 是 → 极不可能（与文档相悖），若出现说明 0.142.5 与官方文档冲突，属高价值发现；
- **只吃信封**：L1 是 + L2 否 + L3 是 → 最可能，0.0.4 缺陷确证为 red；
- **两者都吃**：L1 是 + L2 是 → Codex 解析器对 unknown-top-level 宽容，0.0.4 在 Codex 下"歪打正着"，缺陷降级为"非 Claude 宿主上碰巧工作"，但仍是契约缺陷（依赖未文档化行为）。

**对照完备性检查**：L0 必须先跑且排除两个污染源——① marker 词被 AGENTS.md/系统提示注入（marker 用随机 nonce）；② `codex exec --json` 的事件流里 hook 输出本身会出现（要区分"hook fired"事件与"上下文进入模型指令流"——后者才能裁决，观察下一 turn 的 prompt token / 模型引用 marker 的回复）。再加一腿 **L1'：payload 加一个未知顶层字段 + envelope**（`{"systemMessage":"x","hookSpecificOutput":{...}}`），测 Codex 是否对混合载荷降级——这一腿把"宽容解析"的边界也画出来，防止三假设判读里出现第四种混淆。

### 1) 执行摘要
# 1) 执行摘要

**Tl;dr**：①「published 轻基线 + 候选体全矩阵」双轨是业界惯例，且与 canary/smoke 分层理论同构，可以沿"按信封形态分轨"再优化一档；②Codex 探针隔离最优解是**用户级 `--ignore-user-config` + `-c` 点火注入**作为复现基准、**项目级 `.codex/` 目录**作为真实用户路径旁证；③hooks 部署位置三选一里**项目级 `.codex/hooks.json` 是真实用户最高采用路径**（信任模型同 config、加性合并不被替换）；④0.0.4 缺陷裁决用**四腿对照**（原生基线/envelope 腿/顶层腿/plain-text 腿）即可区分三种假设；⑤推荐维持双轨但把 published 轨升级为"契约形态 smoke"，候选轨按 Codex 专属差异点扩矩阵。

Confidence：**高**（Codex hooks/config 机制有官方文档 + 两个独立第三方参考交叉；双轨惯例有 canary/smoke 工程文献 + 仓库自身 smoke-gate 技能双源；缺陷裁决腿设计由官方输出契约文档直接支撑）。

## 双轨 基线 canary

### 1) 执行摘要
# 1) 执行摘要

**Tl;dr**：①「published 轻基线 + 候选体全矩阵」双轨是业界惯例，且与 canary/smoke 分层理论同构，可以沿"按信封形态分轨"再优化一档；②Codex 探针隔离最优解是**用户级 `--ignore-user-config` + `-c` 点火注入**作为复现基准、**项目级 `.codex/` 目录**作为真实用户路径旁证；③hooks 部署位置三选一里**项目级 `.codex/hooks.json` 是真实用户最高采用路径**（信任模型同 config、加性合并不被替换）；④0.0.4 缺陷裁决用**四腿对照**（原生基线/envelope 腿/顶层腿/plain-text 腿）即可区分三种假设；⑤推荐维持双轨但把 published 轨升级为"契约形态 smoke"，候选轨按 Codex 专属差异点扩矩阵。

Confidence：**高**（Codex hooks/config 机制有官方文档 + 两个独立第三方参考交叉；双轨惯例有 canary/smoke 工程文献 + 仓库自身 smoke-gate 技能双源；缺陷裁决腿设计由官方输出契约文档直接支撑）。

### 2) 分点结论 > Q1 双轨证据是否惯例、有无更优分层 —— Confidence：高
## Q1 双轨证据是否惯例、有无更优分层 —— Confidence：高

**是惯例，且理论支撑充分。**

- **两轨的认识论分工**是渐进交付文献的标准结论：qaskills.sh 的 canary 指南明确"signal 按速度分层：readiness → smoke → 短窗指标 → 深层业务检查"、"useful smoke suite is small——startup、config、一条认证路径、最高风险变更"；映射到你们场景：published 轨 = smoke（验证"用户真正下载的字节"在真宿主里活着），候选轨 = 深层检查（全矩阵 P1-P9）。知识库里 Squad v0.8.25 的"test the actual bytes users download"三层矩阵与本仓库 Noosphere 的 `public-artifact-runtime-smoke-gate` 技能（"Prove the artifact users install, not the source tree"）都是同构实践。
- **关键洞察：分层轴有两个独立维度，不该混用。** 维度 A = 工件来源（published vs tarball），维度 B = 覆盖深度（smoke vs 全矩阵）。你们现有双轨是 A/B 捆绑的。工业界更优做法（canary track 的核心思想）是**把两维正交**：
  - published 包全矩阵（因为 tarball→npm 差异——file 清单、bin shebang、hooks 模板是否进 files 字段——正是 ER-1 那类缺陷的成因，全矩阵对 published 包也只贵几分钟 headless）；
  - tarball 做 smoke 迭代（开发期快速反馈，不进证据档案）。
  - 即：**published-full-matrix + tarball-dev-iteration** 优于 published-smoke + tarball-full。证据门槛放在"用户实际拿到的工件"上。
- 更优分层候选是 **契约形态 smoke**：不按探针数量分轨，而按"hooks 信封形态"分轨——因为你们的缺陷史（ER-2 顶层信封、本次 0.0.4 session-start envelope）表明风险集中在输出契约，不在探针数量。published 轨只跑"每种输出形态各一个探针"（envelope / 顶层 / plain-text / exit-code-2 四腿），这是最小且每腿都有判别力的 smoke。

### 3) 对比矩阵
# 3) 对比矩阵

| 项 | published 轻基线（现状） | published 全矩阵（推荐） | tarball 全矩阵（现状） | canary track | 备注 |
|---|---|---|---|---|---|
| 验证对象 | 用户下载的字节 | 用户下载的字节 | 源码产物 | 真实流量 cohort | published 才是用户拿到的东西 |
| 覆盖深度 | 3 探针 | 契约形态 smoke | P1-P9 | 指标驱动 | smoke 应按契约形态而非数量 |
| 堵住的缺陷类 | artifact drift（部分） | artifact drift（全部） | 逻辑回归 | 真实负载回归 | ER-1 属 drift 类，tarball 轨抓不到 |
| 可复现性 | 高（固定版本） | 高 | 高（绑定 commit） | 中（流量依赖） | Codex 侧靠 `--ignore-user-config`+`-c` |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: session-start, hookspecificoutput, public-artifact-runtime-smoke-gate, vladimirsiedykh, --dangerously-bypass-hook-trust, additionalcontext, agenticcontrolplane, comparative, posttooluse, criticism, community, readiness, noosphere, overrides, official, currency, laozhang, required, decision, --ignore-user-config, sessionstart, chatgpt, install, ③codex, --json, 不进证据档案, 单命令自包含, system, 每腿单层注入, stdout, legacy, jsonl, value, batch, learn, users, prove, guide, 初始化哨兵, block