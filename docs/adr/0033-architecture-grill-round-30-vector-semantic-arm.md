# ADR-0033: Grill Round 30 — Vector Semantic Arm (transformers.js local embedding + 4th RRF arm)

## Status

Accepted — 2026-08-29 (grill round 30, commit pending implementation round).

## Context

检索质量目前是 FTS5 关键词臂 + trigram 实体臂（ADR-0031）双臂 RRF（k=60）。行业 2026 年记忆系统共识（Mem0、Hindsight、Vespa、Elasticsearch）是 hybrid 检索必须带语义臂：FTS 召回受限于词面匹配，中英混合短句与释义型查询长期漏召回。本项目 ADR-0023 曾决策过向量检索但当时为控制范围推迟；本轮由 improve-codebase-architecture 热点扫描 + atomcode 行业调研交叉得出"语义臂是下一个最高 ROI 深化点"的结论。

硬约束：local-first CLI、better-sqlite3 预编译纪律（allowBuilds:false）、Node + TypeScript（pnpm 11.24.0）、fail-open（ADR-0009）、条件臂与健康遥测（ADR-0031 D4/D6）、eval 硬化闭环（ADR-0027/0028/0029）。

## Decision

**D1 (Q1 方向)：引入向量语义臂作为 RRF 第四臂。** 补齐 FTS5 召回缺口；走 hybrid 检索的行业标准路径；与 ADR-0031 条件臂框架同构。

**D2 (Q2 嵌入来源)：transformers.js 本地嵌入，不接远程 API。** 理由：local-first 信任模型（记忆内容不离本机）、fail-open 下远程 API 会把 recall 绑定到网络可用性、原生依赖 onnxruntime-node 有官方 Windows 预编译包（allowBuilds:false 兼容，落地前 spike 验证）。行业对照：Hindsight 默认本地嵌入、Mem0 本地形态 = Ollama 嵌入。 **（R62 D-002 修订：见 D9——嵌入来源不变，安装形态改为可选。）**

**D3 (Q3 模型选型)：Xenova/multilingual-e5-small（q8 量化，~60MB 常驻内存）。** 118M 参数 / 384d / 100 语种，C-MTEB 中文检索 59.95；`passage:`/`query:` 前缀约束必须收敛进单一 embedder 封装层（调用方不各自为前缀负责）。bge-m3 留档案为 v2 升级位（长记忆或免前缀诉求出现时，模型 ID 配置化切换）。bge-small-en-v1.5 明确否决：英文专用模型，中文记忆语义臂结构性失效。

**D4 (Q4 存储与计算)：SQLite BLOB 旁表 `memory_embeddings(memory_id, embedding BLOB)` + JS 全量余弦。** 千级规模 <1ms；零新原生依赖；向量自解释blob保留"导出后重灌 sqlite-vec/Vec1"的迁移通道。sqlite-vec 0.1.x 存储格式未冻结 + loadExtension ABI 风险 + 4 平台 CI 冒烟成本，千级规模无对应收益，否决；5 万+ 向量时重评。hnswlib/外置库永久否决（破坏单文件可拷贝承诺）。

**D5 (Q5 激活策略)：默认激活 + Circuit Breaker(n=3 连续失败则本轮进程语义变降级为 FTS-only)。** 权重 0.5 保守入场（"新臂保守"原则，与 Mem0 的 BM25-boost 形态地位不同——本项目语义臂是 recall expander 不是 booster）。k=60 保持。EMA 只做遥测不做开关（TOIS 2023 跨域不迁移纪律）；意图路由分流留二期。CB 状态与臂命中率写遥测。

**D6 (Q6 写入时机)：adjudicateMemory 落库时同步嵌入；嵌入失败则写库成功但记 pendingVectors 标记，用 `ans memory backfill-vectors`（幂等，--dry-run）统一回填存量与失败残留。** 写侧与读侧共享同一枚 Circuit Breaker。行业三参照系（Mem0/Hindsight/Zep）一致认为嵌入属写路径；arXiv 2606.06448 判据（构造时间 < 会话间隔则同步无害）在本项目规模成立。回填命令双重职能：存量回填 + 未来模型升级重嵌入。

**D7 (Q7 eval gate 分层)：防回归 gate 立即绑死，增益阈值观测一轮再固化。**
- 防回归（fail-closed，立刻生效）：融合后 Rank-of-Relevant 不得劣于 FTS-only 基线（ADR-0028 D2 确定性断言机制直接复用），防"向量稀释 FTS"回归。
- 增益阈值（观测期）：首跑结果即基线（ADR-0027 D9 Baseline Refresh Discipline），观测 1 个发布轮后经 review 判定落 gate。39 例样本的 MDE 过大，提前绑阈值会误报。
- 遥测三件套（臂命中率 / pendingVectors / CB 状态）：告警不 gate，数据回流 golden 防集子腐烂。


### D8 (implementation amendment): arm provenance + weak-evidence assertion migration (r79 audit, option A+B)

The 41-case eval exposed a topological conflict D1-D7 did not cover: the vector arm legitimately recalls near-answer distractors with cosine 0.84-0.87, fully overlapping the positive-case band — a static threshold cannot separate them (measured via probe). Aligning with LongMemEval / MemBench / CRAG, the unanswerable assertion migrates from retrieval-layer zero-hit (expectEmpty) to evidence semantics:

- A: retrieval stays recall-only; the refusal decision belongs to evidence semantics, not retrieval.
- B: every hit carries `arms` provenance; a hit present only in the vector arm is weak evidence — the abstain signal for the answer layer (Sufficiency Gate consumers), at zero new dependencies.
- Runner: `expectAllWeak` asserts the unanswerable slice; `expectMaxCount` counts strong (FTS-armed) hits only; unanswerable-slice metrics exclusion keys off both `expectEmpty` and `expectAllWeak`.
- Rejected: C (reranker) — violates the zero-new-native-dependency constraint; candidate for v2.

### D9 (decision revision, R62 T3 / ADR-0063): vector arm is optional at install time

R62 实测（q2 调研 + npm 行为矩阵）发现 D2 落地形态与 npm v12 安装脚本默认禁用冲突：
onnxruntime-node 的 postinstall 下载 ~728MB 运行时，在 npm v12 全局安装下必然失败或挂起——
基础 CLI 安装被向量臂绑架。修订（不 Supersede，仅收窄 D2 的安装面含义）：

- `@anysearch-cli/embedding`（store 侧）与 `@huggingface/transformers`（embedding 侧）均降为
  `optionalDependencies`；三个应用包的 bundler external 统一追加 `@anysearch-cli/embedding`。
- 安装闭包（Install Closure）承诺：`npm i -g @anysearch-cli/cli` 的基础闭包**不含 onnxruntime-node**；
  install-smoke 以 `--omit=optional` 净装断言该不变量。
- 缺席语义合法化：embedding 缺席是 supported FTS-only 状态——`embedText ≡ null`、
  写路径仍 fail-open 记 pendingVectors、`vectorTelemetry().absent === true`、
  doctor 以 SKIP 行报告（与缺失 provider key 同语义）。守卫模块 `store/src/embedding-arm.ts`
  是包缺席的唯一入口；`cosineSimilarity` 内联（纯数学，~6 行），解除纯函数对可选包的静态依赖。
- D2 其余裁决（本地嵌入、不接远程 API、local-first 信任模型）全部保留。

## Consequences

- `<1ms` 检索延迟目标（千级）成立；首条嵌入冷加载 ~1-2s 一次性成本由长驻进程吸收。
- 新增包间边界：`packages/embedding`（embedder 封装 + CB）被 store（写路径）与 retriever（读路径）共同依赖；模型 ID / 量化档 / 前缀三常量集中在该包配置出口。
- 新遥测字段进入 ship-gate 报告；ADR-0032 的"merge telemetry report-only"先例延续。
- onnxruntime-node 是本项目第二个原生依赖，其 allowBuilds:false 兼容性是落地前强制 spike（风险已记录）。
- 向量臂上线后 golden cases 需新增中英混合语义等价用例（Q3 缺口已记录）。

## Implementation Plan

1. spike 验证 onnxruntime-node 在 allowBuilds:false 下免编译安装（红线条款，不过即停）。
2. `packages/embedding`：pipeline 懒加载单例 + `embedText(text, role)` 前缀 + mean pooling + L2 normalize + CB(n=3)。
3. migration：`memory_embeddings` 旁表 + 回填扫描视图。
4. 写路径：adjudicateMemory 内同步嵌入，失败置 pendingVectors 标记。
5. `ans memory backfill-vectors [--dry-run]`：幂等回填 + 遥测。
6. RRF 第四臂接线（weight=0.5, k=60）+ CB 降级路径 + 遥测字段。
7. eval：语义臂 golden 用例 + 防回归 gate + 增益观测记录。
8. ship-gate 全绿（check/build/test/ship-gate/CLI --help）。

## Acceptance

1. 嵌入服务在无网络环境下产出确定性向量（同输入同向量，误差 <1e-6）。
2. CB 连续 3 次嵌入失败后 recall 自动降级为 FTS-only，且遥测可读。
3. `backfill-vectors` 幂等（重复执行不产生重复行/无副作用），--dry-run 零写入。
4. 融合臂 Rank-of-Relevant 不劣于 FTS-only 基线（ship-gate fail-closed 断言）。
5. 嵌入失败时写库成功且该记忆可通过回填命令事后补全。

## Research Sources

- transformers.js 官方文档与 Hugging Face Xenova/multilingual-e5-small 卡（quantized 版就绪）。
- BAAI bge-small-en / bge-m3 model cards；C-MTEB 中文榜（e5-small Retrieval 59.95）。
- sqlite-vec（asg017）0.1.x 存储格式说明与 issue#25 roadmap；SQLite 官方 Vec1 扩展（2026 新增，跟踪位）。
- Hindsight 架构公开文（本地默认嵌入 + 向量独立存储）；Mem0 local companion（Ollama 嵌入）；Zep write-path embedding。
- arXiv 2606.06448（记忆构造时间与会话间隔判据）。
- Atlan / Statsig shadow→promotion 模式；Galtea / Confident AI "检索配置变更即 gate"。
- 本项目 ADR-0009 fail-open、0023/0027/0028/0029/0031 既有决策（均交叉核验）。
- atomcode 调研 resume 链：92aac6bd / 46632138 / 08b51fc4（Q2-Q7 五轮串行，三引擎双源交叉，Exa 429 回落 Tavily+AnySearch）。
