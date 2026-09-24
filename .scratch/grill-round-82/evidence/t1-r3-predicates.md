# T1 — R3 transport spec 谓词式验收（逐条判定）

Date: 2026-09-24. spec 原文面=modelcontextprotocol.io specification/2025-11-25/basic/transports（服务端协商版本=2025-11-25，即账本所称 2026-07-28 stateless 修订线的现行文本）。每条谓词可机械判定；任一失败=验收失败。

| # | spec 原文谓词 | 实现面 | 判定 |
|---|---|---|---|
| R3-1 | Every JSON-RPC message MUST be a new HTTP POST | rpc()/notify() 每消息独立 POST（mock 捕获 3 POST 序列实证）| PASS |
| R3-2 | client MUST include Accept listing both application/json and text/event-stream | post() 固定 Accept 双类型；test#1 断言逐 POST | PASS |
| R3-3 | POST body MUST be a single JSON-RPC request/notification/response | 单消息发送，无 batching | PASS |
| R3-4 | notification/response 受理→202 no body | id===undefined 分支：非 2xx 才 throw，202 空体正常返回 | PASS（test#1 notifications/initialized→202）|
| R3-5 | request 应答=Content-Type text/event-stream 或 application/json；client MUST support both | Content-Type 分支双实现 | PASS（test#1 JSON / test#2 SSE）|
| R3-6 | SSE 帧格式（data: 行、id/retry 字段语义）| eventsource-parser 解析（SDK 同款，不手搓状态机）；取 data 载荷 JSON.parse | PASS（SSE 测试实证）|
| R3-7 | server MAY 在 response 前发 requests/notifications——client 须容忍 | SSE 循环按 id 匹配、异 id 消息跳过 | PASS（设计面+实现）|
| R3-8 | server MAY 于 initialize 应答携 Mcp-Session-Id；若返回 client MUST 于后续请求回显 | post() 捕获 mcp-session-id 响应头→sessionId 字段→后续 POST 回显 | PASS（test#11b 实证；端点当前不发=前向兼容腿）|
| R3-9 | client 收到含 session-id 请求的 HTTP 404 → MUST 新发 InitializeRequest | 404+sessionId→SessionExpiredError→search() 清 session/handshake 重初始化重试一次 | PASS（test#11c 实证）|
| R3-10 | client MUST 于所有后续请求携 MCP-Protocol-Version | 每 POST 必携（协商值覆盖默认）| PASS（test#1 逐 POST 断言）|
| R3-11 | resumability：断流恢复=GET+Last-Event-ID（client SHOULD）| **不实现**——SHOULD 级；本端点 stateless 无流式多消息场景；search() 断流=整调 throw→臂降级由上层重试。记档非失败 | N/A（SHOULD 级，明示弃）|
| R3-12 | client SHOULD 发 DELETE 终止 session | 端点无 session——N/A | N/A |
| R3-13 | JSON-RPC messages MUST be UTF-8 | JSON.stringify+fetch=UTF-8 | PASS |
| R3-14 | GET 长流/协议级 session 在 2026-07-28 线删除（Mcp-Session-Id 降 OPTIONAL）| 实测：无 session 头全链通（wire-probes §1）；实现不依赖 GET 流 | PASS |

**谓词锚判定：MUST 级全 PASS；SHOULD 级两条明示弃/不适用并记档。R3 消解（折入验收锚成立）。**
