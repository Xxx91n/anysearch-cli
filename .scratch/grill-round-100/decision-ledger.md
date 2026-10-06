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

---

## D-003 — ADR-0101 滤尺条文形态（fails 必填 / tier 字段+互斥 / sunset 义务挂收口半机检 / fraud-vs-style 由 tier 承载 + 四精化）

- **状态**：current
- **原问题**：Q3 — ADR-0101 封顶滤尺条文形态三子项：(a) kill-oracle 机器残余（A=schema 必填 fails 字段 / B=纯人审 / C=lint 谓词验真实性）；(b) 具名登记降级 info 居留位（A=锚条目 tier:red|info / B=deferred-registry documented_anchors / C=ADR 附录）；(c) sunset 退役判据形态（A=义务挂收口一行账 / B=纯条文 / C=全自动日落）。atomcode 深调后修正呈报，用户答「采纳」。
- **原回答原文**：「采纳」（对修正版 Q3：A+A+A+四精化——fails 条件必填+存量 5 锚回填回审；tier 默认 red 零迁移+pending_anchors∩tier:info=RED 互斥立法；sunset 只计生产 finding 半机检；fraud-vs-style 由 tier 承载 style 上限 info 档）。
- **规范化需求**：
  1. **`fails` 条件必填字段**：anchors.json schema 加必填 `fails`——机器验「字段存在非空+指向封闭具名故障类词表」，「故障真用户可见」留 ADR 准入人审（Meyer 相对性：存在性+指向性可机检、真实性不可机检）。**存量 5 锚回填**——全过一遍自家滤尺，某锚指不出故障即发现（滤尺回审首演）。
  2. **`tier: "red"|"info"` 字段**：默认 red→5 锚零迁移（Semgrep 旧值映射先例）；info 锚仍跑探针（观察不缺席=Coverity Audit 收容档先例）；档迁移须立法痕迹（ADR/账本挂账）。
  3. **互斥立法**：锚 ID 不得同时在 `pending_anchors` 且 `tier:"info"`——否则「坐席被 sunset 摘除、关票时 runner 升级不存在的锚」状态机漏洞（坐席 loophole 镜像）；runner 遇组合直接 RED（fail-closed，`anchor-unresolvable` 同型）。
  4. **sunset 义务挂收口**：每轮 closeout claims 段加「锚活性一行账」（各锚生产 finding 计数/距上次真 RED 轮数），**只计生产 finding，fixture kill 不算活性证据**（fixture kill=探针健康检查非活性；计入则判据自毁）；半机检——行存在性+数值与账本一致可机验（ratchet-recount 同构），「连续 N 轮」归因留人审（快照读数+活查裁断分级）；N 值立法不定、首适用时裁。
  5. **退役阶梯**：red→info→注册表摘除，全程走 schema（ESLint deprecated/replacedBy 先例——退役状态进 schema 不进外部文件）+立法痕迹。
  6. **fraud-vs-style 由 tier 承载**：style 语义检查器准入上限=info 档（阻断位只给已证明指向真实缺陷的检查器——ESLint meta.type 三分/Error Prone vet/Block 位 highest-confidence 先例）。
  7. **处死入账**：B（deferred-registry 塞终态降级=在升级通道表寄生降级通道，比特判更违 Avoid）/ C（只入 ADR 附录=运行时判定输入入史料=装饰）/ 全自动日落（N 无机判准）/ 纯条文 sunset（橡皮图章化实证）。
- **显式约束/负向需求**：
  1. `fails` 指向的「具名故障类」须封闭词表（与 vocab-registry 纪律同构），禁自由文本。
  2. 禁止把人读描述（constraint 散文）当机器判定位（labels/annotations 二分）。
  3. tier 迁移（red↔info、摘除）每次须立法痕迹——禁静默调档。
  4. sunset 一行账禁把 fixture kill 计入活性。
  5. N 值本轮不定——立法只立机制与裁断人位，数值留首次适用裁定。
  6. 沿账不扩：本票不动 pending_anchors 既有坐席语义（其修法归 cohesive 顺手项一，另裁）。

---

## D-004 — cohesive 三顺手项参数（坐席 Addendum 三件套+双读迁移 / tau 递归+AST 前门耦合+RED 拆双支 / 顺带约束）

- **状态**：current
- **原问题**：Q4 — cohesive 三顺手项参数。(Q4-a) 坐席 loophole Addendum 修法：A=三件套（结构化条目+masking info+限期 RED）/B=只加 info/C=只设限期/D=删坐席通道；(Q4-b) tau 递归+AST 机检耦合：A=AST 静态判定作排除清单机械前门/B=两票解耦/C=tau 目录级排除/D=不递归。atomcode 深调后修正呈报，用户答「采纳」。
- **原回答原文**：「采纳」（对修正版 Q4：A+A+三精化——坐席条目结构化 {anchor,reason,seated_at,review_by}+masking info+到期 RED+双读窗口迁移（旧串 seated_at:null 迁移日设限无豁免）；tau 递归 glob scripts/**/*.mjs+AST 只认 export const X_CODES=<字面> 形状+RED 拆双支（{可验证声明∧副作用}→RED；{存在性不可机验}→独立具名 RED）+{副作用∧无codes}→具名排除+info+tau-scan.mjs 排除通道首演；纯静态禁运行模块+typescript API+互斥沿 D-003）。
- **规范化需求**：
  1. **坐席 Addendum（修 ADR-0099 D4 既有层）**：pending_anchors 裸字符串→结构化条目 `{anchor,reason,seated_at,review_by}`（限期入 schema 非散文）；runner 对「open seat 下探针报 no-kill」出具名 masking info 行（漏洞从隐形降级升每跑可见）；seat 到期未关票/未具名续期→RED（限期=裁决日禁永悬——unicorn expiring-todo 先例：到期报 error 非 info；CODEOWNERS 反证：事件驱动失效须配时钟兜底）。
  2. **坐席迁移兼容**：双读窗口——runner 消费「结构化条目∪旧裸字符串」并集；旧串视同 `seated_at:null`→**迁移日设限**（存量不豁免到期 RED）；写端单写，旧形态被消费一次后改写，禁长期双写漂移。
  3. **tau 递归+AST 前门耦合**：glob 扩为 `scripts/**/*.mjs`（递归入域）；AST 静态判定作排除清单机械前门——三分类：①{AST 可验证 `export const X_CODES=<字面>` 声明 ∧ 顶层副作用}→RED（词表存在但不可机验，fail-closed）；②{词表存在性不可静态验证}（动态计算导出 `buildCodes()`/getter/运行时组装）→**独立具名 RED/候选**（与副作用判定解耦）；③{副作用 ∧ 无 codes}→具名排除候选+info 行（封闭排除清单仍须具名条目，AST 供准入证据）。
  4. **AST 违规集白名单收敛**：顶层 expression statement / side-effect import / top-level await / 非白名单 initializer call（白名单=Object.freeze/RegExp/字面构造类）；误报经济学——执法语境用窄判面+info 逃生门（webpack 黑名单默认只适合优化语境；ESLint no-unassigned-import/ruff INP001/PEP 420 窄判面先例；Rolldown 2026 激进收窄回归=假阴性代价≫假阳性）。
  5. **tau-scan.mjs 排除通道首演**：顶层 spawn launcher（import 即起子进程）=side-effect import+顶层 expression statement 双命中→具名排除条目（判据=无法命名空间注入，非 fixture 便利）。
  6. **顺带约束**：AST 判定纯静态禁运行模块（运行=引入同款副作用自相矛盾）；解析器用 workspace 既有 typescript API（packages pin ^5.6.0）不引新依赖；互斥立法沿 D-003（pending_anchors∩tier:info=RED，结构化后照条款生效）。
  7. **处死入账**：B（只加 info=可见不致命，实证装饰锚存活）/C（无结构化无从机验到期）/D（删通道违 D4 语义逼向暗门）；递归侧 B（解耦=每次扩域变人工裁定队列不可扩展）/C（目录级排除重开 ADR-0100 D3 封死的口子）/D（不递归=覆盖缺口制度化）。
- **显式约束/负向需求**：
  1. masking info 行须具名（哪个坐席掩盖哪个锚），禁泛泛一行。
  2. 坐席到期语义=RED 非 info（unicorn 先例）；到期计算错宁可 fail-loud 不可静默有效（K8s grant-born-expired 教训）。
  3. 禁运行模块证伪词表存在性（AST 静态唯一通道）。
  4. 排除清单准入仍须具名条目+AST 证据链，禁 AST 结果直写清单（条目是立法痕迹）。
  5. 沿账不扩：tau/*.py 不入域（非 .mjs）；AST 判定域不动深层语句（只顶层）。
