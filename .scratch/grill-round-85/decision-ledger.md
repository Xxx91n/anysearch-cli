# Grill Round 85 — Decision Ledger

Slug: grill-round-85 · 基线: r84 审计 PASS (acaaccb3..+stack) · 主题源: 锐评第七轮核账 + R84 审计签核方向指示
规则: 每条含 ID/原问题/用户原答/规范化需求/显式约束·负向需求/状态(current|revised|stale|deferred)

## 记录

### D-001 · R85 主轴裁决

- **原问题**：Q1 终审——R85 主轴裁决（调研修订版）
- **我的原回答原文**：采纳
- **规范化需求**：R85=delta 腿全量重跑 + prefer-capable 前置判读（evidence-only 轮）：(1) 重跑配对 runner（packages/store/test/online/eval-looks-vertical.online.ts）再生 anysearch/vertical-delta@1 四面全量证据件（datasetFingerprint+臂标识+显式 n+better/worse/tied/unknown+providersFailed），核销 defer-r84-delta-quota-rerun；(2) prefer-capable 判读预注册三分出口——GO=臂级 delta 方向性收益信号在场→defer-r83-prefer-capable-weighting 注记转「数据在手，下轮设计加权」；NO-GO=无信号或显著为负→关闭该挂账；INCONCLUSIVE=附具名下触发条件（如配额再耗尽/语料扩量），不许裸 INCONCLUSIVE；(3) 读数法=配对符号检验为主（better/worse 计数差）+效应量+CI 区间，不报 p 值不设显著性门禁；判读双问题=增益效应量有多大 + 是否显著为负（后者为加权硬闸）；(4) 配额守卫=adaptive pacing+按 stratum 优先级截断+null 格回填而非弃跑；单次终读纪律（禁中途 peeking 改判）；(5) 轮次完成定义=registry 注记状态变更+决策记录落盘，非「拿到数据」。
- **显式约束/负向需求**：加权实施不在本轮（实施归下一轮）；清障项（defer-r84-anysearch-empty-endpoint-env/defer-r83-a03/a06/a08/Standards smell/control 降级口径）仅 boy-scout 搭车不占票不稀释主题；不设显著性门禁/CI 阈值；INCONCLUSIVE 必须附具名继续条件；禁止跑批中途多次读数改判；ANYSEARCH_ENDPOINT 用户域不入档。
- **状态**：current
- **证据**：q1-atomcode.md（posse 六格矩阵/Spotify 序贯测试/eBay arXiv:1710.03410 损失阈值/GrowthBook×Kohavi 低功效拆解/parin.work last-responsible-moment/stage-gate Gate 3，高置信）

### D-002 · 预注册判读矩阵形态

- **原问题**：Q2 终审——预注册判读矩阵（调研修订版）
- **我的原回答原文**：采纳
- **规范化需求**：判读矩阵=三轴+生效条件+记录字段，run 前全量落盘预注册：
  (1) 覆盖前置闸：处理层 nPaired/n≥70% 且 unknown≤30%，不达标→INCONCLUSIVE；**对照层独立闸**：control stratum non-tied≥4/16 或 unknown>8/16→整轮 INCONCLUSIVE 装置旗标（对照层通过是处理层判读的必要合取条件，不进方向分；判别顺序=先 unknown 缺失模式→方向一致性→对称噪音）；
  (2) 方向轴：处理层合并池 Beta(1+better,1+worse) 后验——P(better>worse)≥0.8 且池化 armHostHit on>off → GO；P≤0.5 或池化≤0 → NO-GO；0.5<P<0.8 → INCONCLUSIVE 附具名下触发；决策记录须声明「0.8≡flat-prior 单侧 α0.2 的代数等价，低于平台默认 0.90–0.99，evidence-only 轮业务选择」；
  (3) 负向硬闸：四域封闭列表（finance/academic/code/health）预注册——任一域 worse−better≥3 记反向域，≥2 反向域→NO-GO；记录声明「业界先例=任一否决/all-pass，2-of-4 为误否决率控制插值（null 下 ~5–23% vs 任一 ~42–65%），设计选择非引用」；事后新增切分（按 stratum 等）无否决权只能记假设；
  (4) 效应量四字段双读落决策记录：净胜率 (better−worse)/nPaired + P(better>worse) + 期望损失 EL + rankDiff 中位；
  (5) 生效条件=单次终读——发生二次读取/peek 矩阵作废；
  (6) 功效注记：本轮 n 下只可分辨 |ΔarmHostHit|≳0.4（Airbnb Power Guardrail 精神写入记录）。
- **显式约束/负向需求**：矩阵须先于任何读数落盘；不报 p 值不设显著性门禁；对照层只作装置健康侦测；per-domain/stratum 只作副列无否决权；融合级列只报告不进门；阈值进 closeout-claims 声明面备审计复核。
- **状态**：current
- **证据**：q2-atomcode.md（Microsoft ExP SRM/Spotify Bayes 分层/VWO·Statsig·GrowthBook 平台默认/Airbnb guardrails/JAMA 阴性对照/Fagerland 2013 配对检验，17 源，高置信）

### D-003 · 轮结构与票序

- **原问题**：Q3 终审——R85 轮结构与票序（调研修订版）
- **我的原回答原文**：采纳
- **规范化需求**：五票序+四处调研加固：
  **T0 哨戒续班**——dsh rc.3+ 版本线 watch、#1764 用户侧挂账不代发、test-online CI 观测、锐评第七轮核账结论归档入报告档；
  **T1 预注册件落盘**——.scratch/grill-round-85/prereg-matrix.md 承载 D-002 全矩阵+**早停规则本体也入件**（stop/investigate 规则先于 launch 登记）+四域封闭列表+单次终读生效条款；**commit 先于任何读数**（SAP-先于-database-lock 时序先例，预注册与重跑不可并票）；
  **T2 重跑执行**——语料冻结（run 前断言 fingerprint=7ac0a48e55cd7954，漂移即装置旗标）；存量降格件按仓内 runs/<ts> 归档惯例存档不删；**对照层先行作仪器健康探针，装置旗标即早停**；runner 最小改动=条目调度加 control 前置排序位，commit 注明「instrument-health ordering, no sampling-protocol change」（探针语义+配额副产物，不宣称业界标配）；CONCURRENCY 维持；
  **T3 判读+决策记录**——确定性判读脚本读 delta.json 按矩阵查表出裁决（机器算不人手算）；脚本+矩阵+输入指纹一并 T1 commit（先于读数，否则脚本可被指事后写）；decision-record.md 落四字段（净胜率/P/EL/rankDiff 中位）+出口+per-domain 副列+**operator/verified-by 人签认字段**（Part 11 签认语义）；
  **T4 收口**——GO→prefer-capable 注记转「数据在手信号正向，下轮设计加权」+具名跟进票；NO-GO→挂账核销附判词；INCONCLUSIVE→registry 显式 hold 态+具名触发带量化锚（|Δ|≳0.4 功效注记+n 条件），作下轮入口检查项；CONTEXT 新词+closeout-claims 注册矩阵阈值；GO/NO-GO 终局立 ADR-0086，INCONCLUSIVE 不立 ADR 只落报告（ozimmer：无选择无 decision record，但不可静默）。
- **显式约束/负向需求**：预注册 commit 必须先于任何读数，无可证性则矩阵作废；早停规则不得 T2 现场决定；判读不得人肉改判脚本输出；INCONCLUSIVE 不得静默遗忘（必须显式 hold+量化触发）；INCONCLUSIVE 不立 ADR 但报告须全字段。
- **状态**：current
- **证据**：q3-atomcode.md（FDA E9/ECTU SAP SOP/ExP SRM/GrowthBook/AWS ADR 指南/ozimmer/lakeFS·DVC，18 源，中高置信）

### D-004 · 重跑执行细节包

- **原问题**：Q4 终审——重跑执行细节包（调研修订版）
- **我的原回答原文**：采纳
- **规范化需求**：
  (1) 处理层调度序=**域轮询交错**（vdomain×stratum 轮转非语料原序；配额耗尽时 null 格均布四域保 per-domain 副列与 2-of-4 否决闸可判性；预注册件写死「截断轮未完成域格记 structural missing 并入 unknown，不作有效格」）；
  (2) 截断处置=**分层应对**：轮询使截断近似 MAR→已完成格保留进判读+decision-record 记 truncation 注记（各域完成格数）；覆盖闸不达标仍走既有 INCONCLUSIVE，不设第五出口；若缺失与域相关（排后域）=结构性 MNAR→显式标记不可用；
  (3) 工件驻留分级：prereg-matrix.md/decision-record.md/调研档入库提交（.gitignore 增 grill-round-85 白名单行，承 R84 惯例）；delta.json 驻机器本地通道 .scratch/vertical-eval/（可再生证据件惯例）；降格件就地改名 delta-2026-09-26.degraded.json 归档不删；decision-record 以路径+指纹引用 delta.json 不入库本体；
  (4) boy-scout 同面=**hunk 邻接级**（本轮改动 hunk 所在文件内、与改动函数有直接调用/定义邻接关系的 smell；跨文件同目录也不算）；搭车修独立 commit（BSR 式可 cherry-pick/裁量）；封闭清单限 runner 面五项（argv 序列化重复/kill-timer 未清/fakeSink 重复/marked 遮蔽/isVerticalEntry 三法并存）；离面项（empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical 边角/MCP 缩进）一律留清障轮。
- **显式约束/负向需求**：轮询序是唯一不引入未注册决策自由的默认（优先级序需已注册先验，禁）；入库决策件与本地证据件不得混级；搭车修绝不与行为变更混 commit；「per-domain 副列+2-of-4 否决」为仓内自创设计，ADR-0086 如实记为首创非业界移植。
- **状态**：current
- **证据**：q4-atomcode.md（SIGCOMM'03 SRR/DVC 官方/lakeFS/KDD'18 受限预算/CEBM 偏倚目录/Rubin 缺失分类/Code-with-Jason+Schneide boy-scout，13 源，高置信）

