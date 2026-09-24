# Round-82 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-24):
`r82-grill` → `mum`（账本 D-001~D-005+任务书+词表+调研存档）；`r82-impl`（叠于其上）→ `npy`（T0 哨戒取证+R82 票组建档）→ `xxy`（T1：AnySearchProvider REST→MCP-over-HTTP 迁移+测试面+CI 探针）→ `lxw`（T2 宣称修正+T3 残余分诊登记+ADR-0083+R83 任务书）→ `uuy`（ADR index 0083 入册）→ `lpq`（R82 收口报告）。

主题：迁移落地轮——ADR-0082 分支 b 执行（REST /v1/search 死路由→POST /mcp MCP Streamable HTTP），薄 JSON-RPC 不引 SDK；宣称修正三处+残余四分诊五卡；TE1 条件辅轴判定=合格候选未出现。

## 已完成

- **T0 哨戒续班**：dsh 三包 rc.2 新发（09-24T14:0xZ）——特征锚 tarball 复验齐（agent/created 携 source/signal、session-start 缺席）但 minimumReleaseAge 闸内至 09-26T14:02Z（npm pack ETARGET 实证闸在呼吸）+changelog 审面缺席→稳定锚未齐；SessionStartSource 实测枚举=startup|resume|clear|compact（无 'fresh'，采纳时 guard 按 startup 落字）；#1764 OPEN 趋僵 21d+；llm-init SSE flake 本窗未复现；dsh-tools defineTool/register 钉版已具非新增→native-tools 触发器未响。evidence/t0-watch-2026-09-24.md。
- **T1 主轴迁移（fix-r82-anysearch-mcp-migration）**：providers/anysearch.ts 重写——initialize→notifications/initialized→tools/call search 薄 JSON-RPC（Accept 双类型/MCP-Protocol-Version 每 POST/协商版本回写 2025-11-25/Mcp-Session-Id 捕获回显/session-404 重初始化一次重试/eventsource-parser SSE 分支/JSON-RPC error 显式 raise）；fail-first 映射（structuredContent 优先→## Search Results markdown 容错→isError/错形/意外 CT 一律 throw 降级该臂）；env 剥尾（/v1/search→base+/mcp+warn 一次）；max_results clamp=10；modes 不下发。新增 dep 仅 eventsource-parser@4.1.1（pnpm why 实证 SDK 仅 pi-ai 传递依赖，retriever 零 SDK）。
- **R2 谓词锚**：anon vs authed 对照实录——anon 200 真结果（847ms）→「继续」分支成立；无效 Bearer→isError invalid_api_key（非 401/429→未触发 stop-gate）。evidence/t1-wire-probes.md §2。
- **R3 谓词锚**：2025-11-25 spec 14 条逐条机械判定——MUST 级全 PASS（POST/Accept/单消息/202 通知/双 CT/SSE 解析/异 id 容忍/session-id 回显/404 重初始化/协议头/UTF-8/无 GET 长流）；SHOULD 级 Last-Event-ID 重放+DELETE session 明示弃记档。evidence/t1-r3-predicates.md。
- **垂域评估腿**：tools/call domain=it_tech 真打 200 返 3 结果；MCP domain=17 值垂域路由枚举≠includeDomains host allowlist→domainFilterSupported 保持 false；真贯通牵动契约+路由+审计三面→具名转 defer-r83-anysearch-vertical-domain-passthrough。evidence/t1-domain-leg.md。
- **测试面**：test/anysearch.test.ts 重写为 mock-fetch 驱动真 provider——12 组 35 断言（握手序列/双 Accept/协议头/SSE 帧/JSON-RPC error/isError/三类错形+合法空信封/session-id 回显/404 重初始化/剥尾/clamp/mode 不下发/dead-port/元数据）。新增 test/online/anysearch-mcp.online.ts live 探针+test:online 脚本+ci.yml test-online-anysearch 非阻断 job（continue-on-error）。
- **TE1 判定**：双锚未齐→合格候选未出现（如实记，预注册票 issues/02 保留票池）。
- **T2 宣称修正**：C-1/C-2（provider 注释契约面重写）+C-13（fixture MCP 形）+README/limitations REST 措辞三处+max_results 名义 20→实证 10 记 CHANGELOG Changed；closeout-claims.json 十条机验声明注册。
- **T3 残余四分诊**：R1/R5 五字段即销卡+R4 closed-by-scope+R2/R3 谓词锚回收=PASS——registry residual-r82-* 五卡登记，无第五格。
- **T4 文书**：ADR-0083（迁移裁决+pnpm why 依赖增量脚注+SDK 切换触发条件 OAuth/MRTR/动态多工具+被拒五件）+index 83 入册+registry 更态（shape-validation closed、rest-route 监控续、dsh-rename carried、新增 defer-r83 垂域票+五残余卡）+CONTEXT 新词核验（grill commit 已预注册全落）+handoffs/next-round-r83.md（候选 A 垂域票/B TE1 兑现窗/C 征集）。
- **验收闭环**：turbo check 8/8；turbo test 13/13（3m42s）；turbo build 5/5；install-smoke **28/28**（pack 4 tarballs→干净 prefix→doctor/domain/search 真结果落白名单域+peer embedding 腿）；ans-mcp --help+stdio 握手返 5 工具；真端点 live 测活（provider anon 实跑返 3 真结果 1219ms server-side）；ship-gate 全腿绿含 closeout-claims 10/10 重推导。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。验收全为本地实录（命令+输出摘要见 reports/2026-09-24-report.md 映射表）。

## 下一轮候选（详见 handoffs/next-round-r83.md）

- **候选 A**：fix-r83-anysearch-vertical-domain-passthrough——垂域贯通具名票（契约+路由+审计三面牵动，须立项裁决）。
- **候选 B**：TE1 兑现窗——rc.2 ≈09-26T14:02Z 出闸后双锚重判，合格即消费预注册票（guard 按 source!=='startup'）。
- **候选 C**：落选池征集。
- **哨戒**：#1764 评论仍挂用户侧；test-online-anysearch 首周观测。

## Known risks / deferred

- 无效 ANYSEARCH_API_KEY 将使该臂 isError 降级（fail-first 生效，不吞零）——键面属用户配置域。
- SSE 帧响应真端点未观测到（全 application/json）——SSE 分支 mock 覆盖+spec MUST 实现。
- OmniRoute /mcp 兼容性未实测（用户 env 域不打扰；错形必降级兜底）。
- live 探针 job 远端表现未验（栈未 push）。
- 落选续债 9+1 条（registry open 面全列）。
