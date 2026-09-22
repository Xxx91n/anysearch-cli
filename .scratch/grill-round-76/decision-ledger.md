# Grill Round 76 — Decision Ledger

> 防丢账本：每条经用户确认的实质性结论当场追加。状态枚举：current/revised/stale/deferred。
> 唯一权威数据源——整理/压缩/handoff 前必须已落盘到最新。
## D-001 — R76 主题定界

- **原问题**：R76 主题定界（deferred 悬池+触发器事实+审计交接方向出候选）：A=纯 shipgate-1g 单题轮 / B=「治理面静默漂移」清算轮（shipgate-1g + registry 格式锁）/ C=f16+f17 env-flaky 姊妹轮 / D=provider-serverside 调查轮 / E=dsh 三件套轮 / F=另指。
- **用户原回答原文**：「b」
- **规范化需求**：R76 = 「治理面静默漂移」清算轮——两件同构失效模（治理机器自己的 silent-drift）同轮清算：(1) `defer-r71-shipgate-1g-coverage`——ship-gate closeout-required 腿 fallback 挑「最新含 closeout 的 round dir」，静默掩盖缺失项（registry 明示不得再静默飘过，已四轮）；(2) `deferred-registry.json` 格式锁——外部进程/编辑工具已两次整文件重排（1→8、1→4 空格），每轮人工恢复最小 diff，须立项防漂移机制（lint 腿或 .gitattributes 等，形态票内定）。
- **显式约束/负向需求**：落选债项原名续 deferred 且须记显式续债条非默认飘过——transformers 债（上游 #1764 仍 OPEN 阻塞中）、event-rename（0.1.6-rc.1 未发）、bitmap（imagegen 缺席）、registerHooks-esm-arm（三触发器均未响）、f16/f17、provider-serverside、dsh 三件套、domain-ownership 均不动；外发闸（#1764/#1087 评论文稿）仍是用户动作项非本轮题；grill 期间不动源码。
- **状态**：current
## D-002 — 1g 修复语义（atomcode 交叉后终审）

- **原问题**：Q2 终审——ship-gate step 1g closeout standing-leg fallback 静默掩盖的修复语义：A+=ADR index 登记作完成信号+fail-closed 三断言+floor 锚规则生日+豁免显式化+验证纪律 / B=仅 contiguity / C=全量重 lint。
- **用户原回答原文**：「采纳」（采纳 A+，即调研裁定版 A）
- **规范化需求**：修复 step 1g (scripts/ship-gate.mjs ~L921-936) 的 leg-b fallback——(1) 「已完 round」信号=`docs/adr/index.md` 含 `Grill Round N` 条目（ADR 落盘=round 收口完成的确定性信号，主流 registry 路线）；(2) fail-closed 三断言：a) 已登记且 N≥floor 的 round dir 无 closeout→红；b) index 登记集合↔.scratch/ 实有已完成 dir 双向不一致→红（防单信源解析漂移成新静默面）；c) 推导的 round 集合为空或不可解析→红（防 running blind）；(3) floor=76（规则生日=本修复 ADR-0077 落地轮），floor 值写入 ADR、日后调整走显式 review（ratchet 腐坏防护）；(4) 在飞豁免显式化：未登记 ADR 的最新 dir 打印结构化豁免结论（round 号+awaiting closeout / ADR not yet registered），不许隐式 break；(5) 验证纪律：known-bad fixture 注入「已登记无 closeout」断言具体报错消息+成功输出打印 round 覆盖计数（aiArch validator 教义：从未见红=与不可能失败不可区分）。leg-b 字段 lint 面不动（仍只 lint 最新含 closeout dir，控 gh liveness 成本）。
- **显式约束/负向需求**：不采用 contiguity-only（B——终端掩盖残留：最后一轮漏产须等下轮开跑才响，项目停更=永久静默）；不全量重 lint（C——违背「修类不修例」且翻祖父旧账）；不读 git 历史/分支态作完成信号（GitButler 虚拟 workspace commit 耦合虽实测低，但落盘文件信号本就足够）；「登记即完成」纪律写入 ADR——ADR 条目不得先于 closeout 登记，报错文案引导「补 closeout 或移除登记」；解析器对未知行形状 fail-loud 不 skip。
- **状态**：current
## D-003 — registry 格式锁机制（atomcode 交叉后终审）

- **原问题**：Q3 终审——deferred-registry.json 防重排锁机制：A+=ship-gate step1 内 stepGovernedJsonCanonical() 字节全等断言+硬编码清单+不自修+note 自文档 / B=并入 pathlint config / C=.gitattributes / D=hook/编辑器侧。
- **用户原回答原文**：「采纳」（采纳 A+，即调研裁定版 A）
- **规范化需求**：格式锁=ship-gate step 1 内新增 `stepGovernedJsonCanonical()`——(1) 断言形态=字节级全等：文件字节 ≡ `Buffer.from(JSON.stringify(JSON.parse(src), null, 1) + '\n')`（语义级深比较会漏报重排，恰是要拦的东西；可报「first differs at line N」黄金 UX）；(2) 目标清单=硬编码常量 `CANONICAL_JSON_FILES`（n=1=docs/deferred-registry.json），注 ADR-0077 编号+「n≥5 或需包级自服务时迁移注册制 config」触发条件注释；(3) 不自修——报错附可粘贴 `node -e` normalize 指令+清单常量脚本位置行号（防清单腐化无人知）；JSON.parse 失败先报独立 invalid JSON，normalize 指引只在合法但字节不匹配时给出；(4) 自文档防误修——registry 顶层 `note` 字段写入「canonical form locked by ship-gate/ADR-0077; run <cmd> to fix」（一次定稿成为 canonical 一部分，防新人/agent 误把 1 空格当损坏去修）。
- **显式约束/负向需求**：不引 prettier（2 空格默认与 1 空格 canonical 直接冲突+版本漂移面+n=1 不成比例；条件性翻案=清单扩到 n≥5 且含 md/ts 多类型、团队要全仓统一格式化时再引，并把 canonical 重定义为 prettier 输出即 `prettier --check` 断言——检查腿与 formatter 天然可互换）；不动 .gitattributes（eol/diff 传输展示层，对内容重排防御力为零）；不走 hook 路线（GitButler #5735 实证 pre-commit 绕过 staging area 静默不执行、#12748 but setup 覆盖 hook 管理器——CI rejection is the final guard）；不引入 JSONC/JSON5 求注释（破坏 JSON.parse 纯净性+canonical 断言简单性，注释需求走 `note` 数据字段惯例）；键序语义写入 ADR（V8 插入序、禁 replacer/排序序列化）。
- **状态**：current
## D-004 — R76 票序结构

- **原问题**：Q4——票序：A=三票串行锁先行（T0 格式锁→T1 1g 修复→T2 文书收口）/ B=1g 主体先行 / C=两工项合并单票。
- **用户原回答原文**：「A」
- **规范化需求**：三票串行——T0 格式锁（D-003）：stepGovernedJsonCanonical() 挂 step1+registry note 字段写锁定声明（canonical 一次定稿）+直跑验证；先行理由=T2 收口还要再编辑 registry（续债条），锁先立则后续每次 registry 编辑即刻被新腿验证 canonical，有因果收益。T1 1g 修复（D-002 主体）：leg-b 改造（ADR index 登记信号+三断言+floor=76+豁免打印+known-bad fixture+计数断言）+turbo check/test+该腿直跑+ship-gate 绿。T2 文书收口：ADR-0077（floor=76 锚定+键序语义+「登记即完成」纪律+不自修教义+prettier 翻案条件）+registry 续债条（落选债原名续记）+CONTEXT 新词+handoff（#1764 观察哨续挂+外发闸仍待用户）+pathlint 登记 round-76+but commit 干净；发布判定=repo 工具链改动非发布态代码→不 bump，入 ADR。
- **显式约束/负向需求**：票边界=格式锁与 1g 修复不同文件面须分票（diff 可审）；发布判定须显式记录非默认跳过；落选债续债条显式记非飘过。
- **状态**：current
## D-005 — R76 收口判据

- **原问题**：Q5——收口判据：A=三段收口（锁段双向行使实证/1g 段三断言全行使/文书段）/ B=两腿代码绿即收口 / C=只账本约定。
- **用户原回答原文**：「A」
- **规范化需求**：三段收口——(i) 锁段：stepGovernedJsonCanonical() 落地且双向行使实证（注入非 canonical 字节断言 fail+报 first-differs-at-line-N+normalize 指令文案；恢复后转绿）+registry note 锁定声明落盘+该文件此后每次编辑过闸；(ii) 1g 段：三断言全行使——known-bad fixture（已登记 N≥floor 无 closeout 注入断言具体报错）+双向漂移断言实测+空推导断言实测+豁免行打印实证（round-76 在飞态=天然用例：ADR-0077 未登记→豁免结论可见）+成功输出带覆盖计数+leg-b 字段 lint 面不回归；(iii) 文书段：ADR-0077（floor=76+键序语义+登记即完成纪律+不自修教义+prettier 翻案条件+双向校验教义）+registry 刷新（落选债续债条+updated bump）+CONTEXT 新词+handoff（#1764 观察哨续挂+外发闸待用户发状态回录）+pathlint 登记 round-76 自证+ship-gate 全绿+turbo check/test 绿+but commit 干净；不 bump 判定入 ADR。
- **显式约束/负向需求**：三段缺一段不收口；红方向必须实测行使（没见过红的检查=与不可能失败的检查不可区分——aiArch validator 教义）；豁免打印须在在飞 round 上可见非仅代码路径存在。
- **状态**：current
