# R78 Q2 — atomcode 深调研存档（repin 拦截实验设计）

Date: 2026-09-22. Prompt: ./q2-prompt.txt。引擎实况见文末 Sufficiency Gate。

## 1) 执行摘要（Tl;dr）

**Confidence：高**（机制结论有 pnpm 官方文档 + 官方 PR + 第三方综述三重交叉验证；唯一保留是未做本机实测）。该治理断言**在默认配置下成立但需加三个限定条件**：pnpm 的 `minimumReleaseAge` 作用于 **resolution 阶段**（版本元数据选择，tarball 下载之前），对 catalog 精确钉死的版本同样生效，strict 模式（显式配置 `minimumReleaseAge` 时 v11 起默认开启）下报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 硬错误。但断言存在**已证实的豁免面**（`minimumReleaseAgeExclude`、`minimumReleaseAgeIgnoreMissingTime` 默认 true、`minimumReleaseAgeStrict: false` 静默回退、`trustLockfile`），且 pnpm 自己在 2026-05 之前就存在「lockfile 在场即绕过」的执法漏洞（#10438，PR #11583 修复）——这本身就是「只配置不验证会被证伪」的一等先例，直接支撑你们立法的必要性。

### atomcode > Sufficiency Gate
## Sufficiency Gate

searches: 9 | angles: Official / Comparative / Criticism / Currency / Community | full reads: 6（pnpm.io/settings、pnpm.io/supply-chain-security、pnpm PR #11583、Renovate 官方文档×2、nesbitt.io） | gaps: 未在本机实测 pnpm 11.24.0 的逐字报错输出；Renovate 配置页过长被截断，minimumReleaseAge 正文细节改由其 key-concepts 页与 nesbitt.io 交叉补齐

## catalog

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**Confidence：高**（机制结论有 pnpm 官方文档 + 官方 PR + 第三方综述三重交叉验证；唯一保留是未做本机实测）。该治理断言**在默认配置下成立但需加三个限定条件**：pnpm 的 `minimumReleaseAge` 作用于 **resolution 阶段**（版本元数据选择，tarball 下载之前），对 catalog 精确钉死的版本同样生效，strict 模式（显式配置 `minimumReleaseAge` 时 v11 起默认开启）下报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 硬错误。但断言存在**已证实的豁免面**（`minimumReleaseAgeExclude`、`minimumReleaseAgeIgnoreMissingTime` 默认 true、`minimumReleaseAgeStrict: false` 静默回退、`trustLockfile`），且 pnpm 自己在 2026-05 之前就存在「lockfile 在场即绕过」的执法漏洞（#10438，PR #11583 修复）——这本身就是「只配置不验证会被证伪」的一等先例，直接支撑你们立法的必要性。

### atomcode > 3) 推荐实验设计：判决矩阵（预先登记）
## 3) 推荐实验设计：判决矩阵（预先登记）

**设计原则**：scratch 最小环境隔离 resolution 行为，真身 monorepo 验证立法语境；六格判决矩阵 + 一格正对照，每格预期错误码预先写死，实测输出与之逐字比对。

| # | 环境 | 操作 | 预期结果 | 判决含义 |
|---|---|---|---|---|
| E1 正对照 | scratch | 钉龄期 >48h 的版本，install | 成功 | 环境 sane，失败才有意义 |
| E2 | scratch | catalog 钉龄期 <48h 精确版本，install | `ERR_PNPM_NO_MATURE_MATCHING_VERSION` | **断言核心格**：成立 |
| E3 | scratch | 同 E2 + `minimumReleaseAgeStrict: false` | 静默装上不成熟版本 | 豁免面存在，立法须写明 strict 前提 |
| E4 | 真身 | 只改 catalog 版本号，非 frozen install | lockfile 失配 → 重新解析 → E2 同款错误 | 断言在真身语境成立 |
| E5 | 真身 | 同 E4 但 `--frozen-lockfile` | 失败但错误为 **lockfile-out-of-sync**（非龄期错误） | 拦截成立，执法点不同——报告须区分 |
| E6 | 真身 | 直接改 lockfile 写入闸内版本 + frozen | `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（#11583 后行为） | 验证 lockfile 复核通道在 11.24.0 真的执法 |
| E7 证伪探针 | scratch | 钉一个 `time` 字段缺失源上的版本（或临时 `minimumReleaseAgeIgnoreMissingTime` 不动默认值指向无 time 的镜像） | **安装成功**（默认 true 跳过检查） | 断言被证伪的合法向量——「任何解析都被拦截」在无 time 元数据面前不成立 |

**对立法的建议**：E2/E4/E6 通过即可维持「npm pack tarball 静态探针是闸内唯一合法未检疫探测手段」的立法；但断言文本应从「**任何** pnpm 驱动的版本解析在龄期闸内都被拦截」收窄为：「**在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）、trustLockfile 未开启的前提下**，任何 pnpm 驱动的 registry 版本解析在龄期闸内均以 hard error 拦截；lockfile 通道由 #11583 引入的复核独立执法」。E3/E7 的存在说明若不做限定，断言可被单点证伪，立法会被翻案——限定了反而立法更稳固。

**用 npm pack 探针找测试标本的方法**：`npm view <pkg> time --json` 拿发布时间轴（与 pnpm 读的是同一个 packument `time` 字段），选一个发布 <48h 的版本作 E2/E4 标本，同一版本在 48h 后跑 E1 正对照——这同时利用了「时间会自然把负例转成正例」的性质，一次抓包两次使用。

### atomcode > 2) 分点结论 > 问题 2：lockfile 在场的行为 —— 曾经绕过，现已封堵；frozen 与非 frozen 是两条不同路径
### 问题 2：lockfile 在场的行为 —— 曾经绕过，现已封堵；frozen 与非 frozen 是两条不同路径

这是本研究最有执法史价值的发现，分三层：

1. **历史漏洞（已被修复）**：PR #11583（2026-05-16 merge，已读原文）原文写道：「The policy only fires while pnpm is *choosing* a version. Once a version is pinned in the lockfile… every later pnpm install (including --frozen-lockfile and pnpm fetch) installs it without re-checking, which defeats the supply-chain protection」——即 v11.3.0 之前，lockfile 在场 = 闸门完全短路。bun 修过一模一样的 bug（oven-sh/bun#30526，PR 原文点名）。
2. **现状（11.24.0 适用）**：lockfile 加载后、任何 tarball 下载前，pnpm 会对**每条 lockfile 条目**重新跑龄期复核，违规即硬错误 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（PR #11583 原文）。这意味着即使有人直接改 lockfile 写入闸内版本，frozen install 也会被拦。
3. **改 catalog 钉版本的路径分化**：
   - **非 frozen**：catalog 版本号变了 → lockfile 与 manifest 失配 → 重新解析 → 触发龄期闸 → `ERR_PNPM_NO_MATURE_MATCHING_VERSION`。
   - **--frozen-lockfile**：lockfile 失配本身就会失败（CI 默认 frozen），**但失败原因是 lockfile-out-of-sync，不是龄期错误**——注意这仍算「拦截成功」，只是执法点不同。若有人同时手改 lockfile + frozen，则由第 2 层的 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 接管。

**豁免面清单**（全部来自 pnpm.io/settings 官方文档，已读）：

| 豁免机制 | 默认 | 效果 |
|---|---|---|
| `minimumReleaseAgeExclude` | 无 | 按 `pkg` / `pkg@version` 精确豁免（含通配符讨论，discussion #9990） |
| `minimumReleaseAgeIgnoreMissingTime` | **true** | registry 元数据无 `time` 字段（私有源/镜像常见）→ **直接跳过检查**。置 false 才 fail-closed |
| `minimumReleaseAgeStrict` | 显式配置时 true | 置 false 则静默回退到不成熟版本 |
| `trustLockfile` | false | 置 true 则跳过整个 lockfile 复核通道 |
| `minimumReleaseAge` 内建默认 1440 | 非 strict | 未显式配置时仅回退不报错（你们已显式配置，不适用） |

另有两个已知配置陷阱（criticism 角度）：`shared-workspace-lockfile: false` 的子包曾完全绕过闸（issue #10008）；`.npmrc` 中 kebab-case 写法混乱导致配置不生效的同 issue 记录。

## lockfile

### atomcode > 2) 分点结论 > 问题 2：lockfile 在场的行为 —— 曾经绕过，现已封堵；frozen 与非 frozen 是两条不同路径
### 问题 2：lockfile 在场的行为 —— 曾经绕过，现已封堵；frozen 与非 frozen 是两条不同路径

这是本研究最有执法史价值的发现，分三层：

1. **历史漏洞（已被修复）**：PR #11583（2026-05-16 merge，已读原文）原文写道：「The policy only fires while pnpm is *choosing* a version. Once a version is pinned in the lockfile… every later pnpm install (including --frozen-lockfile and pnpm fetch) installs it without re-checking, which defeats the supply-chain protection」——即 v11.3.0 之前，lockfile 在场 = 闸门完全短路。bun 修过一模一样的 bug（oven-sh/bun#30526，PR 原文点名）。
2. **现状（11.24.0 适用）**：lockfile 加载后、任何 tarball 下载前，pnpm 会对**每条 lockfile 条目**重新跑龄期复核，违规即硬错误 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（PR #11583 原文）。这意味着即使有人直接改 lockfile 写入闸内版本，frozen install 也会被拦。
3. **改 catalog 钉版本的路径分化**：
   - **非 frozen**：catalog 版本号变了 → lockfile 与 manifest 失配 → 重新解析 → 触发龄期闸 → `ERR_PNPM_NO_MATURE_MATCHING_VERSION`。
   - **--frozen-lockfile**：lockfile 失配本身就会失败（CI 默认 frozen），**但失败原因是 lockfile-out-of-sync，不是龄期错误**——注意这仍算「拦截成功」，只是执法点不同。若有人同时手改 lockfile + frozen，则由第 2 层的 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 接管。

**豁免面清单**（全部来自 pnpm.io/settings 官方文档，已读）：

| 豁免机制 | 默认 | 效果 |
|---|---|---|
| `minimumReleaseAgeExclude` | 无 | 按 `pkg` / `pkg@version` 精确豁免（含通配符讨论，discussion #9990） |
| `minimumReleaseAgeIgnoreMissingTime` | **true** | registry 元数据无 `time` 字段（私有源/镜像常见）→ **直接跳过检查**。置 false 才 fail-closed |
| `minimumReleaseAgeStrict` | 显式配置时 true | 置 false 则静默回退到不成熟版本 |
| `trustLockfile` | false | 置 true 则跳过整个 lockfile 复核通道 |
| `minimumReleaseAge` 内建默认 1440 | 非 strict | 未显式配置时仅回退不报错（你们已显式配置，不适用） |

另有两个已知配置陷阱（criticism 角度）：`shared-workspace-lockfile: false` 的子包曾完全绕过闸（issue #10008）；`.npmrc` 中 kebab-case 写法混乱导致配置不生效的同 issue 记录。

### atomcode > 3) 推荐实验设计：判决矩阵（预先登记）
## 3) 推荐实验设计：判决矩阵（预先登记）

**设计原则**：scratch 最小环境隔离 resolution 行为，真身 monorepo 验证立法语境；六格判决矩阵 + 一格正对照，每格预期错误码预先写死，实测输出与之逐字比对。

| # | 环境 | 操作 | 预期结果 | 判决含义 |
|---|---|---|---|---|
| E1 正对照 | scratch | 钉龄期 >48h 的版本，install | 成功 | 环境 sane，失败才有意义 |
| E2 | scratch | catalog 钉龄期 <48h 精确版本，install | `ERR_PNPM_NO_MATURE_MATCHING_VERSION` | **断言核心格**：成立 |
| E3 | scratch | 同 E2 + `minimumReleaseAgeStrict: false` | 静默装上不成熟版本 | 豁免面存在，立法须写明 strict 前提 |
| E4 | 真身 | 只改 catalog 版本号，非 frozen install | lockfile 失配 → 重新解析 → E2 同款错误 | 断言在真身语境成立 |
| E5 | 真身 | 同 E4 但 `--frozen-lockfile` | 失败但错误为 **lockfile-out-of-sync**（非龄期错误） | 拦截成立，执法点不同——报告须区分 |
| E6 | 真身 | 直接改 lockfile 写入闸内版本 + frozen | `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（#11583 后行为） | 验证 lockfile 复核通道在 11.24.0 真的执法 |
| E7 证伪探针 | scratch | 钉一个 `time` 字段缺失源上的版本（或临时 `minimumReleaseAgeIgnoreMissingTime` 不动默认值指向无 time 的镜像） | **安装成功**（默认 true 跳过检查） | 断言被证伪的合法向量——「任何解析都被拦截」在无 time 元数据面前不成立 |

**对立法的建议**：E2/E4/E6 通过即可维持「npm pack tarball 静态探针是闸内唯一合法未检疫探测手段」的立法；但断言文本应从「**任何** pnpm 驱动的版本解析在龄期闸内都被拦截」收窄为：「**在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）、trustLockfile 未开启的前提下**，任何 pnpm 驱动的 registry 版本解析在龄期闸内均以 hard error 拦截；lockfile 通道由 #11583 引入的复核独立执法」。E3/E7 的存在说明若不做限定，断言可被单点证伪，立法会被翻案——限定了反而立法更稳固。

**用 npm pack 探针找测试标本的方法**：`npm view <pkg> time --json` 拿发布时间轴（与 pnpm 读的是同一个 packument `time` 字段），选一个发布 <48h 的版本作 E2/E4 标本，同一版本在 48h 后跑 E1 正对照——这同时利用了「时间会自然把负例转成正例」的性质，一次抓包两次使用。

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-78/q2-prompt.txt)"

我先召回知识库，再启动第一轮三引擎广泛搜索。知识库已命中 pnpm 官方文档要点。继续补齐第二、三角度：抓官方原文 + 检索 lockfile 行为与控制有效性验证先例。继续第二阶段定点深挖：读 PR #11583（lockfile 复核）原文，并补三角度搜索（对比/批评/社区先例）。继续第二阶段：抓 Renovate 冷却期文档 + anysearch 补充对比与先例角度。继续定点深挖：打开 Renovate 官方 minimumReleaseAge 概念页与两篇供应链冷却期分析文。补最后一轮：控制有效性实测方法论（fault injection / canary）信源。三引擎检索与原文核验已完成，材料足以支撑结论。以下为综合报告。

## 推荐

No matching sections found.

## 实验设计

### atomcode > 2) 分点结论 > 问题 4：受控实验设计惯例
### 问题 4：受控实验设计惯例

标准做法（从 control validation / conformance testing 领域提炼）：**verdict matrix 预先写死**（实验前登记每个用例的预期错误码，防事后合理化）、**scratch 最小环境 + 真身环境双轨**（最小环境隔离变量，真身环境验证立法条文在其真实执行语境下成立）、**正负对照齐全**（必须有一个 positive control 证明实验环境本身是 sane 的——即同一钉法在龄期满后必须能装上，否则「失败」可能只是网络/registry 问题而非闸门执法）。

### atomcode > 3) 推荐实验设计：判决矩阵（预先登记）
## 3) 推荐实验设计：判决矩阵（预先登记）

**设计原则**：scratch 最小环境隔离 resolution 行为，真身 monorepo 验证立法语境；六格判决矩阵 + 一格正对照，每格预期错误码预先写死，实测输出与之逐字比对。

| # | 环境 | 操作 | 预期结果 | 判决含义 |
|---|---|---|---|---|
| E1 正对照 | scratch | 钉龄期 >48h 的版本，install | 成功 | 环境 sane，失败才有意义 |
| E2 | scratch | catalog 钉龄期 <48h 精确版本，install | `ERR_PNPM_NO_MATURE_MATCHING_VERSION` | **断言核心格**：成立 |
| E3 | scratch | 同 E2 + `minimumReleaseAgeStrict: false` | 静默装上不成熟版本 | 豁免面存在，立法须写明 strict 前提 |
| E4 | 真身 | 只改 catalog 版本号，非 frozen install | lockfile 失配 → 重新解析 → E2 同款错误 | 断言在真身语境成立 |
| E5 | 真身 | 同 E4 但 `--frozen-lockfile` | 失败但错误为 **lockfile-out-of-sync**（非龄期错误） | 拦截成立，执法点不同——报告须区分 |
| E6 | 真身 | 直接改 lockfile 写入闸内版本 + frozen | `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（#11583 后行为） | 验证 lockfile 复核通道在 11.24.0 真的执法 |
| E7 证伪探针 | scratch | 钉一个 `time` 字段缺失源上的版本（或临时 `minimumReleaseAgeIgnoreMissingTime` 不动默认值指向无 time 的镜像） | **安装成功**（默认 true 跳过检查） | 断言被证伪的合法向量——「任何解析都被拦截」在无 time 元数据面前不成立 |

**对立法的建议**：E2/E4/E6 通过即可维持「npm pack tarball 静态探针是闸内唯一合法未检疫探测手段」的立法；但断言文本应从「**任何** pnpm 驱动的版本解析在龄期闸内都被拦截」收窄为：「**在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）、trustLockfile 未开启的前提下**，任何 pnpm 驱动的 registry 版本解析在龄期闸内均以 hard error 拦截；lockfile 通道由 #11583 引入的复核独立执法」。E3/E7 的存在说明若不做限定，断言可被单点证伪，立法会被翻案——限定了反而立法更稳固。

**用 npm pack 探针找测试标本的方法**：`npm view <pkg> time --json` 拿发布时间轴（与 pnpm 读的是同一个 packument `time` 字段），选一个发布 <48h 的版本作 E2/E4 标本，同一版本在 48h 后跑 E1 正对照——这同时利用了「时间会自然把负例转成正例」的性质，一次抓包两次使用。

## 心智模型

### atomcode > 2) 分点结论 > 问题 3：工业界心智模型与实证先例
### 问题 3：工业界心智模型与实证先例

**心智模型**：这正是安全工程里的 **Security Control Validation / Adversarial Exposure Validation**（Gartner 2024 提出 AEV，取代单纯的 BAS：用自动化负向注入持续验证控制「真的在执法」，见 Scythe/BAS 综述与 Picus/Cymulate 的 control validation 材料）+ policy-as-code 的 **conformance testing**（对策略引擎本身跑正/负用例）。落到供应链门禁，行业已有成型的「验证工具的验证工具」层：

- **zizmor 的 `dependabot-cooldown` 审计规则**（v1.15.0+）：静态检查 Dependabot 配置是否缺冷却期或冷却期不足 7 天，带 auto-fix——「门禁配置本身成为审计对象」的直接先例（nesbitt.io，已读）。
- **StepSecurity 的 PR check**：直接以「PR 引入发布不足冷却期的 npm 包」为失败条件——负向探针产品化。
- **包管理器自身的历史就是先例库**：pnpm lockfile 绕过漏洞（#10438→#11583）与 bun 同型漏洞（oven-sh/bun#30526）证明：**龄期闸这类控制曾有约 7 个月的时间窗口只配置不执法**。Dependabot 的 cooldown 也有实锤缺陷——「resets its timer whenever a dependency has a new version」（firezone/firezone#11451，社区实measured）。
- **「只配置不验证」的知名失败面**：未验证备份在勒索事件中失效（ally.security IR 复盘：只测过 best-case 场景，从未验证备份是否真的可恢复/干净）、配置错误防火墙导致的入侵（kryptocybersecurity 案例研究）、2024 年多起重大泄露以 misconfigured settings 为主因（Picus 统计）。共性：控制的**存在性**被当成了控制的**有效性**。
- **冷却期控制的生态验证数据**：William Woodruff 对十起供应链攻击的分析——八起机会窗口小于一周，7 天冷却可挡住大多数（nesbitt.io 转引）。这给「2880 分钟（48h）」的龄期值提供了一个行业基准参照：48h 低于 7d 基线，属于「挡快速自动化利用、不挡慢速潜伏」的强度档位。

### atomcode > 4) 完整来源清单
## 4) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| pnpm Dependency Resolution Settings | https://pnpm.io/settings/dependency-resolution | Official | 当前版（12.x 文档） | minimumReleaseAge 全部豁免面、strict 语义、trustLockfile |
| pnpm Mitigating supply chain attacks | https://pnpm.io/supply-chain-security | Official | 当前版 | 机制定位在 resolution；2880 分钟值的行业语境 |
| PR #11583 enforce minimumReleaseAge on existing lockfile entries | https://github.com/pnpm/pnpm/pull/11583 | Official/Criticism | 2026-05-16 merge | lockfile 绕过漏洞原文 + `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` + bun 同型 bug |
| PR #14216 back off to installable version under minimumReleaseAge | https://github.com/pnpm/pnpm/pull/14216 | Official/Criticism | 2026 | 精确钉死版本的行为与报错码实证；rolldown 86 分钟断供案例 |
| commit 42a8f29 strict default | https://github.com/pnpm/pnpm/commit/42a8f29 | Official | 2026-05-02 | strict 默认开启的动机（静默回退缺陷 #11436） |
| Issue #10100 NO_MATCHING_VERSION fallback | https://github.com/pnpm/pnpm/issues/10100 | Criticism | 2025-10 | major 版本场景回退行为的实证 |
| Issue #10008 shared-workspace-lockfile=false 绕过 | https://github.com/pnpm/pnpm/issues/10008 | Criticism | 2025 | 配置陷阱实锤 |
| Renovate Minimum Release Age 概念页 | https://docs.renovatebot.com/key-concepts/minimum-release-age/ | Official/Comparative | 当前版 | cooldown 的安全语义、timestamp-optional 行为 |
| nesbitt.io: Package Managers Need to Cool Down | https://nesbitt.io/2026/03/04/package-managers-need-to-cool-down.html | Currency/Community | 2026-03-04 | 全生态 cooldown 综述；Woodruff 8/10 攻击窗口 <7 天；zizmor/StepSecurity 验证层；lockfile pinned 绕过（Bundler 设计） |
| Scythe: BAS & AEV Tools 2026 | https://scythe.io/library/best-breach-and-attack-simulation-bas-aev-tools-2026 | Comparative | 2026-04 | Gartner AEV 框架：控制有效性持续验证的心智模型 |
| ally.security IR 复盘 | https://www.ally.security/blog/critical-hits-critical-misses-lesson-in-incident-response-mastery-from-real-world-ir-failures | Criticism | 2025 | 「只测 best-case、从未验证备份有效性」的失败先例 |
| firezone issue #11451 | https://github.com/firezone/firezone/issues/11451 | Community/Criticism | 2025-12 | Dependabot cooldown 计时器重置缺陷的实measured |
| GitHub Changelog: Dependabot minimum package age | https://github.blog/changelog/2025-07-01-dependabot-supports-configuration-of-a-minimum-package-age/ | Currency | 2025-07-01 | Dependabot cooldown 上线时间点 |
| pnpm 10.16 发布博客 | https://pnpm.io/blog/releases/10.16 | Official | 2025-09-12 | 机制引入的原始动机与语义 |

三引擎覆盖：Exa（web_search）2 次成功查询、Tavily 1 次（配额受限后由 AnySearch 承担）、AnySearch 5 次；关键结论（resolution 阶段定位、strict 默认、lockfile 复核、豁免面）均 ≥2 独立信源。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume 0c255ada-37e5-4c1c-a086-4b4691b3048c


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: err_pnpm_minimum_release_age_violation, err_pnpm_no_mature_matching_version, key-concepts, minimumreleaseageexclude, --frozen-lockfile, lockfile-out-of-sync, shared-workspace-lockfile, stepsecurity, supply-chain-security, minimumreleaseageignoremissingtime, minimumreleaseagestrict, trustlockfile, comparative, 2026-05-02, 2026-05-16, validation, conformance, dependabot, anysearch, community, packument, best-case, atomcode, official, currency, rolldown, security, cooldown, firezone, woodruff, 42a8f29, exclude, oven-sh, control, gartner, testing, commit, frozen, pinned, 写入闸内版本