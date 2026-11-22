# anysearch 档案夹

AnySearch 的说明和手工探针。信息源 id 是 `anysearch`（`SearchProvider`，见 `GLOSSARY.md`），适配器在
[`packages/retriever/src/providers/anysearch.ts`](../../packages/retriever/src/providers/anysearch.ts)。

## 端点

- 默认 `https://api.anysearch.com/mcp`（MCP Streamable HTTP，只有 `POST /mcp`）。**这个值的第一来源是
  代码**：`packages/retriever/src/providers/anysearch.ts` 的 `ANYSEARCH_ENDPOINT`（探针 import 的就是
  它，不另写一份）；改那边要同步这份 README。
- `ANYSEARCH_ENDPOINT` 可覆盖。值以 `/v1/search` 结尾时自动改写成 `base+/mcp` 并打一次 stderr 警告——
  REST 还活着（`POST /v1/search` 200），改写成兼容垫片，不是 REST 退役。
- 官方归属 2026-11-04 确认（#15，证据在适配器头注释）；证书 `*.anysearch.com` 有效期到 2027-04-07，
  下次轮换要复查。
- 三家信息源里**只有 anysearch** 有这个 endpoint 环境变量开关。

## 认证

- `ANYSEARCH_API_KEY`，走 `Authorization: Bearer`；没设就是匿名调用。
- 匿名过了配额，上游回的是「自动签发」提示体：HTTP 200、`isError:null`、没有结果体。适配器把它判成
  `permanent-auth`，不是 `malformed`。
- 两条探针**只读环境变量**（`ANYSEARCH_API_KEY`），不读 `~/.ans/credentials.json`。适配器本身同理，但
  `ans` 装配时会把「环境变量 → 用户凭据文件」解析出来的 key 传进构造函数（`packages/kernel/src/composition.ts`），
  所以探针和产品看到的可能不是同一把。把 key 只存在凭据文件里的人跑探针会静默变成匿名调用——没报错、
  照样 `ok:true`，看不出区别（#422）。

## 协议版本

- 适配器发 `2025-11-25`（`MCP_PROTOCOL_VERSION`），上游按请求协商；往下退就跟着退，不硬扛。
- raw 探针的 `initialize` 还写着 `2025-03-26`。两处不一致是已知的，收在 #428（探针参数化），这里先
  记着别当新发现。
- 事实：五种协商下 `tools/call` 的回复形状完全一致，所以对齐版本本身安全（#423）。

## 回复形状

- 成功：`result.content[].text` 是 markdown 信封——`## Search Results (N results, Tms)`，每条
  `### N. 标题` + `- **URL**: ...` + 摘要行。`result.structuredContent` 到 2026-09-24 还没有；将来有
  就先解析它。
- 失败：`result.isError:true`（例如 `invalid_api_key`）→ 适配器直接抛，不会返 0 条假装成功。

## 已知异常

- **匿名配额墙**：HTTP 200 + 无结果体 → `permanent-auth`，解法在用户侧设 key。
- **不能预过滤**：MCP 的 `domain` 参数是垂域路由值（academic..travel），不是主机白名单，`includeDomains`
  只能在返回后本地筛。审计事件 `retrieval.domain_filter.pre` 会记下这条限制。
- **`finance.fundamental` 校验比文档严**：tag 层强制要 `cn_code`，只给 `symbol` 会 `isError`。
- **endpoint 带 `/v1/search` 会被改写**，别拿改写当「上游换了地址」的证据。

## 探针

两条，各测一层，互不替代：

| 脚本 | 什么时候跑 | 回答什么 | 期望输出 | 退出码 |
|---|---|---|---|---|
| `probe-anysearch-mcp-raw.ts` | 怀疑上游原文变了，或要分清是谁的错 | 上游原文本身对不对——**唯一站在适配器下面**的面 | 一份缩进过的 JSON（`ok:true`、`httpStatus:200`、`hasResultsHeader:true`，`textHead` 带原文开头） | 0 结果形状正常 / 3 回复不是结果形状 / 2 传输或工具失败 |
| `probe-anysearch-provider.ts` | 怀疑映射、错误分类不对 | 适配器的映射和 `errorClass`——唯一打 `errorClass` 的面 | 一行 JSON：成功给 `results` / 失败给 `errorName`+`errorClass` | 0 通 / 2 失败并给出类别 |

和另外两个面的分工：`packages/retriever/test/online/anysearch-mcp.online.ts` 是 CI 的活体冒烟
（`continue-on-error`），只断言正常路径，失败就抛栈、不分类，所以它**说不出是哪一层坏的**；raw 探针
才划得清「原文就坏了」还是「原文好、适配器坏了」。`ans search --json` 隔着融合和别家的臂，更粗。

跑法（仓库根，plain `node`，不装 tsx、不构建）：

```bash
node providers/anysearch/probe-anysearch-mcp-raw.ts
node providers/anysearch/probe-anysearch-provider.ts
ANS_PROBE_QUERY="rust tokio" node providers/anysearch/probe-anysearch-provider.ts
node providers/anysearch/probe-anysearch-provider.ts --nokey            # 匿名臂
node providers/anysearch/probe-anysearch-provider.ts --default-endpoint # 忽略 env，用写死地址
ANYSEARCH_ENDPOINT=http://127.0.0.1:9/mcp node providers/anysearch/probe-anysearch-provider.ts  # 死端点臂
```

输出只走 stdout，人读、贴进 issue，**不落盘**：provider 探针一行 JSON，raw 探针一份缩进过的 JSON。key
和 endpoint 的值不打印，只打 `endpointSource` / `keyPresent`；错误消息里出现的值会遮成 `<endpoint>` /
`<key>`。

`probe-anysearch-provider.ts` 头顶那段 `registerHooks` 是必要的：适配器源码里的相对 import 没写扩展名
（`../contract`），tsc 的 Bundler 解析和 tsx 都放行，Node 的 ESM 解析不放行。钩子只在 `.ts` 文件真的
存在时补一次，坏路径照样报错。另一个办法是往适配器里写 `.ts` 后缀，但那要给编译到适配器源码的三份
`tsconfig`（retriever / kernel / apps/cli）打开 `allowImportingTsExtensions`——为一个手跑夹具不值得。
它要 Node 22.15+（`module.registerHooks`）；仓库要求的 Node 是 22.19+，没问题，但比这更老的机器上这条
探针在 import 阶段就会炸。

## 最近一次真跑

2026-11-22（本机 Windows，Node 24.22.1，仓库根，key 在环境变量里）：

- raw 探针：`ok:true`、`httpStatus:200`、`textLen:2610`、9 条、`886ms`（上游自报）。
- provider 探针：`ok:true`、3 条、`elapsedMs:3541`、`serverElapsedMs:1234`、`endpointSource:"default"`。
- 死端点臂（`ANYSEARCH_ENDPOINT=http://127.0.0.1:9/mcp`，2026-11-22 同一天跑的）：两条各退 2；provider
  那条给 `errorClass:"transient"`（记录在 #388）。

三家一次跑的对照基线（含 exa、tavily，同一分钟、同一个查询词）：
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。
