# R88 Q2 atomcode 调研归档

> 来源：atomcode -p（q2-prompt.txt）；串行单跑；已索引 ctx。Tavily 超限，Exa+AnySearch+知识库三源交叉。

# R88 Q2（a06 归并边界）深度调研报告

### atomcode > 5) 信息缺口
## 5) 信息缺口

1. **`reason` 字段的具体枚举集**未裁决——建议 ADR-0089 验收判据里预注册（参照 a06 预注册条款惯例）：结构化 reason 短码集 + 各 surface 文案映射表，错误形状（exit code、MCP error text 措辞）冻结为与现状 byte-identical，避免违反 ADR-0084 D-006“错形不许改”。
2. `verticalSpecProps` 片段抽取后 TypeBox 推断出的 TS 类型是否与现手写类型逐字段一致（TypeBox 片段复用可能改变 Static 推断的命名）——落地时需一次 `tsc --noEmit` 级验证，本调研未做本地代码实验。
3. Tavily 引擎因配额超限缺席，第三引擎交叉验证由 AnySearch + 知识库召回顶替；关键结论（wrong abstraction 判据、monorepo 分层、schema 复用）均已获 ≥2 独立信源，未受影响。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume a7a85f56-04d3-4141-987c-200cf1c3c322

## 推荐

### atomcode > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐 A1【双层归并】，Confidence：高**。决定性理由不是“三处重复该 DRY”，而是：① whole-replace 语义的单一权威（`canonicalizeVertical`）已经在 retriever/contract.ts 立法（ADR-0084 D-003），守卫语义是**同一块知识的另一半**——把它留在各站复制，等于把一条已立法的合约语义拆成三份手抄，这正是 DRY 定义的“知识重复”而非表面巧合；② 归并形态（判别联合 + 各 surface 自行渲染）不引入跨 caller 条件分支，恰好避开 Sandi Metz 意义上的 wrong abstraction 触发条件。A3 的分层方向错误，A2 是留了语义发源地在共享面之外的半吊子方案。

## buildVerticalSpec

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**结论 1 — A1 成立的核心判据：这是“知识重复”，不是“代码巧合重复”。**（来源：kentcdodds.com AHA、sandimetz.com）

DRY 的原始定义是“**每块知识在系统内有且只有一个权威表述**”（Kent C. Dodds 引 Wikipedia），而错误地抽象的代价来自“两段代码长得一样但代表不同概念”。本例相反：三个 call site 复制的 guard+组装逻辑代表**同一个概念**——query-level vertical 的 whole-replace 语义，且该语义已被 ADR-0084 D-003 立法为统一合约（A-02 错形 fail-fast 一致）。立法过的共享语义在代码里出现三份，是 Kent 说的“一个 bug 要修八处”风险的同级问题：任何一处先漂移（比如 CLI 站改了守卫条件），CLI/MCP 两个入口对同一非法输入开始给出不同答案——合约漂移，不是风格问题。**反对“维持现状（A4 的不归并臂）”**：Rule of Three 只是“到没到阈值”的判据，本例不止到了阈值，还满足更强的“同一知识已立法”条件。

**结论 2 — 归并位置：retriever/contract.ts 与 canonicalizeVertical 同址，是分层上唯一自洽的落点。**（来源：sergiodxa.com、nazarboyko.com）

两条 monorepo 分层纪律在此直接适用：

- sergiodxa：“**apps 可以依赖 packages，但 packages 不该知道哪些 app 存在**”；“如果共享代码需要知道是哪个 app 在调它，它还不配是共享代码”。A1 的判别联合返回形态使 `buildVerticalSpec` 完全不知道调用方是谁——CLI 拿 `{ok:false}` 自己映射到 stderr+exit(1)，MCP 映射到 tool error text。这正是 ports-and-adapters：**领域结果共享，渲染留在 adapter**。
- nazarboyko：“**按能力（capability）划包边界，不按层划**；一句话描述里不该有 'and'”。`buildVerticalSpec` + `canonicalizeVertical` 是**同一个能力**（vertical 输入合约）的两半，同址在 contract.ts 使 retriever 拥有一条不含 "and" 的完整能力描述。A3 把组装放 kernel、把 canonicalize 留 retriever，是把一个能力劈成两个包各拿一半——恰好制造 nazarboyko 警告的边界碎裂。且 kernel 已消费 retriever 的 `VerticalSpec` 类型，依赖方向 kernel→retriever 已存在，运行语义再下沉 kernel 只会让 kernel 从“schema 权威”膨胀为“schema + 运行变换”混合体——utils landfill 的典型第一步。
- sergiodxa 的“少抽取”警告（“第三个 app 需要略不同行为→包长出 options→每个 caller 传不同 option set”）在 A1 下不成立，因为三站的差异**全部在渲染层**，共享函数零参数分歧、零条件分支。

**结论 3 — 判别联合不是过度设计，它是让错误“文案单源化”的最小合约。**（来源：sandimetz.com 的反向应用 + 社区 Result-pattern 惯例）

辩证检验 A1 最强反对论据“判别联合 vs 各 surface 原生错误通道是否过度设计”：

### atomcode > 2) 分点结论 (2)
- 反方最强形态：三站错误通道天然异构（exit code vs MCP text），联合返回逼每个 caller 写映射代码，是不是为共享而共享？
- 正方回应：关键问题不是“要不要联合”，是**错误文案在哪里生成**。三个选项： (a) 共享函数抛异常/返回带文案的 error → CLI 要 catch、MCP 要 catch，catch 块两处重复且异常跨包逃逸； (b) 共享函数只返回 `boolean`/null，文案各站写 → 文案三份复制，漂移后两个入口对同一非法输入说法不一——又回到结论 1 的问题； (c) 判别联合 `{ok:true,vertical}|{ok:false,reason}` → 语义单源、渲染各站、类型系统强制每个 caller 处理失败臂。** 是最小合约**。唯一的真实取舍点在 `reason` 的粒度：建议返回**结构化 reason（机器可判别的枚举/短码 + 必要参数）**，人话文案由各 surface 出——这与本仓库知识库中已立法的 IpcError 模式（typed error enum + i18n_key，surface 渲染 locale 文案）同构，仓库自身已有先例可援引。
- 另一个反对论据“only-3 未到 Rule of Three 阈值”不成立：WET 的表述是“问两次可以，第三次必须重构”（Conlin Durbin 定义，经 Kent C. Dodds 与 understandlegacycode.com 双源确认），三站恰好第三次击发。且 understandlegacycode 补充的真正阈值是“**叫得出清晰名字的抽象才抽**”——`buildVerticalSpec({domain?,subDomain?,params?})` 名字自明，无 boolean 参数、无 caller 条件分支，通过该检验。

**结论 4 — schema 面抽 `verticalSpecProps` 共享片段归 kernel：正确，且是 schema-first 惯例的正典做法。**（来源：json-schema.org 官方文档）

JSON Schema 官方 structuring 文档明文：“把 schema 结构化成可复用组件对任何非平凡场景都高度有益”，并给出 `$defs` + `$ref` 作为标准复用机制（address 复用例子与本案同构：shipping/billing_address 共享 address 子 schema）。TypeBox 本身就是“以 TypeScript 类型推断的 JSON Schema 片段组装器”（TypeBox 官方定位），片段共享是其设计意图内的用法。kernel 是 schema 权威（两份 TypeBox 块都住在 kernel/tool-schemas.ts），片段抽在 kernel 不新增依赖边。**注意验收点**：`additionalProperties:false` 与三参块的注释要随片段走，防止复用后 loose schema 静默改变 AJV 校验面——这是 ADR-0084 D-006“错形 fail-fast 不许改”在 schema 侧的镜像。

**结论 5 — A2 与 A3 的具体否决理由。**

- **A2（仅归并 MCP 双站）**：把 whole-replace 语义的**发源地 CLI 站**留在共享面之外，守卫语义仍是两处维护——归并收益砍半而复杂度不减（新建一个 apps/mcp 内部共享模块，未来 CLI 要归并时还得再搬家一次）。且 MCP 内部共享模块是一个“只服务部分 caller 的包”，比放 retriever 更不像共享代码。
- **A3（kernel 大一统）**：schema 半臂对（见结论 4），运行半臂错——kernel 持有 retriever 类型的运行变换语义，会把“输入合约层”变成“schema+变换混合层”，且把能力劈到两个包。辩证地说，A3 唯一可辩处是 kernel 已消费 retriever 类型、依赖方向不新增——但“依赖边为零”不等于“能力内聚”，分层纪律看重的是能力归属而非 import 计数。
- **A4 含“不归并”臂**：已在结论 1 否决。不归并的唯一合理场景是三站代表不同概念（accidental duplication），本案明确不是。

## Rule of Three

### atomcode > 4) 完整来源清单
## 4) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| The Wrong Abstraction（Sandi Metz） | https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction | Criticism/经典 | 2016-01-20 | wrong abstraction 的判定信号（跨 caller 条件分支/boolean 参数）；本案 A1 形态不含这些信号 |
| AHA Programming（Kent C. Dodds） | https://kentcdodds.com/blog/aha-programming | Comparative | 2020-06-22 | DRY 的“知识单源”原始定义；WET "never three" 判据；AHA=避免仓促抽象而非拒绝抽象 |
| Don't use the Rule of Three blindly（understandlegacycode.com） | https://understandlegacycode.com/blog/refactoring-rule-of-three/ | Community/Criticism | 无日期 | 第三次击发即重构；“叫得出清晰名字才抽”的补充阈值 |
| Structuring a Bun Monorepo with Shared Packages（sergiodxa） | https://sergiodxa.com/articles/structuring-a-bun-monorepo-with-shared-packages | Currency | 2026-07-23 | “packages 不该知道哪些 app 存在” → 支持判别联合渲染留 surface；少抽取警告及其在 A1 下不成立的原因 |
| How To Structure Shared Libraries In A Node.js Monorepo（nazarboyko） | https://www.nazarboyko.com/articles/structuring-shared-libraries-nodejs-monorepos | Comparative | 2024-03-19 | 按 capability 划边界、一句话无 "and" 检验 → 否决 A3 劈能力两包 |
| Modular JSON Schema combination（json-schema.org 官方） | https://json-schema.org/understanding-json-schema/structuring | Official | 现行文档 | `$defs`/`$ref` 复用子 schema 的正典惯例 → 支撑 verticalSpecProps 片段抽取 |
| 99 Bottles/I Spent 3 Days with Sandi Metz（jackhoy.com） | https://www.jackhoy.com/web-applications/2014/08/20/i-spent-3-days-with-sandi-metz-heres-what-i-learned.html | Community | 2014-08-20 | 摘要级佐证：duplication 先行、抽象在理解后——辅助检验 A1 非仓促抽象 |
| Result Pattern/DU 社区讨论（Reddit r/csharp 等，摘要级） | https://www.reddit.com/r/csharp/comments/1qvybyr/ | Community | 2026 | 仅用于确认 Result-pattern 是跨语言成熟惯例，非关键结论支柱 |
| TypeBox（GitHub 官方 README） | https://github.com/sinclairzx81/typebox | Official | 现行 | “TypeBox types 是 JSON Schema 片段”——片段复用是设计意图 |
| 本仓库知识库召回（ctx_search） | — | 内部 | — | IpcError typed-enum + surface 渲染先例；understandlegacycode 文章先前索引 |

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**结论 1 — A1 成立的核心判据：这是“知识重复”，不是“代码巧合重复”。**（来源：kentcdodds.com AHA、sandimetz.com）

DRY 的原始定义是“**每块知识在系统内有且只有一个权威表述**”（Kent C. Dodds 引 Wikipedia），而错误地抽象的代价来自“两段代码长得一样但代表不同概念”。本例相反：三个 call site 复制的 guard+组装逻辑代表**同一个概念**——query-level vertical 的 whole-replace 语义，且该语义已被 ADR-0084 D-003 立法为统一合约（A-02 错形 fail-fast 一致）。立法过的共享语义在代码里出现三份，是 Kent 说的“一个 bug 要修八处”风险的同级问题：任何一处先漂移（比如 CLI 站改了守卫条件），CLI/MCP 两个入口对同一非法输入开始给出不同答案——合约漂移，不是风格问题。**反对“维持现状（A4 的不归并臂）”**：Rule of Three 只是“到没到阈值”的判据，本例不止到了阈值，还满足更强的“同一知识已立法”条件。

**结论 2 — 归并位置：retriever/contract.ts 与 canonicalizeVertical 同址，是分层上唯一自洽的落点。**（来源：sergiodxa.com、nazarboyko.com）

两条 monorepo 分层纪律在此直接适用：

- sergiodxa：“**apps 可以依赖 packages，但 packages 不该知道哪些 app 存在**”；“如果共享代码需要知道是哪个 app 在调它，它还不配是共享代码”。A1 的判别联合返回形态使 `buildVerticalSpec` 完全不知道调用方是谁——CLI 拿 `{ok:false}` 自己映射到 stderr+exit(1)，MCP 映射到 tool error text。这正是 ports-and-adapters：**领域结果共享，渲染留在 adapter**。
- nazarboyko：“**按能力（capability）划包边界，不按层划**；一句话描述里不该有 'and'”。`buildVerticalSpec` + `canonicalizeVertical` 是**同一个能力**（vertical 输入合约）的两半，同址在 contract.ts 使 retriever 拥有一条不含 "and" 的完整能力描述。A3 把组装放 kernel、把 canonicalize 留 retriever，是把一个能力劈成两个包各拿一半——恰好制造 nazarboyko 警告的边界碎裂。且 kernel 已消费 retriever 的 `VerticalSpec` 类型，依赖方向 kernel→retriever 已存在，运行语义再下沉 kernel 只会让 kernel 从“schema 权威”膨胀为“schema + 运行变换”混合体——utils landfill 的典型第一步。
- sergiodxa 的“少抽取”警告（“第三个 app 需要略不同行为→包长出 options→每个 caller 传不同 option set”）在 A1 下不成立，因为三站的差异**全部在渲染层**，共享函数零参数分歧、零条件分支。

**结论 3 — 判别联合不是过度设计，它是让错误“文案单源化”的最小合约。**（来源：sandimetz.com 的反向应用 + 社区 Result-pattern 惯例）

辩证检验 A1 最强反对论据“判别联合 vs 各 surface 原生错误通道是否过度设计”：

### atomcode
# atomcode

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-88/q2-prompt.txt)"

我先检索知识库召回历史，再按三引擎+多角度开展外部调研。知识库已命中 Rule of Three/Wrong Abstraction 文章。现在三引擎并行开展外部调研。Tavily 超限，改用 Exa + AnySearch 双引擎继续。现在打多角度查询并深挖已命中的原文。继续调研——开始深挖已抓取的搜索结果，并针对剩余角度进行补充搜索。继续第三阶段：定点深挖 monorepo 分层与错误通道设计原文。补足第 6 次原文核验后即输出综合。# R88 Q2（a06 归并边界）深度调研报告

## 辩证

No matching sections found.


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: buildverticalspec, understandlegacycode, result-pattern, whole-replace, canonicalizevertical, verticalspecprops, comparative, kentcdodds, nazarboyko, capability, json-schema, structuring, duplication, criticism, community, sandimetz, fail-fast, sergiodxa, atomcode, official, currency, vertical, packages, landfill, ipcerror, adapter, boolean, 不该知道哪些, import, d-003, sandi, false, utils, d-006, 双层归并, 知识重复, metz, 合约漂移, 维持现状, apps