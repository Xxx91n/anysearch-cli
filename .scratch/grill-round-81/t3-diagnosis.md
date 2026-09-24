# T3 — defer-r71-provider-serverside 诊断书

Date: 2026-09-24. 取证戳 = **2026-09-24T07:46:38.734Z**。时限窗内收口（非降级路径）。证据索引：T1a=evidence/t1a-recon-2026-09-24.md；T1b=evidence/t1b-claims-audit.md；T2=evidence/t2-matrix.md。

## 1. 已证伪假设集

| 假设 | 证伪证据 | 证据指针 |
|---|---|---|
| H2 fake-ip DNS 污染致包丢失 | fake-ip 列与真 IP 列同得 CF 应答（X-Amz-Cf-Pop NRT20-P9 一致），请求真实抵达 CloudFront | T2 P-A E1/E2 |
| H3 代理出口地理屏蔽/降级 | 同上；若出口被 CF 屏蔽应见 CF 403/连接重置，实测应用层 404 | T2 P-A |
| H4 TLS/证书客户端病理 | schannel 握手 2.1s 成功 verify OK；新证书 2026-09-22→2027-04-07 SAN 双名 | T2 P-D |
| 「api.anysearch.com 服务全死」| /health → **200**；apex/status 子域 → 200 | T1a §1 + T2 补探针 |

## 2. 剩余假设（收窄后）

- **H1'（收窄）**：REST `/v1/search` 路由级下线——基础设施活、搜索能力健在、仅该 REST 路由不响应。已非假设而是实测事实（双列 404）。
- **H5（本机 env 重定向）**：R71 000 的真因候选——`ANYSEARCH_ENDPOINT` User 级常驻 env（=127.0.0.1:20128/v1/search）把 provider 钉到本地端口；端口无监听→connection refused→000 形态。dead-port 复现格（T2 P-C）在本机精确重现 000 形，无需任何远端参与。残余未验：R71 时刻 20128 的实际监听态不可回溯（如实记）。

## 3. 决定性新证据（本轮首发）

1. **`POST https://api.anysearch.com/mcp` = 活的 MCP Streamable HTTP 端点**：
   - `initialize` → 200，serverInfo=`anysearch-mcp-server v1.0.0`，capabilities.tools 在场；
   - `tools/list` → 200，四工具全列（search/batch_search/extract/get_sub_domains），描述与 1MCP anysearch server 一致；
   - `tools/call search("cloudflare workers")` → 200，**10 真实结果 867ms**（request_id=4f417c17-5060-4020-bc65-8004f27137dc）。
   - 即：**服务端点活着，搜索能力迁移到 MCP transport**。REST /v1/search 是被下线的旧面，不是「服务死」。
2. **OmniRoute 错形静默面**：本机 `ANYSEARCH_ENDPOINT` 所指 127.0.0.1:20128 现为 OmniRoute LLM gateway——`/v1/search` 返 200 JSON 但为 provider 枚举形（`{object:list,data:[search_provider...]}`），非 anysearch 协议形。AnySearchProvider 的 `body.data?.results ?? []` 使其退化为**静默零结果 envelope**——「活但错形」比 000 更隐蔽的降级面。
3. **CI 无对照面**：ci.yml/ship-gate.yml 全工作流无 provider live-search 探针（test-online 仅 store vector-arm+embedding）——「CI 是否同 000」证据面不存在。

## 4. 三分支推荐（推荐非裁决——裁决归 ADR-0082）

| 分支 | 适用性判定 |
|---|---|
| a. 端点复活 → live 验证+去种子化（R82 实现票）| **不适用**：`/v1/search` 路由外部不可控（域归属挂 defer-anysearch-domain-ownership 法务面），复活与否不归我们决定 |
| b. 死但可修 → 修复路线 | **推荐**：REST 面死但 `POST /mcp` 活且全功能——修复=AnySearchProvider 从 fetch REST 迁 MCP-over-HTTP（initialize→notifications/initialized→tools/call search；无 session-id 依赖实测通过）。纯自侧工程，不依赖外部复活。配套票：响应形校验（非协议 200 → 按 fail 处理，堵 OmniRoute 静默面）+ env override 语义澄清（本机 env 污染面=用户配置域外但值得 doctor 检测腿）|
| c. 死且外部不可控 → 宣称降级/换 provider | 次优兜底：若 R82 实施中发现 /mcp 亦不稳定/凭据要求变化，降级到此分支（摘除 anysearch provider 或改 third-party MCP 桥接）|

**推荐路线（b）**：修复代码出本轮域（R82 实现票）：provider 改 MCP-over-HTTP 调用 `https://api.anysearch.com/mcp` tools/call search；`ANYSEARCH_ENDPOINT` override 语义保留（dead-port 注入兼容 MCP transport）；错形响应校验按 fail 处理；live 验证+种子化退役随之成立（真 MCP 面可测活）。

## 5. 未检验假设 / 残余（携入 R82 票，原 H# + Test 保留）

| # | 未验面 | Test |
|---|---|---|
| R1 | R71 时刻 127.0.0.1:20128 监听态（000 真因的直接确认）| 不可回溯——以 H5+P-C 复现证据为收敛解释，不追 |
| R2 | /mcp 端点的凭据/限流政策（anonymous 是否长期可用）| R82 修复票内实测 authed vs anon 行为；若 anon 被封→重评分支 c |
| R3 | /mcp 传输细节：session-id 语义/SSE 流模式/断线重连（当前实测无 session 头即通）| R82 实施时按 MCP Streamable HTTP spec 全验 |
| R4 | OmniRoute 错形 200 的来源语义（用户有意路由 or 端口复用巧合）| 用户侧确认，非 agent 可判——doctor 检测腿提案内询 |
| R5 | /v1/search 下线时点（R58→R81 之间何时路由消失）| 不可精确回溯；cert 轮换（09-22）前后 CF 行为变更可能相关——不追 |

## 6. 影响面（决策后果预演）

- 若采分支 b：anysearch provider 从「不可验 REST」变为「可测活 MCP 面」——去种子化成立条件满足（真端点可测）；`install-smoke` dead-port 注入语义不变（MCP transport 同样可死端口）；doctor 可加 /mcp 存活腿。
- 若采分支 c：anysearch provider 摘除或降级——sources.enabled 默认集要改，domains toml、tool-schemas、文档宣称全波及——成本显著高于 b。
- 不变量：fail-open 语义不动；OmniRoute 静默面无论何分支都该修（响应形校验=独立小票）。
