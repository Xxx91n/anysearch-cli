# tavily 档案夹

Tavily 的说明和手工探针。信息源 id 是 `tavily`，适配器在
[`packages/retriever/src/providers/tavily.ts`](../../packages/retriever/src/providers/tavily.ts)。

## 端点

- `https://api.tavily.com`，写死在 `@tavily/core` 的 `BASE_URL` 里；适配器构造 `tavily({})` 不传
  baseURL，**没有**环境变量开关（#421 查实，三家只有 anysearch 有）。
- 用到的路由：`POST /search`、`POST /research`、`GET /usage`。适配器只打 `/search`，探针打 `/search` 和
  `/research`；`/usage` 现在没人打——#416 打算让它进 doctor 的联网检查，那个决定还没实现（今天的 doctor
  只有 `--json` / `--strict`，live 行一律 `unchecked`，写着「doctor 不联网」）。

## 认证

- `TAVILY_API_KEY`，走 `Authorization: Bearer`。SDK 不传 key 就报 `TAVILY_API_KEY unset`。
- 探针**只读环境变量** `TAVILY_API_KEY`；产品走 composition 的「env 优先、再用户凭据文件」解析
  （`packages/kernel/src/composition.ts`）。所以 key 只在凭据文件里时，`ans` 能跑、探针会退 2 并明说
  `TAVILY_API_KEY unset`——不会静默匿名（这一点比 anysearch 友好，#422）。

## 协议版本

REST/JSON，不是 MCP，没有协议版本协商这回事。适配器的 mode 映射：`fast`→`searchDepth:"fast"`、
`index`→`basic`、`deep`→`advanced`、`answer`→`advanced` + `includeAnswer:true`。

## 回复形状

- 成功：`results[]`，每条 `title` / `url` / `content` / `publishedDate` / `score`；`answer` 模式下多
  一个 `answer` 字段。
- `include_domains` 支持两档：默认（加权）和 `include_domains_mode:"filter"`（硬过滤）。
- SDK 包装后的 `usage` **永远是 `undefined`**：`@tavily/core` 只在单次回包里给
  `response.usage.credits`，没有独立的用量 API，所以契约里的 `usage()` 没实现。

## 已知异常

- **套餐额度用满 → HTTP 432**：回包是纯文本 `{"detail":{"error":"This request exceeds your plan's set
  usage limit..."}}`，`@tavily/core` 把它重新抛成一个不带状态码的普通 `Error`。`classifyProviderError`
  按正文关键匹配，判成 `quota-exhausted`——key 是好的，换 key 或重试都没用，得账号侧充值或升级。
- **`AbortSignal` 不转发**（#32）：SDK 的 `search` 选项里没有 signal，预算守卫只能限花钱，限不住墙钟。
- **`/research` 是异步句柄**：回包里没有 url 字段，探针的 D 臂只能记 `INCONCLUSIVE`，不能当泄漏证据。

## 探针

一条：`probe-tavily-domains.mjs`，测的是 `include_domains` 泄漏（criterion 5），四个臂：

| 臂 | 测什么 | 备注 |
|---|---|---|
| A default-mode | 默认模式下 `include_domains` 会不会放进域外结果 | 需要活着且有额度的 key |
| B filter-mode | `include_domains_mode:"filter"` 硬过滤能不能真挡住 | 同上 |
| C subdomain-direction | 父域与子域互相覆盖的方向性 | 需要 A、B 都回 200 |
| D research-endpoint | `/research` 的 `include_domains` 是不是只算软偏好 | `PROBE_TAVILY_RESEARCH=1` 才跑 |

什么时候跑：改了域过滤、或者怀疑上游放宽了 `include_domains` 的时候。它不进 CI——要活 key，而且
额度用满时会退 2。

```bash
node providers/tavily/probe-tavily-domains.mjs
TAVILY_API_KEY=tvly-... PROBE_TAVILY_RESEARCH=1 node providers/tavily/probe-tavily-domains.mjs
```

期望输出：每个臂一行 `[PASS|LEAK|INCONCLUSIVE|SKIPPED|ERROR] <id> - <摘要>`，再落两份台账
`tavily-probe-ledger-<ranAt>.{json,md}`，默认目录 `.scratch/grill-round-62/`（相对当前目录；`.scratch/`
是 gitignore 的，所以台账不随仓库走，要留证据就贴进 issue）。文件名带 `ranAt`，重跑不会盖掉上一轮；
用 `PROBE_TAVILY_OUT_DIR=/some/dir` 改目录。

退出码：`0` 有臂 PASS 且没泄漏；`1` 有臂判 LEAK；`2` 没有一条能下结论（缺 key、额度用满、
结果为空都算没有证据，不算通过）。

## 最近一次真跑

2026-11-22 晚（本机 Windows，Node 24.22.1，仓库根）：环境变量里那把 key 的套餐额度用满了——
A、B、C 三臂都是 HTTP 432，探针打出 `no conclusive evidence this run — evidenceStatus=not-verified`，
退 2，没有崩。这就是「额度用满时的正确表现」：明确说没证据，不假装绿。

同一天早些时候用另一把新 key 跑过真调用：3 条结果、`elapsedMs:1573`，记录在
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。
