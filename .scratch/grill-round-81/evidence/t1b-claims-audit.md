# T1b — 存量宣称审计（种子化位置穷举 + 逐条 PASS/FAIL/RESHAPE）

Date: 2026-09-24. 取证戳 = **2026-09-24T07:44:43.899Z**。审计对象 = 仓内关于 anysearch provider / live-search / memory 种子化的全部现存宣称与代码面。

## A. R71 直接种子 memory 行的位置穷举

仓内持久化种子化 seam（grep `INSERT INTO retrieval_results` + `saveResults(` 全扫，含生产/测试两面）：

| # | 位置 | 性质 |
|---|---|---|
| S-1 | `packages/store/src/eval/runner.ts:409-425` `case "seed"` → `INSERT INTO retrieval_results (session_id,url,title,snippet,source,rrf_score,entity) VALUES(...)`，注释 `seeded N row(s) (write guard bypassed)` | eval harness 合法种子化 seam（eval 域内显式 op）|
| S-2 | `packages/store/src/session-store.ts:428` prepared + `:701 saveResults()` | **正路**（provider 结果落库正式 API）|
| S-3 | `apps/mcp/src/tools/search-web.tool.ts:57` `eng.store.saveResults(session.id, envelope.results)` | **正路**（live search 结果写 memory 的唯一产品路径）|
| S-4 | `scripts/chain-gate-fixture.ts:17` `saveResults` | fixture 生成器（access-chain 链 fixture）|
| S-5 | `scripts/ship-gate.mjs:1582` step6 seeded preference T0 smoke probe | 门禁种子化（t0_preferences 面）|
| S-6 | `packages/store/test/consolidate-forget.test.ts:140-146` seedRw `INSERT INTO retrieval_results` | 测试种子化 |
| S-7 | `packages/store/test/fusion-registry-memory.test.ts:20` 等 9 个 test 文件 `saveResults` 调用 | 测试种子化（走正式 API）|
| S-8 | `packages/kernel/test/pi-runtime.test.ts:131` `saveResults` stub | mock 桩 |

**R71 spike 当时的种子化操作**：`.scratch/grill-round-71/evidence/t1-embedding-spike.md` 记录「rows seeded directly into `retrieval_results` (same shape as `SessionStore.saveResults`)」——为装进临时 arm 的 DB 直写，**该 INSERT 语句未入库**（运行时操作，无仓内持久脚本）。仓内可复跑等价物 = S-1（eval runner seed op）/S-6（test seedRw）。

## B. 现存宣称逐条审计

| # | 位置 | 宣称 | 判定 | 依据 |
|---|---|---|---|---|
| C-1 | `anysearch.ts:5-6` | `Endpoint: https://api.anysearch.com/v1/search` + `Anonymous has lower rate limit` | **RESHAPE** | 路由实测 404（T2 P-A 双列）；匿名限流宣称从未被验（无 authed 对照）|
| C-2 | `anysearch.ts:3` | REST `/v1/search` 返 JSON `{code,message,data:{results,metadata}}` | **RESHAPE** | 契约形当前不可验（404）；唯一实测契约证据=mock fixture 自证 |
| C-3 | `anysearch.ts:10-15` | `Verified live at round 58: CloudFront CNAME, Amazon wildcard cert valid to 2026-12-03, fresh status subdomain cert - NOT dead infrastructure` | **RESHAPE** | R58 验证面=基础设施层（DNS/cert/子域），「Verified live」对路由存活构成过度暗示；且 cert 已轮换（2026-09-22→2027-04-07），"2026-12-03" 为过期值 |
| C-4 | `anysearch.ts:13` | fail-open：不可达端点只降级 anysearch arm | **PASS** | 机制在（fetch throw→上游兜）；**但新发现**：env 错形 200 响应下 provider 返静默零结果 envelope（fail-open 不覆盖「活但错形」面）——另立新债 |
| C-5 | `anysearch.ts:51-53` | `ANYSEARCH_ENDPOINT` env override（install-smoke dead-port 注入）| **PASS** | 机制实测生效（P-B：env 继承下 fetch 打 127.0.0.1:20128）|
| C-6 | `docs/limitations.md:61-63` | anysearch provider 无 pre-filter（post-filter-only）| **PASS** | REST 面无 domain param 的语义宣称仍真（端点 404 不改变 API 形状宣称的真值）|
| C-7 | `deferred-registry.json` `defer-r71-provider-serverside`.evidence | `provider endpoint returned 000 for live search` | **RESHAPE** | 「provider endpoint」未指明实际端点——本机 `ANYSEARCH_ENDPOINT` User 级 env 常驻（127.0.0.1:20128），000 大概率=本地端口死而非 api.anysearch.com（T2 P-C 复现）；措辞需改写为实测精确形，处置态 T4 落地 |
| C-8 | `defer-anysearch-domain-ownership`.evidence | `Domain verified live at round 58 ... NOT dead infrastructure` | **PASS** | R81 复核：CNAME/新证书/apex+status 200 仍活（T1a §1）——宣称边界=域/证书层，与实测吻合 |
| C-9 | `search-web.tool.ts:57` | live 结果落 memory | **PASS** | 正路在（fail-open 下 provider 失败不落行——种子化绕验的必要性来源如实记）|
| C-10 | `eval/runner.ts:409` | seed op 显式 bypass 注释 | **PASS** | 合法 seam，语义诚实 |
| C-11 | `ship-gate.mjs:1582` | T0 seeded-preference smoke | **PASS** | 门禁层种子化，与 provider 无关 |
| C-12 | `install-smoke.mjs:11,193` | dead-port fault injection | **PASS** | 设计在案（ADR-0063 R62 T2）|
| C-13 | `test/anysearch.test.ts:80-91` | mock REST 契约形（code=0/data.results/metadata.search_time_ms）| **RESHAPE** | 与 C-2 同源——mock 自证契约，真实契约当前不可验 |
| C-14 | `test/domain-filter.test.ts` 等 | post-filter-only 宣称 | **PASS** | 机制面宣称不受影响 |

## C. RESHAPE → 具名跟进票（验收面各挂）

| 宣称 | 具名票 | 验收面 |
|---|---|---|
| C-1+C-2+C-13（REST 契约三件套）| `fix-r82-anysearch-rest-contract` | R82 端点处置裁决后：端点复活→契约注释+mock fixture 按实测更新；端点死且外部不可控→注释降级为 dead-endpoint 记+provider 摘除票（ADR-0082 裁决面）|
| C-3（"Verified live" 过度暗示+过期 cert 值）| `fix-r81-anysearch-live-annotation`（**本轮内落地**，宣称修正票=T4 文书域非行为码）| anysearch.ts 注释改写：验证面=基础设施层（DNS/cert/子域）限定词+2027-04-07 新 cert 值+R81 路由级 404 实测注记 |
| C-7（registry evidence 措辞）| `fix-r81-registry-evidence-reshape`（**本轮内落地**，T4 registry 更态票）| evidence 改写为：「R71 T1.2 本机观测 000（本机 ANYSEARCH_ENDPOINT env 常驻=127.0.0.1:20128，R81 T2 复现 dead-port→connection refused）；R81 spike 实测 api.anysearch.com 路由级 404（基础设施层活）」|

PASS=9 / FAIL=0 / RESHAPE=4（C-1/C-2/C-13 合票 / C-3 / C-7）。零 FAIL 项——无彻底伪宣称，全部为措辞越界或未验形。

## D. 残余未验

- R71 spike 的原始 curl/fetch transcript 未入库（registry evidence 为二手描述）——000 的精确工具面（curl exit code 还是 node fetch error）不可回溯，如实记。
- 匿名速率限制宣称（C-1 后半）：无 authed 凭据，永远不可验——建议票内删除该半句。
