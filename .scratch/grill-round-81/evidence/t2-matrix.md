# T2 — 判别实验矩阵（探针×环境列，每格区分≥2 假设）

Date: 2026-09-24. 取证戳 = **2026-09-24T07:43:22.676Z**。环境常量：fake-ip=198.18.0.34（全程不切代理）。探针=curl -sv 级/单次 fetch，未重演业务流量；MCP 对照组仅 1 次 search 调用。

## 环境列定义与诚实边界

| 列 | 环境 | 实现 | 诚实边界 |
|---|---|---|---|
| E1 | 代理+fake DNS/fake-ip | 本机默认（Clash/mihomo TUN，无 HTTP_PROXY env——应用直连 fake-ip，TUN 接管按域名转发）| 基准列 |
| E2 | 代理+真 DNS/DoH | DoH 双源（cloudflare-dns.com+dns.google）取真 A + `curl --resolve` 钉真 IP | TUN 模式下 DNS 层绕行成立，IP 层仍可能经 TUN 策略转发——「真 DNS」列表达为「真 IP 直连起点」，不保证完全绕代理 |
| E3 | 直连 | 同 E2（--resolve 真 IP；本机无 HTTP_PROXY，curl 本就无代理层）| TUN 全域接管下不存在物理直连面——E2/E3 收敛为同一实测列，如实记 |
| E4 | CI runner | 核查 ci.yml/ship-gate.yml/native-smoke.yml 探针面 | **CI 不存在 provider live-search 探针**（test-online 仅 store vector-arm+embedding 模型）——分水岭列缺席如实记 |

## 矩阵（行=探针，列=环境）

| 探针 | E1 fake-ip | E2/E3 真 IP | E4 CI | 区分假设 |
|---|---|---|---|---|
| **P-A** GET /v1/search?query=test | **404** `404 page not found`（text/plain 18B）+ X-Cache:Error-from-cloudfront + X-Amz-Cf-Pop:NRT20-P9 + X-Request-Id（1478ms）| **404** 同形（remote_ip=3.173.238.10 实测直连真 CF IP，同 POP NRT20-P9，1367ms）| 无探针面 | **H1 vs H2/H3**：两列同 404 → DNS/代理病理证伪，路由级失败跨路径一致 |
| **P-B** provider env 继承 fetch（`ANYSEARCH_ENDPOINT` 原样）| **HTTP 200 application/json**（52ms）body=`{"object":"list","data":[{"id":"serper-search","object":"search_provider"...}` | — | — | **H5 vs H1**：证明本机 provider 默认打 127.0.0.1:20128（OmniRoute provider 枚举面）而非 api.anysearch.com——000 观测面与远端无关 |
| **P-C** dead-port 复现（`ANYSEARCH_ENDPOINT=http://127.0.0.1:9` 同 install-smoke 注入形）| curl: `connect to 127.0.0.1 port 9 ... Connection refused`（curl exit 7 = **HTTP 000 形态**）；node fetch 19999: `TypeError ECONNREFUSED`（1ms）| — | — | **H5 vs H1**：000 在本机无远端参与下精确复现——000 只需要「env 端点死」这一条件 |
| **P-D** TLS 握手+证书 | schannel 握手成功 verify OK；CN=*.anysearch.com / Amazon RSA 2048 M04 / 2026-09-22→2027-04-07 / SAN 双名 | 同（--resolve 下 SNI=域名，证书同）| — | **H4 vs 其余**：握手健康 → TLS 病理证伪 |
| **P-E** MCP 对照组（1MCP anysearch.search）| **10 results / 858ms**（request_id=d696d2b9-09c1-4cee-b3e8-184d8c4f8aa6）真实网络结果 | — | — | **后端数据面死 vs REST 路由死**：MCP 通道返回真实结果 → 后端数据面+本机出口面活着；措辞限于此——MCP 走自身通道，不证明 REST /v1/search 应活 |

## 逐格 transcript（可复跑）

```bash
# P-A/E1
curl -sv 'https://api.anysearch.com/v1/search?query=test&max_results=1'
# → remote_ip=198.18.0.34, TLS schannel OK, HTTP/1.1 404, body='404 page not found',
#   X-Cache: Error from cloudfront, X-Amz-Cf-Pop: NRT20-P9, X-Request-Id: 07613d89-...

# P-A/E2
curl -sI --resolve 'api.anysearch.com:443:3.173.238.10' 'https://api.anysearch.com/v1/search?query=test'
# → HTTP/1.1 404, remote_ip=3.173.238.10, 同 X-Amz-Cf-Pop: NRT20-P9, X-Request-Id: 5c0d1a07-...

# P-B
node -e 'fetch(process.env.ANYSEARCH_ENDPOINT+"?query=test&max_results=1").then(r=>r.text()).then(t=>console.log(r.status,t.slice(0,120)))'
# → HTTP 200 application/json 52ms, body={"object":"list","data":[{"id":"serper-search","object":"search_provider",...}]}
#   （OmniRoute 的 search-provider 枚举面：serper/brave/perplexity/exa/tavily —— 非 anysearch 协议形）

# P-C
curl -sv 'http://127.0.0.1:9/v1/search?query=test'   # → connect failed: Connection refused (curl 000 形)
node -e 'fetch("http://127.0.0.1:19999/v1/search?query=test").catch(e=>console.log(e.name,e.cause.code))'
# → TypeError ECONNREFUSED
# 注：port 9 在 WHATWG fetch bad-port blocklist → node 层 TypeError:bad port；ECONNREFUSED 用 19999 复现

# P-D
echo | openssl s_client -connect api.anysearch.com:443 -servername api.anysearch.com | openssl x509 -noout -issuer -subject -dates -ext subjectAltName
# → issuer=Amazon RSA 2048 M04, subject=CN=*.anysearch.com, 2026-09-22→2027-04-07, SAN=*.anysearch.com+anysearch.com

# P-E（经 1MCP 网关）
anysearch.search(query="test") → 10 results, 858ms, request_id=d696d2b9-09c1-4cee-b3e8-184d8c4f8aa6
```

## 矩阵外补充观测

- **OmniRoute 错形静默面**：P-B 的 200-JSON 非 anysearch 协议形——`body.data.results` 不存在 → provider `?? []` → **静默零结果 envelope**。该 env 污染下 live search 表现为「活着但永远空集」——比 000 更隐蔽的降级面，记入诊断书候选病灶。
- GET /（api apex）404 + status.anysearch.com 200 + anysearch.com 200（E1 列，T1a §1 实录）。

## 判别力自检（任务书硬约束：不区分≥2 假设的格子丢弃）

- P-A：H1(+) H2(−) H3(−) —— 三区格 ✓
- P-B：H5(+) H1(−/无关化) —— 两区格 ✓
- P-C：H5(+) H1(−) —— 两区格 ✓（预期推翻偏爱格之一：若 dead-port 不产生 000 形则 H5 受损——实测精确复现）
- P-D：H4(−) vs 全部其余 —— 证伪格 ✓
- P-E：后端死(−) vs 仅 REST 路由死(+) —— 收窄格 ✓

**预期推翻偏爱假设（H5）的格子**：P-A/E1-E2（若真端点也返 000 则 H5 独因被削弱——实测 404，H5 幸存并强化）；P-C（dead-port 复现即 H5 正证）。
