# R75 Q3 — atomcode 深调研存档（2026-09-21）

> 问题原文见 q3-prompt.txt。「推荐落地 B 形态」段经 ctx_search 追补（见文末）。

## module.registerHooks ESM

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**① 不变量形态防护的工业界心智模型：「守护架构约束用 lint/test，运行时 shim 只给可达缺陷」**（Confidence 高，多源一致）
- Node 生态的标准工具链是 `no-restricted-imports`（[ESLint 官方文档](https://eslint.org/docs/latest/rules/no-restricted-imports)）、`eslint-plugin-boundaries`、`@nx/enforce-module-boundaries`（[npm](https://www.npmjs.com/package/eslint-plugin-boundaries)、[timdeschryver.dev](https://timdeschryver.dev/bits/enforce-module-boundaries-with-no-restricted-imports)）——全部是**静态、构建期失败**的姿势，专治「有人顺手绕过唯一入口」。Nx 文档的原话逻辑："with the best intentions, it is easy to break the rules with a small change"——这正是你担心的「未来顺手重构走 ESM import」的精确画像。
- 运行时 patch（`_resolveFilename`、registerHooks）的适用边界是：**缺陷路径在生产可达、且你无法用静态手段约束第三方代码**。你的 CJS patch 就是这类（上游 dist 是黑盒）。而你自己的 src 对 ESM 的使用是**完全可静态约束的白盒**——这是 B 的立论基础。
- 先例配比：GitNexus 自己（同构问题 #2069/#307）走了 A 路线，但其注释明写触发条件是它**自己的代码路径确实 dynamic import transformers**（可达面非零）。你们零可达面，先例不迁移成立。

**② 对零可达面路径写防御码 vs 静态守不变量的边界**（Confidence 高）
- 防御码的隐藏成本不止代码量：registerHooks 是 process-global 的，每个后续模块解析都过你的闭包（GitNexus 注释自述 "runs for every subsequent module resolution"——他们论证了成本仅一次字符串比较，但这在 `type:module` 的 embedding 包里是给所有消费者的解析热路径添了一个三方 experimental 钩子）。
- 静态护栏的成本≈0 且**失败模式友好**：违例在 CI 直接红，而不是在消费者的某个 Node 版本上静默崩。零可达面路径 + 运行时防御码 = 死代码 + experimental API 暴露面。

**③ `module.registerHooks` 成熟度**（Confidence 高，官方文档两版本交叉）
- Node v22 文档：`Added in: v22.15.0`，**Stability: 1.1 - Active development**；v26 文档已升到 **1.2 - Release candidate**。即：22.15 引入时是 1.1，至今未到 stable（2.0）。它同时拦截 `import`、`require`、`createRequire` 的 require（同步钩子同线程），语义上确是 `_resolveFilename` patch 的 ESM 对位物。
- 旧 `module.register`（async off-thread）已 DEP0205 弃用、**Node 26 移除**（[deprecations 页直读](https://nodejs.org/api/deprecations.html)）——GitNexus 选 registerHooks 而非 register 正基于此。方向上 registerHooks 是终局 API，但「终局方向」≠「今天该为不可达路径引入」。
- 兼容性：GitNexus 踩过一个关键坑——在 `type:module` 包里 `import { registerHooks } from 'node:module'` 的**静态具名导入在 <22.15 上是 link-time SyntaxError**，typeof 守卫根本跑不到；必须 namespace import + 运行时 feature-detect（他们的 `node-module-compat.ts` 就是为此单独立的模块）。这是 A 路线的真实实施税。
- 未知项：Deno 已支持同名 API（2026-07 文档），Bun 未见材料。jest ESM 走 `--experimental-vm-modules` 自己的 loader 体系（jest 文档自述仍 experimental），vitest 走 Vite transform——两者的模块解析大多不经过 Node 原生 ESM resolver，registerHooks 在其中**可能整个不生效**（这对你反而是安全方向：fail-open 语义一致），但意味着「测试环境验证了 hook」≠「生产生效」。无直接实测报告（见缺口）。

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐姿势 = B 为主体（源码级不变量护栏 + 文档记缺口与重返触发器），A 降级为「触发器触发后才立项」的条件项。** 理由：对「不变量形态」的加载路径防护，工业界成熟心智模型是**用静态断言守住不变量（entry-point 唯一性），而不是为今天不可达的路径写运行时防御码**——运行时防御只配给「真实可达且会造成生产故障」的缺陷路径。`module.registerHooks` 自身仍是 Stability 1.1（Active development）/ @experimental（Confidence：高——Node 官方文档直读），为一条零调用面路径引入 experimental API + 条件启用语义，是负收益。版本配对：**动态配对（从 effective onnxruntime-node 目录 resolve）优于固定钉版**，GitNexus 是已验证先例；你们现有的 1.21.0 钉版应加一条「升级 transformers 时同步刷新 + 配对断言测试」的纪律兜底。

### atomcode > 3) 对比矩阵（A vs B vs C）
## 3) 对比矩阵（A vs B vs C）

| | A：registerHooks ESM 臂 | B：静态护栏 + 文档 | C：仅文档 |
|---|---|---|---|
| 防护对象 | ESM 入口解析 miss（症状） | 「唯一入口=createRequire」不变量（根因） | 无 |
| 覆盖范围 | Node ≥22.15 且走 Node 原生 resolver；<22.15 静默无防护；jest/vitest 下可能不生效 | 全 Node 版本、全工具链（CI 阶段拦截） | 无 |
| API 成熟度风险 | Stability 1.1→1.2，@experimental，process-global 钩子 | 零（只用 ESLint/测试） | 零 |
| 实施税 | 中：feature-detect 模块、动态配对 resolve、fail-open 包装、测试 | 低：一条 lint 规则 + 一条单测 + 文档段 | 极低 |
| 与现状匹配度 | 低（今天零可达面） | 高（护栏恰好表达你们已存在的设计决策） | 部分高 |
| 何时必要 | ESM 加载路径变为可达（触发器） | 立即 | 不充分 |

## source guard 静态断言 不变量

### atomcode > 3) 对比矩阵（A vs B vs C）
## 3) 对比矩阵（A vs B vs C）

| | A：registerHooks ESM 臂 | B：静态护栏 + 文档 | C：仅文档 |
|---|---|---|---|
| 防护对象 | ESM 入口解析 miss（症状） | 「唯一入口=createRequire」不变量（根因） | 无 |
| 覆盖范围 | Node ≥22.15 且走 Node 原生 resolver；<22.15 静默无防护；jest/vitest 下可能不生效 | 全 Node 版本、全工具链（CI 阶段拦截） | 无 |
| API 成熟度风险 | Stability 1.1→1.2，@experimental，process-global 钩子 | 零（只用 ESLint/测试） | 零 |
| 实施税 | 中：feature-detect 模块、动态配对 resolve、fail-open 包装、测试 | 低：一条 lint 规则 + 一条单测 + 文档段 | 极低 |
| 与现状匹配度 | 低（今天零可达面） | 高（护栏恰好表达你们已存在的设计决策） | 部分高 |
| 何时必要 | ESM 加载路径变为可达（触发器） | 立即 | 不充分 |

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐姿势 = B 为主体（源码级不变量护栏 + 文档记缺口与重返触发器），A 降级为「触发器触发后才立项」的条件项。** 理由：对「不变量形态」的加载路径防护，工业界成熟心智模型是**用静态断言守住不变量（entry-point 唯一性），而不是为今天不可达的路径写运行时防御码**——运行时防御只配给「真实可达且会造成生产故障」的缺陷路径。`module.registerHooks` 自身仍是 Stability 1.1（Active development）/ @experimental（Confidence：高——Node 官方文档直读），为一条零调用面路径引入 experimental API + 条件启用语义，是负收益。版本配对：**动态配对（从 effective onnxruntime-node 目录 resolve）优于固定钉版**，GitNexus 是已验证先例；你们现有的 1.21.0 钉版应加一条「升级 transformers 时同步刷新 + 配对断言测试」的纪律兜底。

### atomcode > 2) 分点结论 (2)
**④ 条件启用防御（<22.15 静默无防护）是否比没有更糟**（Confidence 中）
- 语义差别是真实的：显式不设防（B）的失败面=不变量被打破+护栏报警；条件启用的失败面=不变量被打破+Node 22.0~22.14 消费者静默 `ERR_MODULE_NOT_FOUND`——**多了一层「以为有防护」的错觉**。
- 但在 A 的前提（零可达面）下这个差别今天不兑现：两条路都零事故。差别在未来兑现时才出现，而那时正确动作本来就是按触发器立项。结论：条件启用不比没有更糟，但也不比没有更好——它只在你**已经决定要设防**之后才成为值得讨论的实施细节（届时用 GitNexus 式 feature-detect + 文档明写覆盖地板）。

**⑤ 版本配对纪律：动态配对 > 固定钉版**（Confidence 高）
- GitNexus 实现注释的论证：redirect 目标**优先从 effective `onnxruntime-node` 目录 resolve 配对的 `onnxruntime-common`**，使被重定向副本与 native binding 版本匹配；自声明依赖仅作 fallback。onnxruntime-common 是纯 JS、Tensor 面 1.24–1.26 稳定，但双实例风险真实存在（你们的 ghost-dep 修复本身就是为此设计）。
- 你们现状：钉 1.21.0 与 transformers 3.8.1 内嵌 ORT-node 1.21.0 配对——**今天是对的，但它是手工同步的隐式契约**。升级 transformers 时最容易忘的正是这条。建议（B 的组成部分）：加一条单测断言「自声明 onnxruntime-common 版本 ≡ node_modules 内 effective onnxruntime-node 的依赖版本」，把配对从纪律变成 CI 事实；未来若上 A 臂，直接照 GitNexus 的动态 resolve 姿势。

## defensive code unreachable

### atomcode
# atomcode

$ atomcode -p "$(cat .scratch/grill-round-75/q3-prompt.txt)"

知识库已召回大半材料，补搜缺的三块：registerHooks 成熟度/loader 生态兼容性、条件启用语义、静态护栏先例。补齐 AnySearch 引擎配额并核验几个关键原文。配额自查先亮出来：

```
searches: 6+ (ctx_search 召回 1 轮 + Tavily 2 + web_search 2 + AnySearch 1)
angles: Official (Node 官方 API 文档/deprecations)、Comparative (vitest/jest ESM 对比)、Criticism (GitNexus 实现注释里的限制自述、registerHooks experimental 标注)、Currency (2026 动态)、Community (GitNexus issue/源码、Reddit)
full reads: 6+ (nodejs.org module API v22、deprecations 页、GitNexus resolver/node-module-compat 源码原文、ESLint no-restricted-imports 文档、jest ESM 文档、知识库历史报告全文)
domains: nodejs.org, github.com, jestjs.io, eslint.org, timdeschryver.dev, npmjs.com 等 ≥5
gaps: registerHooks 与 vitest/jest 具体冲突的实测报告未找到直接材料（仅有间接证据，见缺口节）
```

### atomcode > 6) 信息缺口
## 6) 信息缺口

- registerHooks 在 jest/vitest 下的**实际**行为（生效/被绕过）无直接实测报告，仅有架构推断（两者各有自己的解析层）；若未来上 A，需先在 CI 矩阵里实测。
- Node 22.0–22.14 消费者占比无数据（决定 A 的紧迫性时需要）。
- Bun 对 registerHooks 的支持状态未查到材料。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume 57faea65-de8a-4d21-9aec-0ac41cef335a

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐姿势 = B 为主体（源码级不变量护栏 + 文档记缺口与重返触发器），A 降级为「触发器触发后才立项」的条件项。** 理由：对「不变量形态」的加载路径防护，工业界成熟心智模型是**用静态断言守住不变量（entry-point 唯一性），而不是为今天不可达的路径写运行时防御码**——运行时防御只配给「真实可达且会造成生产故障」的缺陷路径。`module.registerHooks` 自身仍是 Stability 1.1（Active development）/ @experimental（Confidence：高——Node 官方文档直读），为一条零调用面路径引入 experimental API + 条件启用语义，是负收益。版本配对：**动态配对（从 effective onnxruntime-node 目录 resolve）优于固定钉版**，GitNexus 是已验证先例；你们现有的 1.21.0 钉版应加一条「升级 transformers 时同步刷新 + 配对断言测试」的纪律兜底。

## version pairing onnxruntime-common

### atomcode > 2) 分点结论 (2)
**④ 条件启用防御（<22.15 静默无防护）是否比没有更糟**（Confidence 中）
- 语义差别是真实的：显式不设防（B）的失败面=不变量被打破+护栏报警；条件启用的失败面=不变量被打破+Node 22.0~22.14 消费者静默 `ERR_MODULE_NOT_FOUND`——**多了一层「以为有防护」的错觉**。
- 但在 A 的前提（零可达面）下这个差别今天不兑现：两条路都零事故。差别在未来兑现时才出现，而那时正确动作本来就是按触发器立项。结论：条件启用不比没有更糟，但也不比没有更好——它只在你**已经决定要设防**之后才成为值得讨论的实施细节（届时用 GitNexus 式 feature-detect + 文档明写覆盖地板）。

**⑤ 版本配对纪律：动态配对 > 固定钉版**（Confidence 高）
- GitNexus 实现注释的论证：redirect 目标**优先从 effective `onnxruntime-node` 目录 resolve 配对的 `onnxruntime-common`**，使被重定向副本与 native binding 版本匹配；自声明依赖仅作 fallback。onnxruntime-common 是纯 JS、Tensor 面 1.24–1.26 稳定，但双实例风险真实存在（你们的 ghost-dep 修复本身就是为此设计）。
- 你们现状：钉 1.21.0 与 transformers 3.8.1 内嵌 ORT-node 1.21.0 配对——**今天是对的，但它是手工同步的隐式契约**。升级 transformers 时最容易忘的正是这条。建议（B 的组成部分）：加一条单测断言「自声明 onnxruntime-common 版本 ≡ node_modules 内 effective onnxruntime-node 的依赖版本」，把配对从纪律变成 CI 事实；未来若上 A 臂，直接照 GitNexus 的动态 resolve 姿势。

### atomcode > 4) 推荐落地（B 的具体形态）
## 4) 推荐落地（B 的具体形态）

1. **ship-gate/单测断言**：embedding src 禁止对 `@huggingface/transformers` 的裸 `import`/`from`/动态 `import()`——唯一合法引用点 = 包内 `createRequire().require()` 加载模块（可用 no-restricted-imports patterns + 一条 grep 型 ship-gate 步骤双保险）。
2. **配对断言单测**：断言自声明 `onnxruntime-common` 版本与 effective `onnxruntime-node` 的内嵌依赖版本一致，升级 transformers 时 CI 红而不是双实例。
3. **文档记缺口 + 重返触发器**：触发器写死三条——(a) 任何代码路径开始以 ESM import 加载 transformers；(b) 上游修 #1087（届时整个 patch 可退役）；(c) 你们把 Node 地板抬到 ≥22.15 且出现真实 ESM 消费者（届时按 GitNexus #2069 姿势上 A，fail-open + 动态配对）。
4. **CJS patch 保持不动**，无需迁移到 registerHooks（后者虽能同拦 require，但 `_resolveFilename` patch 在全版本地板工作，无需条件启用）。

### atomcode > 5) 完整来源清单
## 5) 完整来源清单

1. [Node.js v22 module API — registerHooks](https://nodejs.org/docs/latest-v22.x/api/module.html)（Official，v22.23.2）— Added in 22.15.0、Stability 1.1、同步钩子同拦 import/require/createRequire；worker 继承限制。贡献：成熟度定级。
2. [Node.js v26 module API](https://nodejs.org/api/module.html)（Official，经 AnySearch）— 同步钩子已升 1.2 Release candidate、"recommended for simplicity"。贡献：成熟度趋势。
3. [Node.js Deprecated APIs](https://nodejs.org/api/deprecations.html)（Official，v26.9.0，本轮全文抓取）— DEP0205 `module.register()` 弃用、Node 26 移除。贡献：为何 registerHooks 是正确对位物。
4. [GitNexus onnxruntime-common-resolver.ts](https://github.com/abhigyanpatwari/GitNexus/blob/8ad4469e/gitnexus/src/core/embeddings/onnxruntime-common-resolver.ts)（Community/生产实现，本轮源码直读）— registerHooks ESM 臂完整参考实现：仅 miss 生效、动态配对、<22.15 graceful no-op、pnpm dlx 场景论证。贡献：A 路线的可行性+成本+配对纪律先例。
5. [GitNexus node-module-compat.ts](https://github.com/abhigyanpatwari/GitNexus/blob/7ac0c861/gitnexus/src/core/embeddings/node-module-compat.ts)（Community，本轮源码直读）— `type:module` 包里静态具名 import registerHooks 在 <22.15 是 link-time SyntaxError 的坑与解法。贡献：A 的实施税实证。
6. [ESLint no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports)（Official）+ [typescript-eslint 版](https://typescript-eslint.io/rules/no-restricted-imports) — 静态边界护栏的标准工具。贡献：B 的工具选型。
7. [eslint-plugin-boundaries](https://www.npmjs.com/package/eslint-plugin-boundaries) + [timdeschryver.dev 实践文](https://timdeschryver.dev/bits/enforce-module-boundaries-with-no-restricted-imports)（Community）— 架构边界用 lint 守住的行业惯例。贡献：心智模型先例。
8. [jest ESM 文档](https://jestjs.io/docs/ecmascript-modules)（Official）— Jest ESM 仍 experimental、走自有 loader。贡献：registerHooks 在测试运行器下可能不生效的间接证据。
9. [transformers.js #1087](https://github.com/huggingface/transformers.js/issues/1087)（知识库历史轮已核验）— 上游知情未修；触发器 (b) 的跟踪对象。
10. 知识库历史报告（batch:atomcode，本会话召回）— 你们 CJS patch 双件修法、4.3.0 仍在裸奔、mastra packageExtensions 先例等结论复用。

## 推荐 姿势 理由

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐姿势 = B 为主体（源码级不变量护栏 + 文档记缺口与重返触发器），A 降级为「触发器触发后才立项」的条件项。** 理由：对「不变量形态」的加载路径防护，工业界成熟心智模型是**用静态断言守住不变量（entry-point 唯一性），而不是为今天不可达的路径写运行时防御码**——运行时防御只配给「真实可达且会造成生产故障」的缺陷路径。`module.registerHooks` 自身仍是 Stability 1.1（Active development）/ @experimental（Confidence：高——Node 官方文档直读），为一条零调用面路径引入 experimental API + 条件启用语义，是负收益。版本配对：**动态配对（从 effective onnxruntime-node 目录 resolve）优于固定钉版**，GitNexus 是已验证先例；你们现有的 1.21.0 钉版应加一条「升级 transformers 时同步刷新 + 配对断言测试」的纪律兜底。

### atomcode > 2) 分点结论 (2)
**④ 条件启用防御（<22.15 静默无防护）是否比没有更糟**（Confidence 中）
- 语义差别是真实的：显式不设防（B）的失败面=不变量被打破+护栏报警；条件启用的失败面=不变量被打破+Node 22.0~22.14 消费者静默 `ERR_MODULE_NOT_FOUND`——**多了一层「以为有防护」的错觉**。
- 但在 A 的前提（零可达面）下这个差别今天不兑现：两条路都零事故。差别在未来兑现时才出现，而那时正确动作本来就是按触发器立项。结论：条件启用不比没有更糟，但也不比没有更好——它只在你**已经决定要设防**之后才成为值得讨论的实施细节（届时用 GitNexus 式 feature-detect + 文档明写覆盖地板）。

**⑤ 版本配对纪律：动态配对 > 固定钉版**（Confidence 高）
- GitNexus 实现注释的论证：redirect 目标**优先从 effective `onnxruntime-node` 目录 resolve 配对的 `onnxruntime-common`**，使被重定向副本与 native binding 版本匹配；自声明依赖仅作 fallback。onnxruntime-common 是纯 JS、Tensor 面 1.24–1.26 稳定，但双实例风险真实存在（你们的 ghost-dep 修复本身就是为此设计）。
- 你们现状：钉 1.21.0 与 transformers 3.8.1 内嵌 ORT-node 1.21.0 配对——**今天是对的，但它是手工同步的隐式契约**。升级 transformers 时最容易忘的正是这条。建议（B 的组成部分）：加一条单测断言「自声明 onnxruntime-common 版本 ≡ node_modules 内 effective onnxruntime-node 的依赖版本」，把配对从纪律变成 CI 事实；未来若上 A 臂，直接照 GitNexus 的动态 resolve 姿势。


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: _resolvefilename, eslint-plugin-boundaries, enforce-module-boundaries-with-no-restricted-imports, process-global, onnxruntime-common, deprecations, node-module-compat, timdeschryver, onnxruntime-node, feature-detect, no-restricted-imports, createrequire, development, syntaxerror, huggingface, anysearch, community, embedding, candidate, link-time, official, register, package, release, dep0205, 无直接实测报告, 条件启用语义, github, jestjs, active, latest, https, rules, 静默无防护, docs, bits, 2069, type, html, miss

---

## 追补：推荐落地（B 的具体形态）

1. ship-gate/单测断言：embedding src 禁止对 @huggingface/transformers 的裸 import/from/动态 import()——唯一合法引用点=包内 createRequire().require() 加载模块（no-restricted-imports patterns + grep 型 ship-gate 步骤双保险）。
2. 配对断言单测：断言自声明 onnxruntime-common 版本与 effective onnxruntime-node 的内嵌依赖版本一致，升级 transformers 时 CI 红而不是双实例。
3. 文档记缺口+重返触发器三条：(a) 任何代码路径开始以 ESM import 加载 transformers；(b) 上游修 #1087（届时整个 patch 可退役）；(c) Node 地板抬到 >=22.15 且出现真实 ESM 消费者（届时按 GitNexus #2069 姿势上 A，fail-open+动态配对）。
4. CJS patch 保持不动（registerHooks 虽能同拦 require，但 _resolveFilename patch 在全版本地板工作，无需条件启用）。
