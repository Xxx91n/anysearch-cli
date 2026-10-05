# ADR-0100: Grill Round 99 — vocab-guards 扩域至全 scripts/（逐模块注册表 + glob 顶层枚举 + 逐模块证伪）

R99 为第五形态检测器的开放面扩域轮。R98 立了闭锚注册表 + 行为消费验证（ADR-0099），但其 Known-Risk 1 明记「开放面外约束逃逸」：闭表只覆盖已登记锚，未登记的「宣称-零消费」对仍可装饰存在。R99 正题 = 把 `anchor:vocab-guards`（「全部 `*_CODES` 导出注册于 CODE_GROUPS」）从单模块（`scripts/handoff-lint-verdict.mjs`）扩域至全 `scripts/` 顶层——即 ADR-0099 Known-Risk 1 的首张扩表示范票，封闭扩表通道（新锚携证伪 fixture 方准入表）首演。

## Status

Accepted (grill round r99; 票序 T0→T4 per `.scratch/grill-round-99/handoffs/next-round.md`). Ledger: `.scratch/grill-round-99/decision-ledger.md` (D-001~D-003, all `current`). Goal: `.scratch/grill-round-99/goal.md`.

## Context

第五形态的判据是「ADR 宣称机器约束 ∧ 实现零消费 → RED」。R98 的 `anchor:vocab-guards` 只在一个模块上消费：`probeVocabGuards` 用 `unregisteredCodeExports(verdictModule)` 校验 verdict.mjs 自身的 `*_CODES` 导出。这留下一个结构性盲区：**扫面外的 `*_CODES` 导出**（新模块、新扫面腿）不受任何守卫，其词表可静默漂移而不出信号——即 knip 类工具 FAQ 固有缺陷「清单维护者忘记更新时无任何信号」的同型制度化风险（Anchor Coverage Gap）。

R99 先修后检实证：扩域前盘点发现 **3 个扫面外导出**——`scripts/enforcement-anchors.mjs` 的 `ANCHOR_RED_CODES` / `ANCHOR_SKIP_CODES`、`scripts/eval-integrity-contract.mjs` 的 `SHIP_OVERRIDE_REASON_CODES`。它们已经是受治理的词表（各自在文件内 `Object.freeze`、被 emit/消费），但未登记于任何注册表。扩域落地当轮预计首抓真 RED——这属设计内（ADR-0099 Consequences 已预写双红解读纪律）。

## Decision

### D1 正题定界与开放面扩表示范票合一

R99 正题 = `anchor:vocab-guards` 扩域至全 `scripts/` 顶层，与「开放面扩表示范票」（`defer-r98-anchor-open-surface-demo`）**合一**：扩域本身即该示范票的兑现，不另立平行票。扩域条目携证伪 fixture 方准入表（自指钉①沿用）；runner 对不可解析 probe 即 `anchor-unresolvable` RED。顺手段落（「探针无孤儿」反向覆盖断言 + 三钉对抗演练）以 cohesive item 入本 ADR（ADR-0029 同子系统），非平行正题。

### D2 注册架构：vocab-registry 纯数据叶 + 逐模块分组 + 寄居判定核禁令

新建 `scripts/vocab-registry.mjs` **纯数据叶模块**（零 import、`Object.freeze`），逐模块分组 `CODE_GROUPS = { verdict, anchors, evalIntegrity, ... }`。verdict.mjs 现 `CODE_GROUPS` 迁入（根治「注册表寄居判定核」存量结构债）。

- **单向依赖零循环**：受治模块（被扫面的 .mjs）**不回 import 注册表**；注册表不 import 受治模块。判定核（verdict.mjs）保持零 import 纯核。
- **寄居判定核禁令**：注册表不得寄居判定核（`verdict.mjs` 内 `CODE_GROUPS` 为存量结构债，本 ADR 清偿）。
- **高摩擦=设计意图**：新增词表须改注册表 + 门禁代码（封闭通道），非可用性缺陷（ADR-0099 Known-Risk 1 缓解同构）。

### D3 扫面枚举：glob 顶层 + 封闭排除清单 + 顶层零副作用立法 + 漂移 info 降级

薄壳 glob `scripts/*.mjs` **顶层不递归**（`scripts/tau/` 子目录不入域，实测零 `*_CODES` 无差）→ 动态 `import()` 为命名空间数组 → 纯核逐模块断言。

- **封闭排除清单判据 = 「无法命名空间注入的文件」**（`.ts` / `.py` 等无法 ESM 命名空间注入者），**非「fixture」措辞**。
- **受治面顶层零副作用纪律立法**：glob + import 会执行扫面内 `.mjs` 顶层代码；无纪律则枚举器成新故障面。受治模块顶层只准声明（数据/函数导出），禁 I/O 与副作用。
- **漂移检出降级为 info 行**：排除项与探针导出面交叉验证，漂移出 info 非 RED（守 R98 D-002 禁裸零引用出 RED）。
- **禁注册表内封闭 modules 清单**：清单维护者忘更新时无信号 = 新文件词表静默逃逸 = Anchor Coverage Gap 制度化。枚举面由 glob 派生，非手写清单。

### D4 证伪形态：逐模块注入同枚举面

`probeVocabGuards` 对受治模块集**每个命名空间**各注入假导出断言点名——kill = 每模块失真皆被抓 ∧ 真实导出零 finding。

- **fixture 模块枚举与生产枚举同源**（探针消费同一枚举面），防「fixture 验的面 ≠ 生产扫的面」的 Anchor Coverage Gap 同型复犯。
- **禁代表模块抽样注入**（其余模块守卫永久无 fixture 消费 = 覆盖缺口）。

### D5 接口变更：(ns, registry) 注册表参数化

`unregisteredCodeExports(ns)` → `unregisteredCodeExports(ns, registry)`（`registry ?? 默认表` 向后兼容）。注册表注入保持纯核纯函数；薄壳喂入枚举面 + 注册表；探针同签名注入失真命名空间。与 `env.registry ?? STATE_PREDICATE_REGISTRY` 参数化同构（既定注入模式又一实例）。`isKnownCode` 同族消费点同步 blast-radius 核对。

### D6 边界与负向需求

禁：①verdict.mjs 单点跨文件注册（ESM 循环 TDZ 故障族 + 破 ADR-0099 D-003 分腿管辖，双重不可用）；②锚腿自持独立守卫面（词表登记点双源 = `anchor:bare-word-single-source` 存在意义的机制级自我否定）；③注册表内封闭 modules 清单；④代表模块抽样注入；⑤通用死代码检测；⑥裸零引用出 RED；⑦受治面顶层副作用；⑧排除清单判据用「fixture」措辞（`.ts`/`.py` 无法 import 注入）。

## 预写块 ①：扩域首抓真 RED 解读纪律

扩域落地当轮预计首抓真 RED（3 个扫面外导出）。处理通道二选一（立法=预写故障解读手册，非发执照）：

- **先注册后合入**：先把 3 个导出登入注册表（同一 PR 内先注册），再上线 glob 枚举；
- **或作扩表 PR 自身验收断言**：扩域 PR 的验收段显式断言这 3 个新登记项被扫面消费（红→绿）。

禁误读 flaky：该 RED 是设计内（新扫面面暴露存量未登记词表），非测试不稳。

## 预写块 ②：四级迁移阶梯（Strangler Fig 次序固化）

1. **registry additive 新建**——`vocab-registry.mjs` 先建，不动存量（纯新增）。
2. **签名泛化**——`unregisteredCodeExports(ns)` → `(ns, registry)`，`registry ?? 默认表` 向后兼容。
3. **CODE_GROUPS 迁出**——verdict.mjs 的 CODE_GROUPS 迁入注册表 + `isKnownCode`/`unregisteredCodeExports` 全消费点 blast-radius 核对（破坏性一刀，可独立 revert）。
4. **glob 枚举上线**——薄壳 glob + 动态 import + 逐模块断言。

**次序硬约束：4 必须在 3 之后。** 半迁移态（注册表未接管而枚举器已执行顶层代码）会产生不可归因 RED：枚举器执行的模块顶层若仍寄居旧表，RED 源无法区分「新文件词表逃逸」与「半迁移态自伤」。

## Consequences

- `anchor:vocab-guards` 的 constraint/subject 描述从单模块（CODE_GROUPS）更新为扩域语义（全 scripts/ 顶层逐模块注册）。
- 注册表获逐模块分组，`ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES`/`SHIP_OVERRIDE_REASON_CODES` 入册——R98 D-002 的「扫面外导出」缺口关闭。
- 判定核（verdict.mjs）与注册表解耦：verdict 保持零 import 纯核，注册表可独立扩展。
- 「探针无孤儿」反向覆盖断言 + 三钉对抗演练并入 T2 验收段（探针名伪造 → 坐席伪造逐条验证，结果具名呈报）。
- 断言数只升不降沿账。

## Known-Risks

1. **递归入域未做**：`scripts/tau/` 子目录不入扫面域（顶层 glob 不递归）。递归入域留开放面后续票；缓解=实测 tau/ 零 `*_CODES`，当前无差。
2. **排除清单漂移**：排除项（`.ts`/`.py`）与探针导出面可能漂移。缓解=交叉验证出 info 行（非 RED），季度顺手审。
3. **顶层零副作用纪律的依赖**：纪律靠受治模块自律，无独立机检（本轮）；缓解=扫面面为 scripts/ 顶层，模块数与体量有限，且顶层副作用在 import 时立即暴露。
4. **注册表手写漂移**：注册表与模块导出名可能名实漂移。缓解=逐模块探针注入 + 自指钉①（probe 名不可解析即红）。

## Addendum A — Audit R99 rework (2026-10-05)

独立审计（审计 Agent）打回本轮返工：2 项硬违规 + 1 项硬验收阻断。修复如下：

1. **A1 探针枚举同源（D4 契约补正）**：`probeVocabGuards` 原先遍历 `Object.keys(GOVERNED_MODULES)`（自封闭键表），违反 D4「fixture 模块枚举与生产枚举同源」。改为消费 `scanVocabGuards({root}).scanned` 的**词表承载模块**（`codes > 0`）——生产扫面看到什么，证伪就注入什么；新增 `*_CODES` 模块未登记时生产扫面 RED、探针同时无法点名 FAKE_CODES → 双红，抽样死角关闭。
2. **A2 扫面 Fail-Closed（D3 边界补正）**：`enumerateScriptFiles` 原 `catch { return []; }` 在目录不可读时静默返空 → `scanVocabGuards` 假绿。改为**抛异常**，由 `scanVocabGuards` 转为致命 finding（`scan-surface-unreadable`）+ `ok:false`——不可枚举的扫面永不报绿。
3. **A3 测试任务并发上界（验收稳定性）**：`turbo run test` 的默认跨包并行会同时跑跨进程 SQLite 竞争演练（`access-chain-bootstrap-spawn`，5s busy_timeout）与 spawn 密集的 revision CLI 集成套件，在负载主机上触及 Windows 进程/原生模块上界（`SQLITE_IOERR_WRITE` / `0xC0000005` / `ERR_WORKER_INIT_FAILED`）。ship-gate step 3 与根 `package.json` test 脚本为 test 任务加 `--concurrency=2`——与 store 套件既有 `--test-concurrency=1` 同一「串行化竞争」纪律，不改变被测内容。

审计另记两处 Fowler smell（重复代码 / 参数命名）已顺带消解：模块加载与错误文本格式化收敛为 `loadScriptModule`/`errText` 单一路径；`unregisteredCodeExports` 的 `registry` 参数语义在判定核注释中显式澄清（名称保留 ADR-0100 D5 契约）。
