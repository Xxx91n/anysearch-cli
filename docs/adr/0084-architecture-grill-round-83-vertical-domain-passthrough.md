# ADR-0084: Grill Round 83 — 垂域贯通轮（AnySearch vertical-domain passthrough + TE1 dsh 事件迁移兑现）

## Status

Accepted (grill round r83; 主轴票 fix-r83-anysearch-vertical-domain-passthrough + 条件辅轴 TE1 fix-r82-dsh-event-created-consumption 双双落地). Records the round-83 decisions per ticket plan T0/TE1/T1/T4. Ledger: `.scratch/grill-round-83/decision-ledger.md` (D-001~D-007, 无断号). Evidence root: `.scratch/grill-round-83/evidence/`.

## Context

ADR-0083 收口时将垂域贯通具名出票（defer-r83-anysearch-vertical-domain-passthrough）：R82 评估腿实证 AnySearch MCP `domain` 是 17 值垂域路由枚举而非 hostname allowlist，与 `SearchRequest.includeDomains` 不同轴——不得复用。同时 defer-r73-dsh-event-rename 的双锚在 2026-09-25 齐（rc.1 过 48h 龄期闸+tarball 特征锚+release 审面），TE1 预注册票当日消费。本轮主题即这两条线的收口。

## Decision

### D1 主题定界——垂域贯通轮（D-001）

主轴=垂域贯通（契约+路由+审计+校验四面）；辅轴=TE1 条件兑现（双锚齐当日先行，时间盒 ≤ 主轴 20%）；验收标准叠加用户原文：「编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环」。

### D2 契约面——vertical 字段独立成轴（D-003）

- `SearchRequest.vertical?: { domain: string; subDomain?: string; params?: Record<string, unknown> }`——内部统一 `vertical*` 命名，wire 名（domain/sub_domain/sub_domain_params）只在 anysearch adapter 边界映射。kernel `Query = SearchRequest & extras` 自动承继。
- 仓 TOML：`DomainSchema.sources.vertical{domain,sub_domain?}`（TOML 面 wire-adjacent 命名），resolve() 走 section-replace 语义——derived 重述即整体替换，无深合并。
- 工具 arg：`search_web`/`research_web` 增 `verticalDomain/verticalSubDomain/verticalParams`；CLI `ans search` 增 `--vertical-domain/--vertical-sub-domain/--vertical-params`；查询级给出 verticalDomain 即整体替换仓级默认（sub/params 无 domain → fail-fast 形状错，AJV 表达不了的依赖由 handler 补）。
- **正交红线**：垂域轴与 host allowlist 轴（urlAllowlist/domain_filter.pre/post）互不引用、互不假设——两个 `.pre` 事件各自独立触发。

### D3 路由面——能力协商 hint 扇出（D-004）

- `SearchProvider.verticalDomainSupported?: boolean` 镜像 `domainFilterSupported` 形态；AnySearchProvider 声明 true。
- engine 扇出：声明者收 `req.vertical`；未声明者 general 扇出并记入 degraded 名单——垂域是路由**提示**不是门（lost hint ≠ abstain），未声明 provider 的结果照常进融合。
- repoVertical 与 urlPolicy 同一 liveSchema 闭包（lazy-mtime reload，TOML 热改免重启）。
- 垂域命中标记：`NormalizedResult.extra.vertical={domain,subDomain?}`——机读、fusion 保活。

### D4 审计面——retrieval.vertical.pre（D-005）

每次 resolved vertical 非空发一条：`anysearch.domain` + `anysearch.vertical.domain` / `.sub_domain` / `.params_keys`（**只记键名，参数值永不进审计**）/ `.source`(repo|query) / `.sent` / `.degraded`。无 `vertical.post`（无 post-阶段语义可记）。domain_filter.pre 触发条件原样不动。

### D5 校验面——上游词表权威唯一（D-006）

本地只验形状：domain/sub_domain 非空字符串、params 为 Record。词表与参数约束归上游 `get_sub_domains`——客户端不复制枚举、不运行时回查、不写静态副本。上游非法组合回 `isError` → fail-first 臂降级（实测矩阵见 evidence/t1-vertical-domain.md：bogus sub_domain→"Invalid tag"；缺 required param→"Missing required params"；枚举外 domain→上游静默退回 general——如实记录该宽容面）。词表+约束以带日期快照写 README §AnySearch vertical domains（人读面非代码面）。

### D6 TE1 兑现——agent/created + startup guard（D-002）

双锚齐当日消费 rc.1：@deepseek-ai/* 全族 0.1.5-rc.2→0.1.7-rc.1（catalog+overrides 21 名 peer 闭包重推导；新增 7 包，退役 code-runtime/util-crypto；cordis 4.0.2→4.0.4）。`ctx.on('agent/session-start')` → `ctx.on('agent/created')`，`source==='startup'` guard（resume/clear/compact 不重注入）；contextMessage 适配 MessageId brand+自有 anysearch-plugin MessageSourceMap 增扩。L2 彩排（pack→plugin add→dump-config 层验+幂等）绿。旧宿主（<0.1.7）下 payload 无 source → guard 自然不注入=静默降级，如实记录非崩坏。

### D7 nit 两档处置（审计残余 4 项 + 本轮新发 1 项）

| nit | 档位 | 处置 |
|---|---|---|
| 度量行自指（R82 报告 9→10 commits） | 登记 | 历史报告不翻案——审计文已载修正值，此处记录性闭合 |
| JSON 回复容忍缺 id（与 SSE 路不对称） | 即修 | post() JSON 路径缺 id 即 throw（对齐 SSE 严格度，spec MUST） |
| clientInfo.version 硬编码 0.0.8 漂移 | 即修 | anysearch.test.ts 增漂移闸（源字面量 vs package.json version） |
| engines 地板缺席 | 即修 | 8 包 package.json 增 `engines.node >=22.0.0`（CI 实证地板，不虚标） |
| cli e2e chat 用例被环境 ANS_LLM_* 污染（本轮新发） | 即修 | run() 增 env 参+用例剥壳 ANS_LLM_* 保 hermetic |

### D8 收口纪律（D-007）

closeout-claims.json 机验声明注册；deferred-registry 核销 defer-r83（closed by ADR-0084）+defer-r73-dsh-event-rename（closed by ADR-0084）+新增 prefer-capable 加权调参跟进项（eval 数据驱动，非契约职责）。

## Rejected alternatives

- **复用 includeDomains 承载垂域**：R82 评估腿实证两轴正交（垂域枚举≠host 列表），硬翻=假声明。
- **深合并仓/查询两级**：优先级语义模糊化（D-003 否决）——查询级整体替换。
- **params 入 TOML**：动态值（symbol 类）入仓=领域理念不表达（D-003 否决）。
- **vertical.post**：无 post-阶段语义（D-005 否决）。
- **运行时 get_sub_domains / 客户端枚举副本**：TTL 缓存伪真理/复制上游权威（D-006 否决）——词表只写人读档。
- **跨 provider 词表映射 / prefer-capable 加权**：半径外，后者具名跟进（D-004 §4）。
- **TE1 延期**：双锚齐+当日消费判据成立，延期=漏斗空转一轮。
