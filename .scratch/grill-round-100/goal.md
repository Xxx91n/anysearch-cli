# Goal — Grill Round 100

- **正题：ADR-0101 元验证封顶立法**——封顶滤尺=三对应物交集：①kill-oracle 须指名用户可见产品故障，指不出者具名登记降级 info；②ratchet sunset 退役判据（N 立法不定值，首适用时裁）；③Meyer 相对性——ship-gate 为 fraud-detection 语义，style-checker 语义的元层不得占 RED 判定位（上限 info 档）。修层/新层操作化判据：「删掉这个提议，现有哪个检查会在哪条产品故障上漏报？」（D-001②③ / D-003 全条）。
- **T0 残留轨（critical-path 死锁清偿，先于一切 land）**：R99 closeout Stack 行六死 SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）改述 `Stack（dissolved @ 2026-10-06）`——独立栈 `r100-green-repair`，序列=owner 授权→push→CI 观测→land→but pull→同会话重锚 commit→ship-gate 复跑绿（D-001④ / D-002①②④⑤ / D-005①⑥）。
- **cohesive 三顺手项**（ADR-0101 内独立条目记账，非平行正题）：①坐席 Addendum 修层——pending_anchors 结构化 `{anchor,reason,seated_at,review_by}`+masking info+到期 RED+双读迁移；②`scripts/**/*.mjs` tau 递归入域+AST 前门三分类（可验证声明∧副作用→RED / 存在性不可机验→独立具名 RED / 副作用∧无 codes→具名排除+info）；③顺带约束——纯静态禁运行模块、typescript API 不引新依赖（D-004）。
- **(e) defer-r72-dsh-approval-channel 本轮不激活**：ADR-0101 Consequences 立触发器前置（连续 N 轮 ship-gate 全绿∧本轮正题关闭→T+1 激活）+deferred 滞留≤2 轮上限注记（D-001⑧）。
- 唯一事实源：`.scratch/grill-round-100/decision-ledger.md`（D-001~D-005 全 current）。
- 单题性守恒：正题名义归 ADR-0101；cohesive 条目独立 Decision 记账（ADR-0029 同子系统 cohesive 通道；R99 D-001 先例同构）。

## 范围外（沿账不扩展）

- 不重开评测矩阵 / 不动 formally-declined / 不追写冻结 claims / 不发布不打 tag / 活体谓词仍走 deferred / 不裸删远端指针 / no-pr·unpublished 语义不动 / approval-channel 本轮仍 deferred（仅触发器注记）。
- 锐评处方四（owner OTP / 弃用文案双空格）属 user 侧动作，备忘不代决。
- 滤尺首演判例已处死候选不复活：`time-lagged-capture` 词表项（与 dissolved 指名同一故障=equivalent mutant）、but-id 主键放宽（违 R98「残留 but-id 假核验」Avoid 条款）、dissolved-on-land 前瞻标记（B 案=删回弹方向棘轮倒转）、纯 instance 不立类法（C 案）。
- 本票不修 closeout 外其他文档类型；tau/*.py 不入域；AST 判定域只顶层不深语句。

## 风险登记（四件）

1. **滤尺首演自审**——ADR-0101 滤尺首演对象即本轮自身候选：`stack-orphaned-by-land` 谓词须以指名故障（sha-not-commit 第四漏检形态：land 保留 SHA 路径下其覆盖域与 sha-not-commit 相交不相含）过自家滤尺；判不配位则退纯义务瓣，判例入 Consequences。
2. **tau 排除通道首演**——`tau-scan.mjs` 顶层 spawn launcher（import 即起子进程）为排除清单首演条目；准入须具名条目+AST 证据链，误放宽即重开 ADR-0100 D3 封死的口子。
3. **坐席迁移窗口**——pending_anchors 裸串→结构化双读：旧串视同 `seated_at:null` 迁移日设限无豁免；写端单写、旧形态被消费一次后改写，禁长期双写漂移。
4. **land 授权挂点**——T0 critical-path 死锁：push/land 须 owner 授权窗，开工即具名申请；授权等待期内 T1 立法文本并行起草，commit/land 不早于绿门修复（红基禁落账）。

## T0 执行窗状态（2026-10-08 定锚）

- VC 全走 GitButler：`r100-grill-ledger`（任务书+账本+goal，unlanded）承载后续票；`r100-green-repair` 已 ff-land 上 main（8d1854e2）并注销。
- main tip 992412d6 红态确认：CI run 37344186467 sha-not-commit（六枚 capture SHA 随 land 重写、远端无对象）；本地残留对象使其呈 PENDING（stack-unavailable+ref-unavailable 降级遮蔽）——写时为真声明被 land 翻转即本轮立法靶症。
- 断言数基数 463/394 只升不降；判定核纯净、薄壳不写判定、正反成对 fixture、fail-closed 沿账执行。
- **T0 land 已落**：`r100-green-repair` ff-land @ `8d1854e2`（2026-10-08，origin/r100-green-repair 随 land 注销）；post-land 重验=main push 三跑（ci/ship-gate/native-smoke）+本地 ship-gate 复跑——land 记录见 `evidence/t0-land-record.md`。
- WORKFLOW.md 备忘：任务书所引「WORKFLOW.md §4.2 版本控制」实体已随 ADR-0092 D3 判死移除，VC 纪律以 GitButler skill + AGENTS.md 为准——具名申报此文档漂移。

no-changelog-entry: T0 为残留轨清偿非簿记轮次动作；CHANGELOG r100 节随 T3（并入 PR-C）落地
