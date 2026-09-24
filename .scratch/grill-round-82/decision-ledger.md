# Grill Round 82 — Decision Ledger

（首问确认后自 D-001 起追加）

## D-001 — R82 主题定界与主轴scope形态（迁移落地轮+垂域评估腿）

- **原问题**：R82 主题定界与主轴scope形态——A 迁移落地轮+垂域评估腿（T1 票内评估 domain/sub_domain/sub_domain_params 贯通+domainFilterSupported 翻转，半径小则同票大则 R83 具名票）/ B 纯 parity 迁移轮（垂域显式出域）/ C 迁移+垂域同捆主轴 / D 另指。
- **原回答原文**：「A」
- **规范化需求**：
  1. R82=迁移落地轮：主轴=fix-r82-anysearch-mcp-migration（AnySearchProvider REST→MCP-over-HTTP），方向已由 ADR-0082 分支 b 裁决钉死不重裁。
  2. T1 票内加垂域贯通评估腿：tools/call search 携 domain/sub_domain/sub_domain_params 实打一fall+domainFilterSupported 翻转可行性评估+post-filter→pre-filter 审计语义牵动面测绘；半径=透传+翻转+契约面核对则同票落，牵动引擎路由/审计面则立 R83 具名票（Named Follow-Up Ticket）。
  3. 票序承继任务书：T0 哨戒续班（dsh rc.1 出闸复检+#1764+flake-watch）→T1 迁移（含评估腿）→T2 fix-r82-anysearch-rest-contract 宣称修正→T3 残余假设 gate（R2 凭据/R3 transport/R4 env 语义）→T4 文书收口（ADR-0083）。
- **显式约束/负向需求**：垂域贯通不作无条件同捆（C 否决：post-filter→pre-filter 审计语义牵动面真实存在，票域吞轮风险）；不无评估出域（B 否决：垂直域参数=信息专精使命抓手，摸到门把手不押后）；评估腿产推荐不裁决；锐评处方 2（#1764 comment 外发）如实记用户侧挂账项不入轮域；fail-open 语义不动；ANYSEARCH_ENDPOINT 属用户配置域不代改。
- **状态**：current

## D-002 — T1 迁移票技术形态（手写薄 JSON-RPC，调研修订版）

- **原问题**：T1 迁移票技术形态——A′ 手写薄 JSON-RPC+调研修订（四坑纪律/混合容错映射/env 剥尾+错形兜底/clamp 10/modes 不下发/live 两层探针/pnpm why 脚注/SDK 切换触发条件）/ B SDK StreamableHTTPClientTransport / C 双实现 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. transport=手写薄 JSON-RPC over fetch（initialize→notifications/initialized→tools/call 三步），不引 @modelcontextprotocol SDK 为 retriever dep。四坑纪律：Accept 双类型 application/json, text/event-stream（spec MUST）；响应可能是 SSE 帧→按 Content-Type 分支、SSE 解析用 eventsource-parser ~2KB（SDK 同款，不手搓状态机）；MCP-Protocol-Version 头每 POST 必携；JSON-RPC error 字段显式 raise（notifications POST 返 202 空体为正常）。
  2. 响应映射=混合容错 fail 优先：structuredContent 存在优先（前向兼容）→否则 content[].text markdown 容错解析（## Search Results / ### N. title / - **URL**: / snippet 段，标题缺失仍可提 URL）→isError:true / 200-错形零结果且 text 非空 / Content-Type 非预期 一律 fail 降级该臂——收口 defer-r81-provider-shape-validation（OmniRoute 静默面堵死）。
  3. env 兼容=剥尾规范化+错形 fail 兜底：ANYSEARCH_ENDPOINT 以 /v1/search 结尾→剥至 base+/mcp+warn 一次；无尾径原样直打；install-smoke dead-port 注入语义不变（127.0.0.1:9 连不上→fail-open）。
  4. max_results 静默 clamp=10（MCP 上限；CHANGELOG 记 Changed/Removed，REST 名义 20 宣称留 T2 核对）；modes 形参不下发（防 additionalProperties:false 拒收；answer 意图降普通 search，记映射文档）。
  5. live 探针两层：fail-path（dead-port 验 fail-open）留 install-smoke；live-path 进 CI test-online 作可选非阻断 job——绝不 blocking gate。
  6. ADR-0083 脚注：pnpm why 实测 SDK 依赖增量落实证；写明 SDK 切换触发条件（端点开 OAuth/MRTR/多工具动态发现时重评）。
- **显式约束/负向需求**：B 否决（SDK 重件 session/SSE 重连/OAuth/Last-Event-ID 对 stateless 端点全死重+fail 隐式路径剥离成本+retriever 依赖面增量）；C 否决（双份成本）；structuredContent 实测缺席不作唯一映射面；live 探针不得 blocking；SSE 状态机不手搓；调研缺口如实记（Tavily 额度尽改 Exa+AnySearch 双引擎；HN 争论帖未找到；SDK bundle 体积无实测）。
- **状态**：current

## D-003 — dsh E1 辅轴条件裁决（条件辅轴预注册+五护栏，调研修订版）

- **原问题**：dsh E1 辅轴条件裁决——A′ 条件辅轴预注册+五护栏（具名票即时写成+执行序钉死 T1 主轴落地后+时间盒≤20%+回退线+DoD 独立+换出具名+频度熔断）/ B 单轴不破一律转 R83 / C 无条件插入 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 条件辅轴预注册：dsh 0.1.7-rc.1（或后续候选）双锚齐（特征锚=agent/created 携 source/signal 且 session-start 缺席+稳定锚=rc-or-stable 线+过 minimumReleaseAge 闸+changelog 审过）→ 具名票 fix-r82-dsh-event-created-consumption 即时写成：repin 全族按新锁文件重推导（alpha.1 实测已扩 21 个 dsh-*）+ apps/dsh-plugin/src/index.ts:87 改 ctx.on(agent/created)+source!==fresh guard（resume/clear/compaction 不重复注路由卡）+测试面+L2 彩排。
  2. 执行序钉死：辅轴执行在 T1 主轴落地后——触发器兑现≠清零，票以「已预约」身份排队非回候选池重新竞争。
  3. 五护栏防吞轮：时间盒≤主轴时长 20%（超时止损封票写明「时间盒耗尽」）；回退线入口即写（出闸晚于主轴 DoD 冻结点或 L2 彩排失败→自动转下轮记「错过窗口」不伪造完成）；DoD 独立不稀释（repin 落地+验收面过≠写了代码）；动主轴容量须具名换出项；频度熔断（连续触发→回溯漏斗节奏错配记 retro/ADR）。
  4. 未触发处理：轮收口时双锚未齐→T0 如实记「合格候选未出现」非空段；已触发未执行→转 R83 主轴候选记「已合格未消费」。
- **显式约束/负向需求**：B 否决（Scrum 原教旨 naive answer，首遇合格候选即递轮=坐实「扳机生锈」病理）；C 否决（无条件插入=文献一致反模式：两半成品+commitment 失效）；预写票优先于触发才写票（判定/执行时刻解耦可审计，ADR-0061 同构先例）；辅轴不稀释主轴验收；live 彩排探针最小化。
- **状态**：current

## D-004 — T3 残余假设处置矩阵（四分类强制分诊+记档纪律，调研修订版）

- **原问题**：T3 残余假设 gate 处置矩阵——A′ 分级处置（R1/R5 即销五字段卡+R2/R3 折入 T1 票验收锚+R4 closed-by-scope+谓词判据入档）/ B R2/R3 独立 gate 票 / C 全转下轮 / D 另取舍。附事实题 R4：用户裁决「个人配置域，不记档不代改」。
- **原回答原文**：「采纳」（并前置指示：本机配置属个人配置域不记档、别管我）
- **规范化需求**：
  1. 四分类强制分诊立法：每项残余必须显式落到「已消解/折入下游验收锚/独立成票/诚实记档接受」四格之一，不存在第五格「挂着不管」（incident.io：closing is a conscious act）。
  2. R1（历史端口监听态）/R5（REST 下线时点）即销：五字段一行卡——残余陈述+本体性不可回溯声明（「无观测面留存」=cannot 非 won't）+收敛证据指针+重开触发器（R1=HTTP 000 复现；R5=REST 面复活的官方声明）+决策人/日期。
  3. R2（/mcp anon 凭据限流）/R3（transport spec 细节）折入 T1 迁移票验收锚：R2=实施首日 authed vs anon tools/call 对照实测，锚文写死双分支「可用→继续；401/429→stop-gate+具名回退票携原 R2 编号」；R3=实施票立票时按 2026-07-28 spec 原文逐条生成谓词式验收项（帧格式/session 头/SSE 事件名/重连语义），失败即验收失败。
  4. R4（用户侧 env 配置语义）即销 closed-by-scope：一行账本记录「用户个人配置域，不记档不代改」+重开触发器（配置治理权变更则重开）；产物面不再录本机 env 具体地址值。
  5. 谓词判据入档：折入合法性充要条件=验收时存在可机械判定的通过/失败谓词；写不出谓词→独立票（先写谓词）或即销（不可测）。
- **显式约束/负向需求**：B 否决（验收面切成两张票=R2 anon 实测本就票内可测的过切）；C 否决（「挂着不管」第五格不合法=被动腐烂）；本体性声明与资源性声明严禁混写（混写即逃避）；独立票须 owner+deadline+原 H# 溯源防静默漂移；转下轮记账不转码+触发器（ADR-0029 scope discipline 兜底 Never-Ending Spike）；四格道德风险定位：即销格道德风险→五字段卡纪律硬约束。
- **状态**：current

## D-005 — R82 收口判据（实施轮形态：三段收口+兜底两则）

- **原问题**：R82 收口判据——A 三段收口（取证段=T0 哨戒+T1 实施证据含 R2 对照实录与 R3 谓词判定+垂域评估腿实录+辅轴消费证据 / 就绪段=turbo 绿+ship-gate 全绿含 1u 新鲜度+install 无脏+fail-open 与 dead-port 兼容实证 / 文书段=ADR-0083+registry 核销与即销卡登记+T2 宣称修正+CONTEXT 新词+next-round.md+映射表+but 干净）+兜底两则 / B 最小收口 / C 另取舍。
- **原回答原文**：「A」
- **规范化需求**：
  1. 取证段：T0 哨戒实录（dsh rc.1 出闸复检+#1764+flake-watch+dsh-native-tools 触发器检查结论）；T1 实施证据（测试 transcript+install-smoke+错形校验证明+SSE 解析证明+R2 authed-vs-anon 对照实录+R3 谓词式验收项逐条判定）；垂域评估腿实录（domain 参数 tools/call 真打+半径判定结论=同票落或 R83 具名出票）；辅轴消费证据（触发→票+执行+验收锚；未触发/错过窗口/时间盒耗尽→如实记）。
  2. 就绪段：turbo check/test 绿+ship-gate 全绿（1u 派生件新鲜度腿承袭：新声明注册 closeout-claims）+install 无脏+fail-open 保留实证+dead-port 注入兼容实证（迁移不破坏 install-smoke 语义）。
  3. 文书段：ADR-0083（分支 b 实施裁决+pnpm why 依赖增量脚注+SDK 切换触发条件入档）+registry 核销/更态（defer-r71-provider-serverside→closed、defer-r81-provider-shape-validation→closed+R1/R4/R5 即销卡登记+claims 修正核销）+T2 宣称修正落实（C-1/C-2/C-13 具名修正）+CONTEXT 新词（若有）+handoffs/next-round.md（R83 立项项：垂域贯通若出票/dsh 票若错过窗口/R2 回退分支若触发/PR-1764 评论仍挂用户侧）+判据↔证据映射表+but 提交干净。
  4. 兜底两则：辅轴中断→如实记「错过窗口/时间盒耗尽」非伪造完成；不可达验收项→如实记「未验」非豁免。
- **显式约束/负向需求**：B 否决（码绿+ADR=取证链断+即销卡不登记+宣称修正不落=半成品轮）；收口不宣告完成于证据缺失之上；三段的段落缺一即不收口。
- **状态**：current
