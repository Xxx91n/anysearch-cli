# Grill Round 100 — Decision Ledger

唯一事实源。状态值：current / revised / stale / deferred。

---

## D-001 — R100 本轮构成：「全做」合规形态（正题=元验证封顶 + T0 绿门清偿 + cohesive 三顺手 + 产品票触发器前置）

- **状态**：current
- **原问题**：Q1 — R100 本轮构成（正题裁定）。背景：main tip 992412d6 ship-gate 双平台红（sha-not-commit，六枚 capture 时值 SHA land 重写后死引用，同型红 main 第四次）；R99 审计交接三候选（坐席 loophole / tau 递归入域 / 零副作用 AST 机检）；锐评 #10 四处方（绿门先行 / ADR-0101 元验证封顶 / 产品票或发布冻结立法 / owner OTP）；用户答「我倾向全做」→ atomcode 深调后修正呈报，用户答「采纳」。
- **原回答原文**：「采纳」（对修正版 Q1：T0 残留轨=绿门修复 dissolved 改述+锐评 §5 审计签字硬项扩域；正题=ADR-0101 元验证封顶（三对应物交集滤尺+修层/新层判据+sunset 条款+fraud-vs-style RED 位保留）；cohesive 三顺手=坐席 Addendum 修法 / tau 递归入域 / 零副作用 AST 机检；(e) 选➀触发器前置——激活条件+deferred 滞留≤2 轮入 Consequences，approval-channel 仍 deferred）。
- **规范化需求**：
  1. R100 = 「1 正题 + 1 T0 残留轨清偿 + 3 cohesive 顺手项 + 0 平行正题」形态，五件事只一件是正题（ADR-0029 同子系统 cohesive 通道；R99 D-001「单轮单题+顺手段落」先例同构）。
  2. 正题 = **ADR-0101 元验证封顶立法**，滤尺=三对应物交集：①kill oracle=须指名用户可见产品故障，指不出者只登记（document）不入红（留「具名登记降级 info」中间态）；②ratchet sunset/retirement 判据——锚连续 N 轮未抓真 RED 且其故障面已被覆盖→具名降格/退役（N 立法不定值，首适用时裁）；③Meyer 相对性——ship-gate 为 fraud-detection 语义（宁漏勿误杀发布），style-checker 语义的元层不得占 RED 判定位。
  3. 修层/新层操作化判据：「删掉这个提议，现有哪个检查会在哪条产品故障上漏报？」——指向既有检查器=修层（不受滤尺审）；指向「没人防」=新层（受滤尺审）。
  4. T0 残留轨=绿门修复：closeout Stack 行六死 SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）按 **dissolved 变体语法**（R98 已立，ref 缺失即核验 GREEN、ref 复活即 declaration-fact-conflict）逐条改述 + 锐评 §5 项（审计签字硬项适用域扩至审计窗末笔 commit，机制细裁归 Q2）。
  5. cohesive 顺手项一：坐席 loophole 判「修层存活」——对 ADR-0099 D4 坐席立法作 Addendum 修法（候选：open 坐席探针不杀时出 info+限期/降格），不立新检查层。
  6. cohesive 顺手项二：`scripts/tau/` 递归入域（ADR-0100 D3 扫面域直接后续）。
  7. cohesive 顺手项三：受治模块顶层零副作用 AST 机检（ADR-0100 D3 已立纪律补机检牙齿——上轮法律执行收尾，非新层）。
  8. (e) defer-r72-dsh-approval-channel **本轮不激活**：ADR-0101 Consequences 写入触发器前置——「连续 N 轮 ship-gate 全绿 ∧ 本轮正题关闭 → T+1 激活」+ deferred 表滞留上限「唯一依赖已解除条目滞留≤2 轮，超期升为下轮候选正题第一优先」。
  9. atomcode 调研（置信度高）：滤尺首演已处死两个绿门修复候选——B `time-lagged-capture` 词表项（与 dissolved 指名同一故障=equivalent mutant）、C but-id 主键放宽（违 R98「残留 but-id 假核验」Avoid 条款）；判例入账本条。
- **显式约束/负向需求**：
  1. grill 中不动源码、不另设目标；实现只允许在 T 期票序内。
  2. 禁止把 (b)(c)(d) 任一立为平行正题；cohesive 条目须在 ADR-0101 内独立 Decision/条目记账。
  3. 坐席修法禁止「为坐席豁免另建监控新层」——那才是新层受滤尺审。
  4. 绿门修复禁用 time-lagged-capture 新词表项与 but-id 主键放宽（滤尺首演判例）；改述须逐条对应原 Stack 条目且保持 closeout-coverage 双向一致。
  5. sunset 退役判据本轮只立机制不定 N 值。
  6. 若未来改主意本轮激活 approval-channel：须独立实现票+具名申报混合轮切换+R99 D-001 否决理由以新证据显式覆写入账（推翻先例留痕）。
  7. 沿账不扩：不重开评测矩阵/不动 formally-declined/不追写冻结 claims/不发布不打 tag/活体谓词仍走 deferred/不裸删远端指针。
