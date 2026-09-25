# Grill Round 83 — Decision Ledger

（首问确认后自 D-001 起追加）

## D-001 — R83 主轴候选裁决（垂域贯通主轴+TE1 条件辅轴，调研修订版）

- **原问题**：R83 主轴候选裁决——A′ 垂域贯通主轴（fix-r83-anysearch-vertical-domain-passthrough 立项+registry 票转 in-flight）+TE1 条件辅轴预注册承继（双锚齐→issues/02 即时成立+五护栏，执行序留 Q2 裁）+C 落选池不动 / B TE1 主轴 / C 落选池主轴 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. R83 主轴=fix-r83-anysearch-vertical-domain-passthrough：SearchRequest 契约面扩展（新字段非复用 includeDomains——host allowlist 与垂域路由枚举不同轴）+引擎路由判据+domain_filter.pre 审计语义扩展三面贯通；registry defer-r83-anysearch-vertical-domain-passthrough 转 in-flight；半径依据=evidence/t1-domain-leg.md 评估腿实录。
  2. TE1=条件辅轴预注册承继 R82 机制：双锚齐（特征锚 tarball 复验 agent/created+source/signal 在场且 session-start 缺席+稳定锚 rc 线出闸 minimumReleaseAge 过+changelog 审面）→预注册票 issues/02（fix-r82-dsh-event-created-consumption）即时成立；五护栏生效（时间盒≤主轴 20%+回退线入口即写+DoD 独立不稀释+换出具名+频度熔断）；guard 写 source!=='startup'（R82 账本 revised 注记）；执行序「主轴落地后 vs 闸开先行」显式留待下一题裁决；未触发如实记「合格候选未出现」、已合格未消费转下轮并触发频度熔断检视。
  3. 落选池（registry open 面其余 10 项）本轮不动，按既有 cadence 续守。
  4. 常驻哨戒承继：T0 复检义务（rc.1 闸 ≈2026-09-25T13:25Z、rc.2 ≈2026-09-26T14:02Z、changelog 审面补检）+#1764 用户侧挂账+test-online-anysearch 首周观测+llm-init SSE flake watch；ANYSEARCH_ENDPOINT 用户配置域不录不代改。
- **显式约束/负向需求**：B 否决（高优先≠该占整轮——TE1 票域中小独占整轮=重仪式轻货+使命核心再押一轮）；C 否决（征集=元工作产不出交付物）；TE1 不作无条件插队（闸开先行与否须显式裁决不默认）；垂域贯通不降级为纯透传票（契约+路由+审计三面是票内承诺非可裁剪装饰）。
- **状态**：current

## D-002 — TE1 辅轴执行序（闸开先行，调研修订版）

- **原问题**：TE1 辅轴执行序——A′ 闸开先行（双锚齐当日先消费 TE1 主体至出闸或时间盒耗尽先到为准，完毕即刻全力进主轴+论证边界三条件入档+频度熔断续守）/ B 主轴后承袭（R82 D-003 原序位）/ C 真并行 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 执行序=闸开先行：双锚齐当日（特征锚 tarball 复验+稳定锚 rc 线出闸+changelog 审面），先消费 TE1 主体至出闸或时间盒耗尽（以先到者为准），完毕即刻全力进主轴。
  2. 论证边界三条件入档（对滑坡的制度性回应）：本例成立=①双锚判据成立②时间盒≤主轴 20%③闸开当日消费；三者缺一规则回到「主轴落地后」默认序——本例不援引自动成立，下次适用须重新过判据。
  3. 频度熔断续守：「次次闸开就先打辅轴」=常态化滑坡信号→retro/ADR 检视漏斗节奏错配；本轮为本机制首次真实用例如实记。
  4. 承继关系如实记：本轮修编 R82 D-003「辅轴执行序钉死主轴后」为「辅轴可在主轴未启动的轮次边界先行消费」——R82 原记录保留不动（上轮事实域内裁决不溯改），本轮自立其据；立法本意（防辅轴抢占主轴产能）不违背：主轴未启无从抢占。
- **显式约束/负向需求**：B 否决（Fixed-Date CoD 窗口关闭后跳变：错过窗口=漏斗空转+预注册沉没+中段插入最贵打断，两害必取其一结构性缺陷；机制语义整洁是一次性收益对逐日累计代价）；C 否决（单会话内并行=交错切换=文献点名损耗源）；TE1 不得变无限期前置（「闸开当日」硬界）；时间盒耗尽即封票写明「时间盒耗尽」如实记。
- **状态**：current

## D-003 — 垂域契约面形态（双层贯通，调研修订版）

- **原问题**：垂域参数注入点——A′ 双层贯通（仓 TOML sources.vertical{domain,sub_domain?} 亲和默认+工具 arg verticalDomain/verticalSubDomain/verticalParams 查询级整体替换仓级不深合并+契约 SearchRequest.vertical 新字段+审计记生效值与来源层 repo|query+命名纪律 vertical* 内部字段/wire 层映射 MCP 命名）/ B 仅工具 arg / C 仅仓 TOML / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 契约面：SearchRequest/Query 增 vertical 字段（新字段不复用 includeDomains——host 轴与垂域轴语义正交共存，Exa category×includeDomains 同请求先例）；wire 层（anysearch provider）映射为 MCP domain/sub_domain/sub_domain_params。
  2. 仓级默认：DomainSchema sources 增 vertical{domain:string,sub_domain?:string}（静态枚举亲和声明，可进 git diff/review 的稳定知识主张——Brian Grant 判据）；RawDomain+resolve+validate 同步扩展；TOML 不收编动态 params（sub_domain_params 值本质查询级）。
  3. 查询级覆盖：search_web/research_web 工具 inputSchema 增 verticalDomain/verticalSubDomain/verticalParams（全参可传含 params——动态值如 symbol/library 仅此处可表达）；CLI search 命令同步参数面。**优先级=查询级整体替换仓级不做深合并**（axios data 语义）。
  4. 审计语义：垂域生效值+来源层（repo|query）写入审计面（domain_filter.pre 扩展或新事件的形态留待路由题裁决）；垂域模式下与 host 过滤的参数兼容性冲突（上游非法组合）须 T1 实测并如实记，不可静默无效（Exa 400 先例精神）。
  5. 命名纪律：内部字段统一 vertical*（kernel domain=仓名/策略域已占用词，严禁与 MCP domain 枚举混名——同名异物是新债）。
- **显式约束/负向需求**：B 否决（仓沦为摆设+配置可审计性丢失+LLM 每次现场猜参）；C 否决（动态 params TOML 无处可去=假声明面硬伤+堵死无仓默认的临时查询）；不做深合并（深合并优先级语义模糊化=新坑）；params 不入 TOML（动态值写死无意义）；垂域轴不与 includeDomains 合并表达（不同轴不混叠）。
- **状态**：current

## D-004 — 垂域路由扇出语义（能力协商 hint，调研修订版）

- **原问题**：vertical 生效时的 provider 边界——A′ 能力协商 hint（verticalDomainSupported 位，anysearch 声明收三参；未声明照常扇出由融合归并+审计具名降级；post-filter 不动；票内落垂域命中标记；prefer-capable 加权调参转跟进项；跨 provider 词表映射出域）/ B 垂域限定路由 / C 缺能力即整臂 abstain / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. SearchProvider 增能力位 verticalDomainSupported（与 domainFilterSupported 同构并列）；anysearch adapter 声明 true——收到 SearchRequest.vertical 时映射 MCP domain/sub_domain/sub_domain_params 下发。
  2. 扇出不变：未声明能力位的 provider 照常扇出 general（参数失效≠源失效——联邦检索判据），融合层归并；post-filter（host allowlist 权威闸）不动、两轴正交共存。
  3. 审计具名降级：vertical 生效时审计面记生效值+来源层（repo|query，D-003）+verticalSent/verticalDegraded 名单（与 domain_filter sent/degraded 同构）。
  4. 票内落「垂域命中标记」：anysearch 垂域路由结果在 extra/metadata 携 vertical 标记（审计+融合层可读）；**「prefer capable」加权调参显式转跟进项**——加权数值须 eval 数据驱动非契约职责（具名跟进票或 R84 议题）。
  5. 显式出域：跨 provider 垂域词表映射（anysearch 17 枚举↔Exa category↔Tavily topic）不在本轮票域——他日若做须独立评估票。
- **显式约束/负向需求**：B 否决（单源化侵蚀 amalgamation+MVSS 充分性门交叉验证退化为单源+「垂域意图=排他来源」语义误置）；C 否决（可用性被提示性参数劫持——能力位 rollout 滞后直接转全线不可用，EDNS required 例外反向适用）；不发明第三轴（hint 语义复用 ADR-0062 D2 协商形态不另起范式）；abstain 语义不被垂域参数绑架。
- **状态**：current

## D-005 — 垂域审计事件形态（新独立事件，调研修订版）

- **原问题**：垂域审计事件形态——A′ 新独立事件 retrieval.vertical.pre（resolved vertical 非空发射，attrs=vertical.domain/sub_domain/params_keys/source(repo|query)/verticalSent/verticalDegraded，与 domain_filter.pre 同构镜像，不立 vertical.post）/ B 扩展 domain_filter.pre（触发条件域外扩展）/ C 仅 span attributes / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 新事件 retrieval.vertical.pre：kernel resolved vertical（仓级默认经查询级整体覆盖后的生效值）非空时发射；attrs=vertical.domain/vertical.sub_domain/vertical.params_keys（参数键名单非值——防敏感值落审计）/vertical.source(repo|query 来源层)/verticalSent（声明能力位 provider 名单）/verticalDegraded（未声明具名降级名单）。
  2. 同构镜像 domain_filter.pre 的 attrs 形状（生效值/来源层/sent/degraded）——消费者解析习惯直接迁移；触发条件独立（不与 domainActive 耦合——两轴正交，可只有 vertical 事件无 domain_filter 事件）。
  3. 不立 retrieval.vertical.post：垂域无独立闸，gate 计数仍在 domain_filter.post 原位。
  4. 上游参数兼容性冲突（Exa 先例的垂域×filter 非法组合类）T1 实测后如实记入事件 attrs 或说明档，不静默无效。
- **显式约束/负向需求**：B 否决（改 proven 事件触发条件=隐性 breaking change——既有消费者「收到=host 策略激活」假设假阳性+纯垂域流量下 host attrs 空转）；C 否决（occurrence 降格为 span attr 丢事件级告警/索引/独立时间戳/采样不丢的审计基本面）；事件名不带动态值（OTel 纪律：attrs 承载变化值）；params 值不入审计（键名单即可——前向防泄纪律）。
- **状态**：current

## D-006 — 垂域参数校验与发现策略（形状校验+服务端真理，调研修订版）

- **原问题**：vertical 三参合法性谁负责查——A′ 形状校验+服务端真理（本地验非空字符串/Record 形状，词表全权上游，非法组合→isError→fail-first 降级+vertical.pre 审计；get_sub_domains 不进运行时；词表写人读档非代码枚举）/ B 运行时 get_sub_domains 校验（直查或 TTL 缓存）/ C 静态内置枚举 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 本地校验=形状校验唯一：domain/sub_domain=非空字符串、params=Record——工具 arg schema（search_web/research_web）与仓 TOML sources.vertical load-time 校验同纪律，不嵌枚举（上游加域不漂移）。
  2. 词表合法性=服务端真理唯一：非法组合→上游 isError→R82 fail-first 臂级降级如实记+retrieval.vertical.pre 审计反馈（fail loudly 不静默吞零——arc42 never-silent-default 判据+R82 同构）。
  3. get_sub_domains 不进运行时路径：无每查询往返、无 TTL 缓存状态面（词表权威唯一归上游——SSoT，客户端不复制权威）。
  4. 人读面：合法垂域词表+sub_domain_params 约束表写进 README/说明档（文档缓存标注日期源）——代码面不内置枚举副本。
  5. 上游参数兼容性冲突实测（T1）：垂域×host 过滤等非法组合的拒收行为实测并记入说明档或 vertical.pre attrs，不静默无效。
- **显式约束/负向需求**：B 否决（直查=热路径延迟翻倍/TTL 缓存=违 SSoT 客户端复制权威+缓存击穿状态机）；C 否决（ADP-768 准则点名反模式+漂移期静默错行为）；Tolerant Reader 边界不越（验值不验结构——不复制上游 schema 语义）。
- **状态**：current

## D-007 — R83 收口判据（三段收口承袭+nit 两档规则，调研修订版）

- **原问题**：R83 收口判据——A′ 三段收口（取证=T0 哨戒+T1 垂域证据含非法组合实测+TE1 闸开消费证据；就绪=turbo/ship-gate 全绿+install-smoke+fail-open；文书=ADR-0084+registry 核销（defer-r83→closed+prefer-capable 跟进项）+nit 两档规则逐项去向+CONTEXT+next-round-r84+映射表+but 干净）+兜底两则+Goodhart 对称警惕入档 / B 最小收口 / C 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 取证段：T0 哨戒实录（dsh rc.1≈2026-09-25T13:25Z/rc.2≈2026-09-26T14:02Z 出闸复检+上游仓 changelog 审面补检+#1764+flake-watch+test-online-anysearch 首周观测结论）；T1 垂域贯通证据（DomainSchema vertical 解析/校验测试+查询级整体覆盖仓级断言+能力协商路由测试 sent/degraded 名单+retrieval.vertical.pre 事件断言含来源层 attrs+params_keys 不落值+上游非法组合实测记录+贯通 e2e 真端点或 mock 留痕）；TE1 兑现证据（闸开先行：repin 全族+listener 迁移+source!==startup guard+测试+L2 彩排；未触发/时间盒耗尽/错过窗口→如实记非伪造）。
  2. 就绪段：turbo check/test/build 绿+ship-gate 全绿（1u 新鲜度腿：垂域新声明注册 closeout-claims）+install-smoke 兼容+fail-open 实证（垂域参数路径不破坏降级语义）。
  3. 文书段：ADR-0084+registry 更态（defer-r83-anysearch-vertical-domain-passthrough→closed+prefer-capable 加权调参具名跟进项登记）+**nit 两档规则逐项去向**（修复<半天→就地修+证据入取证段；否则→registry 三态登记 closed/defer-with-ticket/accepted-as-documented——4 项=度量行自指/JSON id 两路不对称/clientInfo.version 硬编码/engines 地板缺席）+CONTEXT 新词（若有）+handoffs/next-round-r84.md（test-online 观测结论/prefer-capable 加权/跨 provider 词表映射评估）+判据↔证据映射表+but 提交干净。
  4. 兜底两则：辅轴中断→「错过窗口/时间盒耗尽」如实记；不可达验收项→「未验」如实记；不登记 nit=替未来轮次伪造「干净」状态违兜底精神。
  5. Goodhart 对称警惕入档：映射表某行说不出「该证据启用何判定」=仪式化残留→删行非补证。
- **显式约束/负向需求**：B 否决（重演已两次书面否决的半成品轮：取证链断+nit 漂移为下轮隐形债）；三段式常设政策化（IF4IT：证据严格度按风险分级为常设政策非每轮临时裁量——本判据承袭不需每轮重辩）。
- **状态**：current
