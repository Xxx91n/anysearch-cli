# T1 — /mcp wire 实录 + R2 authed-vs-anon 谓词锚

Date: 2026-09-24. 取证戳 = 2026-09-24T15:4x–16:0xZ（探测窗）。探针=单次 JSON-RPC POST（curl -sv 级，不重演业务流量）。端点 `https://api.anysearch.com/mcp`（显式指定——本机 env 属用户配置域，值不录）。

## 1. 握手+调用序列实录（anon 列）

| POST | 状态 | Content-Type | Mcp-Session-Id | 体 |
|---|---|---|---|---|
| initialize（请求 2025-06-18）| 200 | application/json | 无 | result.protocolVersion=`2025-06-18`，serverInfo=anysearch-mcp-server v1.0.0，capabilities.tools 在场 |
| notifications/initialized | **202 空体** | — | 无 | 正常（spec：notification 受理→202 no body）|
| tools/call search(query,3) | 200 | application/json | 无 | result.`_meta.request_id` + content[0].text=markdown 信封；isError 缺席；structuredContent 缺席 |

**协议协商面**：请求 `2026-07-28` → 服务端协商回落 `2025-11-25`；请求 `2025-11-25` → `2025-11-25`。客户端实现=请求 2025-11-25 + 后续 POST 携协商值（MCP-Protocol-Version 头每 POST 必携）。

## 2. R2 谓词锚 —— authed vs anon 对照实录

锚文（D-004 §3 写死双分支）：「anon 可用→继续；401/429→stop-gate+具名回退票携原 R2 编号」。

| 列 | initialize | tools/call search | 判定 |
|---|---|---|---|
| anon（无 Authorization）| 200 | **200 真结果**（## Search Results (3 results, 847ms)，_meta.request_id 在）| anon 可用 |
| authed（Bearer 本机 env 键）| 200 | 200 但 result.isError:true，text=`invalid_api_key\nInvalid API key.` | 键对该端点无效——键面属用户配置域不评不录 |

**判定：anon 臂可用 → 「继续」分支成立**。附注：无效 Bearer → isError:true（非 401/429）——provider 按 fail-first 将该臂降级（isError→throw→providersFailed），符合「错形不吞零」。

## 3. tools/list 契约面（anon 实录）

- 四工具：`search / batch_search / extract / get_sub_domains`。
- search inputSchema：`{query(required), max_results(number, default 10, maximum 10), domain(enum 17 垂域), sub_domain, sub_domain_params(object)}`——**max_results 上限 10 实证**（REST 时代名义 20 宣称作废 → T2 CHANGELOG 核对点）；description 内嵌「HARD GATE: domain 须先 get_sub_domains」但服务端未强制拒收（domain 单独直发亦 200，见垂域腿实录）。
- 垂域枚举 17 值：academic, agriculture, business, code, energy, environment, film, finance, gaming, general, health, ip, legal, resource, security, social_media, travel（账本记 15——实测 17，以此为准）。

## 4. 样本形态（fixture 依据）

```
## Search Results (3 results, 706ms)

### 1. Cloudflare Workers - Global Serverless Functions Platform
- **URL**: https://www.cloudflare.com/products/workers/
- <snippet 自由文本（可含 markdown 链接/多行）>
### 2. ...
```

空结果合法形：`## Search Results (0 results, Tms)`（头在、零 ### 块——合法空集非错形）。
