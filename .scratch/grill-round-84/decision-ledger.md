# Grill Round 84 — Decision Ledger

> 防丢规则：每个被用户确认的实质性结论当场追加一条记录——ID（D-001 起）、原问题、用户原回答原文、规范化需求、显式约束/负向需求、状态（current/revised/stale/deferred）。


## D-001 — R84 主轴裁决（垂域 eval 面，调研修订版）

- **原问题**：R84 主轴——A′ 垂域召回质量评测面（query 侧事实收集先行+垂域金标集+双臂质量差证据+LLM judge 限建集不进闸+interleaving 远期出口）/ B prefer-capable 直接调参 / C dsh 宿主验收 / D audit-rework 批次主轴 / E 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：R84 主轴=`fix-r84-vertical-eval-leg`——垂域召回质量评测面：(a) query 侧事实收集先行（消费自家 retrieval.vertical.pre 审计数据测垂域占比/子类分布，再定覆盖域）；(b) 垂域金标集（RTEB 最小规模形制：≥50 query、任务类分层、BM25 类基线对照）；(c) 垂域臂 vs general 臂质量差证据产出（prefer-capable 前置所需的证据形态）；(d) LLM judge 只进建集辅助与报告、不进确定性门禁（与 ADR-0028 D2 心智一致）；(e) interleaving 在线面记为 ADR 远期出口（与 dsh 宿主阻塞同类挂账）。
- **显式约束/负向需求**：prefer-capable 本轮不动工（无数据调权=零正例先例+违 Goodhart 警惕）；audit-rework 七项不占主轴（降为辅轴候选）；dsh 宿主验收续挂（unverified-at-host）；评测不触碰 ANYSEARCH_ENDPOINT 用户配置域；调研保留项——BM25 5× 差异仅 Broadoak 单源，进 ADR 时降级为「方向性引用」。
- **状态**：current
- **证据基**：atomcode R84-Q1（q1-atomcode.md；Netflix/Airbnb 离线闸先例、DIR 加权归并文献、RTEB/OmniEval/Broadoak 垂域建集法）

## D-002 — 评测面落点形态（双层扩展现有族谱，调研修订版）

- **原问题**：垂域评测腿落点——A′ 双层扩展现有族谱（契约层 looks 账册新增垂域断言键+证据层垂域质量差条目入 eval-looks golden.entries 双臂共享 query 分别断言+delta 证据件携 fingerprint+臂标识溯源）/ B 平行新面 / C 纯报告腿 / D 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：评测腿落点=扩展现有族谱，不新建第二账册：(i) **契约层**——looks 账册新增 `expected.vertical{domain,sub_domain,paramsKeys}`+`verticalHit` 标记+degraded 语义断言键，offline 确定性跑（ADR-0027 D11 typed TS/编译器同步惯例）；(ii) **证据层**——垂域质量差条目入 `eval-looks.json` golden.entries（live-scoped、domain 打标、任务类分层、internal-dogfood provenance），双臂共享同一批 query 分别断言，delta 证据件携 dataset fingerprint+臂标识溯源；(iii) quarantine 棘轮/fingerprint/ship-gate 在场断言同惯例接管；(iv) incident-derived 条目（vertical miss/general hit 首采对）按 append-mostly+日期元数据入册；(v) LLM judge 只进建集辅助（label 候选/聚类）与报告评语，不进确定性门禁。
- **显式约束/负向需求**：禁止第二本账册（双 fingerprint/双棘轮对账=静默腐烂点翻倍）；禁止无指纹报告腿（不可复现不可归因）；judge 不进门禁（ADR-0027 D1 anti-pattern 裁定在先）；looks 条目结构膨胀须 domain 打标防混 scope；delta 本轮不定门禁阈值（证据件非门禁项——query 级最小样本量/显著性实践留待需要时另研）。
- **状态**：current
- **证据基**：atomcode R84-Q2（q2-atomcode.md；Langfuse 单治理面多 scope/aievals 三哈希溯源/prodinit 腐烂点失败模式/Airbnb 双臂 delta 形制）

## D-003 — 垂域金标语料构建法（分层子集+构建式语料，调研修订版）

- **原问题**：垂域金标语料的覆盖域+查询源+分层形态——A′ 分层子集+构建式 / B 全 17 域薄铺 / C finance 单域深挖 / D 纯 dogfood 等待 / E 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：语料=分层子集+构建式：(i) 覆盖域=3-4 域按**四判据**分层选——参数结构丰富度×垂域差似然×agent-CLI 用户画像贴合×**上游已知风险点**（出枚举静默回退/sub_domain/params 拒绝压力，已实测行为=最廉价差似然证据）；(ii) 总盘 ~60-70：每域 12-17 条+**对照类一等断言类 ≥12-15**；(iii) 查询三类分层且 per-stratum 内部核算（聚合分不动而切片塌掉须可见）；(iv) 对照条目用独立断言键（expected.vertical=null / mustNotHit / degraded=general-fallback 形制——直测上游静默回退行为，不与垂域条目共用断言通道）；(v) 源=撰写+LLM **跨家族**辅助草稿人工抽审（SILENCER 同族偏差规避）+**采集通道常驻**（silver→gold 晋级，构建条目随真实流量成熟退为 bootstrap 层）；(vi) provenance 记 constructed/llm-assisted+reviewer/audit trail+harvestedAt；(vii) query 侧事实收集如实记「首窗稀薄」+垂域分布复检列常驻观测项。
- **显式约束/负向需求**：禁全域薄铺（低于最小样本共识带+放不下对照类）；禁单域外推普适主张；禁等真实流量才建集；LLM 辅助不得与被测/上游同模型家族；合成条目须与真实条目同严评审（否则稀释 golden 信任基础）；域间分配非均摊（按四判据得分配）。
- **状态**：current
- **证据基**：atomcode R84-Q3（q3-atomcode.md；Scale AI 分层估计/Google silver→gold/Langfuse candidates-not-golden/Samuel Ochoa negative 四类/QASkills sizing/tianpan SILENCER）

## D-004 — 断言计分形制与 delta 证据件形态（分层断言制+配对 delta，调研修订版）

- **原问题**：证据层条目断言粒度与 delta 证据件形态——A′ 分层断言制+同判据双臂配对 delta / B 纯判定式 judge 打分 / C 弱结构断言 / D 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：(i) 断言键按 D-002 契约层定义（expected.vertical{domain,sub_domain,paramsKeys}+verticalHit+degraded）；(ii) 证据层断言粒度分层——参数化查询锚 curated mustHitHosts+mustHitPaths（页族），语义垂域查询期望面更宽（host+页族+minResults），字节级 mustHitUrls 仅限 stability_class=controlled/frozen-spec（内容轮转不押字节级 URL）；(iii) 对照条目独立断言键 expected.vertical.role:"control"，对照臂失败走 degraded 名单而非红门（存在性=一等断言，通过性不是）；(iv) delta 证据件=per-stratum 分列的配对差分——per-arm hit-rate 两档（host 命中率+「host+页族」强命中率）、rank 位置差（双臂同命中 query 的 expectRankOf 整数差+better/worse/tied 计数）+dataset fingerprint+臂标识+judge 评语附报告；**显式标注小样本 n 不构成统计结论**，不设 CI/显著性门禁（证据件非门禁项）但 schema 留 CI 字段位；(v) live 腿落 packages/store/test/online/ 惯例面（eval-looks-live.online.ts 同邻），offline 降格按 ADR-0060 D7 如实记；默认公网端点承担 live 断言（ANYSEARCH_ENDPOINT env 用户域不录不代改）。
- **显式约束/负向需求**：judge 不做主证据（SIGIR'26 金标评估者分层+llm-judge-bench 偏置实证——垂域恰是裸 judge 最差场景）；judge 建集辅助须 reviewer 审核后入 gold（D-003 silver→gold 门）；「垂域评测 host 断言区分度」无大厂一手先例——作显式假设记入 ADR；per-stratum 样本量下限估算参考 rankkit queries_needed 思路于建集落盘时核；C 式结构断言降为 smoke/管线存活检查不承担质量证据职责。
- **状态**：current
- **证据基**：atomcode R84-Q4（q4-atomcode.md；rankkit 配对差分+queries_needed 检验力/SIGIR'26 assessor 分层/llm-judge-bench 偏置量化/pooled-LLM-eval 相关性验证/Sentifish 双臂实例）

## D-005 — delta 测量范围/臂定义（双层测量、臂级为主证，调研修订版）

- **原问题**：同一批 query 的 vertical on/off 对照在哪一层测量出证据——A′ 双层测量臂级主证 / B 仅臂级 / C 仅融合级 / D 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：(i) 臂级隔离 delta（anysearch 臂 vertical-on vs vertical-off，同 query 同期盼集，per-stratum 配对差分）=prefer-capable 前置的**直接证据**（主证管归因）；(ii) 融合级 delta（最终融合列表 on/off）=**副列报告**（答「融合自然浮出率多高、加权收益上限多少」=传导验证面），只报告不断言加权收益已兑现——加权收益最终确认属 prefer-capable 调参后再评测；(iii) 一次 run 两层顺带产出（共享同 query 集同期盼集，无额外语料成本）；(iv) 「命题→测量层级映射」判据固化（融合贡献命题→融合级 primary（ADR-0046 先例）；臂能力命题→臂级 primary（本轮）——主从排序随被门禁命题而变）。
- **显式约束/负向需求**：禁融合级 delta 作 prefer-capable 前置（三重混杂：垂域臂质量差×其余臂稀释×融合归并——无法区分「臂无增益」与「他臂代偿遮蔽」，消融批评文机理级证据）；禁把臂级 delta 解读为融合收益已兑现断言；若未来对融合质量命题设门禁须回归融合级 primary（ADR-0046 精神，per-arm 独立门禁决策=Avoid）。
- **状态**：current
- **证据基**：atomcode R84-Q5（q5-atomcode.md；TREC FedWeb 三任务拆分/Ng 五步循环传导验证/消融代偿遮蔽批评/RAG internal-external 二分；信息缺口：权重调参前须证组件级差异无一手规范，间接支持=TREC+RAG 组件监控）

## D-006 — 覆盖域具体圈选（finance+academic+code+health 四域，调研修订版）

- **原问题**：覆盖域具体圈选——A′ 四域 finance+academic+code+health / B 三域 finance+academic+code / C 换 health→ip / D 另指组合。
- **我的原回答原文**：采纳
- **规范化需求**：(i) 覆盖域=**finance+academic+code+health**，四轴各一域承载——finance=参数面（calendar/fundamental 子域参数最丰，仓内上游实测）、academic=差似然面（arxiv/semanticscholar vs 泛网语义隔离度最大+研究画像贴合）、code=画像面（agent-CLI 天然垂域）、health=风险面（唯一「高风险+上游子域词表严校验动机最强」组合）；(ii) 每域 ~12-17 条+对照类一等断言类 ≥12-15（D-003 总盘 ~60-70 不变），per-stratum 分层核算；(iii) **ip 记条件性第五域**——触发条件=上游补齐 ip 子域结构化参数，落 ADR/registry 标注不作本轮裁决；(iv) 域选择 rationale 与证据等级随集落盘（每域对四判据的承载轴+「高风险剔除→高估」论证标推导级）。
- **显式约束/负向需求**：禁剔除唯一轴承载域（health 缺位=效度漏洞非覆盖缺口——无域可暴露「高风险查询被静默降级」失败模式，结论系统性高估泛网回退可接受度）；禁按单维排序取 top-k（多轴正交选域）；禁 17 域浅摊/单域深挖（PolyBench 实证 4 域×分层紧凑胜 3 域×堆量）。
- **状态**：current
- **证据基**：atomcode R84-Q6（q6-atomcode.md；BEIR 轴覆盖四因子+Jaccard 差似然形式化/RTEB 企业域三域重合先例/Comp-Comp 反 data-scaling/Do-Not-Trust-Benchmark 域错配首因/LegalBench-RAG 高风险域独立评测先例；信息缺口：参数丰富度判据无直接文献、方向性偏差属推导级、RTEB open/private 不对称不可核验）

## D-007 — audit-rework 批次去向（耦合分流，调研修订版）

- **原问题**：R83 审计登记建议 A-02~A-08 七项去向——A′ 耦合分流 / B TE 式整批辅轴 / C 整批 defer R85 / D 另取舍。
- **我的原回答原文**：采纳
- **规范化需求**：(i) **前置语义立法类**升主票——A-02（三入口错形行为立法：配置输入边界 fail-fast 方向，CLI/TOML 对齐 MCP 拒收报错或三入口统一「忽略+显式 warn」，断言只依赖立法后行为——修法定型归票内）+A-04（sub_domain_params:{} 空参 wire 语义先立法=params_keys 断言的独立真理源）；(ii) **收口复核类**折进收口清单——A-05（第 7 键已披露，与 ADR-0084 对账）+A-07（evidence 命令 ./ 前缀）；(iii) **无耦合清障类**落 registry 归清障轮——A-03 flagValueSet 吞词+A-06 三处组装重复+A-08 dead maxResults；(iv) 无独立辅轴；(v) **失真判据固化入词表**——「该发现不修，主票验收标准是否失真？失真→前置并入主票；不失真但同文件收口→复核行；完全不影响→清障轮」。
- **显式约束/负向需求**：禁断言落在未立法语义上（Pact Golden Rule——断言合法域=已立法承诺非偶然行为）；禁断言面先于语义立法合入（先严后松：语义歧义在断言固化前收紧，反向代价高）；禁整批一刀切（AppSec reachability 分流先例——可达升主票/披露层复核/不可达清障）；A-02/A-04 属主票 Red 阶段语义决策非实现细节。
- **状态**：current
- **证据基**：atomcode R84-Q7（q7-atomcode.md；Pact Golden Rule+V3 先严后松/EDD eval-即规格/TDD tautological+implementation-coupled 反模式/Orca reachability 分流与两失败模式/boy-scout 边界判据；信息缺口：语义空洞非命名术语三源合成、耦合度分流属类比映射）

## D-008 — 轮结构与收口判据（原序 T0→T4+三段承袭+证据面专条+两补，调研修订版）

- **原问题**：R84 票序与收口判据——A′ 四票+哨戒原序+三段承袭+证据面专条+两补 / B 调序 / C 收口判据另取 / D 另指。
- **我的原回答原文**：采纳
- **规范化需求**：(i) 票序=T0 哨戒续班（rc.2 锚复检+test-online flake 哨+#1764 用户侧仍挂）→T1 契约层+语义前置（断言键 schema+offline 用例+A-02/A-04 语义立法与实现对齐）→T2 语料构建（四域三类分层~60-70+对照类+provenance 全字段+LLM 跨家族辅助+人工抽审+首窗稀薄诚实记）→T3 证据层 live 腿（双臂配对 runner+per-stratum 报告+delta 证据件 fingerprint+臂标识+n 标注+CI 位留 schema+offline 降格如实记）→T4 收口（ADR-0085+CONTEXT 新词+registry 核销新增+nit 两档+Goodhart+兜底两则）；(ii) 收口判据=三段承袭（验收谓词绿+registry nit 两档去向+审计就绪）+本轮证据面专条——delta 证据件产出且携 fingerprint/臂标识/n 标注、语料达量分层覆盖、对照类≥12-15、契约断言 offline 绿、live 腿绿或如实降格；(iii) **两补**——证据件 unknown/未达量字段记 null/unknown 非 0（agent-axiom 铁律防 Goodhart）；分层稀薄记 coverage 缺口不删层；(iv) prefer-capable registry 注记更新为「证据机制在役等数据」（非核销——数据读出前保持 open）。
- **显式约束/负向需求**：禁调序（schema→语料→runner 业界五阶段序+仓内依赖链硬性要求）；D-005 融合级副列为仓内自创形制无完全同构先例——判据从严按如实降格档；对照类≥12-15 为仓内自定数（业界仅 10-25% 分层占比类比带——首轮实测反馈校准义务入 T4）。
- **状态**：current
- **证据基**：atomcode R84-Q8（q8-atomcode.md；agent-axiom schema=合同+unknown≠zero 铁律/ai-tldr 五阶段序+50-100 起步量/hashorn 分层配比 60-70/20-25/10-15/tech-insider 迁移级版本纪律/galtea 跨 run 一致性/OpenAI+AWS Bedrock 双 runner 共享 schema 官方实现；信息缺口：大厂内部排序一手复盘不可得、对照类精确数靠首轮校准）
