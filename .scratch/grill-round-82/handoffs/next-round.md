# Round-82 任务书 — 「迁移落地轮」AnySearchProvider REST→MCP-over-HTTP

Date: 2026-09-24. 账本 `.scratch/grill-round-82/decision-ledger.md`（D-001~D-005 全 current，唯一权威数据源——任何实测与账本冲突→标 revised 呈报用户，禁止静默改向）；调研存档 `q2-atomcode.md`（手写薄 JSON-RPC/2026-07-28 stateless 修订/六技术点）、`q3-atomcode.md`（条件辅轴=Expedite CoS/五护栏）、`q4-atomcode.md`（残余四分诊/谓词判据/即销卡五字段）。Stack 约定：`r82-grill`（本文档+账本+调研存档）← 实施栈叠其上（GitButler 分支，与其他栈并行互不写）。

## 状态快照（接手即知）

- **基线**：common base `ec020b7e`（R81 全栈已并入：grill+impl+audit 11 commits），工作区干净；全仓公开集 5 包已发 0.0.8（v0.0.8 run success+SLSA attestation）。
- **主轴标的**：`packages/retriever/src/providers/anysearch.ts`——当前 REST 实现（GET `/v1/search`+`Accept: application/json`+`body.data.results` 映射+`domainFilterSupported=false` ADR-0062 D2）；REST 路由已实测 404 死，`POST /mcp` 活（initialize/tools-list/tools-call 三通，search 实返 10 条 ~867ms）。
- **MCP 实测面**（R81 探针+本会话 1MCP 对照组）：endpoint=`https://api.anysearch.com/mcp`；tools/list 四工具（search/batch_search/extract/get_sub_domains）；search schema=`{query,domain,sub_domain,sub_domain_params,max_results}`（max 10）；domain=15 垂域枚举，sub_domain 结构化参数（`finance.quote{type,symbol,period}` 等，get_sub_domains 前置闸）；tools/call 响应=content[].text markdown 形（`## Search Results`+`### N. title`+`- **URL**:`+snippet），**无 structuredContent**（仅 `_meta.request_id`）。
- **transport 判据**（Q2 调研关键事实）：2026-07-28 协议修订删 GET 长流+协议级 session+Mcp-Session-Id 降 OPTIONAL——本端点 stateless，SDK 重件全死重；手写四坑：Accept 双类型 `application/json, text/event-stream`（spec MUST）+响应可能 SSE 帧（eventsource-parser ~2KB 不手搓）+MCP-Protocol-Version 头每 POST 必携+JSON-RPC error 显式 raise（notifications 返 202 空体=正常）。
- **测试/安装面**：`packages/retriever/test/anysearch.test.ts`=复制映射逻辑的 mock（非 import 本体）——fixture 形态须换；`install-smoke.mjs:193` dead-port 注入在用（`127.0.0.1:9` 连不上→fail-open），迁移不得破坏。
- **哨戒面**：dsh `0.1.7-rc.1` 特征锚已验（`agent/created` 携 source/signal 且 session-start 缺席），出闸点≈2026-09-25T13:25Z——**轮内极可能撞双锚**；`0.1.5-rc.3`/`0.1.7-alpha.1`/`alpha.2` 出闸复核义务续；transformers #1764 OPEN 趋僵（用户侧评论稿仍挂）；kernel `llm-init.test.ts` SSE stub flake watch；dsh-native-tools 触发器检查续。
- **dsh 消费标的**：`apps/dsh-plugin/src/index.ts:87` `ctx.on('agent/session-start')`→迁 `agent/created`+`source!=='fresh'` guard（resume/clear/compaction 不重复注路由卡）；dep-closure repin 须全族按新锁文件重推导（alpha.1 实测已扩 21 个 dsh-*）。
- **残余假设账**（R81 T3 诊断书 R1–R5）：处置矩阵已定 D-004——R1/R5 即销卡，R2/R3 折入 T1 验收锚，R4 closed-by-scope（用户个人配置域，不记档不代改，产物面不录具体地址值）。
- **用户扳机**：#1764 评论外发仍挂用户侧；本机 env 属个人配置域。

## T0 — 哨戒续班（覆盖 D-001 背景义务+D-003 §1 触发面+D-005 §1；纯证据零代码）｜0.25d

1. **dsh 出闸复检**：`npm view @deepseek-ai/dsh-agent time version dist-tags --json`（+`dsh-tools`/`dsh-mcp-client` 同查）快照落档，rc.1 对 minimumReleaseAge 闸复核+**changelog 审过**（双锚第二锚）；
2. **#1764 哨**：`gh pr view 1764 --repo huggingface/transformers.js --json state,mergedAt,updatedAt`——不可达如实记「未验」；
3. **flake-watch**：kernel `llm-init.test.ts` SSE stub 并行竞态观测延续——复现即升级非静默；
4. **dsh-native-tools 触发器检查**：`dsh-tools`/`dsh-mcp-client` 稳定工具注册 API 面或 bridge 显不足证据→如实记；
5. **双锚判定行**：特征锚（已验）+稳定锚（rc 线+出闸+changelog 审）→显式结论行「双锚齐/未齐」；
6. **格式化结论行**（零发现也须显式+观测窗口截至戳）→`evidence/t0-watch-<date>.md`。
- **验收**：五线结论行+transcript+截至戳；依赖面零脏。

## T1 — fix-r82-anysearch-mcp-migration（覆盖 D-001 §1-2+D-002 全+D-004 §3）｜主轴

1. **薄 JSON-RPC transport**（`packages/retriever/src/providers/anysearch.ts`）：fetch 直发 POST `/mcp`——initialize→notifications/initialized→tools/call search；四坑纪律全落（Accept 双类型/SSE 帧经 eventsource-parser/Protocol-Version 头/error 字段 raise/202 空体正常）；不引 @modelcontextprotocol SDK 为 retriever dep；
2. **Fail-First 映射**：structuredContent 优先→content[].text markdown 容错解析（## Search Results/### N. title/- **URL**:/snippet 段，标题缺失仍可提 URL）→isError:true/200-错形/Content-Type 非预期一律 fail 降级该臂——收口 defer-r81-provider-shape-validation；
3. **env 兼容**：ANYSEARCH_ENDPOINT 以 `/v1/search` 结尾→剥至 base+/mcp+warn 一次；无尾径原样直打；dead-port 注入语义不变；
4. **参数面**：max_results 静默 clamp=10；modes 形参不下发（additionalProperties:false 防拒收），answer 意图降普通 search 记映射文档；
5. **R2 谓词锚（实施首日）**：authed vs anon tools/call 对照实测——锚文双分支「anon 可用→继续；401/429→stop-gate+具名回退票携原 R2 编号」；
6. **R3 谓词锚**：立票时按 2026-07-28 spec 原文逐条生成谓词式验收项（帧格式/session 头/SSE 事件名/重连语义），失败即验收失败；
7. **垂域评估腿**（D-001 §2）：tools/call search 携 domain 参数真打一发+domainFilterSupported 翻转可行性+post-filter→pre-filter 审计语义牵动面测绘——半径=透传+翻转+契约面核对则同票落；牵动引擎路由/审计面则立 R83 具名票（腿产推荐不裁决）；
8. **测试面**：anysearch.test.ts fixture 换 MCP 形（mock initialize/tools-call+SSE 帧样本+错形样本+isError 样本）；fail-open 保留实证+dead-port 兼容实证；
9. **live 探针两层**：fail-path 留 install-smoke；live-path 进 CI test-online 可选非阻断 job——绝不 blocking。
- **验收**：谓词锚逐条判定+测试 transcript+install-smoke 实录+错形校验证明+SSE 解析证明+R2 对照实录+评估腿半径结论行；turbo check/test 绿+ship-gate 全绿+install 无脏。
- **红线**：不重裁方向（ADR-0082 已钉）；structuredContent 缺席不判死；错形不吞零；env 值不代改不录档。

## TE1 — fix-r82-dsh-event-created-consumption（覆盖 D-003 全；条件辅轴——双锚未齐不成立）

- **触发判据**（T0 判定行兑现）：特征锚已验+稳定锚（rc-or-stable 线+过闸+changelog 审过）→**即时写成具名票**（预注册优先于触发才写票）；
- **票内容**：repin 全族按新锁文件重推导+`index.ts:87` 改 `ctx.on('agent/created')`+`source!=='fresh'` guard+测试面更新+L2 彩排（装跑+dsh plugin add 实测）；
- **执行序**：钉死 T1 主轴落地后；
- **五护栏**：时间盒≤主轴 20%（超时封票记「时间盒耗尽」）；回退线（出闸晚于主轴 DoD 冻结点/L2 彩排败→自动转下轮记「错过窗口」不伪造完成）；DoD 独立（repin 落地+验收面过≠写了代码）；动主轴容量须具名换出项；频度熔断（连续触发→retro/ADR 回溯漏斗节奏）；
- **未触发/未执行**：双锚未齐→T0 记「合格候选未出现」；已触发未执行→转 R83 主轴候选记「已合格未消费」。
- **验收**：票本体存在+验收面独立+护栏记录可查。

## T2 — fix-r82-anysearch-rest-contract（覆盖 D-005 §3；宣称修正具名票）

1. C-1/C-2/C-13 具名修正落实：REST 契约注释/文档改 MCP 契约陈述；max_results 名义 20 宣称核对→clamp 10 记 CHANGELOG Changed/Removed；
2. 修正=票文名+验收面非描述行（RESHAPE 具名票纪律承袭）。
- **验收**：每宣称修正有落点+closeout-claims 注册（新可机验声明）。

## T3 — 残余分诊执行（覆盖 D-004 全；docs+registry 面）

1. **R1 即销卡**：「历史时刻端口监听态」——残余陈述+本体性不可回溯声明（无观测面留存）+收敛证据指针（H5+P-C 复现证据）+重开触发器（HTTP 000 复现）+决策人/日期；
2. **R5 即销卡**：「REST 下线时点」——同构（git log/发布记录已穷举）+重开触发器（REST 面复活的官方声明）；
3. **R4 closed-by-scope**：一行账本记录「用户个人配置域，不记档不代改」+重开触发器（配置治理权变更则重开）；
4. **R2/R3 核验**：T1 谓词锚判定结果回收——R2 触发 stop-gate→具名回退票携原 R2 编号转档；
5. 三张即销卡+R4 行登记入 registry（或 docs 域内即销档案）。
- **验收**：五残余四格全落位无第五格；即销卡五字段齐；谓词锚判定结果回收。

## T4 — 文书收口（覆盖 D-005 §3-4；docs-only）

1. **ADR-0083**：迁移落地轮主题+手写薄 JSON-RPC 裁决（pnpm why 依赖增量实测脚注+SDK 切换触发条件：OAuth/MRTR/多工具动态发现）+条件辅轴预注册立法+残余四分诊立法+谓词判据+**rejected alternatives**（SDK transport/双实现/垂域同捆/单轴不破/无条件插入/独立 gate 票/第五格/最小收口）；
2. **registry**：`defer-r71-provider-serverside`→closed、`defer-r81-provider-shape-validation`→closed+R1/R4/R5 即销登记+claims 修正核销+其余 open 债 carried_log r82；
3. **文书**：CONTEXT 新词已入（R82 词块）+`handoffs/next-round-r83.md`（立项项：垂域贯通若出票/dsh 票若错过窗口/R2 回退分支若触发/#1764 评论仍挂用户侧）+**判据↔证据映射表**+度量单行；
4. but 干净收尾。
- **兜底两则**：辅轴中断→如实记「错过窗口/时间盒耗尽」非伪造完成；不可达验收项→如实记「未验」非豁免；三段缺一即不收口。

## 红线

- 实测与账本冲突→对应 D-xxx 标 revised+新 D 呈报用户拍板，禁静默改向；
- 迁移方向不重裁（ADR-0082 分支 b）；SDK 不引 retriever dep；SSE 状态机不手搓；
- 错形 200 不吞零；structuredContent 缺席不判死；live 探针不 blocking；
- ANYSEARCH_ENDPOINT 用户配置域——不代改不录具体值；
- 辅轴不稀释主轴验收；触发器兑现≠清零（已预约身份排队）；
- 即销卡本体性/资源性声明严禁混写；独立票须 owner+deadline+原 H# 溯源；
- 票间禁跨改（T1 不动宣称修正面/T2 不动 provider 码）；
- gh/npm/CI 外部实况不可达→记「未验」非静默跳过；用户扳机不代扣。

## Suggested skills

`$implement`（票流驱动）· `$but`（版本控制）· `$atomcode-research`（spec 谓词死角/辅轴彩排疑点补查）· `$handoff`（收口）· tdd（测试 fixture 换形，model-invoked）· diagnosing-bugs（谓词锚失败判别纪律，model-invoked）· writing-for-agents（ADR-0083/即销卡/next-round-r83 文体）。