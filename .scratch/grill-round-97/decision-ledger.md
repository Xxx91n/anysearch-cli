# R97 Decision Ledger（grill-round-97）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。
> 恢复上下文权威入口：`.scratch/grill-round-96/handoffs/round-96-audit-loop3-handoff.md`。

## D-001 — R97 范围定界（正题 A：自造失效声明可机检类别 + 并行处置轨 B：未合并分支清算）

- **原问题**：R97 这一轮正题选什么？（A 自造失效声明立法为可机检类别 / B 未合并分支清算轮 / C N5 专项票 / D 其他）
- **用户原回答原文**：「A+B」
- **规范化需求**：R97 采用双轨构成——
  - **正题面 A（立法/设计面）**：把「自造失效声明」立法为可机检类别。同族缺陷第三次出现且刚被门禁首次机器捕获（push 后 `PENDING{stack-unpushed}` 被 `declaration-fact-conflict` 当场抓出、Stack 链尾 SHA 被 `chain-tail-not-in-branch` 抓出）；前两次全靠人工审计（R95 F5R push 自造失效 / R96 P5→LOOP2 F1 ADR 写入即失准的实测值 / R96 §10.3 改写立法文本静默打断机械锚 claim）。候选可机检形态（声明-动作一致性 / 立法数值时效契约 / 机械锚语义锁）的取舍与边界留后续问题裁定。
  - **并行处置轨 B（一次性 VC 处置）**：解决上轮未合并分支积压——origin/main 自合并基点 `3642d494` 起 0 commit 新增；全工作区单一栈车道（顶→底：r96-audit-loop2 → r96-audit → r95-audit-loop2 → r95-audit → r96-handoff-lint → r95-exec → r95-rework → r96-grill-docs → r95-grill-docs → 基底）；r95-rework 处置三选一已登记（留置 / land 后 but pull 回收 / 授权裸 git push --delete 仅删远端指针）。B 的裁量与时序留后续问题。
- **显式约束·负向需求**：①单题性守恒——正题名义归 A（ADR-0029），B 以「并行处置轨」身份存在；B 是否产立法面（栈合流纪律类词条）另由专门问题裁定，默认不产；②grill 期不动手修源码——含 N5（`parseButStatusIds` 漏 U+25D0 `◐` 标记致 Stack 腿假红），其归属（正题内子票 / 独立票 / 台账）留后续问题；③B 的一切 land / 删 ref 动作属外部授权操作（push main、origin 删指针），裁量归 owner，grill 只定型方案与时序，未授权不执行；④范围外沿用：不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims 工件、不代持/改凭证、不做发布/tag；⑤双轨交汇点明示——B 处置现场（「未 push / 未 land」声明的失效史）正是 A 类缺陷的最大实物样本，A 的立法须兼容 B 处置产生的状态迁移。
- **状态**：current
## D-002 — B 轨处置包（全栈 land + r95-rework 回收 + but land 机制 + 轻量立法）

- **原问题**：未合并分支清算四子裁量——(a) land 范围与时序 / (b) r95-rework 冗余标签处置 / (c) 执行机制与授权 / (d) 是否产立法面。
- **用户原回答原文**：「采纳」（对修正版推荐的采纳——atomcode 深调呈报 + `but land` 本机实测存在（0.22.3）辩证修正后确认）
- **规范化需求**：
  - **land 范围与时序**：全栈一次 land——`but land r96-audit-loop2 --whole-stack`（ff 形态），栈顶→main 一次合流 37-commit 车道全段（r95-grill-docs→…→r96-audit-loop2）；时序=R97 实现期开工前（零冲突窗口：origin/main 0 新增，新工作叠上即退化为部分 ff+rebase）；land 前可以 `node scripts/ship-gate.mjs` 复跑作前置闸门（裁量项非强制——LOOP3 已全绿）。
  - **r95-rework 处置**：随 land 由 `but pull` 自动回收（官方语义：integrated branches 自动移除）；若工具残留则退「留置」（虚拟标签不占远端空间、成本近零）；不采用裸 `git push origin --delete` 删远端指针（owner 授权+违规成本/收益不成比例，仅当标签误导他人时才值得）。
  - **执行机制**：`but land <top> --whole-stack`——**推翻呈报期「but 无 land 原语」的错误前提**：本机 but 0.22.3 `but land --help` 实证该原语存在（gitbutler SKILL.md 命令清单未收录=技能文档缺口，非工具缺口）；ff 默认（不加 --no-ff——merge commit 先例不构成义务；栈段边界由 commit 序列承载，分段 revert 用 `git revert <base>..<tip>`）；main 实测无分支保护 + 本机 gh push 权限=机制上必然成功；`--yes` 可跳确认。
  - **立法面**：轻量立法一条——「轮次收口时栈必须 land 或显式登记 deferred+理由」；三约束：可机检（栈空 ∨ deferred 登记存在）、零新工具依赖、只管流程不管内容（No-Grandfathering 合规——deferred 登记=流程内豁免，不让未过检 commit 免检）；一句话说完不配细则；失效预警=若频繁 deferred 不 land，查 CI 拓扑根因、修因不修表。
- **显式约束·负向需求**：①land=外部授权动作（push origin/main），未授权不执行；执行时点=owner 拍板的 R97 实现期前窗口，非 grill 期内自动执行；②PR 流（but pr new）降为可选验证通道非必需——仅当要求 land 前看真 CI 绿灯时启用（开 PR 作 CI 载体、绿后仍 land 落地）；③已否项：只 land 到 r95-exec 腰斩栈=违背 Sequential Stack Landing 完整合流语义；不 land 继续积压=与 trunk-based 全部主流心智模型相悖；④r95-rework 不裸删远端指针；⑤ff 形态选定；⑥条款一句话不配细则（条款数量本身有成本，反方观点记录在案）；⑦技能文档缺口记账：gitbutler SKILL.md 未收录 `but land`/`but absorb` 等命令面，待回写技能库。
- **状态**：current
## D-003 — 可机检形态取舍（gamma 修正版：统一类别立法 + 形态一/三实现 + 形态二先立规则）

- **原问题**：「自造失效声明」立为可机检类别的形态取舍——alpha 三形态全收 / beta 形态一 only / gamma 统一类别立法+形态一/三实现+形态二先立内容规则 / delta 只立类别全 deferred。
- **用户原回答原文**：「采纳」（atomcode 深调呈报+四处辩证精化并入后的 gamma-prime 版）
- **规范化需求**：
  - **统一类别立法**：「自造失效声明」= `{词表项, 机械核验谓词, 失效触发谓词}` 三元组 + 封闭谓词注册表；扩表须改门禁代码（fail-closed），扩表 PR 自身受三态门禁约束（自指收敛，防注册表成后门）。失效语义=词表项的 valid-time 属性（bitemporal：如 `unpushed` 失效条件=origin ref 出现）；机检须同时答「写入时为真」与「门禁运行时仍真」。
  - **形态一（声明-动作一致性）实现**：状态谓词走**语法级标记**（封闭词表只在标记内匹配，散文出现同字样不触发——Conventional Commits 定位模式，拒 NLP 近似识别）；词表初版 3-5 项，每项配 allowed/denied 成对 fixture。
  - **形态三（机械锚语义锁）实现**：claims schema 新增 `verbatim` kind——整句字节级锁定，token 存活但语义改写即破锚；捆绑**重锚仪式**（重锚须携变更理由+落审计+重批次数可被 ratchet 度量，specticus accept-drift 模式）。附补强论据入档：现有 `count` 锚存在换位盲区（同数量不同语义静默过检，SwiftLint baseline #6871 同型）。
  - **形态二（立法数值时效契约）先立内容规则**：权威文档（ADR/CHANGELOG/轮报）中的实测数值须同段挂复现命令或治理型 marker 锚（借 `<!-- machine-local: ... -->` 标记语法族）；机检入 lint 先落 PENDING 位（surfaced 非阻断），ratchet 收敛后升 RED——deferred 的是机检深度非立法本身。
  - **落地序**：ADR（类别+注册表+失效语义）→ 词表初版+成对 fixture 同批 → 形态一 lint → 形态三 verbatim+仪式 → 形态二规则入 lint（PENDING）→ ratchet 升 RED。
- **显式约束·负向需求**：①禁 NLP/散文近似匹配——谓词仅在标记语法内匹配（误报从源头收窄；宁词表小+误报趋零，勿词表大+高误报——warning 被忽略会腐蚀门禁权威）；②verbatim 不得脱离重锚仪式单独立法（无显式重登记通道的字节锁等于逼人绕行）；③新声明自立法日起须过机检，存量声明过渡期豁免=流程豁免（No-Grandfathering 合规边界）；④alpha/beta/delta 已否——批次错（三形态误报面/依赖不同，违背契约+实现+测试同批收敛）/ 漏缺陷③与 count 换位盲区（同族不修=变相豁免）/ 立法空转=self-attestation 最弱档且无法被 fixture 证伪；⑤扩表评审流程本身受门禁约束防滥用。
- **状态**：current
## D-004 — 形态一落地参数（单行治理标记 + 自移靶位 + 三项离线词表）

- **原问题**：形态一的三个落地参数——标记语法（HTML 注释标记/字段位/标记与散文并存）、目标文件面（自移靶位/全量回溯/全仓）、初始词表（5 项含活体/3 项全离线）。
- **用户原回答原文**：「采纳」（atomcode 深调呈报+裸词违例规则明示并入后确认）
- **规范化需求**：
  - **标记语法**：`<!-- state: <predicate> <args> @ <iso-date> -->` 单行 HTML 注释（markdownlint #832 实证多行注释解析不可靠）；标记须单条正则整体可解析（词表项+谓词+args+日期）；args 禁含 `--`（CommonMark 注释严格性）；`stack` 占位=解析 Stack 行具名分支；handoff-template 升级给状态声明定「语法家」（run-URL 的 `PENDING{code}` 已是先例形态）。**裸词违例规则**：词表词（英文 token + 登记的中文等价短语封闭枚举）出现于散文且同文件无合法标记→模板违例；代码 span/fence 内不扫（meta 引用豁免——本轮工件自身必然讨论谓词词汇）；散文永远从属于标记，禁反向。
  - **目标文件面**：沿用 handoff-lint 现行「最新含 closeout 轮目录」自移靶位（=自动滚动 ratchet，优于手工 baseline 文件；全量回溯=pre-existing findings 海啸的实测失败模式）。**两速分权**：报告级全量扫（只出报告不开门禁）与门禁级增量扫并存（gitleaks scheduled job 同构）；无靶位时显式 no-op+日志（不静默 skip）；靶位解析逻辑进 golden 测试；`docs/adr` 权威档不在本腿（形态二地盘，防双重管辖）。
  - **初始词表 3 项全离线**：`unpushed`（谓词=`origin/<branch>` ref 缺位）/ `unlanded`（谓词=`git rev-list origin/main..origin/<branch>` 非空）/ `no-branch-runs`（复用 workflows `on:` 触发器谓词——注册表条目显式记录 reuse 指针，触发器实现变更须同步走扩表流程）。`no-pr`/`unpublished` 等活体依赖谓词**延后=首张扩表票**（自带验收场景：实测「扩表须改门禁代码+扩表 PR 自身受门禁约束」闭环）。
- **显式约束·负向需求**：①裸词扫描=封闭枚举字面匹配非 NLP；②标记单行、args 禁 `--`、单正则解析——违反即语法违例；③活体谓词不入初版（flaky 假红的信用损失大于语料覆盖收益）；④存量文档豁免=生效域自移的流程豁免（No-Grandfathering 合规），新声明自立法日起须过机检；⑤B/C 语法与 B/C 面已否——frontmatter 在 md 生态只剥离不校验无成功案例 / 标记散文并存=intent 漂移制度化 / 全量回溯=首周信用破产先例 / docs/adr 入靶=双重管辖；⑥报告级与门禁级扫面分权，不混。
- **状态**：current
## D-005 — N5 归属（正题内子票，定性同族第四实例「锚覆盖缺口型」）

- **原问题**：N5（parseButStatusIds 漏 U+25D0 `◐` 标记致 Stack 腿假红）归属——A R97 正题内子票 / B 轮内独立 chore / C 轮外独立票 / D 台账 deferred。
- **用户原回答原文**：「采纳」（atomcode 深调呈报——A 与 B 非二选一：B 是 A 的合法记账形态——后确认）
- **规范化需求**：N5 收编 R97 正题内子票，定性=自造失效声明同族**第四实例「锚覆盖缺口型」**（冻结样本=对上游输出的声明被上游静默失效；单例样本+封闭标记枚举=把 golden master 盲区假绿内置进门禁的设计面缺陷）。修法三件：① `parseButStatusIds` 标记类放宽为「单个非空白非制表符号」（GitButler 官方无标记枚举文档可查=放宽是诚实解非偷懒）；② E2E 冻结样本**系统性扫已知 glyph 集**（`●`/`◉`/`◐` 全覆盖，系统性扫输入空间而非个案补丁）；③ ADR-0097 Known-Risk 1 **errata**——预测方向（`stack-unavailable`/env-PENDING）更正为实测（逐行丢行→硬 RED），原条目内注记+日期，不 supersede。commit 粒度可在轮内拆 fix+docs(errata) 两票记账。
- **显式约束·负向需求**：①不 deferred——门禁在写作期硬 RED 假红=本轮交付物不可用的阻塞缺陷；②根因不拆出决策面（B 的独立 commit 仅为记账形态）；③errata=原条目注记更正非 supersede；④样本补全须系统性覆盖非单点补丁；⑤修法与词表/注册表立法同批——修法即法条修订本身；⑥上游未来再发新标记时解析器不得再次静默丢行（未知标记的显式行为入设计：不识别即整体解析降级而非逐行吞掉）。
- **状态**：current
## D-006 — R97 票序与簿记结构（T0→T7）

- **原问题**：R97 实现票序与簿记结构裁定——立法包前置的 T0→T7 序列 + 簿记新增项（ADR-0098 件数 / CONTEXT 词条区 / gitbutler 技能文档缺口处置）。
- **用户原回答原文**：「采纳」
- **规范化需求**：
  - **T0** goal 定锚 + B 轨 land 执行窗：owner 授权后 `but land r96-audit-loop2 --whole-stack`（ff）→ `but pull` 回收标签（含 r95-rework 处置）→ 核验 origin/main 推进——先于一切 R97 实现 commit（零冲突窗口）；land 触发的 push→main 为 CI/ship-gate 首次真实 run（R96 GREEN 路径首次演练场，但 ff-land 后 `origin/main..origin/<branch>` 为空→run-URL 对 land 后轮产物仍只能 PENDING，此边界入 ADR-0098 Known-Risk）。
  - **T1 立法包先行**：ADR-0098 决策条文初版（类别三元组+封闭注册表+词表+失效语义+生效域边界）+ CONTEXT 「Grill Round 97 Terms」词条区 + 注册表数据结构（判定核常量：每词表项 `{核验谓词,失效触发,环境需求,reuse 指针}`）+ 首批成对 fixture——Legislated-Before-Asserted 字面满足，条文先于实现票。
  - **T2 形态一**：判定核扩展（标记解析器/裸词违例扫描/三项离线核验谓词/失效触发求值/env-PENDING 分流）+ 门禁腿接线 + 靶位解析 golden 测试 + 无靶位显式 no-op+日志。
  - **T3 形态三**：claims `verbatim` kind（整句字节级）+ 重锚仪式（理由+审计记录+ratchet 重批计数）。
  - **T4 N5 修法三件**：标记类放宽 + 冻结样本 glyph 全扫 + ADR-0097 errata（可拆 fix+docs 两 commit）。
  - **T5 模板+形态二规则**：handoff-template 状态位标记化 + 形态二内容规则入 ADR-0098（实测值须挂复现命令/marker；机检腿先 PENDING 位）。
  - **T6 簿记收尾**：CHANGELOG r97 节 + registry 登记（形态二 ratchet 排程票 / 扩表示范票 no-pr·unpublished / 收口清算义务落地形态=轮收口清单机械条目「栈空 ∨ deferred 在册」）+ ADR-0098 Consequences/Known-Risks 回填。
  - **T7 轮报+收口交接**：三态骨架预写；closeout-claims 首批用 verbatim kind 自证。
  - **簿记定裁**：ADR-0098 一件不拆；词条区 9–10 条一次落（自造失效声明/谓词注册表/状态标记/失效触发谓词/裸词违例规则/verbatim 锚/重锚仪式/锚覆盖缺口/两速扫分权/收口清算义务）；`gitbutler` 技能文档缺口（but land/but forge review 未收录）=仓外 user 级文件→轮外 chore，改文件须单独授权或用户自补。
- **显式约束·负向需求**：①land 先于一切实现 commit；②T1 立法条文先于实现票落盘；③形态二机检腿仅 PENDING 位不直接 RED；④词表初版锁 3 项不外溢；⑤仓外技能文档不在本轮仓内工作面。
- **状态**：current
