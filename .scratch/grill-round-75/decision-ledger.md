# Grill Round 75 — Decision Ledger

> 防丢账本：每条经用户确认的实质性结论当场追加。状态枚举：current/revised/stale/deferred。
> 唯一权威数据源——整理/压缩/handoff 前必须已落盘到最新。

## D-001 — R75 主题定界

- **原问题**：R75 主题定界（deferred 悬池+触发器事实出候选）：A=transformers 未声明外部债清算轮 / B=shipgate-1g 单题轮 / C=R71 三债打包轮 / D=dsh 生态轮 / E=另指。
- **用户原回答原文**：「A」
- **规范化需求**：R75 = `defer-r71-transformers-undeclared-dep` 判定性清算轮。监控条件疑似已响（transformers 4.x 把 onnxruntime-node/web 收进直接 deps，undeclared-external 面被上游重写）。本轮=spike 验证 4.x 下 `onnxruntime-common` require 面是否真消失 → 二选一施工（迁 4.x 拆 patch+自声明 dep，或留 3.8.1 带新证据显式续债）→ embedding 双臂（npm/pnpm）复验 + release 判定。
- **显式约束/负向需求**：落选债项（尤其 shipgate-1g——registry 明示不得再静默飘过）本轮账本须记显式续债条，非默认飘过；grill 期间不动源码；dsh event-rename 续哨戒不动（0.1.6-rc.1 未发）；logo bitmap 续 deferred（imagegen 缺席）。
- **状态**：current

## D-002 — R75 施工姿势（atomcode 交叉后终审）

- **原问题**：Q2 终审——R75 施工姿势：A+=判定「删除条件未达成」→patch 续存+上游申报+留 3.8.1+registry 刷新（ESM 缺口另问）/ B=迁 4.x+patch 重定向 / C=A+B 双轨 / D=纯证据刷新不申报。
- **用户原回答原文**：「采纳」（采纳 A+，即调研裁定版 A）
- **规范化需求**：姿势 A+——(1) 判定上游删除条件未达成（4.3.0 解剖+atomcode 双证：manifest 未声明 onnxruntime-common、node.cjs 顶层 bare require 仍在）；(2) scoped patch 续存（fail-open 设计使上游真修时自动 no-op、零退役成本；运行时 patch 是唯一随发布包旅行保护 pnpm 消费者的机制——packageExtensions/patchedDependencies 均消费侧配置不旅行，fork=末路）；(3) 上游申报：先读 #1087 全部评论（避免复述已驳回论点），在既有线程补 4.2/4.3 双版本 pnpm 复现+「下游≥4 项目各自造轮子」证据（episodic-memory#105/mastra packageExtensions/GitNexus#2069/本项目），或直交一行修 PR——申报形态票内定；(4) 留 transformers 3.8.1 不迁；(5) registry 证据刷新：4.3.0 解剖结论+版本配对纪律（自声明 onnxruntime-common 版本须对齐 effective onnxruntime-node 内嵌版本）+#1087 链接+watch 改 >4.3.0。
- **显式约束/负向需求**：不迁 4.x（B 否——sharp 零增量、真成本=ORT 1.21→1.30 换线+e5/q8 新导出策略兼容复验、收益仅追维护线）；C 双轨重定为演进项非本轮（触发条件：e5 q8 在 4.x 生态复验通过+上游修复仍无进展）；不申报（D）排除；勘误入档：sharp eager-load 3.8.1 已存在非 4.x 新增（决策矩阵剔除该轴）；上游申报属外发动作，发布形态（issue 评论/新 issue/PR）与账号通道须经用户确认；ESM 入口缺口（import() 消费者无 patch 保护）为新浮出子项，处置另问。
- **状态**：current

## D-003 — ESM 入口缺口处置（atomcode 交叉后终审）

- **原问题**：Q3 终审——ESM 入口缺口处置：B+=静态护栏双件+缺口与重返触发器记文档+registerHooks 具名重返票 / A=registerHooks ESM 臂现在上 / C=仅文档。
- **用户原回答原文**：「采纳」（采纳 B+，即调研裁定版 B）
- **规范化需求**：姿势 B+——(1) 静态护栏双件：a) embedding src 禁止裸 import/from/动态 import() 直引 @huggingface/transformers（no-restricted-imports 规则或 grep 型断言，唯一合法入口=createRequire().require()）；b) 配对断言单测：自声明 onnxruntime-common 版本 ≡ effective onnxruntime-node 内嵌依赖版本（手工同步隐式契约→CI 事实，防 Tensor 双实例）；(2) 缺口与三条重返触发器记 registry/limitations/ADR：a) 任何代码路径开始 ESM import 加载 transformers；b) 上游修 #1087（届时整个 patch 可退役）；c) Node 地板 ≥22.15+出现真实 ESM 消费者（届时按 GitNexus#2069 姿势上 registerHooks：fail-open+从 effective onnxruntime-node 动态配对）；(3) registerHooks 作具名重返票显式 deferred。
- **显式约束/负向需求**：不上 registerHooks（Stability 1.1→1.2 experimental、process-global 解析钩、type:module 包具名 import 在 <22.15 link-time SyntaxError 税、jest/vitest 自有 loader 下可能不生效、零可达面防御码=负收益）；CJS patch 不动（_resolveFilename 全版本地板工作，registerHooks 无增量）；条件启用语义澄清入档（<22.15 静默无防护不比显式不设防更糟也不更好，仅在决定设防后才成实施细节）；GitNexus A 路线前提=其自有 dynamic import 可达面，我们零可达面先例不迁移。
- **状态**：current

## D-004 — 上游申报形态与通道

- **原问题**：Q4——申报形态与通道：A=advocate 已飞修复（#1764 评论落证据推合并优先级，可选 #1087 短评指路）+通道(a)我起草用户审后亲手发 / B=#1087 评论 / C=新 issue / D=自交一行修 PR。
- **用户原回答原文**：「采纳」（采纳 A+通道 a）
- **规范化需求**：申报形态=advocate 已飞修复非重交——在 #1764（nico-martin 自开 OPEN PR，已含 onnxruntime-common:1.24.3 声明+NODE_IGNORE_MODULES 配套）落评论，弹药=4.3.0 仍顶层 bare require 的实证+published 消费者裸奔（pnpm 隔离 scope）+下游 ≥4 项目各自造轮子成本（episodic-memory#105/mastra packageExtensions/GitNexus#2069/本项目 scoped patch）+关联 #1087；可选 #1087 一条短评指路服务后来检索者。通道=我起草评论全文→用户审阅→用户以本人 GitHub 账号亲手发→发布链接/状态回录票据。
- **显式约束/负向需求**：不自交一行修 PR（重复维护者已写 hunk）；不新开 issue（修复已在飞，新开=分流）；#1764 未 merge 则 defer-r71-transformers-undeclared-dep 续存——申报成功≠删除条件达成，merge 落地才算；外发文稿须经用户审阅亲手发（不经 gh 直发）；发布时点由用户定，轮内「完成」=文稿实物+递交记录，发布链接后补。
- **状态**：current

## D-005 — R75 票序结构

- **原问题**：Q5——票序结构：A=四票串行（T0 活证据补强→T1 申报文稿+用户审阅闸→T2 静态护栏双件→T3 文书收口）/ B=T2 先于 T1 / C=T0+T1 合并三票 / D=去 T0 纯解剖即申报。
- **用户原回答原文**：「A」
- **规范化需求**：四票串行——T0 活证据补强（pnpm 隔离 scope fixture 实测 4.3.0 仍 ERR_MODULE_NOT_FOUND+3.8.1 对照绿，产 evidence transcript）；T1 申报文稿（#1764 评论全文+可选 #1087 短评起草入 .scratch/→用户审阅闸→用户亲手发→链接回录；轮内完成=文稿+递交记录，链接后补）；T2 静态护栏双件（禁裸引断言按 repo 既有 lint 形态选型+配对断言单测+turbo test/check 绿）；T3 文书收口（registry 刷新+ESM 缺口+三触发器+ADR-0076+CONTEXT 新词+found/fixed/deferred+落选债显式续债条+handoff+pathlint 登记 round-75+but commit 干净；发布判定=无发布态代码增量→不 bump 版本，判定入 ADR）。
- **显式约束/负向需求**：T1 含用户审阅闸（外发必经用户）；T0 不可省略（静态解剖须升运行时复现）；发布判定须显式记录非默认跳过；落选债项（shipgate-1g/provider-000/dsh 三件套/bitmap/f16/f17/domain-ownership）记显式续债条非飘过。
- **状态**：current

## D-006 — R75 收口判据

- **原问题**：Q6——收口判据：A=四段收口（实证/申报/护栏/文书）/ B=护栏绿+文稿递交即收口 / C=只账本约定。
- **用户原回答原文**：「A」
- **规范化需求**：四段收口——(i) 实证段：4.3.0 pnpm 隔离 scope 复现 transcript（ERR_MODULE_NOT_FOUND 运行时实证）+3.8.1 对照绿+tarball 解剖归档 .scratch/grill-round-75/evidence/；(ii) 申报段：#1764 评论文稿实物+用户审阅确认记录+发布链接或「待用户发」显式状态回录；(iii) 护栏段：禁裸引断言+配对断言单测落地+turbo check/test 绿+ship-gate 绿（含 parity/pathlint 腿）；(iv) 文书段：registry 证据刷新（4.3.0 解剖+#1764 链接+配对纪律+watch>4.3.0）+ESM 缺口三触发器+registerHooks 具名重返票+落选债显式续债条+ADR-0076+CONTEXT 新词+CHANGELOG 如需+handoff（#1764 merge 观察哨）+pathlint 登记 round-75 自证+but commit 干净+origin/r71-grill 已消失事实呈报核销。
- **显式约束/负向需求**：四段缺一段不收口；「待用户发」是合法的申报段终态（外发权在用户）；pathlint 自证=本轮文档自身过 lint。
- **状态**：current
