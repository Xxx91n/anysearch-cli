# #421 真实基线：三家各一次真调用

Date: 2026-11-22（Asia/Singapore 19:05 左右）。机器：本机 Windows，Node v24.22.1，仓库
`D:\Aworker\anysearch-cli`，分支 `impl/406-gate-ran-checks`，工作树干净。查询词
`cloudflare workers`，`mode: "fast"`，`maxResults: 3`，超时 30 秒。走的是产品用的那三个
适配器（`packages/retriever/src/providers/{anysearch,exa,tavily}.ts`），不是直接打 HTTP。

结论先说：**anysearch 和 exa 都通，各回 3 条结果；tavily 第一次跑不通——key 有效，但
账号的套餐额度用满了（HTTP 432，1000/1000）。换了一个新 key 之后 tavily 也通了。**

## 怎么跑起来的

根目录跑不了：`node --import tsx` 要在当前目录解析得到 `tsx`，根目录的 `node_modules`
里没有（`require.resolve("tsx")` 在根失败，在 `packages/retriever` 成功）。所以从
`packages/retriever` 起跑，脚本本身放在 `.scratch/wf421/baseline.ts`：

```bash
cd packages/retriever && node --import tsx ../../.scratch/wf421/baseline.ts
```

脚本给三家各一次调用，一家一行 JSON，key 和 endpoint 的值一律不打印；出错时把消息里
出现的 key / endpoint 值换成 `<key>` / `<endpoint>`。退出码 0——某一家失败不算脚本失败，
失败记在那一行里。`.scratch/` 是 gitignore 的，所以这个脚本是这次的一次性工具，不在仓库里；
要长期留着复跑，等 #413 定了脚本放哪再搬。

## 三家的结果

| 服务商 | endpoint 来源 | key | 耗时（客户端） | 结果数 | 结论 |
|---|---|---|---|---|---|
| anysearch | default | 环境变量里有 | 2897 ms | 3 | 通 |
| exa | default | 环境变量里有 | 1261 ms | 3 | 通 |
| tavily | default | 环境变量里有 | 1163 ms | — | 不通，额度用尽（换 key 后通了，见下一节） |

原始三行（`.scratch/wf421/baseline.jsonl` 的内容，无 key、无 endpoint 值）：

```json
{"schema":"anysearch/real-baseline@1","provider":"anysearch","query":"cloudflare workers","mode":"fast","maxResults":3,"endpointSource":"default","endpointEnvLever":true,"keyPresent":true,"ok":true,"ranAt":"2026-11-22T11:05:09.961Z","elapsedMs":2897,"serverElapsedMs":626,"results":3,"sampleHosts":["www.cloudflare.com","developers.cloudflare.com","developers.cloudflare.com"],"answers":0}
{"schema":"anysearch/real-baseline@1","provider":"exa","query":"cloudflare workers","mode":"fast","maxResults":3,"endpointSource":"default","endpointEnvLever":false,"keyPresent":true,"ok":true,"ranAt":"2026-11-22T11:05:11.225Z","elapsedMs":1261,"serverElapsedMs":1260,"results":3,"sampleHosts":["developers.cloudflare.com","developers.cloudflare.com","developers.cloudflare.com"],"answers":0}
{"schema":"anysearch/real-baseline@1","provider":"tavily","query":"cloudflare workers","mode":"fast","maxResults":3,"endpointSource":"default","endpointEnvLever":false,"keyPresent":true,"ok":false,"ranAt":"2026-11-22T11:05:12.389Z","elapsedMs":1163,"errorName":"Error","errorClass":"quota-exhausted","errorMessage":"This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com"}
```

## tavily 为什么不通

不是 key 的问题，是额度用完了。直接打一次搜索，回的是 HTTP 432：

```json
{"status":432,"contentType":"application/json","body":"{\"detail\":{\"error\":\"This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com\"}}"}
```

同一个 key 打 `/usage` 是 200，说明 key 本身有效：

```json
{"key":{"usage":1000,"limit":null,"search_usage":1000,"crawl_usage":0,"extract_usage":0,"map_usage":0,"research_usage":0},"account":{"current_plan":"Researcher","plan_usage":1000,"plan_limit":1000,"search_usage":1000,"crawl_usage":0,"extract_usage":0,"map_usage":0,"research_usage":0,"paygo_usage":0,"paygo_limit":null}}
```

套餐 `Researcher`，`plan_usage` 1000 / `plan_limit` 1000，搜索用量 1000。`/usage` 的回包里
没有重置日期，什么时候能跑要看 tavily 控制台。`classifyProviderError` 把它判成
`quota-exhausted`——`contract.ts` 里 `classifyProviderError` 判 `quota-exhausted` 的那段
注释说的正是这个形状（tavily 回纯文本 432，`@tavily/core` 把状态码丢了），这次是第一次拿
真回包验到。

## 顺手查实的两个事实

- **只有 anysearch 有 endpoint 环境变量开关。** `anysearch.ts` 里 `AnySearchProvider` 的
  构造函数读 `ANYSEARCH_ENDPOINT`，没设就用写死的默认公开地址。exa 和 tavily 的适配器把
  默认地址写死了（`exa.ts` 构造 `new Exa()` 不传 baseURL，`@tavily/core` 里有个 `BASE_URL`
  常量），没有 env 开关。所以「endpoint 来源」这一栏，三家现在都是 default，但只有
  anysearch 能变成 env。
- **三个 key 都来自环境变量。** 本机没有 `~/.ans/credentials.json`，三个适配器也都只读
  `process.env`（`ANYSEARCH_API_KEY` / `EXA_API_KEY` / `TAVILY_API_KEY`）。这一条跟 #418、
  #422 是同一件事：按 README 把 key 存进凭据文件的人，跑探针会变成匿名调用。

## 换 key 之后（19:15）

换了一个新 key（`TAVILY_API_KEY`，Windows 用户环境变量，长度从 58 变成 54），只重跑
tavily 一家，通了：

```json
{"schema":"anysearch/real-baseline@1","provider":"tavily","query":"cloudflare workers","mode":"fast","maxResults":3,"endpointSource":"default","endpointEnvLever":false,"keyPresent":true,"ok":true,"ranAt":"2026-11-22T11:15:02.248Z","elapsedMs":1573,"serverElapsedMs":0.37,"results":3,"sampleHosts":["medium.com","www.gtechme.com","synergenie.com"],"answers":0}
```

新 key 的 `/usage` 是干净账号：`current_plan` 还是 `Researcher`，`plan_usage` 0 /
`plan_limit` 1000，所以它是另一个账号的 key，不是同一个账号里新开的一把。

三条结果的域名是 medium.com / gtechme.com / synergenie.com，比 anysearch 那三条
（cloudflare.com 官网）跟「cloudflare workers」这个查询词贴得松一些——`fast` 模式下
tavily 的取舍跟别家不一样，这次只记下来，不当结论。

## 没验的

- 没验 `ans doctor` 的 provider 行。它是恒真式（永远 OK，见 #416），这次跑它只会多一条
  不可信的证据。
- 没验 `answer` 模式、`deep` 模式、超时和重试路径——这次只跑 `fast` 一次。
- tavily 换了 key 之后只重跑了一次（`fast` 模式、3 条），`answer` / `deep` 模式没跑。
- 单次耗时别当趋势读：同一台机器、同一个查询词，仓库自带探针
  （`providers/anysearch/probe-anysearch-provider.ts`）刚跑的一次给 anysearch 是 5626 ms 客户端 /
  3253 ms 服务端，比上面那行的 2897 / 626 慢一倍左右。网络抖动，不是谁快谁慢。
- 没补「三把 key 全清」的对照。那一次同机同查询词已经真跑过（2026-11-24 01:41，Asia/Singapore），
  记在 `providers/exa/README.md` 的「## 最近一次真跑」：退出码 0，三家都在 `providersQueried`，
  `credentialSources` 三家 `none`。不搬进这份文件，是因为它只记了汇总、没有各家条数，而且 exa
  那条走的是免费臂（`mcp.exa.ai`，`snippet` 来自 `Highlights`），条数和延迟跟上面三行不能直接比。

## 这份记录放哪

留在 `docs/research/`，不拆。这是一次跑、三家的对照记录（同一台机器、同一个查询词、同一
分钟），拆成三份就把对照关系拆没了。三家夹子的 README 在「最近一次真跑」那一栏都链到这里；
夹子本身放的是说明和手工探针（#413），跨家的记录留在 `docs/research/`。

探针已经搬进 `providers/anysearch/` 和 `providers/tavily/`（#425），跑法、期望输出、退出码
写在各自夹子的 README 里。
