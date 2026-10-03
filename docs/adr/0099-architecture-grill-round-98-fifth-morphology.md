# ADR-0099: Grill Round 98 — 第五形态：装饰性机器约束检测（闭锚注册表 + 行为消费验证 + 两枚自指钉）

R98 为声明-兑现缺口收口轮。R97 立了「声明须可机检」（形态一/三实现），R97 独立审计随即实证同族缺陷更深一层：**机器约束本身可以没有消费方**——`STATE_PREDICATE_REGISTRY` 声明但不被读、`reuse` 字段是字符串不解析、ratchet 计数只验整数不 recount、裸词枚举双源漂移、全扫未采集仍报 GREEN。ADR 宣称约束 ∧ 实现零消费 = 装饰声明，与「写入真但运行假」同构，属第五形态。正题立法：封闭锚注册表 + 行为消费验证探针，装饰即 RED。前置义务轨 R1~R8/R10（审计返工）先修后检，修复产物即首批锚的消费方（dogfooding）；B 轨 land 在实现期开工前执行（授权 D-001(c)）。

## Status

Accepted (grill round r98; 票序 T0→T5 per `.scratch/grill-round-98/handoffs/next-round.md` → `.scratch/grill-round-97/handoffs/next-round.md`). Ledger: `.scratch/grill-round-98/decision-ledger.md` (D-001~D-004, all `current`). Goal: `.scratch/grill-round-98/goal.md`.

## Context

门的可信度不只取决于喂入声明诚实（R97 已立法），还取决于**宣称的机械约束真被实现消费**。四族先例：mutation testing RIP 变异（变异体未被杀死=测试装饰）/ chaos steady-state / dead-man's switch / Pact CDC。通用死代码检测不可靠且范围失控（D-001 禁项④⑤），封闭锚注册表把靶面收为 schema 面。

## Decision

### D1 判定模型：行为消费验证为主，静态前检永不独立出 RED

检测器对**门禁代码自身**做受控失真注入（失真注册表/坏 reuse 指针/缺词表/假计数），运行真消费方，判 **kill / no-kill**：

- 注入失真 → 消费方产出预期 RED = **killed**（约束有活消费方）。
- 注入失真 → 消费方无反应 = **anchor-not-consumed** RED（装饰实锤，失效条件兑现）。
- 静态引用计数仅前检分流（「连测试引用都没有」速筛 info 行），**永不独立出 RED**——锚宣称的是机器约束、面向运行行为，终判必须是行为（knip production-mode 同构）。
- 重构/绕行边界的唯一机械判据 = 「fixture 是否仍产出预期 RED」；禁语义等价判断（防 NLP 复辟）。合法重构须走重锚仪式（理由 + 审计 + ratchet 可见重批计数）；未走仪式的重构双红（锚 RED + 消费缺失 RED）为 fail-closed 设计意图。

### D2 封闭锚注册表：schema + 两枚自指钉

`docs/enforcement-anchors.json`：每条目 `{id, subject, constraint, probe, invalidate}`——锚 ID / 宣称的机器约束 / 证伪 fixture 指针（`scripts/enforcement-anchor-probes.mjs` 导出函数名）/ 失效触发说明。扩表须改门禁代码 fail-closed（ADR-0098 D1 谓词注册表同构第二实例）。两枚自指钉：

1. **无 fixture 的锚条目 = 无法杀死的等价变异体 = 不准入表**——probe 名在探针模块不可解析即 `anchor-unresolvable` RED。
2. **fixture 未执行 / 未产出预期 RED → 注册表自身 RED**——runner 逐条执行探针并断言 killed；探针 throw / 返回 no-kill 即 RED。「传永远 GREEN 表绕过」由此钉兜底。

锚注册表文件本身不可读即 fail-closed RED（装饰检测器自身不能是装饰）。

### D3 宿主与注入：ship-gate 独立自检腿 + 注册表参数化

- **宿主**：ship-gate 独立自检腿 `enforcement-anchors`（`scripts/enforcement-anchors.mjs`，与 handoff-lint 腿平级注册）——锚指向门禁代码非 closeout 文档，代码面与文档面分腿管辖（「docs/adr 不入形态一靶」同一逻辑）。禁并入 handoff-lint；禁只挂单测套件（watcher shares fate with observed，测试被删即装饰回归无闸）。成本 O(锚数) 常数级。
- **注入**：`env.registry ?? STATE_PREDICATE_REGISTRY` 参数化（默认回退生产表；env.workflows/git/now 既定注入模式第五实例，`Object.freeze` 纪律不动）。缺省=生产表路径兼作第 6 个隐式 fixture。禁 monkeypatch（可变导出与 frozen 注册表语义正交）；禁复制判定核源码改注册表（双源维护=锚自变装饰）。
- **探针纪律**：探针只注入失真数据并观察消费方输出，不调用门禁内部私有路径；`probeExports` 自指解析（probe 名→模块导出）使「探针表漂移」自身成为可检对象。

### D4 ratchet 类首发锚：封闭 PENDING 位坐席

`anchor:ratchet-recount`（recount 类）与形态二同构——先 PENDING 坐席后 ratchet 升 RED。坐席机制：deferred registry 新增 `pending_anchors` 字段挂接锚 ID；runner 对坐席锚仍**执行探针**（观察不缺席）但输出 `skip` 而非 `fail`（`pending-anchor` 标注）——坐席即降级可见，关闭 deferred 票即自动升全量 kill 判定（ratchet 语义兑现，无第二通道）。

### D5 首批 5 锚（各配证伪 fixture 方准入表）

| 锚 ID | 宣称约束 | 探针失真面 | 首发类 |
|---|---|---|---|
| `anchor:predicate-registry` | `STATE_PREDICATE_REGISTRY` 为活体谓词词表 | 注入删 `unlanded` 条目的注册表 → state 腿须 RED | RED |
| `anchor:reuse-pointer` | `reuse` 指针按名解析 env 源 | 注入不可解析 reuse spec → 源须降级（workflows.ok=false） | RED |
| `anchor:ratchet-recount` | verbatim `reauthored` = reanchor_log recount | 声明计数与日志不符 / 缺仪式对 → claims 腿须出 problems | PENDING 坐席 |
| `anchor:bare-word-single-source` | 裸词扫描派生自活体谓词集 | 注入删谓词注册表 → 散文裸词须逃逸（漏报=双源实锤） | RED |
| `anchor:vocab-guards` | 全部 `*_CODES` 导出注册于 CODE_GROUPS | 注入假 `FAKE_CODES` 导出 → 守卫须点名 | RED |

锚 1/2/4 的真实消费方 = R1/R4/R3 修复产物（dogfooding）；锚 5 收 R96 审计 B3 词表守卫缺口（不收则首次扩表即复现同型装饰）。

### D6 生效域边界与负向需求

禁：裸「零引用→RED」；消费方登记契约（问题转移）；ADR 文本自动发现宣称约束；只在新增时检查（grandfathering 变体）；通用死代码检测（开放面检测留 Known-Risk）；猴补丁与源码复制注入。新锚自立法日起须携 fixture 方准入表；存量=封闭表内条目，无 grandfathering 面。

## Consequences

- ship-gate 新增 `enforcement-anchors` 腿：5/5 锚 consumer-verified 才放行；`anchor-unresolvable` / `anchor-not-consumed` 为封闭 RED 码。
- 判定核获 `env.registry` 注入参数——「唯一引用即自声明」在签名层面不再可能（S-5 根治）。
- deferred registry 获 `pending_anchors` 字段 + `defer-r98-anchor-ratchet-recount-seat` 首票；关闭票即锚升 RED，零代码改动。
- 双红设计意图须被知晓：合法重构未走重锚仪式 = 锚 RED + 消费缺失 RED 同现——首次触发成本此处预写，防误读 flaky。
- E2E 新增检测器自身失效覆盖：unresolvable 探针 / 不杀探针 / 坐席不阻塞 / 注册表不可读四格；断言数 351→360。

## Known-Risks

1. **开放面外约束逃逸**：闭表只覆盖已登记锚；未登记的「宣称-零消费」对仍可装饰存在。缓解=扩表走封闭通道（fixture 强制），全扫引用计数为 info 分流。开放面扩展示范票入 deferred registry。
2. **探针自身失真**：探针与被验代码共享模块时，探针退化可能掩盖消费缺失。缓解=探针只断言外部可观察 RED 面 + 自指钉②（不杀即红，探针死了也红）。
3. **双红初次触发成本**：合法重构未走仪式首触双红，修复动作=重锚仪式三步非改判据——成本已预写本条，防误读 flaky。
4. **注册表手写漂移**：JSON 锚表与探针导出可能名实漂移。缓解=`anchor-unresolvable` 探针名解析即红（自指钉①），漂移不可达稳态。
5. **锚表与 deferred 坐席交叉**：坐席票被误关/误开即升降级错位。缓解=`pending_anchors` 与 `pending_predicates` 同面字段，挂接/回落同一挂点，无第二通道。
