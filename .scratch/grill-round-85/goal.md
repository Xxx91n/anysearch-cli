# Grill Round 85 — Goal（定稿）

## 主题
`fix-r85-delta-rerun-prefer-capable-readout`——delta 腿全量重跑 + prefer-capable 前置判读（evidence-only 轮，D-001）。为 defer-r83-prefer-capable-weighting 挂账供给唯一前置证据：再生 anysearch/vertical-delta@1 全量四面证据件→按预注册判读矩阵出 GO/NO-GO/INCONCLUSIVE 裁决→registry 注记状态迁移。加权实施不在本轮。

## 账本
4 条全 current（decision-ledger.md，无断号无 revised）：D-001 主轴 / D-002 预注册判读矩阵 / D-003 五票序+四处加固 / D-004 执行细节包。

## 票序（D-003）
T0 哨戒续班（dsh rc.3+ watch+#1764 挂账+CI 观测+锐评核账归档）→ T1 预注册件落盘（prereg-matrix.md 全矩阵+早停规则+判读脚本+输入指纹，commit 先于读数）→ T2 重跑执行（指纹断言 7ac0a48e+对照层先行仪器探针早停+instrument-health ordering）→ T3 确定性脚本判读+decision-record（四字段+operator 签认）→ T4 收口（GO=注记+跟进票/NO-GO=核销附判词/INCONCLUSIVE=显式 hold+量化锚；GO·NO-GO 立 ADR-0086）。

## 数据源纪律
本轮整理唯一数据源=decision-ledger.md；结论不许只活在对话里；与本轮无关的回忆不补录。

## 承继基线
- R84 垂域评测腿落地并审计 PASS（返修闭环，栈 r84-audit→r84-t4，基 acaaccb3）。
- 锐评第七轮核账完毕：四处方+小刀全回应，唯一未闭=用户侧 #1764（agent 不代办）。
- 痛点承继：构建信息专精 Agent CLI，遵循 AnySearch 垂直领域理念——本轮为 prefer-capable 挂账读数。
- 环境事实：ANYSEARCH_API_KEY 在场且 live 实测跑通（2026-09-27 探针），defer-r84-delta-quota-rerun 触发条件满足。

## 常驻哨戒承继
- dsh rc.3+ 版本线 watch；#1764 用户侧不代发；test-online-anysearch CI 腿观测；llm-init SSE flake watch。
- ANYSEARCH_ENDPOINT 用户配置域不录不代改。

## 显式范围外（本轮新增+承继不回潮）
- 本轮新增：prefer-capable 加权实施（GO 后另轮）/ 清障独立轮（boy-scout 搭车除外）/ peeking 二次读数 / p 值或显著性门禁 / 优先级调度序（需已注册先验）/ 跨文件 boy-scout / 工件混级 / INCONCLUSIVE 无具名触发。
- 承继 R84：LLM judge 进闸 / delta 显著性阈值 / 全 17 域浅摊 / 第二评测账册 / 断言落未立法语义 / 0 记 unknown / per-arm 独立门禁决策 / 融合级列进门。

## 遗留呈报项（grill 末复核）
- 判读矩阵三处设计声明须随档：0.8 阈≡单侧 α0.2 业务选择（低于平台默认 90–99%）；2-of-4 否决为误否决率控制插值（无直接文献先例）；per-domain 副列+2-of-4 为仓内自创设计（ADR 记首创非移植）。
- 调研缺口随档：KDD'18 GRE 全文未读（摘要+类比交叉）；Yahoo KDD16 未读；「配额窗口捕获」无强工业先例；DORA stabilize→scale 顺序论仅二手转述。
