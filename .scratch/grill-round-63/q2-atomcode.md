# atomcode 调研 — Q2: con_add_then_noop 处置（2026-09-15, grill-round-63）

## 0) 执行摘要
**推荐 A**（decideOp 加无-embedding 分支，bestJac>theta_jac 判 noop），同一 round 内兑现注释承诺。Confidence 高——四板块工业惯例全部同向收敛。唯一保留项：theta_jac 取值需本地校准（业界区间 0.7–0.8 保守 / 0.5–0.6 激进；本仓库现有 0.4 是 update 门槛而非 dedup 门槛，不可混用）。

## 1) 事实面复核（先证伪）
用户陈述与代码逐条一致：decideOp（consolidate.ts:110-114）noop 唯一来源 bestCos>theta(0.90)；bestJac>0.4 仅参与 update 判定（需叠 contradiction）；:200 注释声称的 jaccard 兜底不存在，:213-214 cos 在 emb/l.embedding 缺席时恒 0。注释描述从未存在的**安全降级路径**——比一般漂移更重。runner 只桩 summarize/classify 两键，embedding seam 真调（集成测试在正常工作）。

## 2) 四板块结论
### 板块1：注释声称不存在的行为——心智模型
- Kernighan/Plauger 1974 第64条：'Don't comment bad code — rewrite it'；Clean Code ch.4：坏注释主动为害；Fowler Refactoring 2e：Comments 是 bad smell（除臭剂），除臭靠清底下代码。
- Kelly Sutton comment drift 定义精确命中；更糟的是注释描述从未存在的降级路径——读者/下一个 agent 会误以为“无 embedding 也有兜底”。
- agent 时代惯例：'stale comments as bugs'；注释与代码冲突时 agent 跟随代码——修注释（C/E）只消除警示不消除缺陷。
- 结论：欺骗级漂移修复优先级高于普通过时，因为它伪装了安全降级路径；兑现行为是唯一出路。
### 板块2：向量缺席降级 lexical 去重——先例与阈值
- hybrid 三策略（jaccard 快路径/embedding 慢路径/hybrid）是标准架构（theneuralbase，2026-04 验证）；embedding 缺席退回 jaccard 单跑=hybrid 退化形态。警告：双轨阈值要避免语义冲突（jaccard 0.85 + fallback 0.65 造成边界带）。
- jaccard 阈值区间（双信源）：保守 0.7–0.8（mbrenndoerfer），激进 0.5–0.6；nelhage/MinHash 佐证 0.7–0.8 工作点；语料 jaccard 分布常双峰（≈0 与 ≈1），中间阈值误判风险有限；theneuralbase 用 0.85。
- 落地建议：theta_jac 取保守端 0.7–0.85，必须与现有 0.4（update 门槛）显式区分文档化。语义差异必须写进 ADR：jaccard 只抓词面重复、抓不到 paraphrase——降级分支是**有损降级**，observational zone 应记 embeddingAbsent 计数（ADR-0060 D7 '排除/降级记录永不再 silent' 先例），而非无声替代。
- 治理一致性：无冲突；案例从“有网才绿”变“无网也绿的 embedding-absent 回归哨兵”，合 ADR-0057 hermetic-by-default。
### 板块3：stub 缝 vs 生产兜底选择标准
- 三信源收敛：stub 正当对象是 SUT 之外的协作方（外部服务/网络/时钟/未实现 LLM seam）；SUT 自己承诺的行为必须真代码兑现。
- Signadot：'mocked green build hides integration bugs'；agent 时代更糟（agent 只优化给定信号）。
- 本案应用：embedding 模型是外部依赖→可桩；“重复记忆判 noop”是 store 自己的核心契约→不可桩。方案 C 把“测试发现真缺陷”重新定义为“测试环境问题”，自废集成测试去伪能力；且与项目 Golden Entry Scope 分类法冲突（dedup 决策属管道契约本身）。
### 板块4：带病发布阻断线
- Chromium ReleaseBlock + GO_NO_GO.md 三档（Blocker/Major/Minor）：Blocker=invalidate safety/security/core functionality/对验证证据的信心；任何 Blocker 开着=No-Go；Conditional Go=Major/Minor 记 KNOWN_LIMITATIONS.md 带 owner+due date。K8s CI Signal（搜索层）：'jobs red, do not release'。
- 本案档位判据：① 无 HF 通道/FTS-only 是否属 0.0.1 受支持配置？embedText fail-open 暗示是→dedup 静默失效=核心功能缺陷+欺骗级漂移→Blocker→No-Go。② 若声明不支持，缺陷降 Major→B 可辩护，但注释与 fail-open 表述必须先改诚实。
- **B 的唯一可辩护形态：先修注释诚实，再按 Major 挂账。** 原样 B（只 README 挂账不改注释）=把 LYING 原文保留进发布。

## 3) 五方案对比矩阵
| 方案 | 修真缺陷 | 兑现注释 | 测试有效性 | 治理合规 | 成本/风险 |
|---|---|---|---|---|---|
| A | ✅ | ✅ | 案例变无网绿回归哨兵 | ✅ 完全兼容 | theta_jac 需校准；须在 observational zone 记 embeddingAbsent |
| B | ✅ | ✅ | 同 A | ⚠️ 仅当判非 Blocker | 发布叙事成本 |
| C | ❌ | ⚠️ | ❌ 测试在测 mock | ❌ 与 Golden Entry Scope 冲突 | 永久自废集成测试去伪力 |
| D | ❌ | ❌ | ❌ | ❌ 撞 D-005 断言（设计上就该撞） | 排除面扩容红线 |
| E | ❌ | ⚠️ | 案例保持无网红 | ⚠️ 行为面未处置 | 净机持续静默劣化 |
**结论：A 为唯一无冲突解；B 仅在“缺陷判非 Blocker”前提下是 A 的排期变体。**

## 4) 冲突检查（明示不折中）
- D-001：无冲突。A 是清障合并合格内容；应作为独立 Decision 条目落本轮 ADR + CHANGELOG Fixed。
- Declared Exclusion：无冲突（A 不碰排除集）；D 撞断言是机制在正确拒绝。
- LYING-Class：调研强化该分类法。
- 诚实提醒：A 的 jaccard 降级**改变产品行为**（无 embedding 下重复记忆开始判 noop）——release notes 须如实记载，observational zone 记 embeddingAbsent 使降级路径可审计。

## 5) 来源清单
1. Kelly Sutton — Comment Drift (kellysutton.com, 2017)
2. Prickles F5 — Self-Documenting Code (2026-04)
3. mbrenndoerfer — Deduplication (2026-03)：jaccard 0.7–0.8 保守/0.5–0.6 激进
4. The Neural Base — near-duplicate chunk detection (2026-04 验证)：jaccard/embedding/hybrid 三策略、0.85 工作值、边界带警告
5. nelhage — Fuzzy dedup MinHash (2024-07)：双峰分布
6. Fowler — Mocks Aren't Stubs (2007)
7. Signadot — Why Developers Shouldn't Write Mocks (2023/2026)
8. Chromium — Release Block Guidelines
9. ai-control-plane — GO_NO_GO.md (fitchmultz, 2026)
10. K8s SIG-Release CI Signal（搜索层引文，原文 404）

## 6) 信息缺口
- K8s CI Signal 原文 404，仅引文支撑（板块4 已有双原文独立支撑，不影响结论）。
- theta_jac 具体取值需本地校准：对 golden 数据集跑 jaccard 分布确认双峰分离度后取值，写进 ADR Decision。
- **FTS-only 是否属 0.0.1 声明支持面**——决定 Blocker vs Major 档位，是用户裁决点非调研可替答。
- runner→embedText 逐行路径未逐帧追踪（grep 证据已足）。
