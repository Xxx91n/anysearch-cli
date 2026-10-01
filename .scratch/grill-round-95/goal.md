# Grill Round 95 — Goal（执行期）

## 主题
`fix-r95-eval-matrix-revision`——评测矩阵修订轮（corpus unfreezing + cn_code 契约处置 + delta 腿重跑读数）。三层分离：身份层（垂域专精）在役不动；机制层（prefer-capable 加权）formally-declined 不动；覆盖层（契约实做/评测仪器）为本轮主题。

## 账本
5 条全 current（decision-ledger.md，无断号无 revised）：D-001 主轴（B∩C 合题+纪律继承）/ D-002 f1105 原位降格+墓碑受控理由码+指纹滚动（语料 diff 仅一格）/ D-003 判读器机械面逐字不变仅 EXPECTED_FP+matrix@3 / D-004 匿名层探针先行+全量或 INCONCLUSIVE-instrument / D-005 票序 T1→T8+三记账裁量。

## 票序（D-005）
T1 语料修订（f1105 降格→墓碑+指纹滚动）→ T2 prereg-matrix.md 先于任何跑数落 commit（parent 须含 T1 diff）→ T3 判读器 EXPECTED_FP+matrix@3+selftest 复跑 → T4 LIMIT=4 匿名层探针（容量测量，非判读输入）→ T5 全量终读档或 INCONCLUSIVE-instrument → T6 单次终读 → T7 台账落账（closed+finding+carried_log+backlog 登记）→ T8 ADR-0096+CONTEXT 词条+轮报+交接（T7/T8 同轮闭环）。

## 数据源纪律
本轮唯一数据源=decision-ledger.md；结论不许只活在对话里；与账本冲突以账本为准并回报，禁静默改向。

## 显式范围外（负向）
prefer-capable 加权轴不动；r88-candidate status 不动（只追加 carried_log）；全语料契约体检/fundamental×cn_code 新格=backlog 不入本轮 diff；判据修订属 owner 未来重议轮；deprecate EOTP 用户亲触不代跑；无 tag/publish。

## 环境事实（执行期实证）
- `ANYSEARCH_ENDPOINT` 本机指向死回环 `127.0.0.1:20128`（R95 Q2 活查实证）；匿名层=覆写 `https://api.anysearch.com`+空 key（runner 子进程 env 透传）。
- 语料旧指纹 `7ac0a48e55cd7954`（matrix@2 期 57 格）；执行期新指纹见 prereg-matrix.md（56 格）。
- `WORKFLOW.md` §4.2 缺位（ADR-0092 D3 判死，GitButler skill 等价覆盖）——版本控制全走 `but`。
