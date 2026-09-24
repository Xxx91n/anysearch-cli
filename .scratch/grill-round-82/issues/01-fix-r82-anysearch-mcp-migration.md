# 01 — fix-r82-anysearch-mcp-migration（T1 主轴）

Status: in-progress
Covers: D-001 §1-2 + D-002 全 + D-004 §3（R2/R3 验收锚）

## 票体

AnySearchProvider REST→MCP-over-HTTP 迁移（ADR-0082 分支 b 已裁决，不重裁）：

1. 手写薄 JSON-RPC over fetch（initialize→notifications/initialized→tools/call search 三步），不引 @modelcontextprotocol SDK 为 retriever dep。
2. 四坑纪律：Accept 双类型 `application/json, text/event-stream`（spec MUST）；响应按 Content-Type 分支，SSE 帧经 eventsource-parser（~2KB，SDK 同款，不手搓状态机）；`MCP-Protocol-Version` 头每 POST 必携；JSON-RPC error 字段显式 raise（notifications POST 返 202 空体=正常）。
3. 混合容错 fail 优先：structuredContent 优先→content[].text markdown 容错解析（## Search Results/### N. title/- **URL**:/snippet 段，标题缺失仍可提 URL）→isError:true/200-错形/Content-Type 非预期一律 fail 降级该臂——收口 defer-r81-provider-shape-validation。
4. env 兼容：ANYSEARCH_ENDPOINT 以 /v1/search 结尾→剥至 base+/mcp+warn 一次；无尾径原样直打；dead-port 注入语义不变。
5. max_results 静默 clamp=10；modes 形参不下发（additionalProperties:false 防拒收），answer 意图降普通 search 记映射文档。
6. R2 谓词锚（实施首日）：authed vs anon tools/call 对照实测——锚文双分支「anon 可用→继续；401/429→stop-gate+具名回退票携原 R2 编号」。
7. R3 谓词锚：立票时按 2026-07-28 spec 原文逐条生成谓词式验收项（帧格式/session 头/SSE 事件名/重连语义），失败即验收失败。
8. 垂域评估腿（D-001 §2）：tools/call search 携 domain 参数真打一发+domainFilterSupported 翻转可行性+post-filter→pre-filter 审计语义牵动面测绘——半径=透传+翻转+契约面核对则同票落；牵动引擎路由/审计面则立 R83 具名票（腿产推荐不裁决）。
9. 测试面：anysearch.test.ts fixture 换 MCP 形（mock initialize/tools-call+SSE 帧样本+错形样本+isError 样本）；fail-open 保留实证+dead-port 兼容实证。
10. live 探针两层：fail-path 留 install-smoke；live-path 进 CI test-online 可选非阻断 job——绝不 blocking。

## 验收

谓词锚逐条判定+测试 transcript+install-smoke 实录+错形校验证明+SSE 解析证明+R2 对照实录+评估腿半径结论行；turbo check/test 绿+ship-gate 全绿+install 无脏。

## 红线

不重裁方向；structuredContent 缺席不判死；错形不吞零；env 值不代改不录档；live 探针不 blocking。
