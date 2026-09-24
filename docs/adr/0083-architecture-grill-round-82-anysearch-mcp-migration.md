# ADR-0083: Grill Round 82 — 迁移落地轮（AnySearchProvider REST→MCP-over-HTTP + 宣称修正 + 残余四分诊）

## Status

Accepted (migration round r82; 实施票 fix-r82-anysearch-mcp-migration 落地). Records the round-82 decisions per ticket plan T0/T1/TE1/T2/T3/T4. Ledger: `.scratch/grill-round-82/decision-ledger.md` (D-001~D-005, 无断号). Evidence root: `.scratch/grill-round-82/evidence/`.

## Context

ADR-0082 已裁决分支 b（死但可修）：REST /v1/search 为外部下线事实，POST /mcp 为活 MCP Streamable HTTP 端点，修复=纯自侧迁移。R82 是执行轮——不重裁方向，只落地+验收+宣称修正+残余分诊。

## Decision

### D1 主题定界——迁移落地轮（D-001）

本轮=实施轮：唯一主轴 AnySearchProvider MCP 迁移；TE1 条件辅轴按预注册双锚判定；T2/T3/T4 为宣称修正/残余分诊/文书收口。验收标准叠加用户原文：「编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环，避免只引入却没做到。」

### D2 传输形态——手写薄 JSON-RPC over fetch（D-002 全条落地）

实测端点无 session-id 依赖、单 tools/call、无 server→client 交互；SDK 的 session/重连/OAuth/Last-Event-ID 价值在本场景全为死重。**依赖增量脚注（pnpm why 实证，2026-09-24）**：`@modelcontextprotocol/sdk@1.30.0` 仅为 @google/genai←pi-ai 传递依赖（cli/kernel/mcp 三消费端），**retriever 直依赖零 SDK**；迁移唯一新增 dep=eventsource-parser@4.1.1（~2KB，SDK 同款解析器）。

**SDK 切换触发条件（入档，触发即重评）**：端点开启 OAuth 授权流 / MRTR（server-initiated requests 双向交互：sampling/elicitation/roots 类）/ 需要 tools/list 动态多工具发现（当前 tool 名+参数固定已知）。

四坑纪律逐条落码：Accept 双类型 MUST；SSE 帧经 eventsource-parser 不手搓；MCP-Protocol-Version 每 POST 必携（实测协商面：请求 2026-07-28→回落 2025-11-25，实现=发 2025-11-25+回写协商值）；JSON-RPC error 显式 raise+notification 202 空体正常。另按 spec MUST 补 Mcp-Session-Id 捕获回显+session-404 重初始化重试一次（端点当前不发 session——前向兼容腿）。

混合容错 fail-first：structuredContent 优先→markdown 信封容错解析（### N. 块+**URL** 行+snippet 段，标题缺失仍提 URL）→isError:true/200-错形/Content-Type 非预期一律 throw 降级该臂——收口 defer-r81-provider-shape-validation（OmniRoute 错形静默面绝不再吞零）。

### D3 条件辅轴——双锚判定成立但候选未合格（D-003）

TE1 预注册票（issues/02）按判据执行判定：特征锚=rc.2 tarball 复验齐（agent/created 携 source/signal、session-start 缺席）；稳定锚=未齐（rc.2 发布 2026-09-24T14:02Z，minimumReleaseAge=2880min 闸内至 09-26T14:02Z——npm pack ETARGET 实测闸在呼吸；changelog 审面缺席，tarball 不随包发布 changelog）。**判定=合格候选未出现**（D-003 §4 如实记，非空段）：预注册票保留票池，rc.2 出闸后特征锚仍立则候选重评。修正点入档：SessionStartSource 实测枚举=startup|resume|clear|compact（无 fresh），采纳时 guard 按 source!=='startup' 落字。

### D4 残余四分诊——五残余全落位无第五格（D-004）

| 残余 | 落格 | 处置 |
|---|---|---|
| R1 历史端口监听态 | 即销 | 五字段卡（本体性不可回溯+收敛证据+重开触发器=HTTP 000 复现）→ registry residual-r82-R1-port-state |
| R2 /mcp 凭据限流面 | 折入验收锚 | authed/anon 对照谓词=PASS（anon 200 真结果→继续分支；未触发 401/429 stop-gate）→ registry residual-r82-R2-anon-credential |
| R3 transport 细节 | 折入验收锚 | 2025-11-25 spec 14 谓词机械判定 MUST 级全过（SHOULD 级 2 条明示弃记档）→ registry residual-r82-R3-transport-spec |
| R4 用户端点语义 | closed-by-scope | 用户个人配置域一行闭合（不记档不代改；重开=配置治理权变更）→ registry residual-r82-R4-user-endpoint |
| R5 REST 下线时点 | 即销 | 五字段卡（外部部署史无观测面+穷举收敛+重开=REST 复活官宣）→ registry residual-r82-R5-rest-shutdown-timing |

### D5 宣称修正与契约核对（D-005）

- C-1/C-2：anysearch.ts 注释与契约陈述重写为 MCP 面（端点常量 https://api.anysearch.com/mcp；REST 全量 URL 在源码零出现，仅保留剥尾后缀字面量）。
- C-13：test/anysearch.test.ts 由复制式 REST mapper 改为 mock-fetch 驱动真实 provider 公开面——12 组断言覆盖握手序列/双 Accept/协议头/SSE 帧/isError/三类错形/空信封合法零/session-id 回显/404 重初始化/剥尾/clamp/dead-port/元数据。
- max_results 名义 20 宣称核对：MCP schema 实证上限 10（tools/list inputSchema maximum=10），静默 clamp 落地+CHANGELOG Changed 记档。
- README/docs/limitations REST 宣称三处修正（REST→MCP 措辞+垂域枚举≠host allowlist 语义边界）。
- closeout-claims.json 十条机验声明注册（ship-gate 1u 腿逐条重推导）。

### D6 live 探针两层（D-002 §5）

fail-path：install-smoke dead-port 注入语义不变（ANYSEARCH_ENDPOINT=127.0.0.1:9→fetch 拒连→臂降级 fail-open）。live-path：packages/retriever/test/online/anysearch-mcp.online.ts + test:online 脚本 + ci.yml test-online-anysearch job——**job 级 continue-on-error: true，外部端点永不卡流水线**（非阻断立法）。

## Rejected alternatives

- **SDK transport（B）**：session/SSE 重连/OAuth/Last-Event-ID 对 stateless 端点全死重+fail 隐式路径剥离成本+retriever 依赖面增量——pnpm why 实证 SDK 已在 lockfile 传递面，直引即增新边。
- **双实现（C）**：REST+MCP 并存=双份维护成本，REST 路由实测 404 死。
- **垂域贯通捆入本票**：eval 腿实测 domain=17 值垂域枚举≠host allowlist——牵动契约面/引擎路由/审计语义，半径超出，具名转 defer-r83-anysearch-vertical-domain-passthrough。
- **TE1 无条件插入**：抢主轴为文献一致反模式；双锚判据守住，候选未合格如实记。
- **独立闸票承接 R2/R3**：谓词判据充要（可机械判定）→折入合法，不另立票。
- **残余第五格「挂着」**：四格强制分诊立法，五残余全落位。
- **最小收口（仅代码迁移）**：宣称错位/残余悬挂/文书缺失=前七轮复发病灶，三段收口强制。

## Consequences

anysearch 臂恢复真实功能面（anon 可用，R2 继续分支成立）；fail-open 语义保持；OmniRoute 错形静默面被 fail-first 关闭；CI 首次获得 provider live-search 探针面（非阻断）。垂域贯通/R2 回退分支（若未来 anon 被关）/TE1 候选重评均具名入 registry。
