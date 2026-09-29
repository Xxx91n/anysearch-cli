# R90 Q2 — atomcode 调研归档（票序+commit 结构+桥处置票位）

> 调研时间：2026-09-29 05:27Z | batch:atomcode | 全文已入 ctx FTS 索引（source=atomcode），本档存核。

## 裁定

**推荐 A（八票序），Confidence 高**——含两处微调确认（均已在 A 案内）：T1 立法留轮首不挪收口；T3→T4 不设人工 soak 窗口，以同一验证批次（测试绿+引用面清零+rollback 单元闭合）作 cutover 判据。

## 分点结论

1. **桥处置选独票直接 cutover**：双注册并行期的工业价值=并行期可比对两边输出（LaunchDarkly shadow 段定义）；本案 mcp 桥与原生注册走**同一 HTTP IPC 后端**，字节恒等、并行期零信息增量，只剩工具面膨胀+路径歧义两真实成本。catio：「temporary infrastructure nobody is tracking has a way of becoming permanent」。双注册何时才值得：execute 体改写业务逻辑（非透传）或消费方不可控需灰度——本案皆否。
2. **拆桥并入 T3 违反迁移 commit 粒度惯例**：leanix atomic-commit 核心场景=「部署后只回滚一部分」；实施与退役是两个独立可回滚风险单元。T3=fix（加新路径）、T4=refactor（去旧路径）天然两票。
3. **expected-RED 闸位置（T2 先于 T3）是成熟序列**：TDD red/green RED isolation check+R68 Spike-Gated Ticket 同构。T4 安全性论证依赖 T3 测试绿——catio 退役退出条件：「no live traffic hitting legacy route / no consumers / rollback window closed」。
4. **T1 立法留轮首**：「规则先于行为」惯例——立法先于实施（预注册文化的立法-施工分层）。
5. **TC 条件票维持**：与 LaunchDarkly 六段迁移「显式判据触发推进」状态机同构；未目击不启不留痕。

## 辩证检验（四反对论据皆裁）

- soak 期再拆桥：不成立——soak 服务统计置信（dualwrite two weeks 案例），本案透传无统计量可积累；残余价值=「实施+退役不同票」A 已满足。变体 A′（T4 挂下轮首票）代价=双注册债过夜+熔断归属模糊——否，两行 patch 删除撑不起跨轮。
- T1 挪收口：不成立。唯一让步=T2 RED 彩排若发现判据无法表述，T1 可轮内 amend 措辞。
- T3→T4 验证窗口：判据型 cutover 分钟级即够（三布尔条件），非时间型 soak。
- 八票过细？：保持显式票位符合熔断审计需求，不合票。

## 对比矩阵（核）

A=退役风险低/revert 粒度最细/工具面归一无歧义/atomic-commit+Azure retirement-as-final-step 全对齐；B=coexistence 债（双写仅适用数据一致性可比对场景）；C=revert 最粗违迁移分离惯例；D 无更优结构。

## 来源

Azure Architecture Center strangler-fig（官方，含不适用条款原文）/ catio.tech 退役退出判据清单（原文）/ LaunchDarkly migration flags 六段状态机（官方原文）/ Unleash flag 清理指南（官方）/ Statsig flag cleanup（批评）/ leanix atomic-commits+r/git（社区）/ catapult.cx（佐证）/ R90 Q1 报告召回（知识库）。全文读 6。

## 信息缺口

dsh rc→stable 政策无公开文档（Q1 已呈报）；桥接退役时长无定量专文（定性推断，定量阈值=未来立法空位）；troccoli-ito 无可读文本单源降权。
