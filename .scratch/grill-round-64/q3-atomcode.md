# Q3 atomcode 调研 — 残留三裁（g0010/g0008/longterm）（2026-09-16, grill-round-64）

## 执行摘要

推荐 **a/a/a**（置信度高，verdict 翻转为罕见情形含合成推理）。唯一需 ADR 补的精化：**「期望跟随现实」的改判必须区分『被测承诺面变化』与『被测质量回归』——前者才允许 re-spec**。

## 一、g0010 → a（实测后改判 abstain 再 promote）

工业心智模型：**金集是校准物不是 ground truth**——只在被测方承诺面内有效。

| 张力 | 原则 |
|---|---|
| 期望固定（测回归） | 承诺面**内**的现实变化→期望不动，改判即作弊（破坏 pass-rate delta 可比性） |
| 期望跟随现实 | 承诺面**外**的变化（第三方 provider 行为、corpus 消亡、dated URL supersede）→必须 re-spec，否则金集在测已不存在的分布（qdrant：material corpus changes 后重生成 qrels） |

g0010 属后者：MCP 官方 dated→latest 替换是外部文档方漂移，非质量回归。

**三个防自欺前置**（防 re-spec 沦为橡皮图章，对齐 waiver corroboration 纪律）：
1. live 复跑 ≥2 次（不同触发/间隔），确认 abstain 稳定非偶发；
2. failure_class 标外部漂移（如 external-doc-superseded），tombstone 注明——被测方对 off-domain 拒答行为是**正确工作**，与 LYING-class 区分；
3. 红利兑现：显式锚定为 live 级 docs-abstain 腿——g0007 是 zh stub，g0010 补 en/docs live 变体，形成双语拒答覆盖。

retire 浪费一个已裁决的域外拒答样本——棘轮下每条案例是稀缺覆盖。

## 二、g0008 → a（降格单宿主 promote）

**locale 聚簇的工业处置：先归因，再降断言粒度，不硬改问题。**

- mlaire 协议（arXiv 2605.07249）：**语义检索质量与 query-language 偏好是独立行为轴**（LPR 与 nDCG 弱负相关 Spearman -0.28~-0.47）——zh query 挤满 zh-localized 变体不是排序 bug，是 retriever 语言偏好行为本身。
- qrels 惯例：相关性锚定 query 真实意图——zh 问 pnpm monorepo tsconfig，pnpm.io 命中即满足意图；typescriptlang 是*希望额外得到*的多样性而非意图。
- c（en 改写）问题本质：**换了一个案例而非裁决这一个**——改写后 harvest 范围/意图/lang 全不同=retire 旧+新增。en 版若要覆盖走独立新案例 harvest 流程，不占 TTL 出口。

**对我原选项的修正**：hops:multi 并非「彻底放弃」——dimensions 数组保留观测（非断言）+tombstone 留谱系（qdrant：version the full evaluation setup 才能分清 regression vs dataset drift）。恢复 hops:multi 断言的正解是新案例。

failure_class 建议：`locale-clustering-suppressed-cross-host`。

## 三、longterm → a（本轮不用）

工业先例高度一致严格：pytest xfail 永久态是例外非常态；Trunk/Datadog/minware/Mill 收敛「quarantine is temporary / a queue not a graveyard」；无主流工具提供「永久隔离永不复查」常规出口。cap=1 = 把「永不复查」压缩到全账本一次的极端出口。

本轮 10 条全部可 promote/retire 清账，无一条满足「真不可修」（=被测方承诺面内+修复代价不可接受）。ADR 写明启用门槛：承诺面内+有 failure_class+书面理由。

## 冲突检查

无冲突。一处精化：LYING-class 与 g0010 改判的表面张力——LYING 指被测方声称支持却给错结果；g0010 是被测方**正确拒答域外**（abstain 本身是产品承诺被验证）。**充要条件成文建议：改判 expected 是 re-spec 而非作弊 iff 现实变化在被测方稳定承诺面之外 且 改判后案例仍断言一个真实产品行为**。反例：若断言对象本是 observational-only（非承诺），同漂移应 retire 而非改判。

## 信息缺口

- qrels 人工改判的形式化规则无一手文献，充要条件为合成；
- mlaire 仅摘要/highlights 级；
- g0008 en 版双宿主命中率无实测（若走独立新案例需先 re-harvest）。

## 辩证附注（呈报人评估）

- 「≥2 次复跑」针对 g0010 的 abstain 稳定性；flaky 路径漂移三条仍按 Q2 的 ≥5 次翻转率标准——两档复跑证据标准不同，别混。
- 「新增 golden 案例合法」（棘轮只管隔离集）与 Q2 复核一致；en 版双宿主若做是独立票。
