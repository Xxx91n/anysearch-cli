# Q5 atomcode 调研 — 落地形态四要素（schema/留痕/锚点/watch）（2026-09-16, grill-round-64）

## 执行摘要

**推荐 A，四处微调**（置信度高）：
- (a) 留痕块命名避开 "tombstone"（Case Tombstone ADR=retire 侧账本内留痕），命名为 `migration` provenance 块；
- (b) eval-looks.json 根加 `schema_version: 1` 哨兵（一行成本留未来路径），不建迁移脚本——C 否决：无 breaking 变更不触发版本化阈值（jundago 变更分类表：加可选字段=无需 bump）；
- (c) watch 重入回既有 TTL 裁决通道，不新开裁决（否则成绕过 TTL 的续期漏洞）；
- (d) ship-gate 两条锚点顺手校验 migration 块存在性（8 条迁移案例留痕完整性机器校验）。

B 否决：promote 物理删除→reviews note 留痕物理丢失+caveat 判据停留文档层（两处独立缺陷）。

## 字段先例对照表

| 拟加字段 | 工业先例 | 先例形态 |
|---|---|---|
| mustHitPaths+mustNotHitPaths | Chromium TestExpectations | 前缀匹配与精确匹配分层共存，更具体期望覆盖更泛期望 |
| stability_class | Zalando @draft / openproxy schema stability / Hermes frozen fixture | fixture 显式标注稳定性等级 |
| failure_class | Datadog Flaky Tests Mgmt | broken（7天100%败）vs flaky 分类驱动不同处置路径 |
| watch:true | Tenki consecutivePasses | 观察计数字段驱动生命周期翻转（watch 是其逆命题） |

Harness quarantine 字段集佐证：机读核心字段与自由文本 meta 分离（meta「被处理逻辑忽略」）——B 的 note 字符串=把结构化数据降格进被忽略的 meta，迁移留痕需被 runner/gate 消费故必须一等字段。

## tombstone 落点（结构约束非偏好）

载体消去法：promoteEntry=entries.filter 物理删除→隔离账本内任何 tombstone 无载体。provenance vs audit-trail 分离（DSpace）：retire 留账本=内部事件日志；promote 的「原断言→新断言+漂移证据+裁决日期」是 golden 工件自身出处叙事→内嵌 golden 条目 metadata（Stella-Ops golden set metadata 同构）。迁移留痕行业形态：protobuf reserved tombstone、GraphQL @deprecated(reason)——在被保留工件上留结构化注释。

## 锚点机器化（四源收敛）

Axiom Studio：把审阅者凭信任接受的主张推进机器可校验门禁。SonarSource 质量门四要素（可度量判据+自动门+反馈回路+文档化）——caveat 判据缺自动门。新锚点与 c1/c2/c4 同构（存在性→持有者计数），成本=一次 fixture 扫描断言。ratchet 基线模式：基线快照+只降不升+显式收紧。

## watch 回路

Tenki consecutivePasses 正向闭环的逆命题；Datadog quarantine→30天 disable 分档同构；同 id∈baseline 合法与 ratchet 基线语义一致。**关键约束：重入后回既有 TTL 裁决机制，不新开通道**（防续期漏洞绕道）。

## 冲突检查

无实质冲突。ADR 须写明语义边界：「promote 的留痕落在 golden 条目 migration 块」（Case Tombstone 只管 retire 侧），否则未来 grill 撞「为什么 tombstone 有两种落点」的 LYING 风险。

## 信息缺口

- 「promote 即物理删除」语义无完全同构开源先例（Datadog 是服务端台账非文件台账）——tombstone 载体结论系相近先例外推；
- 字段级先例充分但匹配算子细节仍需实现期自行约束（承接 Q2 缺口）。

## 辩证附注（呈报人评估）

- 「载体外推」缺口可接受：结构约束本身是决定性的（文件里条目没了就是没了），先例只是佐证形态；
- schema_version 哨兵一行成本值得付；
- migration 块命名修正采纳——与 Case Tombstone 语义边界清晰。
