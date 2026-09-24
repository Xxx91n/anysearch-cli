# atomcode 调研存档 — R82 Q2（MCP transport 选型）

> 调研时间 2026-09-24；命令 atomcode -p "$(cat q2-prompt.txt)"；Sufficiency Gate：searches 7（web_search×3+anysearch×4，Tavily 额度尽改双引擎）| angles=Official/Comparative/Criticism/Currency/Community | full reads 6。resume 锚=2dffc5d6-8ff7-401a-a47c-44ad43b399c1。

## 1) 执行摘要

推荐：手写薄 JSON-RPC over fetch（约 80–120 行适配器），不引入 @modelcontextprotocol/client。Confidence 高。决定性依据：实测端点「无 session-id 依赖即通、单次 tools/call、无 server→client 交互」，叠加 2026-07-28 协议修订正式删除 GET 长流、协议级 session 与 Mcp-Session-Id（官方规范原文+flaviocopes/MCPJam 解读双源确认）——SDK 相对薄客户端的价值（session 管理、SSE 重连、OAuth、Last-Event-ID 恢复）在本场景全部是死重；手写面已知坑收敛为三个可枚举项（Accept 双类型、响应可能是 SSE 帧、MCP-Protocol-Version 头），逐条可测。

## 2) 分点结论

① 工业界心智模型：「全功能 MCP host」用 SDK，「嵌入式单工具 provider 适配器」走直连 JSON-RPC。分野在「调用形状是否已知」：IDE/Agent host 需动态 tools/list、多工具、OAuth、server-initiated→SDK；后端里已知 tool 名+参数+固定端点的 provider 适配器，社区明确把「40 行直连客户端、无需 SDK」作成熟模式（databaaba：There is no SDK, because there does not need to be one）。Cloudflare MCP v2 博客以「stateless 核心、任何实例可处理任何请求」方向背书。retriever 的 anysearch 臂正是后者。

② 2026-07-28 修订是选型杠杆。官方规范原文：Removal of the GET stream endpoint. Removal of protocol-level sessions；每请求自包含（版本+capabilities 在请求里），MCP-Session-Id 变 OPTIONAL 且端点实测不依赖。SDK 最重一块（持久 GET SSE 流、指数退避重连、Last-Event-ID 恢复调度器——deepwiki 对 streamableHttp.ts 结构分析确认复杂度）对当前端点永不触发。

③ 手写 JSON-RPC 已知坑（收敛四条，可枚举可测）：Accept 头必须双类型 application/json, text/event-stream（规范 MUST+databaaba 实战，缺则严格服务端 4xx）；单次响应也可能是 SSE 帧（规范 MUST 支持双 content-type；直接 .json() 会炸——按 Content-Type 分支，SSE 帧取 data: 行多行拼接，建议用 eventsource-parser 的 EventSourceParserStream ~2KB SDK 同款，别手搓 SSE 状态机）；MCP-Protocol-Version 头 2026-07-28 起每个 POST MUST 携带；JSON-RPC error 字段与 202/空体（notifications POST 返 202 无体；带 error 字段必须显式 raise）。反面教材：OpenAI 官方 connector 迁 Streamable HTTP 后过早发 DELETE 掉 session 全社区踩坑。

④ 响应映射→混合容错 fail 优先：structuredContent 存在则优先（前向兼容）；否则解析 content[].text 的 ## Search Results / ### N. / - **URL**: 结构（容错正则，标题缺失仍可提取 URL）；isError:true、200 但解析为零且 text 非空的错形（OmniRoute 枚举形正属此列）、Content-Type 非预期——一律走 fail 分支降级该臂，绝不静默吞零。

⑤ env override 兼容→剥尾规范化+错形 fail 兜底：ANYSEARCH_ENDPOINT 若以 /v1/search 结尾→剥尾落 base+/mcp 并 warn 一次；install-smoke 的 127.0.0.1:9 无尾径原样直打连不上→fail-open 不受影响；本机 127.0.0.1:20128/v1/search 剥尾后指向 OmniRoute——不应答 /mcp，即使碰巧 200 错形也被④拦住。剥尾+错形 fail 是唯一同时满足「旧值不暴毙」与「不错误吞零」的策略。

⑥ max_results clamp 20→10：provider 层静默 clamp，属参数归一化非错误；CHANGELOG 记一条，融合信封不感知。

⑦ modes 处置：MCP 端无 mode 形参→provider 不下发该参数（别发未知键，input_schema 可能 additionalProperties:false）；mode:"answer" 意图降级为普通 search，融合层已有臂权重语义——记入映射文档。

⑧ live 测活探针→分两层：fail-path（dead-port 注入验 fail-open）留 install-smoke（契约关键路径已存在）；live-path 放 CI test-online 作可选/定时 job，不进必经门禁（外网依赖让 CI 摆烂）。绝不把 live 探针做成 blocking gate。

## 3) 对比矩阵

| 项 | 手写薄 JSON-RPC | SDK StreamableHTTPClientTransport |
|---|---|---|
| 代码/依赖面 | ~100行+可选 eventsource-parser(~2KB) | client 包+zod+OAuth/reconnect/middleware 全家桶；retriever 再持一份=lockfile 面增量 |
| session/SSE/重连 | 不需要（端点无 session 依赖；2026-07-28 已删协议 session） | 全内置但本场景永不触发=死重 |
| fail-open 可控性 | 每个 fail 路径显式可测 | SdkHttpError 外有 schema 解析/隐式重试等隐式路径，fail 语义需额外剥离 |
| 协议合规漂移 | 自担（需实现面收敛到 3 项 MUST） | SDK 官方跟随 spec 演进=唯一实质优势；v2 刚发布仍在收敛 |
| 已知坑 | Accept 双类型/SSE 帧/Protocol-Version 头共 3 条 | session-terminated 类事故反证复杂度，坑难枚举 |
| 适用边界 | 单工具、无 OAuth、无 server-initiated | 多工具动态发现/OAuth/MRTR/订阅——未来 anysearch 加 OAuth 再切 SDK |

## 4) 来源清单

deepwiki typescript-sdk transport 页（session/重连/OAuth/SSE 解析全貌）| blog.modelcontextprotocol.io 2026-07-28 release candidate（stateless 修订意图）| databaaba.com mcp-without-an-llm（40 行直连客户端+三大坑全文）| flaviocopes.com mcp-2026-07-28-stateless（修订解读）| community.openai.com session-terminated 帖（SSE→Streamable 迁移踩坑实录）| MCPJam substack stateless 破坏面清单| blog.cloudflare.com/mcp-v2（stateless 方向背书）| npmjs @modelcontextprotocol/sdk

## 5) 信息缺口

未找到 HN「手写 vs SDK」高热争论帖；@modelcontextprotocol/client v2 依赖树/bundle 体积无实测——建议实施时 pnpm why 对比 lockfile 增量作 ADR 实证脚注；端点未来是否开 OAuth/MRTR 不可知——按现状裁决并写明 SDK 切换触发条件。