# 深调研报告：可选重依赖（embedding/onnxruntime-node）在 npm 全局 CLI 的打包形态

> atomcode q2 · 2026-09-14 · grill-round-62 Q2（安装炸弹拆除形态 A-D 取舍）
> Sufficiency：本地账本/ADR/源码实物已读；工业证据三引擎交叉（Exa/Tavily/AnySearch），关键原文 web_fetch 核验

## 1) 执行摘要（Tl;dr）

**推荐：A 的修正版（A′）** —— embedding 移入 `optionalDependencies`（不是 peerDependencies），store 侧静态 import 改守卫式动态 import（`module.available` 探测），ship-gate 增加"安装闭包不含 onnxruntime-node"断言；**不拆包（否决 C）**。**Confidence：高**——fail-open 与可选性是你们自己的既有决策（ADR-0033 D2/D5、CONTEXT.md Circuit Breaker 词条），A 只是把运行时承诺追平到安装时；而外部证据（npm v12 全局安装无 allowScripts 通道、pnpm onlyBuiltDependencies 不随包分发）证明"硬依赖 + postinstall 下载"这条路在 2026 年的包管理生态里对 `npm i -g` 已结构性走不通。**与账本 current 决策不冲突**，但与 ADR-0033 的一条 implementation 细则冲突，需按 Nygard 流程显式修订（详见 §6）。

## 2) 分点结论

**结论 1：外部评审的净机失败不是偶发 bug，是 2026 年生态的结构性结果。（Confidence 高；npm 官方文档 + byteiota/npm RFC）**
npm v12（2026-07-08 起）install scripts 默认全禁（`allowScripts`），全局安装连 allowlist 都没有落盘位置——官方文档原文："Running it with `--global` (-g) fails with an EGLOBAL error, since global installs have no project package.json to write to"，只能靠用户手动 `npm install -g --allow-scripts=...`。pnpm v10+（onlyBuiltDependencies）、Yarn Berry、Bun 同样默认禁脚本，且 pnpm 侧 onnxruntime-node 不在默认 allowlist。仓库 pin allowBuilds=false 只对仓库内开发安装生效、不随 tarball 分发——消费者 npm i -g 时 onnxruntime-node 的 postinstall 必然被拦或必然裸跑下载，两条路都是死路。本地 install-smoke 全绿是因为 CI 机器有 HF 通道，是"在开发环境验证发布面"的假绿。

**结论 2：onnxruntime-node 体量与脆弱性双源证实，与检索 CLI 核心功能不成比例。（Confidence 高）**
transformers.js#1164 实测 node_modules/onnxruntime-node/bin 解压 727.79 MB（Vercel 250MB 限制直接爆掉）；registry manifest 证实 @huggingface/transformers 4.2.0 的 dependencies 里 onnxruntime-node 与 sharp 都是硬依赖（v2 曾是 optional，v3 收硬）。本仓库历史：onnxruntime-node@1.21.0 是 macOS darwin-arm64 SIGSEGV 真凶候选（Round-57 五段决策门）。缺席时整个 CLI 该更好用的组件，占安装体积 95%+ 且带平台崩溃前科。

**结论 3：工业界成熟心智模型 = optionalDependencies + 守卫式动态 import，先例充分。（Confidence 高；esbuild 官方文档 + npm RFC + npm cli#7355）**
- esbuild：平台二进制走 optionalDependencies，官方文档明文"partial work when --ignore-scripts or --no-optional is present"——降级是设计的一部分。
- npm RFC-0000（package-distributions）称 optionalDependencies 为 current best practice/work-around。
- transformers.js v2（@xenova/transformers@2.17.2）自己就是 optional onnxruntime；v3 收硬后才有 #1164 连锁痛苦。
- 反面教训：npm cli#7355（optional 依赖 build 失败仍可炸全局安装，Open）说明 optional 不是银弹，必须配合消费端动态 import 容错——正是 embedding 包已有形态（`import("@huggingface/transformers")` 动态加载 + fail-open）。

**结论 4：guard-import 技术形态已写好一半。（Confidence 高；代码实物）**
- packages/embedding/src/index.ts 的 transformers 加载本来就是动态 import + unresolved package = arm absent 注释。
- 真正断点是 store 两处静态 import（session-store.ts:23、consolidate.ts:10）。守卫化后 embedding 缺席时 embedText 返回 null、cosineSimilarity 可零依赖内联（11 行）。CB 与遥测形态不变（telemetry 全零 + circuitOpen=false = 臂缺席，与臂熔断可区分）。
- tsup noExternal 不含 @anysearch/embedding → 被打进 ans bundle → 静态链把 onnxruntime 拖进消费闭包。守卫化后加 external（该文件已有 external onnxruntime-node 注释纪律，加一行顺势）。

**结论 5：C（拆包 store-vector）是对 A 的过度工程。（Confidence 高）**
问题本质是"可选性没有被包管理语义承载"——A 用 optionalDependencies 一行解决同一问题且保留单包内聚。拆包代价：① 5→8 tarball，install-smoke/PACK_DIRS/ship-gate 全动；② store 调用点改跨包异步边界，consolidate 同步余弦去重被异步化污染；③ 私有 monorepo 无独立发版收益。防静态 import 回归用 ESLint no-restricted-imports + ship-gate grep 免费获得。

**结论 6：B 和 D 都不解决外部消费者第一分钟。（Confidence 高）**
B：postinstall-download-or-block 结构性死结原样保留，版本收敛是移动靶（SIGSEGV 前科）。D：等于把"装不上"写进规格，违反 R61 D-001 README 诚实红线与 R60 C1 pack→装→doctor→search 可交付闭环承诺。

**结论 7（与 ADR-0033 的唯一冲突点，必须显式修订）：**
ADR-0033 D2 "onnxruntime-node 有官方 Windows 预编译包（allowBuilds:false 兼容）"在仓库内开发安装语境成立且 spike 通过，但隐含假设"兼容性传导到消费安装"被外部实测证伪。按 Nygard：D2 标 revised（补"消费安装闭包中 onnxruntime-node 必须可选缺席"子条款），不 Supersede 整篇——D1/D3-D8 全存活。D8 的 zero-new-native-dependency 精神与 A′ 方向一致（原生依赖最小化推广到安装层）。

**结论 8（与 ADR-0062 正向对齐）：**
R61 D1 把 publish 排在 abstain 缺口关闭后——"可发布"验收面天然包含装得上；A′ 是 publish 前置条件的一部分不是新主题。R61 D3 abstain-as-first-class-outcome 与"臂缺席是合法状态"同构。

## 3) 对比矩阵

| 项 | npm i -g 净机成功率 | 安装体积 | 拆包/迁移成本 | 可选性承载 | ship-gate 可断言性 | 主要风险 |
|---|---|---|---|---|---|---|
| **A′ optionalDeps + 守卫动态 import + 闭包断言** | **高**（postinstall 失败仅跳过该包，bin 正常落地；esbuild 验证过的路径） | CLI 基线 ~数 MB | 小：2 处静态 import 改守卫 + tsup external + package.json 一行 | npm 原生语义 | 断言安装后 node_modules 无 onnxruntime-node，可入 install-smoke | optional 装不上时静默降级——需 doctor 显示向量臂缺席遥测 |
| B 硬依赖收敛 onnxruntime 变体 | 低（npm12 全局无 allowScripts 通道，死结不变） | 仍数百 MB | 零 | 无 | 只能断言版本号 | 版本收敛是移动靶 |
| C 拆包 store + store-vector | 高（取决于声明方式） | CLI 基线不变 | 大：5→8 tarball、PACK_DIRS、跨包异步边界 | 间接 | 中 | 私有 monorepo 无发版收益，纯加结构不加语义 |
| D 不动依赖只改测试 | 零 | 数百 MB | 零 | 无 | 反向：把失败写成规格 | 违反 R60 C1 / R61 D-001，publish 即事故 |

## 4) 推荐方案 A′ 落地要点（含负向约束建议）

1. `packages/embedding/package.json`：dependencies → optionalDependencies（优于 peerDependenciesMeta.optional：peer 要 store/cli 两层转发声明且 npm i -g 上 peer 安装行为更脆；optional 是 esbuild/rollup/nx 平台包行业标准，SO 74916906 交叉）。
2. `session-store.ts:23` / `consolidate.ts:10`：静态 import → `await import("@anysearch/embedding")` 包 try/catch（或 `createRequire().resolve` 探测）；缺席时 `embedText≡null`、`cosineSimilarity` 内联（Float32Array 点积，11 行）。
3. `apps/cli/tsup.config.ts`：external 追加 `"@anysearch/embedding"`（现注释纪律已保留 onnxruntime-node/sharp，同理由）。
4. `scripts/install-smoke.mjs`：新增断言——干净 prefix 安装后 node_modules 树不含 onnxruntime-node（glob 探测），`ans --version`/`doctor` 仍绿；有 key 时 doctor 输出向量臂状态行。把外部评审的净机场景变成 CI 红线。
5. 账本动作：Round-62 建档后 D 记录"ADR-0033 D2 revised（安装闭包子条款）"；CONTEXT.md 无需新词条（Embedding Circuit Breaker 语义自动覆盖"包缺席=臂缺席"）。
6. 负向约束：不动 better-sqlite3（硬依赖 + allowBuilds=false prebuilds 不变）；不引入新 npm 依赖（AST 断言走 Node stdlib）；守卫探测失败必须走遥测不许 throw。

## 5) 完整来源清单

| # | 标题 | 角度 | 贡献 |
|---|---|---|---|
| 1 | npm cli#7355 failed optional dependency builds should not prevent global install | Criticism/官方 | optional build 失败边界行为，Open |
| 2 | npm v12 approve-scripts 官方文档 | Official | npm i -g 无 allowScripts 落盘位置原文 |
| 3 | npm RFC-0000 package-distributions | Official | optionalDependencies = current best practice |
| 4 | esbuild Getting Started | Official | optionalDependencies + 部分降级是设计 |
| 5 | @huggingface/transformers registry manifest 4.2.0 | Official | onnxruntime-node/sharp 硬 dependencies 现行证据 |
| 6 | transformers.js#1164 onnxruntime-node 727MB | Criticism | 体量实测；v2→v3 optional→硬依赖回归史 |
| 7 | npm v12 install-scripts blocked 迁移文（byteiota） | Currency | 三管理器 allowlist 对比；pnpm allowBuilds 佐证 |
| 8 | pnpm Settings 官方文档 | Official | allowBuilds/ignoreScripts 语义 |
| 9 | npm cli#7355 + byteiota 双读（两轮） | — | 结论 1 双源闭环 |
| 10 | SO 74916906 optional vs peer-optional | Comparative | A′ 选 optional 的语义依据 |
| 本地 | grill-round-61/60 decision-ledger、ADR-0033/0061/0062、embedding/src/index.ts、store+cli package.json、tsup.config.ts、install-smoke.mjs、CONTEXT.md:191-197 | 实物 | 冲突检查与结论 4/5/7/8 代码级证据 |
| 本地 | ctx_search 召回 Round-57 D-006 五段决策门 | 知识库 | 结论 2 本仓库历史证据 |

## 6) 账本冲突显式声明

| 冲突点 | 性质 | 处置 |
|---|---|---|
| **ADR-0033 D2** | **唯一实质冲突**：兼容性结论仅在仓库内安装语境成立，未覆盖消费安装闭包 | A′ 与之冲突需修订：D2 标 revised，新增子条款"消费安装闭包中 onnxruntime-node 必须可选缺席"；D1/D3-D8 不动 |
| R61 账本 D-001..D-005（全部 current） | 无冲突——D-001 publish 顺延反而要求先解决安装闭包；T1-T5 票序不含依赖变更，A′ 作新票挂入 | 正向对齐 |
| R60 账本 D-001/D-003/C1（current） | 无冲突——"干净环境装→doctor→search"正是 A′ 守卫面；better-sqlite3 不动红线遵守 | 正向对齐 |
| CONTEXT.md 两词条 | 无冲突——"缺席降级 FTS-only"本是词条语义，A′ 从运行时延伸到安装时 | 正向对齐 |
| R62 账本 | 调研执行时账本骨架尚未含 D 记录（D-001 A+D 主题随后落盘）——D-001"拆弹"意图与 A′ 同向 | 正向对齐 |

**信息缺口**：① 未实测 npm i -g + optionalDependencies 在 npm v12 + 脚本全禁环境完整行为（npm#7355 证明 optional 非绝对安全，A′ 第 4 步断言即为此设）；② transformers.js 4.x 未恢复 onnxruntime optional 化（4.2.0 仍硬依赖），升级版本不能替代 A′。
