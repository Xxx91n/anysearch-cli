# Vertical domain contract — 2026-09-25

This file is the evidence for ticket **#656** under spec **#643** (section E). It backs five
corpus entries: `ctrl-0001` / `ctrl-0002` (what upstream does with a bad
spec) and `vert-f0001`–`vert-f0003` (what the tool puts on the wire). The raw text was
recovered from `0f1148ca`, where it lived in
`.scratch/grill-round-83/evidence/t1-vertical-domain.md` and
`.scratch/grill-round-84/evidence/t1-semantics-legislation.md`; neither path is in a clean
checkout. The corpus refs still point at those old paths; ticket #665 repoints them at this
file.

The ADR layer was removed in `5593fe05`. The ADR numbers, `D-xxx` and `A-xx` decision ids
below are historical names, not links that still resolve.

## Trigger

A direct probe of the upstream endpoint on 2026-09-25 split bad vertical specs into two
kinds: one errors, one is quietly accepted. The same round wrote down what an empty params
object means (A-04) and what each entry point does with a malformed spec (A-02). Without
those two decisions the corpus could only assert that a vertical query returns something.
With them it can pin what reaches the wire and what the caller gets back.

## Method

- Dates: probe 2026-09-25; both decisions were recorded in that round and harvested into the
  corpus on 2026-09-26.
- Endpoint: `https://api.anysearch.com/mcp` (Streamable HTTP MCP).
- Calls: `tools/call search` with the argument object named in the matrix below, plus a
  `get_sub_domains` call for the 17-value vocabulary. The surviving source did not keep the
  exact `query` strings, so the matrix records the arguments the assertions rest on, not the
  wording. The envelope was the standard JSON-RPC `tools/call`; request ids were not
  preserved either, and nothing here invents them. An argument object as used:

  ```json
  {"domain":"finance","sub_domain":"calendar","sub_domain_params":{"type":"earnings"}}
  ```

- A key was present; it is never written down here.
- Read-only: the probe only called `get_sub_domains` and `search`. Nothing was rewired.

## Raw

> 立法先于断言（Pact Golden Rule）：断言只许依赖立法后行为。本档是
> expected.vertical* 断言键的独立真理源；ADR-0085 起稿时并入草案段。

### Vocabulary and parameter constraints (2026-09-25)

垂域 17 值词表（get_sub_domains enum，2026-09-25 快照）：academic agriculture business code energy environment film finance gaming general health ip legal resource security social_media travel。params 约束示例表：finance.calendar required type∈{earnings,dividends,ipos,economic}；finance.fundamental required type∈{overview,income,balance,cashflow,indicator,holder}+symbol/cn_code 随 type；finance.macro required type∈{gdp,cpi,fed_funds,treasury,unemployment,nonfarm,shibor,lpr,money_supply,social_finance}。（写进 README §AnySearch vertical domains 附日期源注记）

### A-02 — 三入口错形行为立法

**裁决方向：fail-fast 拒收报错**（CLI/TOML 对齐 MCP「拒收报错」），不取
「忽略+显式 warn」。

**理由**：(1) 现状主导方向已是 fail-fast——MCP 走 AJV schema 拒收+依赖约束
报错文案，CLI 对 params 非 Record 已 exit 2，TOML 对空 domain/sub_domain 已
throw；取 warn 方向是反向放宽，违背「先严后松」。(2) 仓内先例：ADR-0045 D2
sources.weights 配置错形 fail-fast at load、provider 运行时 fail-open——配置
边界严、运行时宽的既有分层。(3) warn 方向会放过「错形静默」类（TOML 未知键、
CLI 空串 domain）——恰是本立法要消灭的失败模式。

**立法后的行为矩阵**（错形类 × 三入口 → 全格 fail-fast）：

| 错形类 | CLI | MCP 工具面 | TOML sources.vertical |
|---|---|---|---|
| sub/params 无 domain | exit 2（既有） | error 文案拒收（既有） | domain 缺席即 throw（既有） |
| domain 空串 | **新增** exit 2 | AJV minLength:1 拒收（既有） | throw（既有） |
| sub_domain 空串 | **新增** exit 2 | AJV minLength:1 拒收（既有） | throw（既有） |
| flag 无值 / 值以 `--` 开头 | **新增** exit 2 | n/a | n/a |
| params 非 JSON/非 Record | exit 2（既有） | AJV Record 拒收（既有） | n/a（TOML 不承载 params） |
| sources.vertical 未知键 | n/a | additionalProperties:false（既有） | **新增** throw 指名键 |

**MCP「拒收报错」形态**：仓内工具层错误惯例 = `content:[{type:"text",
text:"<tool> error: ..."}]`（不设 isError——与本文件既有 error 路径同构，
见 search-web.tool.ts catch 分支）。保持不变。

**显式范围外**：engine 层对 `q.vertical` 继续信任 TS 类型（程序化调用面不
重校验）；词表合法性仍归上游权威（unknown domain 不本地拒收——ADR-0084
D-006 既有裁定不动）。

### A-04 — sub_domain_params:{} 空参 wire 语义立法

**裁决：空参 ≡ 缺席（empty ≡ absent）**——`params` 仅在「非空 Record」
（≥1 键）时序列化上 wire；`{}`、非对象、数组一律 canonical 化为缺席。

**理由**：(1) 空对象不带信息——发送 `{}` 与不发在语义上等价，选「不发」使
wire 面保持 canonical（protobuf/JSON API 惯例：empty map ≈ unset）；
(2) `params_keys` 断言真理源据此自洽——canonical 化后 `params_keys=[]` 与
wire 键缺席同义，断言永远反映真实 wire 语义；(3) fail-first 不受影响——
合法 params（≥1 键）照常下发。

**canonicalization 单点**：`canonicalizeVertical()`（packages/retriever
contract.ts，纯函数）——engine 解析 `q.vertical ?? repoV` 后调用，CLI/MCP
入口构 vertical spec 时同调（echo 面展示 canonical 形=实际下发形）。

**衍生行为**：CLI `--vertical-params '{}'` → params 键从 vertical spec 消失
（不是错误——空对象是合法 Record，只是 canonical 后无 wire 足迹）；MCP
`verticalParams:{}` 同。`params:{}` 显式出现在仓内 golden 条目 = 合法断言
载体（钉 canonicalization 的确定性用例）。

## Evidence table

### Upstream checks (2026-09-25, live https://api.anysearch.com/mcp, tools/call 直打)

| 用例 | 结果 |
|---|---|
| domain="bogus_domain_xx"（枚举外） | HTTP 200 正常结果集——domain 枚举上游不严校验，静默退回 general 风格 |
| domain=finance + sub_domain="bogus_sub_xyz" | `isError=true` "Invalid tag: finance.bogus_sub_xyz." → fail-first arm degrade ✅ |
| domain=finance + sub_domain=calendar 缺 required param type | `isError=true` "Missing required params for tag 'finance.calendar': type." → fail-first ✅ |
| domain=finance 仅 domain 不带 sub | HTTP 200 正常结果（文档写 required 但服务不强制） |
| 合法基线 finance.calendar + {type:earnings} | HTTP 200 真垂域数据（FMP earnings 条目） |

How the five entries use this:

- `ctrl-0001` pins row 1: an out-of-enum domain is accepted (HTTP 200, general-style
  results), so the entry expects the vertical marker absent and
  `degraded: "general-fallback"`.
- `ctrl-0002` pins row 2: a bogus sub_domain comes back `isError`, the vertical arm fails
  first, and the general arms still answer (`general-fallback`). The matrix covers the first
  half; the fail-open envelope carries the second.
- `vert-f0001` pins the baseline in row 5: `finance.calendar` with `{type:"earnings"}` is a legal
  spec, every key goes on the wire, and the result carries `extra.vertical`.
- `vert-f0002` pins A-04: `params:{}` canonicalizes to absent, so `paramsSent` is false
  and `paramsKeys` is empty while the domain still routes.
- `vert-f0003` pins the domain-only shape: no sub_domain and no params, only `domain`
  reaches the wire.

## Scope

- Provenance only: no runtime code changes, no corpus entry is added, and the probe is not
  re-run here.
- The matrix is a 2026-09-25 snapshot. Upstream is the only authority on the vocabulary: an
  unknown domain is not rejected locally, and the enum may drift.
- The CLI end-to-end run recorded in the source used a local stub on loopback and is not
  copied here. The general-arms half of `ctrl-0002` therefore rests on the envelope's
  fail-open behaviour, not on that run.
- The `.scratch/...` paths above are historical. This file is where their text lives now.
