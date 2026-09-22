# T0 — repin 拦截实验 transcript（判决矩阵逐格实录）

Date: 2026-09-22. pnpm 11.24.0 / node v24.11.0 / win32。Scratch 实验场 = 机器临时目录 `r78-t0-scratch`（不入仓）。闸 = `minimumReleaseAge: 2880`（48h）。判定矩阵预登记于 decision-ledger.md D-002（权威文本）。

## 标本龄期锚（npm view time，采样 2026-09-22T14:05Z）

| 版本 | 发布时间 | 采样时龄 | 闸态 |
|---|---|---|---|
| `@deepseek-ai/dsh-agent@0.1.7-alpha.1` | 2026-09-22T06:04:55.999Z | ~481min | **闸内**（出闸 ≈2026-09-24T06:05Z）|
| `@deepseek-ai/dsh-agent@0.1.5-rc.3` | 2026-09-22T05:39:36.425Z | ~506min | **闸内** |
| `@deepseek-ai/dsh-agent@0.1.6-alpha.2` | 2026-09-17T13:38:55.569Z | ~5d | 出闸（E1 对照）|
| 现钉 `0.1.5-rc.2` | 2026-09-10T14:44:55.316Z | ~12d | 出闸 |

## 逐格实录

| 格 | 环境 | 操作 | 预登记预期 | 实测 | 判定 |
|---|---|---|---|---|---|
| E1 正对照 | scratch | catalog 钉 0.1.6-alpha.2 + `pnpm install` | 成功 | exit 0，`+ @deepseek-ai/dsh-agent 0.1.6-alpha.2`（+17 包，7.4s）| ✅ 一致 |
| E2 核心 | scratch | `minimumReleaseAge: 2880` + catalog 钉 0.1.7-alpha.1 + `pnpm install` | `ERR_PNPM_NO_MATURE_MATCHING_VERSION` | exit 1，`ERR_PNPM_NO_MATURE_MATCHING_VERSION] 24 versions do not meet the minimumReleaseAge constraint`（列出 0.1.7-alpha.1 全家 + cordis@4.0.3/cosmokit@1.8.4/schemastery@3.18.3 同日闸内版）| ✅ 一致 |
| E3 豁免 | scratch | E2 + `minimumReleaseAgeStrict: false` | 静默装上 | exit 0，`+ @deepseek-ai/dsh-agent 0.1.7-alpha.1`；pnpm **自动写 15 条 `minimumReleaseAgeExclude`** 入 ws yaml（附提示 "set minimumReleaseAgeStrict to true to gate these updates with a prompt"）| ✅ 一致（豁免面实证，且发现自动 exclude 写入行为）|
| E4 真身 | 仓内 | catalog dsh-agent 0.1.5-rc.2→0.1.7-alpha.1，`pnpm install`（非 frozen）| E2 同款龄期错误 | exit 1，`ERR_PNPM_NO_MATURE_MATCHING_VERSION] 1 version does not meet ...`（唯 dsh-agent@0.1.7-alpha.1——其余家族仍钉 rc.2 出闸版）| ✅ 一致（lockfile 失配→重解析→闸路径硬拦）|
| E5 真身 | 仓内 | 同 E4 + `pnpm install --frozen-lockfile` | lockfile-out-of-sync（拦截但执法点不同）| exit 1，`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] ... "overrides" configuration doesn't match the value found in the lockfile` | ✅ 语义一致——frozen 拒装于 config 一致性检查点，错误码如实记（非龄期闸执法点）|
| E6 真身 | 仓内 | lockfile 携闸内版 + `--frozen-lockfile` | `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | **exit 0 静默放行**，四种变体全绿（见下）| ❌ **证伪** |
| E7 证伪 | scratch | 无 time 字段源 | 装成功=合法证伪向量 | npmjs 恒带 time 字段，无标本 → 「配置面向量」记档不跑（预登记路径）| ◻ 记档 |

## E6 证伪细节（三变量排除法）

锁文件写入路径：ws yaml 临时加 `minimumReleaseAgeStrict: false` → `pnpm install`（闸放行并写入 lockfile + exclude 列表）→ 删除 `strict:false` 与 `minimumReleaseAgeExclude` 块恢复 strict 默认态 → lockfile 此时真实携带 `@deepseek-ai/dsh-agent@0.1.7-alpha.1`（importers/packages/snapshots 三处 + overrides 段记录 0.1.7-alpha.1，与 config catalog 一致——config-mismatch 检查过闸）。

| 变体 | 条件 | 结果 |
|---|---|---|
| E6a | frozen + node_modules 已新 | `Lockfile is up to date, resolution step is skipped. Already up to date.` exit 0 |
| E6b | frozen + node_modules 全删（温 store）| 364 包全量重链，exit 0 |
| E6c | frozen + node_modules 全删 + **全新 `--store-dir`**（冷 store，364 tarball 全从 npmjs 重下，含 8h 龄 dsh-agent）| exit 0，2m5s 装完 |
| E6d | frozen + 显式 `minimumReleaseAgeStrict: true` | exit 0 |
| E6e | `CI=true pnpm fetch`（lockfile 携闸内版，strict 默认）| exit 0，364 包导入 virtual store |

**结论：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 在 pnpm 11.24.0 的 lockfile 回放通道不触发**——`install --frozen-lockfile`（温/冷 store、显式 strict:true）与 `pnpm fetch` 全部静默放行闸内锁定版。龄期闸只拦「新鲜 registry 解析路径」（manifest/catalog/range → registry 元数据）；lockfile 回放完全绕过。预登记的「#11583 lockfile 复核通道在 11.24.0 真执法」假设证伪（注：q2 调研所载 #11583「lockfile 加载后逐条目复核」与本机实测直接矛盾——调研以 PR 描述为准，实测以行为为准；可能原因=该修复未在 11.24.0 生效/有未满足的前置条件/已被后续变更回归，如实记档待查）。

## 断言收窄（按 D-002/D-005 证伪处置路径）

原断言（R77 ADR-0078 隐含前提）：「任何 pnpm 驱动的 registry 版本解析在龄期闸内均被拦截」→ **收窄为**：

> 在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）前提下，`minimumReleaseAge` 闸只拦截**新鲜版本解析路径**（manifest/catalog/range 重解析，E2/E4 实证）；**lockfile 回放通道（`--frozen-lockfile`）不执法龄期闸**——闸内版一旦进入 lockfile（strict:false 放行写入、异机提交、闸外时期生成等任何渠道），frozen install 静默放行（E6a~d 实证）。拦截边界 = 解析路径，非安装路径。E5 另证：frozen 的 config-mismatch 检查先于一切龄期检查。

## 安全后果（供 ADR-0079 引用）

`minimumReleaseAge` 对本仓的真实保护面 = 「开发者/Agent 主动 repin 或升级」场景（E2/E4 路径），**不保护**「lockfile 已携闸内版」场景——例如上游发版后 N 小时内从他机/CI 生成的 lockfile 被带入本仓 frozen install，闸不作为。L1 探测层立法前提须按此收窄；`minimumReleaseAgeIgnoreMissingTime: false` 加固项仍成立（堵「无 time 字段源」向量，E7 记档态）。

## 零脏恢复实证

- 快照：`pnpm-workspace.yaml` 3051B sha256 `c68dfcffe7982c46…`、`pnpm-lock.yaml` 168042B sha256 `ce7fdbe9041925dd…`（实验前）
- 恢复后同 sha256 逐字节一致；实验相关改动 `git status --porcelain` 零痕迹（仅本归档 evidence/ 新文件在册，属交付物）；恢复后 `pnpm install` exit 0 重建 364 包。
- **过程事故注记**：一次 `node -e` 经 bash 双引号携带 `$1` 被 shell 展开，ws yaml catalog 键被啃掉致 YAML 解析失败——快照即时恢复，无残留。印证 goal.md 教训：含 `$` 的写入一律走 ctx_execute(javascript) 或 .cjs，不走 shell 双引号串。
- scratch 产物全留 `%TEMP%/r78-t0-scratch` + `%TEMP%/r78-t0-repo-snap` + `%TEMP%/r78-fresh-store`，未入仓。 <!-- machine-local: Windows env-var 路径引用（存量合规化） @ 2026-09-22 -->
