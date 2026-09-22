# Grill Round 77 — Decision Ledger

> 防丢账本：每条经用户确认的实质性结论当场追加。状态枚举：current/revised/stale/deferred。
> 唯一权威数据源——整理/压缩/handoff 前必须已落盘到最新。
## D-001 — R77 主题定界

- **原问题**：R77 主题定界（哨戒实况+审计 backlog+续债池出候选）：A=dsh 观测哨再校准+到期演练轮（0.1.5-rc.3/0.1.7-alpha.1 今日新发→演练债到期+触发器锚定 0.1.6-rc.1 或被跳线漂移） / B=R76 审计 backlog 清算轮（F-5⑥⑦+spec 残余三处+F-6 BOM 文案） / C=f16+f17 env-flaky 姊妹轮 / D=provider-serverside 调查 / E=registerHooks 重返评估（trigger(c) 仅一腿响） / F=另指。
- **用户原回答原文**：「A+B」
- **规范化需求**：R77 = 双轨「治理残账清算」轮——轨一（A）：dsh event-rename 观测哨再校准+到期演练。上游 2026-09-22 连发 @deepseek-ai/dsh-agent 0.1.5-rc.3（05:39）与 0.1.7-alpha.1（06:04），registry cadence「per upstream release (rehearsal each time)」→演练债已到期；触发器锚定的 0.1.6-rc.1 或被 0.1.7-alpha 线跳越（0.1.6 仅 alpha.1/alpha.2）→观测哨语义漂移。实装 0.1.7-alpha.1（+0.1.6-alpha.2 对照）探 Events 面：改名若已落地→触发器实质已响走 R73 采纳蓝图+override 枚举重推导；未落地→触发器从版本号锚定改修为特征锚定（事件名出现于任一发布家族版本）。轨二（B）：R76 审计显式 backlog 清算——F-5⑥ parser 行形状↔gen-adr-index render 措辞耦合、F-5⑦ gov-r76-registry-canonical-lock 条目缺 sibling 字段（编辑须走 normalize 流程=字节锁自食其锁实证）、spec 残余三处（titleRound 误登记面/grill-round-<非数字> dir 隐形/coverage 红压 leg-(a) 诊断序）、F-6 BOM 报错文案帮不了用户修 BOM。
- **显式约束/负向需求**：其余落选债原名续 deferred 记显式续债条非默认飘过——transformers 债（#1764 仍 OPEN）、provider-serverside、dsh 三件套、bitmap（工具缺席）、registerHooks-esm-arm（trigger(c) 仅 Node 腿响、真实 ESM 消费者仍零）、f16/f17、domain-ownership 均不动；外发闸（#1764/#1087 文稿）仍用户动作项；grill 期间不动源码；A+B 是用户显式双轨裁决（突破一轮一题默认，依据=两轨同属治理机器残账且 A 有即时性窗口）。
- **状态**：current
## D-002 — 轨一 watch-and-rehearsal 管线设计（atomcode 交叉后终审）

- **原问题**：Q2 终审——轨一 dsh 观测哨管线设计：A+=L0/L1/L2 漏斗+respect-and-schedule+特征/稳定性双锚触发器+latest-only 配墓碑 / B=重锚 0.1.7-rc.1 / C=绕龄期闸抢跑 / D=两段式不分层每版补 L2。
- **用户原回答原文**：「采纳」（采纳 A+，即调研裁定版 A）
- **规范化需求**：轨一=分层哨戒漏斗+触发器重写——(1) L0 元数据层：npm view 拉新版本+publish timestamp 喂龄期闸日历；(2) L1 静态探针：npm pack tarball→解包 .d.ts→与 pin 版消费面 API 期望快照 diff（consumer-side API report，API Extractor/apiguard 先例）——含破坏特征（agent/created 事件+source/signal payload）即标 ALARM 写 evidence transcript；npm pack 不走 pnpm resolver→闸内可合法探测闸门外版本，非 bypass 是不归闸管；(3) L2 安装彩排（repin→install→tsc 期望 RED）只给「ALARM+过 48h 闸+rc-or-stable」采纳候选，每闸门出口至多一个（latest wins）；(4) 龄期闸=respect-and-schedule 绝不 bypass 不豁免（Renovate pending→passing/Dependabot 默认冷却同构；scratch-dir bypass=实质提前消费未检疫版，gate exemption=fail-open-with-exceptions）；(5) 触发器三层重写：特征锚定（候选 .d.ts 存在 agent/created+payload 含 source/signal）判定「要不要关心」+稳定性锚定（rc-or-stable+changelog 审）判定「能不能采纳」+版本号降级为 transcript 记录字段永不进触发逻辑；alarm 跟随发布走（alpha 可响），adoption 跟随稳定性走；(6) 跳窗版本不欠逐个 L2 但欠墓碑条目（version/superseded-by/L1-diff 摘要——Y 若 RED 时 X 的 L1 快照即归因证据）；(7) 本轮实例化：L1 今天跑 0.1.5-rc.3+0.1.7-alpha.1（0.1.6-alpha.2 对照已有 R73 实证）；L2 出闸后（~09-24）只对最新合格候选跑一次；registry defer-r73 触发器改写走 canonical normalize 流程。
- **显式约束/负向需求**：ADR-0074 cadence 教条显式修订——「每次上游发版跑安装预演」降层为「每版都有 L1 证据+留档，L2 只给采纳候选」（正确收缩=降层非减少，须在 ADR-0078 记明修订理由：leapfrog 证伪版本锚定+latest-only 工具收敛先例）；不绕龄期闸不为其开 per-dependency 豁免；alpha 线此后只走 L1 不例行 L2；触发器不得再含具体版本号；静态探针误报率需一次实测校准（信息缺口记档）；pnpm 闸对 catalog repin 拦截行为作本地实验项记档。
- **状态**：current
## D-003 — 轨二 R76 审计 backlog 处置范围

- **原问题**：Q3——轨二 backlog 处置：A=全量清算 7 项同票 / B=只清行为类 5 项文书类续债 / C=轨二全缓。
- **用户原回答原文**：「A」
- **规范化需求**：轨二全量清算 7 项（同一失效类「gate 可因遗漏/误导而说谎」+同文件面 ship-gate.mjs/closeout-coverage.mjs/governed-json.mjs）：(1) titleRound 误登记面——含「Grill Round N」文字的任意非 round ADR 标题即误登记（fail-loud 向）→收紧为确切行形状匹配；(2) grill-round-<非数字> dir 隐形——scanRoundDirs regex 静默滤除使两个漂移方向都不可见→显式计数/报告（fail-loud 或 surfaced skip）；(3) coverage fail() 先于 leg-(a) lint——红态下 lint 诊断被压→调序或合并输出，观测序变化补申报；(4) canonical 锁空清单报 pass——stepGovernedJsonCanonical 对空 CANONICAL_JSON_FILES 绿=「nothing to check=green」自相悖→fail-closed；(5) F-5⑥ parser 非 marker 行形状↔gen-adr-index render 措辞耦合→解耦或互注（shotgun-surgery 点）；(6) F-5⑦ gov-r76-registry-canonical-lock 条目补 sibling 字段（title/source_adr/opened_at/owner/deadline/review_cadence/monitoring_channel）——编辑走 canonical normalize 流程=字节锁第二轮自食其锁实证；(7) F-6 BOM 文案升级——BOM'd registry 报「not valid JSON」且 normalize 修不了 BOM→专门报错教修 BOM。
- **显式约束/负向需求**：7 项不再续债（再续即成 backlog 的 backlog）；每项修复须带红方向实测行使（延续「没见过红的检查=与不可能失败的检查不可区分」教义）；不改写审计已核销项的既有行为契约（leg-b 字段 lint 面不动仍是约束）；文书类项（6/7）与行为类（1–5）同票但 diff 语义可分组。
- **状态**：current
## D-004 — R77 票序结构

- **原问题**：Q4——双轨票序：A=三票串行证据先行（T0 轨一探针→T1 轨二 backlog→T2 文书收口） / B=轨二先行 / C=四票拆分 / D=轨一合并单票。
- **用户原回答原文**：「A」
- **规范化需求**：三票串行——T0 轨一探针取证（纯证据零源码）：L0 npm view 全族 versions+timestamps watch 快照归档+L1 静态探针（npm pack 拉 0.1.5-rc.3/0.1.7-alpha.1+pin 版 0.1.5-rc.2 消费面 API 期望快照=Events 键+src/index.ts:87 所用 payload 字段→.d.ts diff）归档 .scratch/grill-round-77/evidence/；产出事实喂 T2（改名是否已上稳定线/payload 是否再变/家族包数是否再扩）。T1 轨二 backlog 清算（D-003 七项同票）：closeout-coverage.mjs+governed-json.mjs+ship-gate.mjs 修复逐项红方向实测；F-5⑦ 补字段走 normalize=字节锁第二轮自证；turbo check/test+相关腿直跑+ship-gate 绿。T2 文书收口：registry defer-r73 触发器改写（特征+稳定性锚定删版本号）+墓碑政策+落选债 carried_log 续记（全走 normalize）+upgrade-ledger.md v2（降层 cadence+L1 对 expected-RED 先验预测）+ADR-0078+CONTEXT 新词+handoff（#1764 哨/外发闸/L2 排程态）+pathlint 登记 round-77+but commit 干净；不 bump 判定入 ADR。因果序：探针事实先于触发器措辞定稿；F-5⑦ normalize 自证先于 T2 大批量 registry 编辑。
- **显式约束/负向需求**：票边界=探针证据与 registry 改写不混票（证据/动作边界）；不 bump 判定须显式入 ADR 非默认跳过；落选债续债条显式记非飘过。
- **状态**：current
## D-005 — R77 收口判据

- **原问题**：Q5——收口判据：A=三段收口+排程态合法（L2 条件式处置） / B=收口等 L2 实跑 / C=不写 L2 排程。
- **用户原回答原文**：「A」
- **规范化需求**：三段收口——(i) 探针段：L0 watch 快照+L1 diff 归档（每版本一份 transcript：Events 键面/payload diff/家族包数）+pin 版消费面 API 期望快照落盘+逐版本显式 ALARM 判定（「无 alarm」也是结论非沉默）；(ii) 轨二段：7 项全修+逐项红方向实测行使+F-5⑦ normalize 自证+turbo check/test+ship-gate 绿；(iii) 文书段：ADR-0078（分层漏斗+双锚触发器+respect-and-schedule+latest-only/墓碑政策+ADR-0074 cadence 修订记录）+registry（defer-r73 触发器改写+墓碑条目若产生+落选债续债+updated bump）+upgrade-ledger v2+CONTEXT 新词+handoff（#1764 哨/外发闸/L2 态）+pathlint 登记+but 干净；不 bump 判定入 ADR。L2 处置=条件式：L1 检出合格候选（ALARM+rc-or-stable）→记 dated scheduled obligation（出闸日期+latest-at-exit 规则）入 registry/ledger/handoff，本轮不吊死等闸（Renovate pending→passing：等待态是合法终态）；无合格候选→「no qualifying candidate」显式结论即收口证据；期间被跳窗版本写墓碑。
- **显式约束/负向需求**：三段缺一段不收口；红方向必须实测行使；ALARM 判定逐版本显式（不许沉默）；L2 排程义务必须落锚点（registry/ledger/handoff）非口头悬债；被跳窗版本墓碑条目非省略。
- **状态**：current
