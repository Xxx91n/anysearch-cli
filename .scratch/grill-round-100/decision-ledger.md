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

---

## D-002 — T0 绿门清偿立法（instance 改述 + A 案双瓣 + §5 双绑 + reanchor 脚本；B/C/第四案处死入账）

- **状态**：current
- **原问题**：Q2 — T0 绿门清偿的机制立法。候选：A=land 序列义务立法（land 者同会话重锚 commit+post-land main 重验+§5 扩域）；B=prospective 时态标记 dissolved-on-land；C=纯 instance 修复不立类法；附带第四案盘点（but-id-only / lint 知情 land 事件）。atomcode 深调后修正呈报，用户答「采纳」。
- **原回答原文**：「采纳」（对修正版 Q2：a) R99 closeout Stack 行改述 `Stack（dissolved @ 2026-10-06）`；b) class=A 双瓣——义务瓣+检测瓣 `stack-orphaned-by-land`（新层须过自家滤尺，指名故障=sha-not-commit 第四漏检形态，滤尺判不配位则退纯义务瓣）；c) §5 签字硬项绑点扩到 post-land main tip 重验 + handoff-reanchor 一键脚本并入 A）。
- **规范化需求**：
  1. **instance 修复**：R99 closeout Stack 行改述 dissolved 变体——六死 SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）撤下机验面，capture 值保留为散文史料；branch=`r99-vocab-expansion` origin ref 缺席→GREEN，回弹断言（declaration-fact-conflict）保持激活。
  2. **A 案义务瓣**：「land ⇒ 同会话补重锚 commit（栈内全部活链 Stack 行改述 dissolved）」入 land 检查清单——义务归因因果方（land 是 SHA 重写制造者，expand-contract 的 contract 步纪律）。
  3. **A 案检测瓣**：新增谓词 `stack-orphaned-by-land`——「main 上存在含活链 Stack 行的 closeout 且其命名 branch 的 origin ref 缺席」判 RED；按修层/新层判据属**新层**（sha-not-commit 与其覆盖域相交不相含——land 保留 SHA 路径下 sha-not-commit 不咬此形态），故须以指名故障过 ADR-0101 封顶滤尺（指名=本轮实证漏检形态）；滤尺若判其不配位则降为纯义务瓣。
  4. **§5 签字硬项双绑**：①land 动作携带「重锚+验证」义务；②审计末笔验证绑点从「栈内 EXIT=0」扩到「post-land main tip 重验 GREEN」——pre/post 断言对象不同（candidate 合并树 vs 公开树）不可互替。
  5. **`handoff-reanchor` 一键脚本**并入 A 立法：改述+记 land 后 main SHA+落签字——A 的弱点是摩擦力非语义，迁移工具化配套。
  6. **处死入账**：B（dissolved-on-land——删除既有 declaration-fact-conflict 回弹方向=棘轮倒转；栈永不 land 则声明永久悬空无回收者=TUF 无 expires 同型）；C（第四次已实证，不立类法必有第五次）；第四案 but-id-only（违 R98「残留 but-id 假核验」Avoid 条款）与 lint 知情 land 事件（状态机搬进检查器=不可证伪）。
  7. **工业判例入账**：「写时为真随外部事件翻转」的声明——ADR supersession 双向链接 / K8s observedGeneration 校验代际（kubectl wait stale-condition 假绿实证）/ expand-contract contract 后置义务 / HTTP conditional validator 每次重验 / CT·TUF expires+inclusion proof——五例同向：声明须携带可复核证据+翻转须显式义务动作，而非读取方豁免。
- **显式约束/负向需求**：
  1. 检测瓣谓词新增须按 R99 纪律带成对证伪 fixture 且入 vocab-registry 注册（RED 码扩表走封闭通道）。
  2. dissolved 改述逐条对应原 Stack 条目，closeout-coverage 双向一致（ADR index 先例）。
  3. 禁止以「读取方豁免校验」方向修（B 案形态）；禁止删改既有 declaration-fact-conflict 回弹断言方向。
  4. reanchor 脚本是降摩擦配套，不替代义务立法本身。
  5. 沿账不扩：本票不修 closeout 外其他文档类型；审计末笔绑点扩展不改动既有栈内验证义务（双段并存）。
