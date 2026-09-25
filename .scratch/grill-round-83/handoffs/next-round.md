# Round-83 任务书 — 垂域贯通轮（主轴 T1 + 条件辅轴 TE1 闸开先行）

Date: 2026-09-25（R83 grill 定稿时生成）。本轮账本 .scratch/grill-round-83/decision-ledger.md（D-001~D-007 全 current，唯一裁决记录源）；goal.md=主题与显式范围外；调研存档 q1~q7-atomcode.md（各题工业先例与修订点）；评估腿依据 .scratch/grill-round-82/evidence/t1-domain-leg.md；TE1 预注册票 .scratch/grill-round-82/issues/02-fix-r82-dsh-event-created-consumption.md。Stack 约定同前：r83-grill（本文档+账本）← 实施栈叠其上。

## 状态快照（接手即知）

- **基线**：R82 全栈已落地+审计 PASSED——AnySearchProvider 已迁 MCP-over-HTTP（POST /mcp 薄 JSON-RPC，eventsource-parser 唯一新 dep）；fail-first 映射收口（isError/错形 200→臂级降级不吞零）；endpoint 剥尾规范化；max_results clamp 10；modes 不下发。common base 17e9c3f2，工作区净。
- **registry 现况**：defer-r83-anysearch-vertical-domain-passthrough=open（本轮主轴→in-flight）；defer-r73-dsh-event-rename=open（TE1 触发源）；defer-r81-anysearch-rest-route-removed=open quarterly 监控续；residual-r82-R1~R5=closed；其余 open 项按既有 cadence 续守本轮不动。
- **dsh 双锚现状**：特征锚=齐（rc.2 tarball 直检 lib/types/runtime-types.d.ts:227 agent/created 携 source/signal、session-start 全包缺席）；稳定锚=未齐（rc.1 龄期闸≈2026-09-25T13:25Z、rc.2≈09-26T14:02Z；changelog 审面缺席=tarball 无 changelog，上游仓待补检）。SessionStartSource 实测枚举=startup|resume|clear|compact——guard 写 source!=='startup'。
- **CI 新面**：test-online-anysearch job（continue-on-error 非阻断）首周观测期。
- **用户侧悬挂**：#1764 评论外发仍挂（不代扣）；ANYSEARCH_ENDPOINT 用户个人配置域（不录不代改）。

## T0 — 哨戒续班（常驻，覆盖 D-001 §4、D-007 §1）

1. dsh 出闸复检：rc.1/rc.2 龄期闸时点核对（npm view @deepseek-ai/dsh-{agent,tools,mcp-client} time——已过闸则双锚重判）；特征锚 tarball 复验（新版发布则重验 agent/created+source/signal+session-start 缺席）；**changelog 审面补检=上游仓**（非 tarball——tarball 无 changelog 已实证）；
2. #1764 哨（OPEN 趋僵续记）；
3. llm-init.test.ts SSE flake watch（R82 窗内未复现续记）；
4. test-online-anysearch 首周观测（非阻断 job 是否误报/真探——首周结论入 evidence）；
5. 格式化结论行+截至戳 → evidence/t0-watch-<date>.md（含**双锚判定行**：特征锚齐/未齐+稳定锚齐/未齐+判定=触发|未触发+理由）。

## TE1 — fix-r82-dsh-event-created-consumption（条件辅轴·闸开先行，覆盖 D-001 §2、D-002）

- **触发判据（双锚缺一不可）**：特征锚=最新候选 tarball 复验 agent/created 携 source/signal 在场且 agent/session-start 缺席；稳定锚=rc 或 stable 线出 minimumReleaseAge 闸+changelog 审面已检。
- **执行序（D-002）**：双锚齐**当日**先消费 TE1 主体至出闸或时间盒耗尽（以先到者为准），完毕即刻全力进 T1 主轴。**论证边界三条件入档**：①双锚判据成立②时间盒≤主轴 20%③闸开当日消费——缺一规则回「主轴落地后」默认序，本例不援引自动成立。
- **票内容**：repin dsh-* 依赖族按新锁文件重推导（上轮实测约 21 包）+apps/dsh-plugin/src/index.ts:87 事件监听 agent/session-start→agent/created+**guard source!=='startup'**（resume/clear/compact 也触发，无 guard 会重复注路由卡）+测试面+L2 彩排。
- **五护栏**：时间盒≤主轴 20%+回退线入口即写（出闸晚于 DoD 冻结点/L2 彩排败→记「错过窗口」转下轮）+DoD 独立不稀释+动主轴容量须具名换出项+频度熔断（连续触发→retro/ADR 漏斗节奏检视——本轮为本机制首次真实用例如实记）。
- **诚实记录**：未触发→「合格候选未出现」；触发未消费→「已合格未消费」转 R84 并触发频度熔断检视；时间盒耗尽→「时间盒耗尽」。

## T1 — fix-r83-anysearch-vertical-domain-passthrough（主轴，覆盖 D-001 §1、D-003、D-004、D-005、D-006）

垂域贯通：仓 TOML/工具 arg 的垂域参数经契约+路由+审计三面贯通至 MCP domain/sub_domain/sub_domain_params。**三面是票内承诺非可裁剪装饰**（D-001）。

### 契约面（D-003）

- packages/retriever/src/contract.ts：SearchRequest 增 `vertical?: { domain: string; subDomain?: string; params?: Record<string, unknown> }`（新字段不复用 includeDomains——两轴正交共存）；kernel Query 同步。
- 命名纪律：内部字段统一 vertical*；kernel 的 domain=仓名/策略域已占用，严禁与 MCP domain 枚举混名；wire 层（provider）才映射 domain/sub_domain/sub_domain_params。
- 仓级默认：packages/store/src/domain-schema.ts——DomainSchema.sources 增 `vertical?: { domain: string; sub_domain?: string }`（RawDomain+resolve+validate 同步；validate=形状校验仅非空字符串，**不嵌枚举**）；TOML 不收编动态 params。
- 查询级覆盖：KernelToolSchemas/KernelJsonSchemas——search_web/research_web inputSchema 增 verticalDomain/verticalSubDomain/verticalParams（string/string/record，不嵌 enum）；apps/cli search 命令同步参数面。**优先级=查询级整体替换仓级不做深合并**。

### 路由面（D-004）

- contract.ts：SearchProvider 增 `verticalDomainSupported?: boolean`（与 domainFilterSupported 同构并列）；anysearch provider 声明 true。
- engine：resolved vertical（仓级默认经查询级整体覆盖后）非空时→能力位声明的 provider 收 vertical 三参；未声明照常扇出 general（具名降级入审计）；post-filter 权威闸不动。
- **垂域命中标记**：anysearch 垂域路由结果在 NormalizedResult.extra（或 envelope metadata）携 vertical 标记（审计+融合层可读）。
- **prefer-capable 加权调参=具名跟进项**：不在本票（eval 数据驱动非契约职责）——T4 登记 registry。
- **显式出域**：跨 provider 垂域词表映射（anysearch↔Exa category↔Tavily topic）不做。

### 审计面（D-005）

- 新事件 `retrieval.vertical.pre`：resolved vertical 非空时发射；attrs=vertical.domain/vertical.sub_domain/**vertical.params_keys（键名单非值）**/vertical.source(repo|query)/verticalSent/verticalDegraded——与 domain_filter.pre 同构镜像；触发条件独立（可无 domainActive）。
- **不立** retrieval.vertical.post；domain_filter.pre 触发条件不改（隐性 breaking change）。

### 校验面（D-006）

- 本地=形状校验唯一（domain/sub_domain 非空字符串、params Record）；词表合法性全权上游（非法组合→isError→fail-first 降级+vertical.pre 审计）。
- get_sub_domains 不进运行时路径；不内置枚举副本；合法词表+params 约束表写 README/说明档（标注日期源）。
- **T1 实测义务**：垂域×host 过滤等上游非法组合拒收行为实测，记入说明档或 vertical.pre attrs，不静默无效。

### 验收锚（谓词式）

1. DomainSchema：TOML `[sources] vertical={domain,sub_domain}` 解析→resolve 继承链生效→validate 形状校验（空串/非 Record params 拒绝；未知词表值不拒）；
2. 覆盖断言：仓级 vertical=X+查询级 verticalDomain=Y→resolved=Y（整体替换不深合并）；仅仓级→resolved=仓值；仅查询级→resolved=查询值；
3. 协商断言：verticalDomainSupported=true 收 vertical 三参（providerRequest 含），false 收不到（且入 verticalDegraded 名单）；
4. wire 断言：anysearch adapter tools/call params 含 domain/sub_domain/sub_domain_params 映射（domain←vertical.domain、sub_domain←vertical.subDomain、sub_domain_params←vertical.params）；无 vertical 时三参全缺席；
5. 审计断言：retrieval.vertical.pre 发射于 resolved 非空时；attrs 五键齐；params_keys 为键名单非值；vertical.post 不存在；domain_filter.pre 触发条件未变；
6. 降级断言：非法组合→上游 isError→该臂降级+审计如实记（fail-first 不动）；垂域路径 provider 不可达→fail-open 空结果（不阻断）；
7. 标记断言：垂域路由结果 extra/metadata 携 vertical 标记可机读。

### 测试面

复制映射逻辑的 mock 模式承袭 R82 fixture 形态；e2e 贯通可用真端点 tools/call 或 mock 择一留痕（T1 证据段要求）；DomainSchema 测试随 store 包新增。

## T4 — 收口文书（覆盖 D-007）

1. 取证段：T0 哨戒实录+T1 垂域证据（上述验收锚逐条判定+非法组合实测记录+e2e 留痕）+TE1 兑现证据（或诚实记档）；
2. 就绪段：turbo check/test/build 绿+ship-gate 全绿（1u 新鲜度腿：垂域新声明注册 closeout-claims）+install-smoke 兼容+fail-open 实证；
3. 文书段：ADR-0084（双层贯通+闸开先行修编+能力协商 hint+新事件+形状校验——本轮全部 D-xxx 依据+「辅轴先行非自动先例」边界条款）+registry（defer-r83→closed+prefer-capable 跟进项+nit 两档逐项去向：修复<半天→就地修+证据，否则三态登记）+CONTEXT 词块核验+handoffs/next-round-r84.md（test-online 结论/prefer-capable 加权/词表映射评估）+判据↔证据映射表+**Goodhart 对称警惕**（行无启用判定→删行非补证）+but 提交干净；
4. 兜底两则：中断→「错过窗口/时间盒耗尽」；未验→「未验」如实记。

## 移交须知

- 验收标准原文承袭：「编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环」。
- 版本控制=GitButler（禁裸 git 写）；报告写 reports/<date>-report.md；closeout-claims.json schema @1 每轮非空；issues 目录规约=.scratch/grill-round-83/issues/。
- 红线：不改用户 env；不重裁账本已决；fail-open 不动；垂域轴不与 includeDomains 合并；事件名不带动态值；params 值不落审计；TE1 闸开先行三条件缺一回默认序；缺证据不宣称完成。

## Suggested skills（下轮会话）

- ``/`-tickets`：T1 票驱动（tdd at pre-agreed seams：契约/DomainSchema/协商断言/事件断言）。
- ``：版本控制（GitButler 唯一写路径）。
- atomcode-research（model-invoked）：上游非法组合实测表/词表文档化的外部先例核对。
- tdd/diagnosing-bugs（model-invoked）：TE1 若触发=repin 全族+迁改测试面。
- writing-for-agents（model-invoked）：ADR-0084/任务书文体。
- ``：R84 交接生成。
