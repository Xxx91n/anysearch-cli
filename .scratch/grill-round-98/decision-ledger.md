# R98 Decision Ledger（grill-round-98）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。
> 恢复上下文权威入口：`.scratch/grill-round-97/handoffs/next-round.md`（R98 任务书）+ `.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（R97 独立审计）。

## D-001 — R98 范围定界与 land 授权窗（正题：自造机检声明第五形态 + 前置义务轨返工 + B 轨逐栈 land）

- **原问题**：R98 本轮构成三子项——(a) 正题是否采纳任务书建议的「自造机检声明」第五形态立法；(b) R97 审计返工票 R1~R8/R10 的定位；(c) B 轨 land 授权窗口与执行路径。
- **用户原回答原文**：「采纳」（用户前置倾向「我偏向a+b+c」，经 atomcode 深调呈报 + 拓扑误读辩证修正后确认）
- **规范化需求**：
  - **正题（a）= 自造机检声明第五形态立法**：判据 = 「ADR 宣称机器约束 ∧ 实现零消费 → RED」；首版 RED 面收窄为注册表条目 + reuse 指针两类结构化锚，ratchet 计数类先落 PENDING（与形态二「先 PENDING 后 ratchet 升 RED」既定模式同构）；只检注册表 schema 面，不做通用死代码检测；检测器自身断言须有真实 fixture 消费（自指负担，四个同型实例恰为样本）。
  - **前置义务轨（b）**：R1~R8/R10 显式入 goal.md 为前置轨——先修 → 重跑同一套验收电池（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate REAL_GATE_EXIT=0+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126）→ 断言数只升不降（R96 审计 P5 教训）；R3/R5/R4 兼作正题 dogfooding 样本；R6 优先补码而非降格（降格将构成 R97 D-002 revised，避免账本连锁改写）。
  - **B 轨 land（c）**：owner 授权后在本轮实现 commit 前逐栈执行——`but land r97-audit-reanchor --whole-stack`（ff，37c 覆盖 R97 实现+重锚；r95-rework 在同栈随 land 由 but pull 回收）→ `but pull` → 依次 land 余栈（grill-docs 栈顶 r98-grill-ledger 6c / r97-audit-ledger 2c / r96-audit-loop2 4c / r95-audit-loop2 3c / r95-audit 1c）；每次 land 后 `but pull` reconcile 余栈保持 ff 性；land 前 `node scripts/ship-gate.mjs` 复跑由裁量升为必做前置闸门；每次 land 使相关 unlanded 声明失效 → 按已立法重锚仪式改述；goal.md 风险登记：①首次真实 CI run 可能首红 ②ff-land 后 run-URL 仍只能 PENDING（ADR-0098 Known-Risk 5，GREEN 兑现待 PR 拓扑）③land 绕过 review 检查，替代保证=审计电池+首次 CI run。
  - **R97 D-002 事实更新承接**（显式注记非裁定推翻）：land 对象栈顶 r96-audit-loop2 → r97-audit-reanchor（多栈实测：`but status` 中 `├╯` 为栈分隔符，实现车道顶为 reanchor；呈报期「单一栈/r97-audit-ledger 全清零」为误读已更正）；land 时序窗口「R97 实现期前」顺延为「R98 实现期前」（审计 P-4 偏离的迟来履行，纠偏非二次偏离）；机制 / ff 形态 / but pull 回收 / 未授权不执行四项沿用不动。
- **显式约束·负向需求**：①单题性守恒——正题名义归第五形态立法，返工轨以「前置义务轨」名义入 goal 非平行正题（ADR-0029 同子系统 cohesive items 合规；四个装饰件与第五形态同属声明-兑现缺口一主题）；②grill 期不动源码——land 属实现期 T0 动作，授权在案但执行窗口在实现期开工前；③返工判据——先修后检（检测器上线瞬间存量违规为零或有显式 baseline），禁「立法即开局四红」；④判据边界——禁裸「零引用 → RED」（防误伤声明为散文契约的文档性数据）；禁通用死代码检测；⑤已否项：拆三轮（B 轨窗口失效 + R3/R5 失同批收敛）/ 四形态全 RED（开局四红违清算义务）/ 只出报告不开门禁（重蹈 S-1 弱化）/ 实现后 land（丢零冲突窗口）/ 继续积压（与 trunk-based 相悖）；⑥范围外沿用 R97 清单不扩展（不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims、不做发布/tag、活体谓词仍只走 deferred、docs/adr 不入状态标记靶位、不裸删远端指针、仓外技能文档缺口须单独授权）。
- **状态**：current
## D-002 — 装饰件检测器判定模型（行为消费验证为主+静态前检 / 封闭锚注册表 / 全程失效语义）

- **原问题**：检测器判定模型三子项——(a) 消费方机械判定（A 静态引用计数 / B 行为消费验证 / C 消费方登记契约）；(b) 靶面（A 封闭锚注册表 / B 只修四实例 / C ADR 文本自动发现）；(c) 失效语义（全程三元组 vs 只在新增时检查）。
- **用户原回答原文**：「采纳」（atomcode 深调呈报+四处精化与两枚自指钉并入后确认）
- **规范化需求**：
  - **判定核**：行为消费验证为主——注入失真锚条目（假谓词项 / 坏 reuse 指针），门禁若真消费注册表必须产出对应 RED；不杀 = 装饰实锤（mutation testing RIP / chaos steady-state / dead-man's switch / Pact CDC 四族先例同构）。静态引用计数降为前检分流：「连测试引用都没有」速筛，永不独立出 RED（knip production-mode 判据——锚宣称的是机器约束、面向检测器运行行为，故终判必须是行为）。
  - **靶面**：封闭 enforcement-anchor 注册表 `{锚ID, 宣称的机器约束, 消费方证伪 fixture 指针, 失效触发}`——扩表须改门禁代码 fail-closed（ADR-0098 D1 谓词注册表同构第二实例）。**两枚自指钉**：①无 fixture 的锚条目 = 无法杀死的等价变异体 = 不准入表；②fixture 未执行 / 未产出预期 RED → 注册表自身 RED（与「扩表 PR 自身受门禁约束」同款自指收敛）。
  - **失效语义**：全程三元组——消费方删 / 绕行 → 下次门禁 run 即 RED（valid-time 同构 R97 D-003）；重构假红走重锚仪式（理由+审计+重批计数，兼兑现审计 P-6 的 ratchet 可见重批计数）；重构 / 绕行边界 = 「fixture 是否仍产出预期 RED」唯一机械判据（禁语义等价判断，防 NLP 复辟）；ratchet 类挂封闭 PENDING 码进 deferred registry。
  - **观察者最小化 + 失效域隔离**：判定核纯净维持（零 spawnSync/fs/Date.now/process.env，时钟 env.now 注入），证伪 fixture 执行路径不经过被验代码的自身配置。
- **显式约束·负向需求**：①禁裸「零引用 → RED」（A 仅前检分流不出 RED）；②禁消费方登记契约（位点漂移+位点自变装饰=问题转移非解决）；③禁 ADR 文本自动发现宣称约束（D-004 禁 NLP/散文近似）；④禁「只在新增时检查」（grandfathering 变体，违 R97 D-003 bitemporal）；⑤禁通用死代码检测（封闭注册表 schema 面之外不扫）；⑥首批锚=审计点名的四个实例（注册表常量 / reuse 指针 / ratchet 计数-PENDING 位 / 裸词枚举单源）+门禁自身关键常量，清单终稿留落地参数裁定。
- **状态**：current
## D-003 — 检测器落地参数（ship-gate 自检腿 / 注册表参数化注入 / 5 锚首发）

- **原问题**：检测器落地参数三子项——(a) 宿主面（ship-gate 独立自检腿 / 并入 handoff-lint / 只挂单测套件）；(b) 注入机制（注册表参数化 / monkeypatch / 复制源码双源）；(c) 首批锚清单（5 锚含 B3 词表守卫 / 4 锚 / 开放面）。
- **用户原回答原文**：「采纳」（atomcode 深调呈报+三处精化并入后确认）
- **规范化需求**：
  - **宿主面**：ship-gate 独立自检腿（与 state 腿 / run-URL 腿平级注册）——锚指向门禁代码自身非 closeout 文档（代码面不是文档面，与「docs/adr 不入形态一靶」同一逻辑）；薄壳执行各锚证伪 fixture（对纯核注入失真→断言期望 kill），核只判 kill/no-kill；观察者同告警链但独立故障域；成本 O(锚数) 常数级可入每次 run（手工策展封闭锚条目≠全量变异）。
  - **注入机制**：注册表参数化 `env.registry ?? STATE_PREDICATE_REGISTRY`（默认回退生产表）——env.workflows/env.git/env.now 既定注入模式第五实例，`Object.freeze` 纪律不动；参数化根治 S-5（腿必须以参数接收注册表→「唯一引用即自声明」在签名层面不再可能）；失真表测试须兼覆盖「缺省=生产表」路径=第 6 个隐式 fixture；「传永远 GREEN 表绕过」威胁由自指钉②兜底。
  - **首批锚（5 锚，各配证伪 fixture 方准入表）**：①`anchor:predicate-registry`（S-5，fixture=注入失真表断言 state 腿出 RED）②`anchor:reuse-pointer`（P-9，reuse 字段须被解析消费）③`anchor:ratchet-recount`（P-6，PENDING 类首发锚，挂封闭 PENDING 码进 deferred registry）④`anchor:bare-word-single-source`（P-8，fixture=注入缺词表断言裸词漏报）⑤`anchor:vocab-guards`（R96 审计 B3 词表守卫常量各仅 1 次出现——不收则首次扩表即复现同型装饰）。
- **显式约束·负向需求**：①禁并入 handoff-lint（文档面与代码面混管，违 R97 D-004 两速分权与靶位边界）；②禁只挂单测套件（watcher shares fate with observed——测试被删/跳过即装饰回归无闸；单测失败与门禁 RED 是不同账本条目，破坏失效语义机械唯一性）；③禁 monkeypatch（可变导出与 frozen 注册表+fail-closed 语义正交冲突，还原失败=跨测试污染）；④禁复制判定核源码改注册表（双源维护=锚自变装饰，P-8 同型）；⑤禁 4 锚漏 vocab-guards（同型豁免，违 D-001⑤精神）；⑥合法重构未走重锚仪式时双红（锚 RED+消费缺失 RED）为 fail-closed 设计意图——首次触发的重锚成本须写进 ADR Consequences 防误读 flaky；⑦开放面检测仍禁（D-001 既定），未来扩表走封闭通道，开放面留作 ADR Known-Risk。
- **状态**：current
## D-004 — R98 票序与簿记结构（T0 land→T1 返工→T2 立法→T3 检测器→T4 簿记→T5 收口）

- **原问题**：R98 票序与簿记——六票结构（goal 定锚+land 执行窗 / 返工前置轨 / 立法包 / 检测器实现 / 簿记 / 收口）与簿记载体（ADR-0099 单件 / 词条区 / deferred 票 / 实现分支形态）。
- **用户原回答原文**：「采纳」
- **规范化需求**：
  - **T0 定锚+land 执行窗**：`.scratch/grill-round-98/goal.md`（三轨名义+范围外清单+风险登记三件=CI 首红 / run-URL PENDING 边界 / land 绕过 review 的替代保证）；owner 授权窗内执行——前置闸门 `node scripts/ship-gate.mjs` 复跑（已由裁量升为必做）→ `but land r97-audit-reanchor --whole-stack`（ff）→ `but pull` → 依次 land 余栈（grill-docs 栈含本账本 / r97-audit-ledger / r96-audit-loop2 / r95-audit-loop2 / r95-audit）→ 每次 land 后失效声明按重锚仪式改述 → 观测首次真实 CI run。
  - **T1 前置义务轨（返工 R1~R8/R10）**：先于一切新立法/新实现——方向性修复先行（R1 S-1 假绿方向 / R8 P-7 降级方向），随后 R3 P-8 单源化 / R4 P-9 reuse 保障 / R5 P-6 recount / R6 P-2 清算义务补码 / R7 P-3 形态二 PENDING 挂接 / R2 S-2 断言补网；R10 CHANGELOG 分行随簿记件。修完重跑同一套验收电池（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate exit 0+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126），断言数只升不降。R3/R4/R5 修复产物=5 锚中 3 锚的真实消费方（dogfooding）。
  - **T2 立法包**：ADR-0099 单件（第五形态判据+锚注册表 schema+两枚自指钉+参数化注入+双红后果入 Consequences+开放面入 Known-Risk）+ CONTEXT「Grill Round 98 Terms」词条区（~8 条）+ 锚注册表数据结构 + 首批证伪 fixture 骨架。
  - **T3 检测器实现**：判定核 `env.registry` 参数化 + ship-gate 自检腿薄壳（壳执行 fixture / 核判 kill·no-kill）+ 静态前检分流（永不独立出 RED）+ ratchet 类封闭 PENDING 码注册 + 单测增量（断言只升）。
  - **T4 簿记**：CHANGELOG r98 节（feat/fix/docs 分行=R10 合规自证）+ deferred registry 两新票（ratchet-recount 升 RED 排程 / 开放面扩展示范）+ `no-pr`/`unpublished` 既有 deferred 沿账不动 + ADR-0099 Consequences/Known-Risks 回填 + ADR index 再生成。
  - **T5 收口**：轮报 + closeout（claims 用 verbatim kind 自证）+ next-round.md 轮回覆写 R98→R99 + 三态骨架（全绿/降格/F-bug 承接）+ land 后声明重锚核验（收口清算义务「栈空∨deferred 在册」本轮首次机检兑现=R6 修复验收场）。
  - **簿记裁定**：ADR-0099 单件；词条区 ~8 条；deferred 两新票；实现分支单支 `r98-anchor-detector`（land 后干净 main 上开栈，返工 commit 在前 feat commit 在后）。
- **显式约束·负向需求**：①返工轨必须先于正题立法/实现（先修后检——检测器上线瞬间存量违规为零或显式 baseline）；②Land 先于一切 R98 实现 commit（D-001 承接 R97 D-002 时序顺延）；③断言数只升不降（R96 P5 教训）；④grill 期不动源码——T0~T5 全属实现期；⑤轮报/交接件中的状态声明须用 R97 立法的 state 标记语法（形态一自 dogfood）；⑥范围外沿用 D-001⑥ 清单。
- **状态**：current
