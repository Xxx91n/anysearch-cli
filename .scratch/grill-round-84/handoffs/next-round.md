# R84 → 下一轮 任务书（零记忆接手）

> 唯一权威账本=.scratch/grill-round-84/decision-ledger.md（8 条全 current）。本任务书只组织执行序，不替代账本原文；冲突以账本为准。票序 D-008 定死禁调。

## 状态快照

- **基线**：R83 全栈落地审计 PASSED（ADR-0084 垂域贯通：SearchRequest.vertical+verticalDomainSupported 能力位+retrieval.vertical.pre 七键事件+形状校验；TE1 dsh 全族 0.1.7-rc.1+agent/created+source==='startup' guard），栈并入主线 base acaaccb3。
- **本轮产出**（本目录）：decision-ledger.md（D-001~D-008）/goal.md 定稿/q1~q8-atomcode.md 调研存档+qN-prompt.txt/CONTEXT.md R84 词块（10 词）。
- **registry 面**：prefer-capable open（注记将更新为「证据机制在役等数据」——T4 活）；defer-r81-anysearch-rest-route-removed 等旧项续挂。
- **用户侧悬挂**：#1764 OPEN 趋僵（评论外发属用户扳机不代发）。

## T0 — 哨戒续班（常驻面，不占主轴）

- **覆盖**：无（哨戒非裁决项）。
- dsh rc.2 复检：闸窗已过（npm 09-24T14:18Z+48h）——查 changelog 面是否补齐、全族钉版现状（rc.1 in-repo）复核；rc.3+ 版本线续 watch；tarball 特征锚复验。
- test-online-anysearch CI 腿观测+llm-init SSE flake 哨续班；#1764 用户侧不代发。
- **红线**：ANYSEARCH_ENDPOINT 用户配置域不录不代改；新产物不录本机环境具体值（R82 远期规则）。
- **suggested skills**：`triage`（哨项分流）、`atomcode-research`（rc.2 changelog 若需外部核验）。

## T1 — 契约层+语义前置（断言键 schema+A-02/A-04 立法）

- **覆盖**：D-002 契约层、D-004 断言键面、D-007 A-02/A-04。
- **内容**：
  1. **A-02 语义立法**（先于断言）：三入口错形行为统一——配置输入边界 fail-fast 方向（CLI/TOML 对齐 MCP「拒收报错」或三入口统一「忽略+显式 warn」，**修法定型是本票 Red 阶段语义决策非实现细节**；断言只许依赖立法后行为）。
  2. **A-04 语义立法**：sub_domain_params:{} 空参 wire 语义定义（发或不发）=params_keys 断言的独立真理源。
  3. looks 账册 schema 增断言键：expected.vertical{domain,sub_domain,paramsKeys}+verticalHit+degraded 语义+expected.vertical.role:"control" 对照键；typed TS+编译器同步惯例（ADR-0027 D11）。
  4. offline 确定性用例全绿（stub 臂验 wire/标记/degraded 语义）。
- **验收谓词**：断言键 schema 入库+offline 全绿+A-02/A-04 立法文档化（ADR-0085 草案段）+三入口行为对齐立法结果。
- **红线**：断言禁落未立法语义（Pact Golden Rule）；禁断言先于立法合入；修法定型不许拖成「维持现状但没立法」。
- **suggested skills**：`tdd`（先红后绿——立法断言先红）、`diagnosing-bugs`（三入口行为差异定位）。

## T2 — 语料构建（四域×三类分层 ~60-70 条）

- **覆盖**：D-003、D-006、D-004 对照键落条目面。
- **内容**：
  1. 四域语料：finance（参数面）/academic（差似然面）/code（画像面）/health（风险面），每域 ~12-17 条；对照类一等断言类 ≥12-15 条（总盘 ~60-70）。
  2. 三类分层 per-stratum 内部核算：参数化垂域查询（sub_domain+params 最强信号）/语义垂域查询（domain-only）/对照查询（域外/歧义——expected.vertical=null/mustNotHit/degraded=general-fallback）。
  3. provenance 全字段：constructed/llm-assisted+reviewer+audit trail+harvestedAt；LLM 辅助草稿**跨家族**模型（禁与被测/上游同族）+人工抽审同严真实条目。
  4. query 侧事实收集先行：消费 retrieval.vertical.pre 审计数据测垂域占比/子类分布；首窗稀薄**如实记**（证据件记 coverage 缺口不删层）；垂域分布复检列常驻观测项。
  5. 采集通道常驻：incident-derived 条目（vertical miss/general hit 首采对）append-mostly+日期元数据入册作 candidates 非 golden（silver→gold 晋级门）。
  6. 每域对四判据承载轴+「高风险剔除→高估」论证标推导级——域选择 rationale 随集落盘。
- **验收谓词**：golden.entries 达量分层覆盖、对照类≥12-15、provenance 全字段、首窗观测报告如实、采集通道机制在册。
- **红线**：禁全域薄铺/单域外推/等真实流量才建集；LLM 辅助禁同族；合成条目禁低评审入 gold；per-stratum 样本量下限按 rankkit queries_needed 思路估算核（D-004 账本明示）。
- **suggested skills**：`domain-modeling`（词表贴合）、`research`（各域 sub_domain 活词表探查——get_sub_domains 仅人工建集用不进运行时）、`atomcode-research`（语料质检复核）。

## T3 — 证据层 live 腿（双臂配对 delta+per-stratum 报告）

- **覆盖**：D-002 证据层、D-004 delta 形制、D-005 双层测量。
- **内容**：
  1. 双臂配对 runner：同 query 同期盼集 vertical-on vs vertical-off 两趟 run——**臂级隔离 delta=主证**（anysearch 臂两次原始结果集对照）、**融合级 delta=副列**（最终融合列表对照，只报告不断言加权收益已兑现）；一次 run 两层顺带产出。
  2. delta 证据件：per-stratum 分列 hit-rate 两档（host 命中率+host+页族强命中率）+expectRankOf 整数差+better/worse/tied+dataset fingerprint+臂标识+**n 显式标注不构成统计结论**+CI 字段位留 schema 不设门禁。
  3. 证据件诚实记：unknown/未达量字段记 null/unknown 非 0；分层稀薄记 coverage 缺口不删层。
  4. live 腿落 packages/store/test/online/ 惯例面（eval-looks-live.online.ts 同邻）；offline 降格按 ADR-0060 D7 如实记；默认公网端点承担 live 断言。
  5. quarantine 棘轮/fingerprint/ship-gate 在场断言同惯例接管新条目（live drift→quarantine 非删条）。
- **验收谓词**：delta 证据件产出携全溯源字段、臂级主证+融合级副列分列、live 腿绿或如实降格、quarantine/fingerprint/ship-gate 接管在场。
- **红线**：禁融合级 delta 作 prefer-capable 前置（三重混杂）；禁臂级 delta 解读为融合收益已兑现；禁小样本设显著性门禁；judge 评语仅附报告。
- **suggested skills**：`tdd`（runner 断言先行）、`diagnosing-bugs`（live 降格归因）。

## T4 — 收口（文书+registry+审计就绪）

- **覆盖**：D-008 收口面、D-007 A-05/A-07 复核行+A-03/06/08 清障轮登记、D-006 ip 条件性第五域标注、D-001 interleaving 远期出口。
- **内容**：
  1. ADR-0085 起稿：主题/契约双层/语料法/断言形制/测量范围/域选/前置语义立法/收口判据八段——含显式假设标注（host 断言区分度=显式假设；高风险剔除→高估=推导级；对照类 12-15=仓内自定首轮校准义务）+interleaving 远期出口节。
  2. registry：prefer-capable 注记更新为「证据机制在役等数据」（**非核销**——数据读出前保持 open）；ip 条件性第五域新项（触发=上游补齐 ip 子域结构化参数）；A-03/A-06/A-08 清障轮项登记。
  3. 收口复核行：A-05（第 7 键与 ADR-0084 对账）+A-07（evidence 命令 ./ 前缀）。
  4. nit 两档规则+Goodhart 对称警惕+兜底两则承袭三段收口；审计就绪（验收谓词绿+映射表+found/fixed/deferred 三联）。
- **红线**：禁提前核销 prefer-capable；禁为 checkbox 补证（Goodhart）；对照类 12-15 首轮实测校准义务如实记档。
- **suggested skills**：`domain-modeling`（CONTEXT 词表复核）、`neat-freak`（收口对账）、`handoff`（下轮交接）。

## 全局红线（各票共通）

- 数据源纪律：执行以账本为准；账本无据的结论须停下呈报禁自补。
- 承继否决项不回潮：跨 provider 词表映射/运行时 get_sub_domains/静态枚举副本/retrieval.vertical.post/params 值入审计/深合并/#1764 代发/ANYSEARCH_ENDPOINT 代改。
- judge 只进建集辅助与报告不进确定性门禁；delta 证据件非门禁项。