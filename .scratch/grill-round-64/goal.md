# Goal — grill-round-64（定稿）

## 主题（D-001）
T6 收口 + 10 条隔离金案例 TTL 裁决（expires 2026-10-14T19:02:29Z）。OIDC trusted publishing 欠条（due 0.0.4）不并入，登记为下轮候选主题。

## 裁决状态
D-001..D-007 全部 current，已随票入版本（.gitignore 白名单）。

## 裁决要点
- D-002：新增 mustHitPaths 页族断言层（子串+负例写死+容忍段声明）；8 条路径漂移迁移；≥2 字节级 exact 腿（自控 sentinel 优先）；stability_class 三级标注。
- D-003：g0010 实测后改判 abstain（live 级 en/docs abstain 腿）；g0008 降格单宿主；longterm 本轮不用（ADR 记启用门槛）。
- D-004：runner evidence 模式（EVIDENCE 四元组/exit0 覆写/RETIRE_CANDIDATE）+前置修 activeIds() 判定+fixture 一致性单测+分档复跑+CI observational corroboration。
- D-005：schema 四字段+schema_version:1 哨兵+migration provenance 块+ship-gate 三锚点+watch:true 重入回路。
- D-006：T1–T6 串行票序；不触发版本发布。
- D-007：ADR-0065 Closure evidence 四部；无「暂不裁决」出口，复跑不达档=retire。

## 实施约束（继承+新增）
- 账本=唯一事实源；publish/tag/push 外部副作用须用户当场授权。
- promote 必须复跑转绿；不重钉 provider 当前路径；不做隐式归一化。
- TTL 死线 2026-10-14——收口必须远早于到期。
- EXA_API_KEY 本机在场可跑 live evidence。
