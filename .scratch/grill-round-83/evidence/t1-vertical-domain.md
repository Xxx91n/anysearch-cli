# T1 垂域贯通证据 — 2026-09-25

## 契约面（D-003）

- `packages/retriever/src/contract.ts`：`SearchRequest.vertical?: {domain;subDomain?;params?}`（内部 vertical* 命名）；`SearchProvider.verticalDomainSupported?: boolean`。
- `packages/store/src/domain-schema.ts`：`RawDomain.sources.vertical{domain,sub_domain?}`（TOML 面 wire-adjacent 命名）；resolve() section-replace 语义（derived 重述整体替换——base sub_domain 不深合并，domain-schema.test.ts 断言覆盖）；validate() 形状校验唯一：domain/sub_domain 非空字符串、对象非数组——词表枚举不本地复制。
- kernel Query=SearchRequest 超集，自动承继 vertical 字段（无额外面）。
- 工具 arg 面：`tool-schemas.ts` search_web/research_web 增 `verticalDomain/verticalSubDomain/verticalParams`（TypeBox 形状约束+additionalProperties:false 保持）；`tool-json-schemas.ts` 经 toPlainJsonSchema 自动同步（无手改）。
- CLI：`ans search --vertical-domain X --vertical-sub-domain Y --vertical-params '{json}'`；params 解析 JSON→Record 形状闸（非对象 exit 2）；flag 值不泄漏进 query string。

## 路由面（D-004）

- `engine.ts`：repoVertical resolver（composition 注入，与 urlPolicy 同一 liveSchema 闭包共享 lazy-mtime reload）；resolvedVertical = q.vertical ?? repoVertical（查询级整体替换）；capability 协商：verticalDomainSupported 声明者收 req.vertical，未声明者 general 扇出并入 degraded 名单。
- `anysearch.ts` provider：`verticalDomainSupported=true`；wire 映射 domain/sub_domain/sub_domain_params ← vertical.domain/subDomain/params（无 vertical→三键全缺席）；结果 extra.vertical={domain,subDomain?} 机读标记（fusion 保活 extra 已验）。
- kernel 测试 `test/vertical-domain.test.ts` 28 断言：repo/query 来源判定、整体替换、sent/degraded 名单、fail-first degrade（isError→providersFailed）、非空才发事件、无 vertical.post、domain_filter.pre 触发条件不变。

## 审计面（D-005）

- `retrieval.vertical.pre` 事件：attrs=`anysearch.domain`+`vertical.domain`+`vertical.sub_domain`+`vertical.params_keys`（仅键名，值断言不落——测试断言 params 值"MSFT"不出现在 attrs）+`vertical.source`(repo|query)+`vertical.sent`+`vertical.degraded`——与 domain_filter.pre 同构镜像；独立触发（无 host policy 也发）；无 `vertical.post`。

## 校验面+e2e（D-006）

- DomainSchema load-time 形状闸：empty domain/sub_domain 拒收（报错指名字段）；未知词不禁（上游权威唯一）。
- 工具 handler 补 AJV 表达不了的依赖约束：sub/params 无 domain → fail-fast 文案错误（不静默吞）。
- anysearch adapter 测试 13/13b/13c/13d：wire 映射在场/缺席双向断言、marker 断言、isError→fail-first 断言。

## 上游实测矩阵（2026-09-25，live https://api.anysearch.com/mcp，tools/call 直打）

| 用例 | 结果 |
|---|---|
| domain="bogus_domain_xx"（枚举外） | HTTP 200 正常结果集——domain 枚举上游不严校验，静默退回 general 风格 |
| domain=finance + sub_domain="bogus_sub_xyz" | `isError=true` "Invalid tag: finance.bogus_sub_xyz." → fail-first arm degrade ✅ |
| domain=finance + sub_domain=calendar 缺 required param type | `isError=true` "Missing required params for tag 'finance.calendar': type." → fail-first ✅ |
| domain=finance 仅 domain 不带 sub | HTTP 200 正常结果（文档写 required 但服务不强制） |
| 合法基线 finance.calendar + {type:earnings} | HTTP 200 真垂域数据（FMP earnings 条目） |

垂域 17 值词表（get_sub_domains enum，2026-09-25 快照）：academic agriculture business code energy environment film finance gaming general health ip legal resource security social_media travel。params 约束示例表：finance.calendar required type∈{earnings,dividends,ipos,economic}；finance.fundamental required type∈{overview,income,balance,cashflow,indicator,holder}+symbol/cn_code 随 type；finance.macro required type∈{gdp,cpi,fed_funds,treasury,unemployment,nonfarm,shibor,lpr,money_supply,social_finance}。（写进 README §AnySearch vertical domains 附日期源注记）

## CLI e2e 实测

- `ans search "AAPL earnings" --vertical-domain finance --vertical-sub-domain calendar --vertical-params '{"type":"earnings"}' --json`：queryClean="AAPL earnings"（flag 值不泄漏）；JSON 出 `vertical:{domain:finance,subDomain:calendar,params:{type:earnings}}`；本机 ANYSEARCH_ENDPOINT 指向 127.0.0.1 本地 stub 时 anysearch arm 拒收组合→providersFailed:[anysearch]+其余臂正常回答（fail-first→envelope fail-open 实演）；直连真端点臂（无 stub 时）垂域命中正常回包。
