# T1 — 垂域贯通评估腿实录（D-001 §2）

Date: 2026-09-24. 任务：tools/call 携 domain 真打一发 + domainFilterSupported 翻转可行性 + post-filter→pre-filter 审计语义牵动面测绘。**腿产推荐不裁决。**

## 1. 真打实录

- `tools/call search(query='cloudflare workers', max_results=3, domain='it_tech')` → **200**，## Search Results (3 results, 1116ms) 正常返回（request_id=cbaa832d-…）。服务端对孤 domain（无 sub_domain）未拒收——schema 内嵌 HARD GATE 文案是协议层建议非强制校验。
- `tools/call get_sub_domains(domains=['it_tech','finance'])` → 200，返垂域能力清单（finance.calendar/fundamental/macro…含 sub_domain_params 约束表）。

## 2. 翻转可行性测绘

**domain 是垂域路由枚举（17 值：academic…travel），不是 hostname allowlist。**`SearchRequest.includeDomains` 的语义=域 canonical allow hosts（如 "developers.cloudflare.com"）；塞进 MCP domain 枚举=类型错误（枚举不含任意 hostname）。两者是**不同轴**：一个是「在哪个站群内搜」，一个是「用哪个垂域引擎路由」。

牵动面：
- 若硬翻 domainFilterSupported=true：includeDomains（host 列表）无处可去——要么丢弃（谎称支持=审计面造假），要么映射到 sub_domain_params（get_sub_domains 前置+逐域 params 约束，host 语义仍不可表达）。
- 若要真垂域贯通：须新契约面（SearchRequest 增 verticalDomain? 字段）+引擎路由决策（何时走垂域）+domain_filter.pre 审计事件语义扩展——**牵动引擎路由与审计面**。

## 3. 半径结论行

**半径判定：超同票范围（牵动引擎路由/审计面）→ 推荐立 R83 具名票 fix-r83-anysearch-vertical-domain-passthrough**（owner 建议=anysearch-retriever；deadline 建议随 R83 立项；溯源=D-001 §2 评估腿）。

本票内落点：`domainFilterSupported=false` 保持（+注释说明垂域枚举≠host allowlist 的语义边界）；kernel post-filter 仍为唯一权威闸。D-001 §2 腿产=推荐，裁决权归下轮账本。
