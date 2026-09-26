# ADR-0085: Grill Round 84 — 垂域评测证据腿（vertical-eval leg：契约断言 + 金标语料 + 双臂配对 delta）

## Status

Accepted (grill round r84; 主轴票 fix-r84-vertical-eval-leg). Records the round-84 decisions per ticket plan T0/T1/T2/T3/T4. Ledger: `.scratch/grill-round-84/decision-ledger.md` (D-001~D-008, 无断号). Evidence root: `.scratch/grill-round-84/evidence/`.

## Context

ADR-0084 落地了垂域贯通契约（`SearchRequest.vertical` + `verticalDomainSupported` 能力位 + `retrieval.vertical.pre` 七键审计），并在 deferred-registry 挂出 `defer-r83-prefer-capable-weighting`——prefer-capable 加权是 eval 数据驱动项，不是契约职责。本轮不碰加权本身，只把「信息专精」的质量证据机制建起来：契约层断言 offline 确定性 + 证据层金标集 live 双臂配对 delta。产出读数前 prefer-capable 保持 open。

## Decision

### D1 主题定界（D-001）

主轴 = 垂域评测证据腿（契约断言面 + 语料面 + live delta 腿 + 收口文书）。禁事项承袭账本：interleaving/实验导出不进本轮（远期出口见 D9）；prefer-capable 调参延后至数据读出。

### D2 契约双层（D-002）

不新建第二账册——扩展既有 `eval-looks.json` 族谱：

- **契约层（offline 确定性）**：`expected.vertical{role,domain,sub_domain,paramsKeys,paramsSent,hit,degraded}` 断言键入 `packages/store/src/eval/docs-golden.ts` 校验器；stub 臂在 `packages/kernel/test/eval-looks-stub.test.ts` 钉 wire 形状、结果标记与 degraded 名单语义。
- **证据层（live 配对）**：`packages/store/test/online/eval-looks-vertical.online.ts` 配对 runner 产 `anysearch/vertical-delta@1` 证据件，携 `datasetFingerprint`（id+spec+expectation+scope 排序 sha256-hex16）、臂标识、显式 n。
- 数据集指纹与 quarantine 棘轮沿用既有惯例接管垂域条目（live drift→quarantine 非删条）。

### D3 语料法（D-003/D-006）

四域 × 三类分层：`vert-f*`finance（参数面）/`vert-a*`academic（差似然面）/`vert-c*`code（画像面）/`vert-h*`health（风险面）；stratum ∈ {parameterized, semantic, control}。对照类一等断言类（`role:"control"`）直测域外/歧义/上游静默回退面。provenance 全字段（type/ref/harvestedAt/reviewer）。sub_domain/params 词表**只取当日实测活词表**（建集期 `get_sub_domains` 人工探查快照 `.scratch/grill-round-84/evidence/sub-domains-vocab.json`，不进运行时——D-006/ADR-0084 D5 承袭）。

显式假设标注：

- **host 断言区分度 = 显式假设**：hitHosts 池按「垂域数据源宿主」定义（如 fmp 族），命中只证「上游把请求路由到了垂域源」，不证结果质量。
- **高风险剔除→高估 = 推导级**：高风险词表条目剔除的理由是推导（上游拒收组合会全灭配对），非实测统计。
- **对照类 ≥12-15 = 仓内自定首轮校准义务**：12-15 是首轮下限不是文献定值，校准责任在本轮实测读出。
- **第五域（ip）条件性**：上游 ip 子域补结构化参数前不建集（registry 新项 defer-r84-ip-fifth-domain）。

### D4 断言形制（D-004）

- 不可测格一律 `null`/`unknown`，绝不记 0（agent-axiom 铁律防 Goodhart）。
- 对照臂失败走 degraded 名单非红门——存在性一等断言，通过性不是。
- delta 三档 verdict：better/worse/tied + unknown（臂缺席/无池=unknown）。
- `paramsSent:false` 钉 A-04 wire 语义（params:{} ≡ absent）。

### D5 测量范围（D-005）

**臂级 delta = 主证**：隔离 `ANS_PROVIDERS=anysearch` 的 anysearch 臂原始列表（优雅窗会取消慢臂——全扇出下的臂缺席是时序产物，单列 `armInFanoutOn/Off` 如实记不作测量）。**融合级 delta = 副列**，只报告不断言加权收益已兑现（三重混杂：RRF 位置 + 其他臂构成 + 优雅窗存活）。`n` 显式标注不构成统计结论；`ci` 字段位留 schema 不设门禁（~60 条规模对 +0.01 检出力差数量级，小样本设显著性门禁是伪科学）。

### D6 前置语义立法（D-007 A-02/A-04）

先于断言立法（Pact Golden Rule——断言禁落未立法语义）：

- **A-02**：三入口错形统一为 **fail-fast 拒收报错**。CLI `--vertical-sub-domain`/`--vertical-params` 无 `--vertical-domain` → 报错退出；空串 domain/sub_domain → 报错；`--vertical-params` 非 JSON 对象 → 报错。TOML `sources.vertical` 对齐同一形状校验。MCP 侧 AJV 约束原样（本就拒收）。立法全文：`evidence/t1-semantics-legislation.md`。**返修补记（2026-09-27 审计 F1）**：schema 层 `validate()` 抛错但 `composition.ts` catch 曾按 `sources.weights` 单字段放行——错形 TOML 被吞成静默全扇出且整域丢弃；已修为 `Domain schema:` 族错误全放行（缺域 `Domain not found` 仍 fail-open——缺席≠错形），kernel `composition-vertical.test.ts` + CLI e2e 坏 TOML 负径在钉。
- **A-04**：`params:{}` ≡ absent——单一真理源 `canonicalizeVertical`（contract.ts）在 engine 审计事件与 anysearch wire 边界两点复用；`sub_domain_params` 只在 params 为非空 Record 时序列化；`params_keys` 断言以 canonicalize 后键集为真理源。

### D7 收口判据（D-008 + D-007 复核行）

- 票序 T0→T4 定死；收口 = 验收谓词绿 + registry nit 两档去向 + 审计就绪三联（found/fixed/deferred）。
- **A-05 复核**：`retrieval.vertical.pre` 七键与 ADR-0084 D4 对账——`anysearch.domain` + `vertical.domain`/`sub_domain`/`params_keys`/`source`/`sent`/`degraded`，本轮只消费不扩张（无第八键）。
- **A-07 复核**：`ans evidence` 命令 `./` 前缀路径面未动（本轮无 evidence 命令变更，登记为无操作复核行）。
- nit 两档：本轮新发 `ANYSEARCH_ENDPOINT=""` 空串经 `??` 落到空 endpoint（应视同未设回落默认）——登记 defer 项（清障轮候选），非本票半径。

### D8 本轮新发 deferred 登记（D-007）

| id | 事由 | 处置 |
|---|---|---|
| defer-r84-anysearch-empty-endpoint-env | `ANYSEARCH_ENDPOINT=""` 空串不满足 `??` → endpoint 为空臂 fail；POSIX 惯例空≈未设应回落默认 | defer-with-ticket（清障轮） |
| defer-r84-ip-fifth-domain | ip 域待上游补结构化子域参数再建集 | deferred-with-condition（D-006） |
| defer-r84-delta-quota-rerun | 匿名额度耗尽致首轮 delta 部分降格；持有效 key 或额度恢复后重跑取全量读数 | deferred-with-condition |

prefer-capable（defer-r83-prefer-capable-weighting）注记更新为「证据机制在役等数据」——**非核销**。

### D9 interleaving 远期出口（D-001）

interleaving/对照实验导出（把垂域评测嵌进主检索管道的在线 A/B 形态）是远期方向：需要真实流量样本量与实验框架支撑，超出本轮半径。本轮的双臂配对 delta 腿是离线索引形态——同一 query 同期盼集的 on/off 对照，query difficulty 在配对内抵消。若未来流量面成立，出口顺序：先本腿读数判 prefer-capable 是否有收益信号，再议 interleaving 立项。

## Rejected alternatives

- **第二账册**：双 fingerprint/双棘轮对账=静默腐烂点翻倍（D-002 否决）。
- **无指纹报告腿**：不可复现不可归因（账本禁项）。
- **judge 进确定性门禁**：judge 评语仅附报告（账本禁项）。
- **断言落未立法语义**：Pact Golden Rule（A-02/A-04 先立法后断言）。
- **0 记 unknown**：Goodhart 对称警惕——未达量记 null/unknown。
- **融合级 delta 作 prefer-capable 前置**：三重混杂（D-005 否决）。
- **全域薄铺 / 单域外推 / 等真实流量才建集**：账本明令否决。
- **运行时 get_sub_domains / 静态词表副本**：ADR-0084 D5 承袭否决。
- **小样本显著性门禁**：样本量对目标效应量差数量级（D-004 否决）。

## Consequences

- 证据机制在役：`pnpm -C packages/store test:online`（在线腿，配额允许时）；offline 断言腿并入常规 `pnpm test`。
- delta 证据件默认落 `.scratch/vertical-eval/delta.json`（round-neutral 通道）；`ANS_VERTICAL_DELTA_OUT` 可改址；`ANS_VERTICAL_DELTA_LIMIT=N` 限冒烟切片。
- 首轮 live 读数受匿名配额限为部分降格——重跑条件与机制证据见 `evidence/t3-vertical-delta.md`。
