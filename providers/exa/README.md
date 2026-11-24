# exa 档案夹

Exa 的说明。信息源 id 是 `exa`，有 key 时的 REST 适配器在
[`packages/retriever/src/providers/exa.ts`](../../packages/retriever/src/providers/exa.ts)，没配 key 时顶上的
免费额度臂在 [`packages/retriever/src/providers/exa-mcp.ts`](../../packages/retriever/src/providers/exa-mcp.ts)；
走哪一条由 `createExaProvider(apiKey?)` 一个工厂决定。这个夹子**暂时只有说明，没有手工探针**——理由写在
「## 探针」。

## 端点

- **有 key**：`https://api.exa.ai`，是 `exa-js` 构造函数的默认 baseURL。适配器写的是 `new Exa(apiKey)`，
  key 由工厂递进来；**没有**环境变量开关（#421 查实，三家只有 anysearch 有）。
- **没 key**：`https://mcp.exa.ai/mcp`，Exa 自己的 MCP 端点，按免费额度跑。地址写死在
  `PROVIDER_FACTS.exa.freeArm`，同样**没有**环境变量开关，也不吃凭据。
- 分岔只看工厂拿到的那一个值：trim 后非空走 REST，空串、纯空格、没传都走免费额度。工厂不自己读
  `EXA_API_KEY`——读了的话「没传」算不算有 key 就得看现场，装配和诊断会各说各话（#449）。

## 认证

- `EXA_API_KEY`。有 key 时适配器收下产品装配递进来的那把（环境变量优先，其次
  `~/.ans/credentials.json`）；`ans doctor` 的构造器表也走 `createExaProvider`，两处不再各写一份判断。
- 没 key 时免费额度臂一个凭据都不发：没有 `x-api-key`、没有 `Authorization`、URL 上也没有
  `?exaApiKey=`。它同样不读环境变量，只认工厂给的「没有 key」。
- 只有直接 `new ExaProvider("")` 才走另一条路：空 key 交给 `exa-js`，由 SDK 自己去读环境变量，读不到
  就当场抛。产品不会走到这里——工厂把空 key 拦下来换成免费额度臂了。
- 坏 key 不退免费额度（#448）：key 里带内部换行（工厂只 trim 两头，去不掉中间的）构造函数当场抛，记进
  `providerBuildErrors`；key 格式没问题、服务端不认（401）的，搜索时报 `permanent-auth`。两种都不会悄悄降级
  成免费额度。
- 这个夹子没有手工探针，所以「环境变量优先、再读 `~/.ans/credentials.json`」这套解析在 exa 上**没有在探针
  这一面实测过**——#506 把三条手工探针都接到了 `resolveSearchCredentials` 上，但 exa 没有探针；
  `ans doctor --live` 会验 Exa 的 key（没配 key 时它跳过这一家），那是免费面检查，不等于原文/适配器归因面，
  见「## 探针」。

## 协议版本

**有 key：REST/JSON**，走 `exa-js`（>= 2.26.0），没有 MCP 协议版本协商。适配器的 mode 映射：

| 本仓 mode | Exa `type` | 备注 |
|---|---|---|
| `fast` | `fast` | |
| `index` | `auto` | |
| `deep` | `deep` | |
| `answer` | `auto` + `answer()` | 用 SDK 的 answer 通道，不是 search |

`searchAndContents` 在 2.26 已废弃，适配器用的是 `search(query, { contents: { text: { maxCharacters: 500 } } })`。

**没 key：MCP/JSON-RPC，但不握手**。一次 `POST` 到 `https://mcp.exa.ai/mcp`，不发 `initialize`、不发
`MCP-Protocol-Version`、不带会话 id——这个端点是**无状态**的，直接 `tools/call` 就回 200（#447 实测；
`GET` / `DELETE` 回 405，我们不用）。两条容易踩的：

- `Accept` 要同时带 `application/json` 和 `text/event-stream`，少了 SSE 上游回 406。
- 只发一条 `tools/call`，工具名 `web_search_exa`，参数只有 `query` 和 `numResults`（取 `maxResults ?? 10`）。
  这个工具还认一个 `objective`，标了 required 但服务端不校验，适配器不发。

免费额度臂声明的模式是 `fast` / `index` / `deep`，**没有 `answer`**：端点没有深度参数，三档打出去是同一条
请求，`mode` 只改 REST 臂的 `type`。两个能力位也都是否——高级工具 `web_search_advanced_exa` 能带上游域名
过滤，但它要用 `?tools=` 在 URL 上点名才出现，这一版没接（#447 记着）。

## 回复形状

**有 key**：

- 成功：`results[]`，每条 `title` / `url` / `text` / `publishedDate` / `score`。`title`、`url` 直接映射；
  `text`（请求的是 `contents.text.maxCharacters: 500`）→ `snippet`；`publishedDate` → `publishedAt`；
  `score` 保留。适配器只要 `text`，不请求也不读 `highlights`。
- `includeDomains` 是 SDK 的一等 typed 字段，所以域过滤可以在上游做（`domainFilterSupported = true`）。
- `usage` **永远 `undefined`**：`exa-js` 只在单次回包里给 `costDollars`，没有独立用量 API。
- `AbortSignal` 是转发的（作为 `RequestOptions` 尾巴传下去，#216）；三家只有 tavily 转发不了。

**没 key**：成功正文是 `content[].text` 里按记录拼的文本块，一条记录一个结果：

- `URL` → `url`；没有 `URL` 的记录直接丢掉。
- `Title` → `title`；缺了回落到 `url`。
- `Highlights` → `snippet`，截 500 字。正文里的换行和空行原样保留。
- `Published` → `publishedAt`；上游缺字段时写的是字面量 `N/A`，算没有。
- `Author` 不读。
- `structuredContent` 从没出现过，出现了也不猜它的形状。
- `answers` 永远是空的（免费额度臂没有 answer 能力）；`usage` 仍是 `undefined`。

## 已知异常

**有 key**：REST 臂没有专属的错误形状，`classifyProviderError` 对它的判定全走通用规则（401 / 403 是
`permanent-auth`，429 / 5xx 是 `transient`）。两件值得记住的：

- key 格式坏了（比如带换行）在**构造时**就抛，走的是「构造失败被点名」那条路：`providerBuildErrors` 里记
  `permanent: missing/invalid credential`，不进 `providerErrorClasses`。key 格式没问题、服务端不认
  （401）才在搜索时报 `permanent-auth`。
- 套餐用满：`exa-js` 没有独立用量接口，免费面探针也验不到，只能从搜索回包看出来。

真遇到新的形状，先把原始回包和 `classifyProviderError` 的判定记进 `docs/limitations.md`，再回来补这一节
——别在 README 里写没查到的东西。

**没 key（免费额度）**，限速也算在这一栏里，不单开一节：

- **429 的形状**：HTTP 429 + `application/json` + JSON-RPC 错误码 `-32000`。分类是 `transient`——这是短窗口
  限速，等一秒真能通，不归 `free-quota-exhausted`。适配器不重试；响应头里有 `retry-after`（秒数或 HTTP
  日期都认）就挂到错误对象上，引擎记进 `providerErrorRetryAfterSeconds`。`X-RateLimit-Reset` 不读。
- **限速数字**：开源服务的默认是 2 QPS / 每天 50 次每 IP（#447 记的开源服务默认值）。2026-11-23 实测过的是
  2 QPS 这一半：4 个并发里 1 个被拒，滑动窗口。同一次实测还确认只有 `tools/call` 计数，`initialize` /
  `tools/list` 不算。
- **`x-ratelimit-limit` / `x-ratelimit-remaining` 被上游故意置 0**：别把这两个头读成「额度用完了」，
  要看得看 `retry-after`。
- **IPv6 或代理出口回 403**：没配 key 时走这两个出口，Exa 的文档说会回 403（#447 记的，本机是 IPv4，
  没撞到），分类落到 `permanent-auth`。那句三家共用的提示里「配一把有效 key」正好是有效动作，「删掉 key
  走免费额度」这半句对没配 key 的人没用——为什么不为它新开一个错误类，记在 `docs/limitations.md`。
- **`result.isError: true` 也算失败**：正文读出来当错误串，绝不静默变成 0 条。
- **回包的 `Content-Type` 两种都认**（`application/json` 和 `text/event-stream`）：都不是就报错，并说出
  实际拿到的是什么。

## 探针

没有手工探针，这是有意的：真正需要的取证面（上游原文 vs 适配器映射）在 exa 这边还没有争议，临时跑一次的成本
又很低。#506 之后三条手工探针（anysearch 两条、tavily 一条）都和产品共用同一套凭据解析，但 exa 不在
这三条里——`ans doctor --live` 会用空体 `POST /search` 验 Exa 的 key（没配 key 时跳过），那是免费面检查，
只回答「这把 key 好不好」，回答不了「原文坏了还是适配器坏了」。

免费额度那条路另有一条在线测试：`packages/retriever/test/online/exa-mcp.online.ts` 用
`createExaProvider("")` 真打一次 `mcp.exa.ai`，断言至少回 1 条结果、url / title 形状正常。它落在
`test:online` 的通配里，CI 那条非阻塞车道自动带上。

要真调用就走产品：

```bash
ANS_PROVIDERS=exa ans search "cloudflare workers" --json
```

或者写个一次性脚本（别提交）。等哪天真需要一条长期夹具，再按这个夹子的形状加：
`providers/exa/probe-exa-*.mjs`，`node 文件名` 能跑，输出 JSON，不打印 key。

## 最近一次真跑

**有 key（REST 臂）**：2026-11-22（本机 Windows，Node 24.22.1，`cloudflare workers`、`fast`、
`maxResults:3`）：通，3 条结果，`elapsedMs:1261`，`serverElapsedMs:1260`，三条都落在
`developers.cloudflare.com`。完整三行原始记录在
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。

**没 key（免费额度臂）**：2026-11-24 01:41（Asia/Singapore，UTC `2026-11-23T17:41:30Z`），本机 Windows，
Node 24.22.1。三把 key 都从环境里拿掉（`env -u EXA_API_KEY -u TAVILY_API_KEY -u ANYSEARCH_API_KEY`），
`HOME` / `USERPROFILE` 指到一个空目录，所以 `~/.ans/credentials.json` 根本不存在——凭据文件那条路也断了。
用 `createExaProvider("")`（显式空串就是「没配 key」，不会去读环境变量）跑 `cloudflare workers`、
`fast`、`maxResults: 3`：通，3 条结果，`elapsedMs: 1737`，第一条是
`https://developers.cloudflare.com/workers/`。

同一次现场直接 `POST` `https://mcp.exa.ai/mcp` 拿原始回包，HTTP 200、`content-type: text/event-stream`，
第一帧开头是：

```text
event: message
data: {"result":{"content":[{"type":"text","text":"Title: Overview · Cloudflare Workers docs\nURL: https://developers.cloudflare.com/workers/\nPublished: N/A\nAuthor: N/A\nHighlights:\nOverview · Cloudflare Workers docs\n\n# Cloudflare Workers\n\nA serverless platform for building, deploying, and scaling apps...
```

产品的三个出口也在同一次现场跑了（源码直跑，没打包；`pnpm -C apps/cli dev <子命令>`、MCP 走
`pnpm -C apps/mcp dev`，前面那串 `env -u` 和临时 `HOME` 一样带着）：

- `ans search "cloudflare workers" --json`：退出码 0，`providersQueried` 是
  `["tavily","exa","anysearch"]`，`credentialSources` 是
  `{"status":"resolved","tavily":"none","exa":"none","anysearch":"none"}`，`providerBuildErrors` 是 `{}`，
  10 条结果里有 exa 的。
- MCP `search_web`：`isError` 为 false，`structuredContent` 里同样是那三家和三个 `none`，正文里有
  `"source": "exa"` 的条目。
- `ans doctor`：三行「信息源」都是「没配 key，用免费额度跑（有次数和速度上限）」，退出码 0。
