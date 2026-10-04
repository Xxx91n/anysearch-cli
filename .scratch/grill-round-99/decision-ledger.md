# R99 Decision Ledger（grill-round-99）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。
> 恢复上下文权威入口：`.scratch/grill-round-98/handoffs/next-round.md`（R99 任务书）+ `.scratch/grill-round-98/handoffs/round-98-audit-handoff.md`（审计交接，R100 候选三题）+ `.scratch/grill-round-98/handoffs/round-98-closeout.md`（R98 收口件）。

## D-001 — R99 本轮构成与正题裁定（正题 = anchor:vocab-guards 扩域至全 scripts/ + 顺手段落 + 残留轨沿账）

- **原问题**：R99 本轮构成四候选裁定——A 正题 = anchor:vocab-guards 扩域至全 scripts/（与 T2 开放面扩表示范票合一）；B 正题 = 检测器自指收敛第三轮（常态断言立法）；C 纯残留轮无正题；D 产品向正题（回归信息专精 CLI 主线）。
- **用户原回答原文**：「采纳」（修正版 A'：atomcode 深调呈报 + 三处精化并入后确认）
- **规范化需求**：
  - **正题 = anchor:vocab-guards 扩域至全 scripts/**——与 T2 开放面扩表示范票合一，封闭扩表通道首演（扩域条目携证伪 fixture 准入表 = 自指钉①验收场；runner 对不可解析 probe 即 anchor-unresolvable RED）。
  - **先修后检**：扩域前先盘点 3 个扫面外导出（scripts/enforcement-anchors.mjs 的 ANCHOR_RED_CODES / ANCHOR_SKIP_CODES、scripts/eval-integrity-contract.mjs 的 SHIP_OVERRIDE_REASON_CODES）的 CODE_GROUPS 注册现状；扩域落地当轮预计首抓真 RED——按 ADR-0099 Consequences 预写的双红解读纪律处理（先注册后合入，或作扩表 PR 自身验收断言），禁误读 flaky。
  - **顺手段落**（ADR-0029 同子系统 cohesive item，非平行正题）：①「探针无孤儿」反向覆盖断言——probe 模块导出无孤儿探针（正向锚→probe 可解析已由自指钉①覆盖，此处补反向）；②三钉对抗演练一组——探针名伪造 → 坐席伪造等对抗路径逐条验证（HN 配额腾挪 loophole 对应物）。
  - **残留轨沿账**：T0 CI 观测——HEAD b3ca0d51 三跑已全绿（ci 4m28s / native-smoke 49s / ship-gate 6m57s；run 37195788023/37195787979/37195787971）；前序 ship-gate 47s 红为自失效声明被抓的 fail-closed 实证；GREEN: run-URL 引用仍受 PR 拓扑边界约束沿账不扩展。T1 anchor:ratchet-recount 坐席关票——零代码改动，关票即升全量 kill 判定。
  - **否决项**：B 独立正题——F-1/F-2 修复已隐式兑现主骨架（reportStep 注册 + step 1j/9 / anchor-registry-empty fail-closed），残余为推测性盲区且自指断言是自增债务（每条须配 fixture 可被消费），不值得单独立轮；C 纯残留轮——ratchet 空轮 = backslide 先例温床；D 产品向——治理复利证据为正（缺口在册 / 示范票待闭 / 机制待首演），切换成本对称，无「治理边际 < 产品机会成本」实证信号。
  - **下游待裁**：Q2 = 跨文件注册架构选型（verdict 外逐模块命名空间分组 / 锚腿自持独立守卫面）+ 扩域 fixture 形态。
- **显式约束·负向需求**：①单题性守恒——正题归 vocab-guards 扩域，顺手段落以 cohesive item 入 ADR 非平行正题（ADR-0029）；②grill 期不动源码——扩域实现属实现期票，本伦只裁设计面；③禁把锚腿词表寄居 verdict.mjs 的 CODE_GROUPS——违 ADR-0099 D-003 分腿管辖（锚腿与 handoff-lint 分腿）；④扩域仍只检注册表 schema 面，禁通用死代码检测、禁裸零引用出 RED（R98 D-002 沿用）；⑤每条新断言须配证伪 fixture 可被消费（自指钉①沿用到顺手断言，无 fixture 不准入）；⑥范围外沿账不扩展——不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims、不做发布/tag、活体谓词仍只走 deferred、docs/adr 不入状态标记靶位、不裸删远端指针、no-pr/unpublished 仍 deferred；⑦三钉对抗演练结果只呈报，发现逃逸路径须具名申报不静默。
- **状态**：current

## D-002 — vocab-guards 扩域落地参数（vocab-registry 纯数据叶 / glob 顶层+封闭排除清单 / 逐模块注入证伪 + 接口变更第一刀）

- **原问题**：扩域三设计参数——(a) 注册架构（A vocab-registry 纯数据叶逐模块分组 / B verdict.mjs 单点 CODE_GROUPS 跨文件注册 / C 锚腿自持独立守卫面）；(b) 扫面枚举（A 薄壳 glob scripts/*.mjs 顶层+封闭排除清单 / B 注册表内封闭 modules 清单）；(c) 证伪形态（A 逐模块注入 / B 代表模块单点注入）。
- **用户原回答原文**：「采纳」（atomcode 深调呈报 + 四处精化与联合接口变更并入后确认）
- **规范化需求**：
  - **注册架构（A）**：新建 `scripts/vocab-registry.mjs` 纯数据叶模块（零 import、`Object.freeze`），逐模块分组 `CODE_GROUPS = { verdict, anchors, evalIntegrity, ... }`；verdict.mjs 现 CODE_GROUPS 迁入（根治「注册表寄居判定核」存量结构债，verdict 保持零 import 纯核）；受治模块不回 import 注册表（单向依赖零循环）；锚腿词表进 `anchors` 分组自持不寄居判定核（ADR-0099 D-003 分腿管辖兑现）；CODE_GROUPS 迁出为破坏性重构——`isKnownCode` / `unregisteredCodeExports`（verdict.mjs:147/155）全部消费点实现期 blast-radius 核对；registry 高摩擦 = 封闭通道设计意图写入 ADR（ADR-0099 Known-Risk 1 缓解同构）。
  - **扫面枚举（A）**：薄壳 glob `scripts/*.mjs` 顶层不递归 → 动态 `import()` 为命名空间数组 → 纯核逐模块断言；**封闭排除清单判据 = 「无法命名空间注入的文件」**（.ts / .py 等）而非「fixture」措辞；**受治面顶层零副作用纪律立法**（glob+import 会执行扫面内 .mjs 顶层代码，无纪律则枚举器成新故障面）；排除清单漂移缓解 = 排除项与探针导出面交叉验证，漂移出 **info 行非 RED**（守禁裸零引用约束）；`scripts/tau/` 子目录不入域（顶层 glob 不递归，实测零 \*_CODES 无差）。
  - **证伪形态（A）**：probe 对受治模块集每个命名空间各注入假导出断言点名——kill = 每模块失真皆被抓 ∧ 真实导出零 finding；fixture 模块枚举与生产枚举同源（探针消费同一枚举面，防「fixture 验的面 ≠ 生产扫的面」Anchor Coverage Gap 同型复犯）。
  - **联合接口变更（实现期第一刀）**：`unregisteredCodeExports(ns)` → `unregisteredCodeExports(ns, registry)`——注册表注入保持纯核纯函数，薄壳喂入枚举面 + 注册表，探针同签名注入失真命名空间；与 `env.registry ?? STATE_PREDICATE_REGISTRY` 参数化同构（既定注入模式又一实例）。
- **显式约束·负向需求**：①禁 verdict.mjs 单点跨文件注册（verdict→锚腿→probes→verdict ESM 循环 TDZ 故障族 + 破 ADR-0099 D-003 分腿管辖，双重不可用）；②禁锚腿自持独立守卫面（词表登记点双源 = anchor:bare-word-single-source 存在意义的机制级自我否定）；③禁注册表内封闭 modules 清单（清单维护者忘记更新时无任何信号 = 新文件词表静默逃逸 = Anchor Coverage Gap 制度化，knip FAQ 固有缺陷）；④禁代表模块抽样注入（其余模块守卫永久无 fixture 消费 = 覆盖缺口）；⑤受治面顶层零副作用 = 实现期立法项非约定俗成；⑥排除清单判据用「无法命名空间注入」措辞非「fixture」（.ts/.py 无法 import 注入）；⑦排除清单漂移检出降级为 info 行不出 RED（R98 D-002 禁裸零引用出 RED 沿用）；⑧grill 期不动源码——实现属实现期票。
- **状态**：current
