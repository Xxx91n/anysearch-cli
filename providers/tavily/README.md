# tavily 档案夹

Tavily 的说明和手工探针。信息源 id 是 `tavily`，适配器在
[`packages/retriever/src/providers/tavily.ts`](../../packages/retriever/src/providers/tavily.ts)。

## 端点

- `https://api.tavily.com`，写死在 `@tavily/core` 的 `BASE_URL` 里；适配器构造 `tavily({})` 不传
  baseURL，**没有**环境变量开关（#421 查实，三家只有 anysearch 有）。
- 用到的路由：`POST /search`、`POST /research`、`GET /usage`。适配器只打 `/search`；探针打 `/search` 和
  `/research`。`/usage` 是这一家的免费面：`ans doctor --live` 拿它验 key 和用量，`ans auth set tavily`
  在存之前也打它（401/403 拒存，其余只警告，#442）。默认的 `ans doctor` 仍然一个字都不联网。
- 探针有一个 **probe-only** 的 endpoint 覆盖：`PROBE_TAVILY_ENDPOINT`，默认还是 `https://api.tavily.com`。
  用处是把探针指到本地桩——凭据接线只能这么验，不能让测试打真上游（anysearch 那边有 `ANYSEARCH_ENDPOINT`
  这个先例）。这个值不打印。

## 认证

- `TAVILY_API_KEY`，走 `Authorization: Bearer`。SDK 不传 key 不会抛：它构造一个 keyless 客户端
  （请求头 `X-Tavily-Access-Mode: keyless`），上游按匿名额度处理。没有 key 时探针不会走到 SDK：它自己
  退 2 说「这一跑没有结论」，别把这句话当成 SDK 的行为。
- 探针和产品读同一份凭据（#418 / #506）：都走 `packages/store/src/credentials.ts` 的
  `resolveSearchCredentials`，环境变量优先，再读 `~/.ans/credentials.json`。所以 key 只在凭据文件里时，
  探针也带着它跑（以前是整轮 SKIPPED、退 2，和真的没配 key 逐字相同）。
- 台账里只记 `keySource: "env" | "user" | "none"`（`user` 就是用户凭据文件），不记 key 的值。凭据文件
  读坏或解析坏时，台账多一个不含密钥的 `credentialWarning`，stderr 也说一句——别把它读成「没配 key」。

## 协议版本

REST/JSON，不是 MCP，没有协议版本协商这回事。适配器的 mode 映射：`fast`→`searchDepth:"fast"`、
`index`→`basic`、`deep`→`advanced`、`answer`→`advanced` + `includeAnswer:true`。

## 回复形状

- 成功：`results[]`，每条 `title` / `url` / `content` / `publishedDate` / `score`；`answer` 模式下多
  一个 `answer` 字段。
- `response_time` 的单位是**秒**（上游文档原话「Time in seconds」；真跑里同一次请求客户端 1573ms、
  自报 0.37）。适配器乘 1000 取整后写进 `ProviderEnvelope.elapsedMs`，那一层恒为毫秒。不换算的话
  `metadata.providerElapsedMs`（#653）里就会出现一张表两种单位，而且 0.37 看着像一条极快的臂。
- `include_domains` 两档：`restrict`（硬过滤，也是上游默认）和 `prefer`（也搜全网），就这两个值。
  适配器只要有 `includeDomains` 就显式发 `include_domains_mode:"restrict"`，不靠默认值；探针的 restrict
  臂也这么发，A 臂故意不发，专门用来抽默认值。这个值不能单独发——不带 `include_domains` 上游回 400，
  所以两处都是成对的（#444）。改之前发的是文档里没有的 `"filter"`：上游不报错，但也分不出它跟默认值有
  什么两样，所以那段时间探针 B 臂等于没测（实测见下面「最近一次真跑」）。另外这个 snake_case key 能到
  线上，靠的是 `@tavily/core` 把不认识的选项原样展开进请求体（`...kwargs`）；依赖是 `^0.7.7`，升大版本
  时要确认这条还在，不在了探针会退 2（`prefer` 不再放宽），不会假装绿。
- SDK 包装后的 `usage` **永远是 `undefined`**：`@tavily/core` 只在单次回包里给
  `response.usage.credits`，所以契约里的 `usage()` 没实现。上游那个 `GET /usage` 是另一回事：
  它是 `doctor --live` 和 `ans auth set` 的免费面，见上面「端点」一节。

## 已知异常

- **套餐额度用满 → HTTP 432**：回包是纯文本 `{"detail":{"error":"This request exceeds your plan's set
  usage limit..."}}`，`@tavily/core` 把它重新抛成一个不带状态码的普通 `Error`。`classifyProviderError`
  按正文关键匹配，判成 `quota-exhausted`——key 是好的，换 key 或重试都没用，得账号侧充值或升级。
- **`AbortSignal` 不转发**（#32）：SDK 的 `search` 选项里没有 signal，预算守卫只能限花钱，限不住墙钟。
- **`/research` 是异步句柄**：回包里没有 url 字段，探针的 D 臂只能记 `INCONCLUSIVE`，不能当泄漏证据。

## 探针

一条：`probe-tavily-domains.mjs`，测的是 `include_domains` 泄漏，四个臂：

| 臂 | 测什么 | 备注 |
|---|---|---|
| A default-mode | 不发 mode，默认值下 `include_domains` 会不会放进域外结果 | 需要活着且有额度的 key |
| B restrict-vs-prefer | 同一查询分别发 `restrict` 和 `prefer`，比域外条数 | `prefer` 那次必须漏出来，才算证明这个字段被上游读了；两次都在域内就 INCONCLUSIVE，不给假绿 |
| C subdomain-direction | 父域和子域互相覆盖的方向 | 有域外结果 → LEAK（按各查询自己的 include_domains 算，跟 A/B 一个标准）；父域带出了子域、子域那次没漏 → PASS（两个方向都看到才算）；方向没看到就 INCONCLUSIVE，不给假绿 |
| D research-endpoint | `/research` 的 `include_domains` 是不是只算软偏好 | `PROBE_TAVILY_RESEARCH=1` 才跑；漏出来是预期，只进台账，不影响退出码 |

什么时候跑：改了域过滤、或者怀疑上游放宽了 `include_domains` 的时候。它不进 CI——要活 key，而且
额度用满时会退 2。

```bash
node providers/tavily/probe-tavily-domains.mjs
ans auth set tavily && node providers/tavily/probe-tavily-domains.mjs          # key 存在凭据文件里也照样带
TAVILY_API_KEY=tvly-... PROBE_TAVILY_RESEARCH=1 node providers/tavily/probe-tavily-domains.mjs
PROBE_TAVILY_ENDPOINT=http://127.0.0.1:8080 node providers/tavily/probe-tavily-domains.mjs  # 指到本地桩
```

期望输出：每个臂一行 `[PASS|LEAK|INCONCLUSIVE|SKIPPED|ERROR] <id> - <摘要>`，再落两份台账
`tavily-probe-ledger-<ranAt>.{json,md}`，默认目录 `.scratch/tavily-probe/`（相对当前目录；`.scratch/`
是 gitignore 的，所以台账不随仓库走，要留证据就贴进 issue）。文件名带 `ranAt`，重跑不会盖掉上一轮；
用 `PROBE_TAVILY_OUT_DIR=/some/dir` 改目录。台账的 schema 是 `anysearch/tavily-domain-probe@2`，
头部记 `keySource`（不是 key 本身），凭据文件坏了再多一条 `credentialWarning`。

退出码：`0` B 对照证成了（`restrict` 不漏、`prefer` 漏了）且没泄漏；`1` A / B / C 有臂判 LEAK；
`2` 没有能证明上游读了这个字段的证据（缺 key、额度用满、结果为空、`prefer` 没放宽都算没有证据，
不算通过）。D 臂判 LEAK 不算失败——`/research` 把 `include_domains` 当软偏好是上游写明的事，
那条只进台账。

## 最近一次真跑

2026-11-23 凌晨（本机 Windows，Node 24.22.1，仓库根，`#444` 改完之后）：A、B、C 三臂都 PASS。
A（不发 mode）10/10 条都在 `pnpm.io`；B 是同一查询的对照——`restrict` 0/10 条在域外、`prefer` 6/10 条
在域外，说明上游真的在读这个字段；C 的父域查询（`cloudflare.com`）回来了 `developers` / `blog` / `www` /
`community` 四个子域，子域查询（`developers.cloudflare.com`）只回它自己——这一对里父域盖得住子域，
反过来子域不会把兄弟或父域带进来。D 臂没跑（要 `PROBE_TAVILY_RESEARCH=1`）。探针这一轮 5 次搜索调用。

同一轮另外单独验了三件事。前两件是 curl 直接打 `POST /search`，第三件走产品链路的 SDK。这些是临时
对照，没进台账，数字照抄回包：

- 老取值 `"filter"`（改之前的代码发的）：2 次调用都是 HTTP 200，各回 10 条、全在 `pnpm.io`，跟不带
  mode 的对照完全一样。所以上游既没拒它，也没法把它跟默认值分出差别——那段时间 B 臂 PASS 说明不了任何事。
- 只发 `include_domains_mode`、不带 `include_domains`：HTTP 400，正文是
  `include_domains_mode/filter_by_include_domains requires include_domains to be specified.`
- 走一遍产品链路（`TavilyProvider.search` 带 `includeDomains`）：10 条结果全在 `pnpm.io`。

上一轮，2026-11-22 晚：环境变量里那把 key 的套餐额度用满了——A、B、C 三臂都是 HTTP 432，探针打出
`no conclusive evidence this run — evidenceStatus=not-verified`，退 2，没有崩。这就是「额度用满时的
正确表现」：明确说没证据，不假装绿。那一轮的台账没留（`.scratch/` 不进仓库），只剩这段记录。

更早一次，2026-11-22 早些时候用另一把新 key 跑过真调用：3 条结果、`elapsedMs:1573`。那次没带
`includeDomains`，跟域过滤无关，记的是 provider 能通；记录在
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。
