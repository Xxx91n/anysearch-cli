# atomcode R91-Q3 调研归档：票序编排+commit 结构+纳编边界

> 存档于 2026-09-29。prompt=.scratch/grill-round-91/q3-prompt.txt。全文在 FTS5（source=atomcode，标题含 R91-Q3 报告节）。

## 执行摘要
推荐 A′=A+两处修订（置信高）：①**T3 拆分**——README 行对齐留 T3 条件票，readme-token claims 立法挪 T6 收口件批（无条件；claims 在降格档价值更大=established/not-established 机检载体，不该被 README 门锁住）；②**T4 并入 T5**——WORKFLOW.md ADR 判死降为 T5 批内 docs commit（十轮悬案是纯文档裁决无独立失败面，独立成票稀释主题）；T5=四小件四 commit。approval-channel 探测成本低则挂 T2 同 rig 顺跑，否则留 T5，产出 evidence-only。

## 分点结论
- 2.1 立法→通道确认→执行→文档=工业标准 gate ordering（Kualitee：smoke 在 build 后 integration 前，推迟=defeats its reason；Scrum Alliance：AC=pass/fail 预注册）。T1 通道确认=T2 硬前置（测试环境须 mirror production 才有绿的意义），保持独立票对。C 两源否决。
- 2.2 条件票惯例（本仓 R83 TE1/R89 D-003+GitHub Actions if: 类比）：T3 门=判词≥降格档与 D-002 三分支对齐无违例；但 T3 原案装了条件+无条件两件事=编排瑕疵（条件票不应携带无条件内容否则「未启不留痕」语义被污染）。
- 2.3 B 否决（三源）：交互路径 headless 测不到→假阴性污染判词（Microsoft Learn 交互登录难自动化/Test Guild headless 可观测限制/仓内一手观察）。探测=Spike 先例（Fowler：时间盒探索产出知识非交付物），降为顺验正确；成本低可挂 T2 同 rig 省环境重建但产出 evidence-only 不入判词。
- 2.4 deprecate 位置：npm 官方=可逆 metadata 更新+immediately effective+不占发布关键路径；javascript-package-publishing=reviewable/repeatable+记录于 notes——R87 D4 模板逐字重放（备准+尝试+EOTP 失败呈报）。纪律点：message 应 specific/actionable/short，修双空格顺手核对文案质量合法，改写措辞超范围。
- 2.5 WORKFLOW 终审：ADR 判死=正确处置（双源）。写件=给等价覆盖造第二真源；ADR supersede 语义（Microsoft Learn）把外部承诺显式登记为「由等价机制覆盖」；「Documentation Theater」反模式=为审计压力写没人维护的文档。判死须用 ADR 非 commit-note——decision 需要可引用。
- 2.6 ship-gate 正则 fix 独票：s*→s* 是行为变更（第二选言死代码变活）性质是 fix；第一选言兜底零爆炸半径。

## 最强反对论据（对 A′ 自身）
- T6 变重（5 件）+claims 立法在 T6 做则机检本轮无法跑→R91 README 修改仍人眼背书，与锐评意图一拍延迟。**回应**：R87 deprecate 核销先例=「立法落地+回执核销下轮翻 green」两拍节奏；把机检首跑显式登记为 R92 候选票比条件票塞无条件立法诚实。
- T4 并批后 pathlint 扫新 ADR——判死文引用 ~/.gemini 等路径须 machine-local marker（R79/R80 惯例可循非阻塞）。<!-- machine-local: atomcode 报告原文引用的用户级宿主配置路径示例 @ 2026-09-29 -->

## 隐藏依赖清单（题面未点出，须立法）
1. **T1 是 T2 硬前置闸非并列 evidence**：通道被证伪→L3b 不可执行→判词直接 F-bug 分支→T3 门永不开。标为 T2 entry criterion。
2. **T3→T6 跨轮词汇依赖**：claims 机检的 established 字段取值语义必须与 D-002 判词三分支词汇表一字不差，否则 R92 首跑即红——立法票预注册字段词汇。
3. **ship-gate fix 须先于 T6**：检测器先修再写它要扫的文档（顺序本已对，成文化）。
4. **deprecate OTP 闸=零写入半残留**：closeout-claims 按 R87 D4「执行态如实记账」模板，不得记 clean fail。
5. **TC 判定窗口 T0 一次定死**：T0 目击 stable→TC 启会改 T2 宿主选型（D-002 钉 0.1.7-rc.2）；T2 开始后不再复观，否则宿主版本轮中漂移违单版本约束。

## 信息缺口
- 「可行性探测」无教科书对应物（借 Spike+顺验仓内先例类比，置信中）；approval 交互不可验为仓内一手观察外部仅通证级支撑；conditional ticket 同精度外部先例未找到（本仓惯例自身是最强权威）。

## 来源（10）
npm Docs deprecate/javascript-package-publishing/Microsoft Learn 自动化集成测试/Test Guild headless/Kualitee Smoke Testing 2026/Scrum Alliance AC/adhdecode npm deprecate/本地 ledger+ADR-0088 D4+R90 handoff（一手）/hidekazu-konishi ADR operations/Fowler Bliki ADR+Spike（后两者弱支持仅摘要）。
