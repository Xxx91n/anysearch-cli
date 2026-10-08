# ADR-0101: Grill Round 100 — 元验证封顶（封顶滤尺三交集 + 修层/新层判据 + 坐席 Addendum + tau 递归/AST 前门 + deferred 触发器）

R100 为治理栈的封顶立法轮。锐评第十轮点名「四轮元验证、四只同型自咬尾巴」——每一轮为上一层检查器立规矩、每一层检查器带同型缺陷出生；同期 main tip 第四次以「记录的记录」形态红（sha-not-commit 漏检）。R100 正题 = 给元验证栈封顶：新增元层必须通过「三对应物交集」滤尺准入，否则不立项。

## Status

Accepted (grill round r100; 票序 T0→T4 per `.scratch/grill-round-100/handoffs/next-round.md`). Ledger: `.scratch/grill-round-100/decision-ledger.md` (D-001~D-005, all `current`). Goal: `.scratch/grill-round-100/goal.md`.

## Context

R100 轮次构成 = 「1 正题 + 1 T0 残留轨清偿 + 3 cohesive 顺手项 + 0 平行正题」全做形态（原 grill D1 降为 Context 记账，ADR-0029 同子系统 cohesive 通道；R99 D-001 先例同构）：

- **正题** = 本 ADR 的封顶立法（D2/D3/D5/D6/D7 五件）。
- **T0 残留轨** = 绿门清偿：main tip `992412d6` ship-gate 双平台红——R99 closeout Stack 行六枚 capture 时值 SHA 随 land 重写注销成死引用（sha-not-commit），同型红 main 第四次（R79 index stale → R85 claim path → R87 孤儿 SHA → R99 sha-not-commit）。修复=独立栈 `r100-green-repair` 将 Stack 行改述 dissolved 变体（R98 已立语法：ref 缺失即核验 GREEN、ref 复活即 declaration-fact-conflict）。
- **cohesive 三顺手项** = D5 坐席 Addendum（修 ADR-0099 D4 既有层，不立新层）/ D6 tau 递归入域（ADR-0100 D3 扫面域直接后续）/ D6 零副作用 AST 机检（ADR-0100 D3 已立纪律补机检牙齿——上轮法律执行收尾）。
- **原 grill D4（`stack-orphaned-by-land` 谓词立法）按独立 supersede 判据拆分**：谓词本体属 T0 轨执行产物（PR-B 检测层），其滤尺首演判例入 Consequences——本 ADR 正文不为其立法。

## Decision

### D2 封顶滤尺三交集（Meta-Cap Filter）

新增元验证层（检查检查器的检查器）立项须三条件交集，缺一不立项：

1. **Kill Oracle（`fails` 必填）**：候选检查器须指名它防止的**用户可见产品故障类**——指向封闭具名故障类词表，机器验「字段存在非空+指向封闭词表」；「故障真用户可见」留 ADR 准入人审（Meyer 相对性：存在性+指向性可机检、真实性不可机检）。指不出者只登记（document）不入红——留「具名登记降级 info」中间态（`tier: "red" | "info"`）。
2. **Ratchet Sunset（退役判据）**：锚连续 N 轮未抓真 RED 且其故障面已被覆盖 → 具名降格/退役（red→info→注册表摘除阶梯，走 schema+立法痕迹）。**N 立法不定值，首适用时裁**；sunset 义务挂收口——每轮 closeout claims 段加「锚活性一行账」（各锚生产 finding 计数/距上次真 RED 轮数），**只计生产 finding，fixture kill 不算活性证据**；半机检——行存在性+数值与账本一致可机验（ratchet-recount 同构），「连续 N 轮」归因留人审。
3. **Meyer 相对性（fraud-vs-style）**：ship-gate 为 fraud-detection 语义（宁漏勿误杀发布），style-checker 语义的元层不得占 RED 判定位——style 语义检查器准入上限=`tier: "info"`（ESLint meta.type 三分/Error Prone vet/Block 位 highest-confidence 先例）；阻断位只给已证明指向真实缺陷的检查器。

配套互斥立法：锚 ID 不得同时在 `pending_anchors` 且 `tier:"info"`——否则「坐席被 sunset 摘除、关票时 runner 升级不存在的锚」状态机漏洞（坐席 loophole 镜像）；runner 遇组合直接 RED（fail-closed，`anchor-unresolvable` 同型）。

### D3 修层/新层判据（Mend-vs-New Criterion）

「删掉这个提议，现有哪个检查会在哪条产品故障上漏报？」——指向既有检查器者=**修层**（amend 既有检查器，不受滤尺审）；指向「没人防」者=**新层**（受 D2 滤尺审）。本轮应用判例：

- 坐席 loophole（open seat 可掩盖装饰锚）→ 修层存活：对 ADR-0099 D4 坐席立法作 Addendum 修法（D5），**禁止「为坐席豁免另建监控新层」**——那才是新层受滤尺审。
- `stack-orphaned-by-land`：sha-not-commit 与其覆盖域相交不相含（land 保留 SHA 路径下 sha-not-commit 不咬「closeout 在 main 上 + 活链 Stack 行 + branch 无 origin ref」形态）→ 判**新层**，以指名故障=本轮实证漏检形态过 D2 滤尺；滤尺若判不配位则退纯义务瓣。

### D5 坐席 Addendum（修 ADR-0099 D4 既有层）

- **结构化条目**：pending_anchors 裸字符串 → `{anchor, reason, seated_at, review_by}`（限期入 schema 非散文）。
- **Masking-Surfaced**：runner 对「open seat 下探针报 no-kill」出具名 masking info 行（哪个坐席掩盖哪个锚）——漏洞从隐形降级升每跑可见，禁泛泛一行。
- **Seat Deadline（坐席限期）**：seat 到期未关票/未具名续期 → RED（限期=裁决日禁永悬——unicorn expiring-todo 先例：到期报 error 非 info；CODEOWNERS 反证：事件驱动失效须配时钟兜底）。到期计算错宁可 fail-loud 不可静默有效。
- **双读迁移窗口**：runner 消费「结构化条目∪旧裸字符串」并集；旧串视同 `seated_at:null` → **迁移日设限**（存量不豁免到期 RED）；写端单写，旧形态被消费一次后改写，禁长期双写漂移。

### D6 tau 递归入域 + AST 前门三分类

- **递归入域**：vocab-scan glob 扩为 `scripts/**/*.mjs`（`scripts/tau/` 子目录入域——ADR-0100 D3 扫面域直接后续）。
- **AST 静态判定作排除清单机械前门**（修层/新层判据下与递归耦合，防「每次扩域变人工裁定队列」）：
  1. {AST 可验证 `export const X_CODES=<字面>` 声明 ∧ 顶层副作用} → **RED**（词表存在但不可机验，fail-closed）；
  2. {词表存在性不可静态验证}（动态计算导出 `buildCodes()`/getter/运行时组装）→ **独立具名 RED/候选**（与副作用判定解耦）；
  3. {副作用 ∧ 无 codes} → **具名排除候选 + info 行**（封闭排除清单仍须具名条目，AST 供准入证据；判据=「无法命名空间注入」，非 fixture 措辞）。
- **AST 违规集白名单收敛**：顶层 expression statement / side-effect import / top-level await / 非白名单 initializer call（白名单=Object.freeze/RegExp/字面构造类）。窄判面+info 逃生门（ESLint no-unassigned-import/ruff INP001/PEP 420 窄判面先例）。
- **tau-scan.mjs 排除通道首演**：顶层 spawn launcher（import 即起子进程）=side-effect import+顶层 expression statement 双命中 → 具名排除条目（判据=无法命名空间注入，非 fixture 便利）。
- **顺带约束**：AST 判定纯静态禁运行模块（运行=引入同款副作用自相矛盾）；解析器用 workspace 既有 typescript API（^5.6.0）不引新依赖；互斥立法沿 D2（pending_anchors∩tier:info=RED，结构化后照条款生效）。

### D7 负向边界 + deferred 触发器修订

- **负向边界**：不重开评测矩阵 / 不动 formally-declined / 不追写冻结 claims / 不发布不打 tag / 活体谓词仍走 deferred / 不裸删远端指针 / no-pr·unpublished 语义不动。
- **defer-r72-dsh-approval-channel 本轮不激活**（R99 D-001 否决沿账；若未来改主意须独立票+具名申报混合轮切换+R99 否决理由以新证据显式覆写入账）。
- **触发器前置修订（入 Consequences 机制，T3 落 deferred-registry 注记）**：激活条件=「连续 N 轮 ship-gate 全绿 ∧ 本轮正题关闭 → T+1 激活」；deferred 滞留上限=「唯一依赖已解除条目滞留≤2 轮，超期升为下轮候选正题第一优先」。

## Consequences

- **滤尺首演判例（equivalent-mutant）**：D2 滤尺首演即处死两个 T0 修复候选——B `time-lagged-capture` 词表项（与 dissolved 指名同一故障=equivalent mutant）、C but-id 主键放宽（违 R98「残留 but-id 假核验」Avoid 条款）；第四案盘点处死 but-id-only（同 Avoid 条款）与 lint 知情 land 事件（状态机搬进检查器=不可证伪）。B 案 dissolved-on-land（删 declaration-fact-conflict 回弹方向=棘轮倒转；栈永不 land 则声明永久悬空无回收者=TUF 无 expires 同型）与 C 案纯 instance（第四次已实证，不立类法必有第五次）同处死入账。
- **T0 修复引用**：`r100-green-repair` 栈改述 `Stack（dissolved @ 2026-10-06）`——capture 值留散文史料逐条对应原条目、closeout-coverage 双向一致、回弹断言保持激活。
- **工业判例入账**：「写时为真随外部事件翻转」的声明——ADR supersession 双向链接 / K8s observedGeneration 校验代际 / expand-contract contract 后置义务 / HTTP conditional validator 每次重验 / CT·TUF expires+inclusion proof——五例同向：声明须携带可复核证据+翻转须显式义务动作，而非读取方豁免。
- **义务瓣立法痕迹**（T0 轨执行，PR-C contract 步）：land ⇒ 同会话补重锚 commit 入 land 检查清单；§5 审计签字硬项绑点扩「post-land main tip 重验 GREEN」（pre/post 断言对象不同——candidate 合并树 vs 公开树，不可互替）；`handoff-reanchor` 一键脚本（改述+记 land 后 main SHA+落签字）为降摩擦配套，不替代义务立法本身。
- **sunset N 值留空**：立法只立机制与裁断人位，数值留首次适用裁定。
- **schema 迁移（PR-A）**：anchors.json `fails` 条件必填+存量 5 锚回填（滤尺回审首演——指不出故障即发现）+`tier` 默认 red 零迁移+互斥+坐席结构化+双读窗口+runner/探针消费方。
- **断言数只升不降**（463/394 基数）；判定核纯净、薄壳不写判定、正反成对 fixture、fail-closed 沿账。

## Known-Risks

1. **滤尺首演自审**：`stack-orphaned-by-land` 谓词若滤尺判不配位则退纯义务瓣——判例已预入账，不视为回退。
2. **AST 窄判面漏报**：窄违规集以漏报换误报率（执法语境经济学）——info 逃生门兜底，季度审。
3. **坐席迁移窗口漂移**：双读并集期旧串残留；缓解=写端单写+消费一次即改写。
4. **sunset 首适用裁量**：N 值留空依赖首次适用裁定质量；缓解=机位先行（一行账行存在性机验）。
