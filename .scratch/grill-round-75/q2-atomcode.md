# R75 Q2 — atomcode 深调研存档（2026-09-21）

> 问题原文见 q2-prompt.txt。以下为 ctx_batch_execute 返回全文（含重复命中段，原样存档）。

## onnxruntime-common undeclared

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**① 上游修复条件明确未达成，且 4.3.0 实锤仍在裸奔**（Confidence 高）
- 4.3.0 已发布 manifest：`dependencies` 只有 `@huggingface/jinja`、`@huggingface/tokenizers`、`onnxruntime-node: 1.30.0`、`onnxruntime-web`、`sharp`——**无 onnxruntime-common**（[jsdelivr tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/package.json)）。
- 4.3.0 `dist/transformers.node.cjs`（1.36MB，本轮沙箱字节检查）：bare `require("onnxruntime-common")` ×1、`require("sharp")` ×1 均为顶层 eager。与你的 tarball 解剖结论一致。
- 上游 #1087「Ghost dependency onnxruntime-common」2024-12 开、被关、社区在 4.2.0 时代留言请求重开（引用 GitNexus#2069 的 pnpm dlx 复现），未修（[issue 原文](https://github.com/huggingface/transformers.js/issues/1087)）。

**② 你的「sharp eager-load 是 4.x 新增」前提有误——3.8.1 就有**（Confidence 高，两源验证）
- 3.8.1 manifest 已含 `sharp: ^0.34.1`（[tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/package.json)），且本轮沙箱检查 3.8.1 `transformers.node.cjs` 顶层同样有 `require("sharp")`。
- 含义：**迁移 4.x 在 sharp 白装载成本上是零收益零损失**，这个维度不构成迁移动因也不构成迁移阻力——把它从决策矩阵的「迁移成本」列里划掉。4.x 的真实迁移成本在别处：onnxruntime-node 1.21→1.30 换线、模型导出策略大改（官方博客：BERT 系 embedding ~4x 提速依赖新 contrib operators，意味着旧 q8 导出模型的兼容面要复验）。

**③ 「只修一半」的先例成熟心智模型：上游知情 = patch 义务未解除**（Confidence 高）
- episodic-memory#105（Linux/WSL2 npm 场景，onnxruntime-node 1.24.3 与 onnxruntime-web 拉到**冲突版本**导致 npm 连 hoisting 都掩盖不了）给出了与本项目完全同构的三层修法清单：直接声明 pinned dep（治标+可 hoist）/ overrides 收敛版本 / require.resolve 哨兵 fallback，并明确「(1)(2) 才是真修，belongs upstream」（[issue 原文](https://github.com/obra/episodic-memory/issues/105)）。
- mastra（大型生产 monorepo）选择 **packageExtensions 声明式补洞**并留下注释「transformers.js imports onnxruntime-common without declaring it; with the global virtual store there is no fallback hoist」（[pnpm-workspace.yaml 原文](https://github.com/mastra-ai/mastra/blob/a97044b0/pnpm-workspace.yaml)）——即工业界对这类问题的标准处置是「消费侧补洞 + 注释留证 + 期待上游」，与你的姿势 A 同构。
- GitNexus 的处置更进一步：CJS `Module._resolveFilename` patch 之外，**ESM 侧用 `module.registerHooks`（Node ≥22.15）做解析 fallback，且优先从 effective onnxruntime-node 目录解析 common 副本以做版本配对**（GitNexus#2069，已读）。这对你们是一个可借鉴的加固点（见 ⑤）。

### atomcode
# atomcode

$ atomcode -p "$(cat .scratch/grill-round-75/q2-prompt.txt)"

先召回知识库，再按三引擎配额开展调研。知识库已命中本项目既有结论（R71 实证 + pnpm packageExtensions 文档）。现在三引擎联网补强外部先例与上游状态。外部证据已经很强（mastra 同款 packageExtensions 先例、npm hoisting 也翻车的实证）。现在定点深挖原文验证关键结论。monorepo 根 package.json 不含发布包依赖——改抓已发布 tarball 的 manifest 与上游 issue 原文。补一手关键实证：4.3.0 的 node CJS 入口顶层 require 是否仍裸奔 onnxruntime-common。入口文件 1.36MB，用沙箱代码在字节层面核验 require 调用，不把原始字节拉进上下文。4.3.0 入口实锤：`require("onnxruntime-common")` 裸奔 + `require("sharp")` eager 均在场，manifest 仍未声明。继续补上游 issue 现状、pnpm 机制文档与 3.8.1 对照。关键新发现：上游 ghost dependency 问题早有 issue #1087（至今未修，4.2.0 仍复现）；且 3.8.1 的 manifest 就已声明 sharp——需核验 3.8.1 入口是否也 eager require sharp（用户前提可能有误）。补最后一块拼图：上游 PR #1701（一行修）现状。# 调研报告：上游「半修大版本」下的运行时 patch 取舍

**Sufficiency Gate**: searches: 6+ | angles: Official（pnpm 官方文档/HF 官方博客/npm tarball manifest）/ Comparative（A/B/C/D 姿势、patch 机制对比）/ Criticism（3 个下游失败案例 issue 实证）/ Currency（2026 年 4.x 发布线）| full reads: 9 | gaps: ①#1087 关闭理由与后续重开请求的完整时间线只读到部分；②未实测 4.x 下 e5 模型 dtype 兼容性（列入选型风险，非结论依赖项）。

### atomcode > 2) 分点结论 (2)
**④ 机制适用边界：唯一能随发布包旅行保护 pnpm 消费者的就是运行时 patch**（Confidence 高）
| 机制 | 是否随你的包旅行到消费者 | 适用边界 |
|---|---|---|
| scoped `Module._resolveFilename` patch | ✅ 打进 tarball，install 即生效 | CJS 入口；依赖 `Module._resolveFilename` 私有 API（Node 生态事实上极稳定，但属未承诺面）；仅拦截 CJS `require` |
| ESM `module.registerHooks` fallback | ✅（随代码旅行） | Node ≥22.15；是 ESM 入口的唯一拦截钩子；gitnexus 已验证可行 |
| pnpm `packageExtensions` | ❌ 消费者 workspace 配置，且 pnpm dlx 场景不适用（GitNexus#2069 实证） | 只适合你**自己**的 monorepo 内部；官方文档建议同时把扩展贡献进 `@yarnpkg/extensions` 数据库（[pnpm 文档](https://pnpm.io/settings/dependency-resolution)） |
| pnpm `patchedDependencies` | ❌ 消费者 workspace 配置；且 v11 起 patch 应用失败直接 throw | 只适合自己仓库；对下游不可达（[pnpm patch 文档](https://pnpm.io/cli/patch)） |
| fork | ✅（换 specifier 发布） | 维护线成本全担：要持续追上游模型/导出层变更；仅当上游长期拒修且 patch 面扩大时才值得 |

结论：你的双件修法（optionalDependencies 自声明 + scoped 运行时 patch）是**当前生态下唯一对已发布 npm 包的 pnpm 消费者闭环的机制**，方向正确，无可替代项。一个真实缺口：若消费者走 ESM 入口（`import`），`_resolveFilename` patch 拦不到——3.8.1 的 ESM 入口 `transformers.node.mjs` 同样裸 import。你们的 CJS 入口走 `createRequire().require()` 已规避；但任何消费者直接 `import('@huggingface/transformers')` 时 patch 不设防。可评估参照 gitnexus 加一层 `module.registerHooks`（仅 Node ≥22.15、同样 fail-open）。

**⑤ patch 的长期维护风险与已验证的缓解纪律**（Confidence 高）
- **版本配对风险（最实质的一条）**：自声明的 `onnxruntime-common` 必须与实际加载的 `onnxruntime-node` 内嵌版本一致，否则 Tensor 类双实例/行为漂移。你们钉 1.21.0 对齐 ORT-node 1.21.0 是对的；GitNexus 干脆不固定，而是运行时从 effective onnxruntime-node 目录 resolve 出配对副本——升级 transformers 时这条配对纪律必须跟着刷新（登记簿证据刷新应含此项）。
- **API 风险低**：`Module._resolveFilename` 是 Node 未承诺但十余年未变的加载面，且你们的双重 scope guard（仅该 specifier + 仅该父包 + 仅 miss 时）保证 fail-open——上游哪天真修了，patch 自动变 no-op，无退役成本。
- **勿扩面**：只此一个 ghost，不值得泛化成通用 shim。

**⑥ 上游申报的「弹药」已经齐备，且时机极佳**（Confidence 高）
- 一行修（declare `onnxruntime-common` in dependencies）与 #1088/#1089 社区 PR 一致、与 #1087 实证一致、与 PR #1701 中维护者自己说的原则一致——即**连「维护者会不会认同」这个最大的不确定性都已被 PR #1701 消除**（nico-martin 原话：whenever we import a package directly, we should also have it in our dependencies, and specifically点名了 onnxruntime-common）。
- 申报材料建议：4.2.0/4.3.0 双版本 pnpm 复现栈 + episodic-memory#105 的 npm 物理层证据（证明**连 npm hoisting 都不是可靠掩盖**，冲突版本下同样炸）+ mastra 的 packageExtensions 先例 + GitNexus 的 316 行 fallback 代码作为「下游各显神通」的成本证明。这条 issue 的本质是：**下游生态已经在至少 4 个独立项目里各自造了一遍轮子**。

## upstream issue PR 申报

### atomcode > 5) 信息缺口
## 5) 信息缺口

- #1087 被关闭的官方理由全文未读到（页面只显示 Closed 状态）——申报 issue 前建议翻阅其全部评论，避免与已驳回论点重复。
- 4.x 运行时下 Xenova/multilingual-e5-small q8 的实际兼容性/精度未实测（C 姿势的前置条件，需要时单开一轮复验）。
- `module.registerHooks` 在 Node <22.15 的覆盖率影响未量化（若你们 doctor 数据里有消费者 Node 版本分布，可决定是否值得加 ESM 臂）。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume 7a9c7872-dfc4-4216-ad7a-7c804cf8579e

### atomcode
# atomcode

$ atomcode -p "$(cat .scratch/grill-round-75/q2-prompt.txt)"

先召回知识库，再按三引擎配额开展调研。知识库已命中本项目既有结论（R71 实证 + pnpm packageExtensions 文档）。现在三引擎联网补强外部先例与上游状态。外部证据已经很强（mastra 同款 packageExtensions 先例、npm hoisting 也翻车的实证）。现在定点深挖原文验证关键结论。monorepo 根 package.json 不含发布包依赖——改抓已发布 tarball 的 manifest 与上游 issue 原文。补一手关键实证：4.3.0 的 node CJS 入口顶层 require 是否仍裸奔 onnxruntime-common。入口文件 1.36MB，用沙箱代码在字节层面核验 require 调用，不把原始字节拉进上下文。4.3.0 入口实锤：`require("onnxruntime-common")` 裸奔 + `require("sharp")` eager 均在场，manifest 仍未声明。继续补上游 issue 现状、pnpm 机制文档与 3.8.1 对照。关键新发现：上游 ghost dependency 问题早有 issue #1087（至今未修，4.2.0 仍复现）；且 3.8.1 的 manifest 就已声明 sharp——需核验 3.8.1 入口是否也 eager require sharp（用户前提可能有误）。补最后一块拼图：上游 PR #1701（一行修）现状。# 调研报告：上游「半修大版本」下的运行时 patch 取舍

**Sufficiency Gate**: searches: 6+ | angles: Official（pnpm 官方文档/HF 官方博客/npm tarball manifest）/ Comparative（A/B/C/D 姿势、patch 机制对比）/ Criticism（3 个下游失败案例 issue 实证）/ Currency（2026 年 4.x 发布线）| full reads: 9 | gaps: ①#1087 关闭理由与后续重开请求的完整时间线只读到部分；②未实测 4.x 下 e5 模型 dtype 兼容性（列入选型风险，非结论依赖项）。

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**① 上游修复条件明确未达成，且 4.3.0 实锤仍在裸奔**（Confidence 高）
- 4.3.0 已发布 manifest：`dependencies` 只有 `@huggingface/jinja`、`@huggingface/tokenizers`、`onnxruntime-node: 1.30.0`、`onnxruntime-web`、`sharp`——**无 onnxruntime-common**（[jsdelivr tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/package.json)）。
- 4.3.0 `dist/transformers.node.cjs`（1.36MB，本轮沙箱字节检查）：bare `require("onnxruntime-common")` ×1、`require("sharp")` ×1 均为顶层 eager。与你的 tarball 解剖结论一致。
- 上游 #1087「Ghost dependency onnxruntime-common」2024-12 开、被关、社区在 4.2.0 时代留言请求重开（引用 GitNexus#2069 的 pnpm dlx 复现），未修（[issue 原文](https://github.com/huggingface/transformers.js/issues/1087)）。

**② 你的「sharp eager-load 是 4.x 新增」前提有误——3.8.1 就有**（Confidence 高，两源验证）
- 3.8.1 manifest 已含 `sharp: ^0.34.1`（[tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/package.json)），且本轮沙箱检查 3.8.1 `transformers.node.cjs` 顶层同样有 `require("sharp")`。
- 含义：**迁移 4.x 在 sharp 白装载成本上是零收益零损失**，这个维度不构成迁移动因也不构成迁移阻力——把它从决策矩阵的「迁移成本」列里划掉。4.x 的真实迁移成本在别处：onnxruntime-node 1.21→1.30 换线、模型导出策略大改（官方博客：BERT 系 embedding ~4x 提速依赖新 contrib operators，意味着旧 q8 导出模型的兼容面要复验）。

**③ 「只修一半」的先例成熟心智模型：上游知情 = patch 义务未解除**（Confidence 高）
- episodic-memory#105（Linux/WSL2 npm 场景，onnxruntime-node 1.24.3 与 onnxruntime-web 拉到**冲突版本**导致 npm 连 hoisting 都掩盖不了）给出了与本项目完全同构的三层修法清单：直接声明 pinned dep（治标+可 hoist）/ overrides 收敛版本 / require.resolve 哨兵 fallback，并明确「(1)(2) 才是真修，belongs upstream」（[issue 原文](https://github.com/obra/episodic-memory/issues/105)）。
- mastra（大型生产 monorepo）选择 **packageExtensions 声明式补洞**并留下注释「transformers.js imports onnxruntime-common without declaring it; with the global virtual store there is no fallback hoist」（[pnpm-workspace.yaml 原文](https://github.com/mastra-ai/mastra/blob/a97044b0/pnpm-workspace.yaml)）——即工业界对这类问题的标准处置是「消费侧补洞 + 注释留证 + 期待上游」，与你的姿势 A 同构。
- GitNexus 的处置更进一步：CJS `Module._resolveFilename` patch 之外，**ESM 侧用 `module.registerHooks`（Node ≥22.15）做解析 fallback，且优先从 effective onnxruntime-node 目录解析 common 副本以做版本配对**（GitNexus#2069，已读）。这对你们是一个可借鉴的加固点（见 ⑤）。

## Module._resolveFilename patch

### atomcode > 2) 分点结论 (2)
**④ 机制适用边界：唯一能随发布包旅行保护 pnpm 消费者的就是运行时 patch**（Confidence 高）
| 机制 | 是否随你的包旅行到消费者 | 适用边界 |
|---|---|---|
| scoped `Module._resolveFilename` patch | ✅ 打进 tarball，install 即生效 | CJS 入口；依赖 `Module._resolveFilename` 私有 API（Node 生态事实上极稳定，但属未承诺面）；仅拦截 CJS `require` |
| ESM `module.registerHooks` fallback | ✅（随代码旅行） | Node ≥22.15；是 ESM 入口的唯一拦截钩子；gitnexus 已验证可行 |
| pnpm `packageExtensions` | ❌ 消费者 workspace 配置，且 pnpm dlx 场景不适用（GitNexus#2069 实证） | 只适合你**自己**的 monorepo 内部；官方文档建议同时把扩展贡献进 `@yarnpkg/extensions` 数据库（[pnpm 文档](https://pnpm.io/settings/dependency-resolution)） |
| pnpm `patchedDependencies` | ❌ 消费者 workspace 配置；且 v11 起 patch 应用失败直接 throw | 只适合自己仓库；对下游不可达（[pnpm patch 文档](https://pnpm.io/cli/patch)） |
| fork | ✅（换 specifier 发布） | 维护线成本全担：要持续追上游模型/导出层变更；仅当上游长期拒修且 patch 面扩大时才值得 |

结论：你的双件修法（optionalDependencies 自声明 + scoped 运行时 patch）是**当前生态下唯一对已发布 npm 包的 pnpm 消费者闭环的机制**，方向正确，无可替代项。一个真实缺口：若消费者走 ESM 入口（`import`），`_resolveFilename` patch 拦不到——3.8.1 的 ESM 入口 `transformers.node.mjs` 同样裸 import。你们的 CJS 入口走 `createRequire().require()` 已规避；但任何消费者直接 `import('@huggingface/transformers')` 时 patch 不设防。可评估参照 gitnexus 加一层 `module.registerHooks`（仅 Node ≥22.15、同样 fail-open）。

**⑤ patch 的长期维护风险与已验证的缓解纪律**（Confidence 高）
- **版本配对风险（最实质的一条）**：自声明的 `onnxruntime-common` 必须与实际加载的 `onnxruntime-node` 内嵌版本一致，否则 Tensor 类双实例/行为漂移。你们钉 1.21.0 对齐 ORT-node 1.21.0 是对的；GitNexus 干脆不固定，而是运行时从 effective onnxruntime-node 目录 resolve 出配对副本——升级 transformers 时这条配对纪律必须跟着刷新（登记簿证据刷新应含此项）。
- **API 风险低**：`Module._resolveFilename` 是 Node 未承诺但十余年未变的加载面，且你们的双重 scope guard（仅该 specifier + 仅该父包 + 仅 miss 时）保证 fail-open——上游哪天真修了，patch 自动变 no-op，无退役成本。
- **勿扩面**：只此一个 ghost，不值得泛化成通用 shim。

**⑥ 上游申报的「弹药」已经齐备，且时机极佳**（Confidence 高）
- 一行修（declare `onnxruntime-common` in dependencies）与 #1088/#1089 社区 PR 一致、与 #1087 实证一致、与 PR #1701 中维护者自己说的原则一致——即**连「维护者会不会认同」这个最大的不确定性都已被 PR #1701 消除**（nico-martin 原话：whenever we import a package directly, we should also have it in our dependencies, and specifically点名了 onnxruntime-common）。
- 申报材料建议：4.2.0/4.3.0 双版本 pnpm 复现栈 + episodic-memory#105 的 npm 物理层证据（证明**连 npm hoisting 都不是可靠掩盖**，冲突版本下同样炸）+ mastra 的 packageExtensions 先例 + GitNexus 的 316 行 fallback 代码作为「下游各显神通」的成本证明。这条 issue 的本质是：**下游生态已经在至少 4 个独立项目里各自造了一遍轮子**。

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**① 上游修复条件明确未达成，且 4.3.0 实锤仍在裸奔**（Confidence 高）
- 4.3.0 已发布 manifest：`dependencies` 只有 `@huggingface/jinja`、`@huggingface/tokenizers`、`onnxruntime-node: 1.30.0`、`onnxruntime-web`、`sharp`——**无 onnxruntime-common**（[jsdelivr tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/package.json)）。
- 4.3.0 `dist/transformers.node.cjs`（1.36MB，本轮沙箱字节检查）：bare `require("onnxruntime-common")` ×1、`require("sharp")` ×1 均为顶层 eager。与你的 tarball 解剖结论一致。
- 上游 #1087「Ghost dependency onnxruntime-common」2024-12 开、被关、社区在 4.2.0 时代留言请求重开（引用 GitNexus#2069 的 pnpm dlx 复现），未修（[issue 原文](https://github.com/huggingface/transformers.js/issues/1087)）。

**② 你的「sharp eager-load 是 4.x 新增」前提有误——3.8.1 就有**（Confidence 高，两源验证）
- 3.8.1 manifest 已含 `sharp: ^0.34.1`（[tarball manifest](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/package.json)），且本轮沙箱检查 3.8.1 `transformers.node.cjs` 顶层同样有 `require("sharp")`。
- 含义：**迁移 4.x 在 sharp 白装载成本上是零收益零损失**，这个维度不构成迁移动因也不构成迁移阻力——把它从决策矩阵的「迁移成本」列里划掉。4.x 的真实迁移成本在别处：onnxruntime-node 1.21→1.30 换线、模型导出策略大改（官方博客：BERT 系 embedding ~4x 提速依赖新 contrib operators，意味着旧 q8 导出模型的兼容面要复验）。

**③ 「只修一半」的先例成熟心智模型：上游知情 = patch 义务未解除**（Confidence 高）
- episodic-memory#105（Linux/WSL2 npm 场景，onnxruntime-node 1.24.3 与 onnxruntime-web 拉到**冲突版本**导致 npm 连 hoisting 都掩盖不了）给出了与本项目完全同构的三层修法清单：直接声明 pinned dep（治标+可 hoist）/ overrides 收敛版本 / require.resolve 哨兵 fallback，并明确「(1)(2) 才是真修，belongs upstream」（[issue 原文](https://github.com/obra/episodic-memory/issues/105)）。
- mastra（大型生产 monorepo）选择 **packageExtensions 声明式补洞**并留下注释「transformers.js imports onnxruntime-common without declaring it; with the global virtual store there is no fallback hoist」（[pnpm-workspace.yaml 原文](https://github.com/mastra-ai/mastra/blob/a97044b0/pnpm-workspace.yaml)）——即工业界对这类问题的标准处置是「消费侧补洞 + 注释留证 + 期待上游」，与你的姿势 A 同构。
- GitNexus 的处置更进一步：CJS `Module._resolveFilename` patch 之外，**ESM 侧用 `module.registerHooks`（Node ≥22.15）做解析 fallback，且优先从 effective onnxruntime-node 目录解析 common 副本以做版本配对**（GitNexus#2069，已读）。这对你们是一个可借鉴的加固点（见 ⑤）。

### atomcode > 3) 姿势对比矩阵
## 3) 姿势对比矩阵

| 姿势 | pnpm 消费者保护 | 上游修复后成本 | 迁移/维护风险 | 判定 |
|---|---|---|---|---|
| **A**：patch 续存 + 申报上游 + 留 3.8.1 + 登记簿刷新 | ✅ 现有闭环保持 | patch 自动 no-op，零退役成本 | 仅版本配对纪律需随升级刷新；3.8.1 为维护线但有 0.0.6 实证 | **推荐（现在做）** |
| **B**：迁 4.x + patch 重定向 1.30.0 | ✅ 仍需 patch（4.3.0 未修） | 同 A | ORT 1.21→1.30 换线 + 新导出策略下 e5/q8 兼容复验；收益仅为追新维护线，sharp 维度为零收益（3.8.1 已有） | 不值得单独做 |
| **C**：A+B 双轨 | ✅ | 同上 | 双维护线成本；4.x 臂价值在于一旦 e5 新导出（onnx-community 4.x 适配版）有实质收益再切 | **演进项（条件触发）**：等 4.x 生态下 e5 q8 复验通过 + 上游修复再无进展时，用双轨降低单线风险 |
| **D**：只刷新证据不申报 | ✅ 短期 | 同 A | 放弃了「一行修」的最大杠杆；下游轮子会继续增多（已是 4 个） | 排除 |

## pnpm packageExtensions

### atomcode > 2) 分点结论 (2)
**④ 机制适用边界：唯一能随发布包旅行保护 pnpm 消费者的就是运行时 patch**（Confidence 高）
| 机制 | 是否随你的包旅行到消费者 | 适用边界 |
|---|---|---|
| scoped `Module._resolveFilename` patch | ✅ 打进 tarball，install 即生效 | CJS 入口；依赖 `Module._resolveFilename` 私有 API（Node 生态事实上极稳定，但属未承诺面）；仅拦截 CJS `require` |
| ESM `module.registerHooks` fallback | ✅（随代码旅行） | Node ≥22.15；是 ESM 入口的唯一拦截钩子；gitnexus 已验证可行 |
| pnpm `packageExtensions` | ❌ 消费者 workspace 配置，且 pnpm dlx 场景不适用（GitNexus#2069 实证） | 只适合你**自己**的 monorepo 内部；官方文档建议同时把扩展贡献进 `@yarnpkg/extensions` 数据库（[pnpm 文档](https://pnpm.io/settings/dependency-resolution)） |
| pnpm `patchedDependencies` | ❌ 消费者 workspace 配置；且 v11 起 patch 应用失败直接 throw | 只适合自己仓库；对下游不可达（[pnpm patch 文档](https://pnpm.io/cli/patch)） |
| fork | ✅（换 specifier 发布） | 维护线成本全担：要持续追上游模型/导出层变更；仅当上游长期拒修且 patch 面扩大时才值得 |

结论：你的双件修法（optionalDependencies 自声明 + scoped 运行时 patch）是**当前生态下唯一对已发布 npm 包的 pnpm 消费者闭环的机制**，方向正确，无可替代项。一个真实缺口：若消费者走 ESM 入口（`import`），`_resolveFilename` patch 拦不到——3.8.1 的 ESM 入口 `transformers.node.mjs` 同样裸 import。你们的 CJS 入口走 `createRequire().require()` 已规避；但任何消费者直接 `import('@huggingface/transformers')` 时 patch 不设防。可评估参照 gitnexus 加一层 `module.registerHooks`（仅 Node ≥22.15、同样 fail-open）。

**⑤ patch 的长期维护风险与已验证的缓解纪律**（Confidence 高）
- **版本配对风险（最实质的一条）**：自声明的 `onnxruntime-common` 必须与实际加载的 `onnxruntime-node` 内嵌版本一致，否则 Tensor 类双实例/行为漂移。你们钉 1.21.0 对齐 ORT-node 1.21.0 是对的；GitNexus 干脆不固定，而是运行时从 effective onnxruntime-node 目录 resolve 出配对副本——升级 transformers 时这条配对纪律必须跟着刷新（登记簿证据刷新应含此项）。
- **API 风险低**：`Module._resolveFilename` 是 Node 未承诺但十余年未变的加载面，且你们的双重 scope guard（仅该 specifier + 仅该父包 + 仅 miss 时）保证 fail-open——上游哪天真修了，patch 自动变 no-op，无退役成本。
- **勿扩面**：只此一个 ghost，不值得泛化成通用 shim。

**⑥ 上游申报的「弹药」已经齐备，且时机极佳**（Confidence 高）
- 一行修（declare `onnxruntime-common` in dependencies）与 #1088/#1089 社区 PR 一致、与 #1087 实证一致、与 PR #1701 中维护者自己说的原则一致——即**连「维护者会不会认同」这个最大的不确定性都已被 PR #1701 消除**（nico-martin 原话：whenever we import a package directly, we should also have it in our dependencies, and specifically点名了 onnxruntime-common）。
- 申报材料建议：4.2.0/4.3.0 双版本 pnpm 复现栈 + episodic-memory#105 的 npm 物理层证据（证明**连 npm hoisting 都不是可靠掩盖**，冲突版本下同样炸）+ mastra 的 packageExtensions 先例 + GitNexus 的 316 行 fallback 代码作为「下游各显神通」的成本证明。这条 issue 的本质是：**下游生态已经在至少 4 个独立项目里各自造了一遍轮子**。

### atomcode > 4) 完整来源清单
## 4) 完整来源清单

1. [transformers.js #1087 — Ghost dependency onnxruntime-common](https://github.com/huggingface/transformers.js/issues/1087)（Community/官方仓库，2024-12 开，未修）— 证明上游知情且删除条件未达成；本报告核心。
2. [PR #1701 — Added knip](https://github.com/huggingface/transformers.js/issues/1087 同仓库)（2026-06）— 维护者明确表态 direct import 必须进 dependencies；申报时机的关键筹码。
3. [@huggingface/transformers@4.3.0 tarball manifest + dist 字节检查](https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/package.json)（Official，本轮解剖）— 4.3.0 实锤：specifier 裸奔 + sharp eager。
4. [@huggingface/transformers@3.8.1 tarball manifest + dist 字节检查](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/package.json)（Official）— 证伪「sharp eager-load 是 4.x 新增」。
5. [episodic-memory#105](https://github.com/obra/episodic-memory/issues/105)（Community，2026-06）— npm 冲突版本下 hoisting 失效的物理层复现；三层修法清单。
6. [mastra pnpm-workspace.yaml](https://github.com/mastra-ai/mastra/blob/a97044b0/pnpm-workspace.yaml)（Community/生产先例）— packageExtensions 补洞 + 注释留证的工业界标准姿势。
7. [GitNexus#2069](https://github.com/abhigyanpatwari/GitNexus/issues/2069)（Community，2026-06）— pnpm dlx 复现 + `module.registerHooks` ESM fallback + 版本配对纪律的完整参考实现。
8. [HF 官方博客：Transformers.js v4](https://huggingface.co/blog/transformersjs-v4)（Official，2026-02-09）— 4.x 迁移面：ORT 换线、导出策略、4x embedding 提速。
9. [pnpm packageExtensions 文档](https://pnpm.io/settings/dependency-resolution) + [pnpm patch 文档](https://pnpm.io/cli/patch)（Official）— 两机制均为消费者 workspace 配置、不随包旅行的依据；packageExtensions 建议贡献回 `@yarnpkg/extensions`。
10. 知识库召回（本项目 R71 实证 + CONTEXT.md 术语条目）— 本地双件修法与 pnpm 臂实证的原始记录。

### atomcode
# atomcode

$ atomcode -p "$(cat .scratch/grill-round-75/q2-prompt.txt)"

先召回知识库，再按三引擎配额开展调研。知识库已命中本项目既有结论（R71 实证 + pnpm packageExtensions 文档）。现在三引擎联网补强外部先例与上游状态。外部证据已经很强（mastra 同款 packageExtensions 先例、npm hoisting 也翻车的实证）。现在定点深挖原文验证关键结论。monorepo 根 package.json 不含发布包依赖——改抓已发布 tarball 的 manifest 与上游 issue 原文。补一手关键实证：4.3.0 的 node CJS 入口顶层 require 是否仍裸奔 onnxruntime-common。入口文件 1.36MB，用沙箱代码在字节层面核验 require 调用，不把原始字节拉进上下文。4.3.0 入口实锤：`require("onnxruntime-common")` 裸奔 + `require("sharp")` eager 均在场，manifest 仍未声明。继续补上游 issue 现状、pnpm 机制文档与 3.8.1 对照。关键新发现：上游 ghost dependency 问题早有 issue #1087（至今未修，4.2.0 仍复现）；且 3.8.1 的 manifest 就已声明 sharp——需核验 3.8.1 入口是否也 eager require sharp（用户前提可能有误）。补最后一块拼图：上游 PR #1701（一行修）现状。# 调研报告：上游「半修大版本」下的运行时 patch 取舍

**Sufficiency Gate**: searches: 6+ | angles: Official（pnpm 官方文档/HF 官方博客/npm tarball manifest）/ Comparative（A/B/C/D 姿势、patch 机制对比）/ Criticism（3 个下游失败案例 issue 实证）/ Currency（2026 年 4.x 发布线）| full reads: 9 | gaps: ①#1087 关闭理由与后续重开请求的完整时间线只读到部分；②未实测 4.x 下 e5 模型 dtype 兼容性（列入选型风险，非结论依赖项）。

## 推荐 姿势 理由

### atomcode > 3) 姿势对比矩阵
## 3) 姿势对比矩阵

| 姿势 | pnpm 消费者保护 | 上游修复后成本 | 迁移/维护风险 | 判定 |
|---|---|---|---|---|
| **A**：patch 续存 + 申报上游 + 留 3.8.1 + 登记簿刷新 | ✅ 现有闭环保持 | patch 自动 no-op，零退役成本 | 仅版本配对纪律需随升级刷新；3.8.1 为维护线但有 0.0.6 实证 | **推荐（现在做）** |
| **B**：迁 4.x + patch 重定向 1.30.0 | ✅ 仍需 patch（4.3.0 未修） | 同 A | ORT 1.21→1.30 换线 + 新导出策略下 e5/q8 兼容复验；收益仅为追新维护线，sharp 维度为零收益（3.8.1 已有） | 不值得单独做 |
| **C**：A+B 双轨 | ✅ | 同上 | 双维护线成本；4.x 臂价值在于一旦 e5 新导出（onnx-community 4.x 适配版）有实质收益再切 | **演进项（条件触发）**：等 4.x 生态下 e5 q8 复验通过 + 上游修复再无进展时，用双轨降低单线风险 |
| **D**：只刷新证据不申报 | ✅ 短期 | 同 A | 放弃了「一行修」的最大杠杆；下游轮子会继续增多（已是 4 个） | 排除 |

### atomcode
# atomcode

$ atomcode -p "$(cat .scratch/grill-round-75/q2-prompt.txt)"

先召回知识库，再按三引擎配额开展调研。知识库已命中本项目既有结论（R71 实证 + pnpm packageExtensions 文档）。现在三引擎联网补强外部先例与上游状态。外部证据已经很强（mastra 同款 packageExtensions 先例、npm hoisting 也翻车的实证）。现在定点深挖原文验证关键结论。monorepo 根 package.json 不含发布包依赖——改抓已发布 tarball 的 manifest 与上游 issue 原文。补一手关键实证：4.3.0 的 node CJS 入口顶层 require 是否仍裸奔 onnxruntime-common。入口文件 1.36MB，用沙箱代码在字节层面核验 require 调用，不把原始字节拉进上下文。4.3.0 入口实锤：`require("onnxruntime-common")` 裸奔 + `require("sharp")` eager 均在场，manifest 仍未声明。继续补上游 issue 现状、pnpm 机制文档与 3.8.1 对照。关键新发现：上游 ghost dependency 问题早有 issue #1087（至今未修，4.2.0 仍复现）；且 3.8.1 的 manifest 就已声明 sharp——需核验 3.8.1 入口是否也 eager require sharp（用户前提可能有误）。补最后一块拼图：上游 PR #1701（一行修）现状。# 调研报告：上游「半修大版本」下的运行时 patch 取舍

**Sufficiency Gate**: searches: 6+ | angles: Official（pnpm 官方文档/HF 官方博客/npm tarball manifest）/ Comparative（A/B/C/D 姿势、patch 机制对比）/ Criticism（3 个下游失败案例 issue 实证）/ Currency（2026 年 4.x 发布线）| full reads: 9 | gaps: ①#1087 关闭理由与后续重开请求的完整时间线只读到部分；②未实测 4.x 下 e5 模型 dtype 兼容性（列入选型风险，非结论依赖项）。


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: _resolvefilename, onnxruntime-node, pnpm-workspace, dependency-resolution, transformers, episodic-memory, eager-load, extensions, embedding, mastra-ai, effective, workspace, atomcode, official, jsdelivr, a97044b0, settings, resolve, yarnpkg, github, issues, no-op, 36mb, 本轮解剖, dist, obra, yaml, blob, r71, cdn, net, com, ---, cli, ort, confidence, huggingface, specifier, monorepo, manifest