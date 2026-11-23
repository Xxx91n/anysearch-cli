# anysearch 档案夹

AnySearch 的说明和手工探针。信息源 id 是 `anysearch`（`SearchProvider`，见 `GLOSSARY.md`），适配器在
[`packages/retriever/src/providers/anysearch.ts`](../../packages/retriever/src/providers/anysearch.ts)。

## 端点

- 默认 `https://api.anysearch.com/mcp`（MCP Streamable HTTP，只有 `POST /mcp`）。**这个值的第一来源是
  代码**：`packages/retriever/src/providers/provider-facts.ts` 的 `PROVIDER_FACTS.anysearch.freeProbe.endpoint`
  （适配器、免费面探针、`probe-anysearch-provider.ts` 都从这一格取；provider 探针拿到后先校验不是空串，
  不然 `--default-endpoint` 那一路会静默退回 env 还打 `default(forced)`）。`probe-anysearch-mcp-raw.ts`
  故意自己留一份字面量——它不能经过 provider 层。改表里那个值要同步这份 README。
- `ANYSEARCH_ENDPOINT` 可覆盖。值以 `/v1/search` 结尾时自动改写成 `base+/mcp` 并打一次 stderr 警告——
  REST 还活着（`POST /v1/search` 200），改写成兼容垫片，不是 REST 退役。
- 官方归属 2026-11-04 确认（#15，证据在适配器头注释）；证书 `*.anysearch.com` 有效期到 2027-04-07，
  下次轮换要复查。
- 三家信息源里**只有 anysearch** 有这个 endpoint 环境变量开关。

## 认证

- `ANYSEARCH_API_KEY`，走 `Authorization: Bearer`；环境变量和凭据文件都没有 key 时，请求就不带这个头。
- 匿名过了配额，上游回的是「自动签发」提示体：HTTP 200、`isError:null`、没有结果体。适配器把它判成
  `free-quota-exhausted`（免费额度到顶），不是 `malformed`，也不是 `permanent-auth`。
- **两条探针和产品现在读同一份凭据**（#418 / #506）：都走 `packages/store/src/credentials.ts` 的
  `resolveSearchCredentials`，环境变量优先，再读 `~/.ans/credentials.json`。key 只存在凭据文件里时，
  探针也会带 `Authorization`，不会再静默丢掉 key（#422 复现的就是这个）。
- 输出里只用 `keySource: "env" | "user" | "none"` 说来源（`user` 就是用户凭据文件），key 的值不打印。
  `--nokey` 显式压掉 key：跳过解析、不发 `Authorization`，env 和文件里都有 key 也一样。
- 解析出来的 key 是**显式**传进 `AnySearchProvider` 的（没有 key 传空串）。不能让适配器再回读
  `process.env`，否则探针的解析和适配器的兜底会再次分叉。
- 凭据文件读坏或解析坏时，结果带一个不含密钥的 `credentialWarning`（只说路径和错误），而不是把它
  伪装成「没配 key」。

## 协议版本

- 适配器发 `2025-11-25`（`PROVIDER_FACTS.anysearch.mcpProtocolVersion`，适配器和免费面探针同一格），
  上游按请求协商；往下退就跟着退，不硬扛。
- raw 探针默认也发 `2025-11-25`；要测旧版本用 `--protocol-version <v>` / `--protocol-version=<v>`，或设
  `ANS_PROBE_PROTOCOL_VERSION=<v>`，例如 `--protocol-version 2025-03-26`。上游「要哪个给哪个」，所以版本做成
  参数，不是替换掉旧的（#428）。探针那份是手写字面量（不 import 被检查的代码），**改表里的
  `mcpProtocolVersion` 要同步改探针的 `DEFAULT_PROTOCOL_VERSION` 和这份 README**。
- 事实：五种协商下 `tools/call` 的回复形状完全一致，所以对齐版本本身安全（#423）。

## 回复形状

- 成功：`result.content[].text` 是 markdown 信封——`## Search Results (N results, Tms)`，每条
  `### N. 标题` + `- **URL**: ...` + 摘要行。`result.structuredContent` 到 2026-09-24 还没有；将来有
  就先解析它。
- 失败：`result.isError:true`（例如 `invalid_api_key`）→ 适配器直接抛，不会返 0 条假装成功。

## 已知异常

- **匿名配额墙**：HTTP 200 + 无结果体 → `free-quota-exhausted`；提示句给两条路（等到上游说的点再试，或加个 key）。
- **不能预过滤**：MCP 的 `domain` 参数是垂域路由值（academic..travel），不是主机白名单，`includeDomains`
  只能在返回后本地筛。审计事件 `retrieval.domain_filter.pre` 会记下这条限制。
- **`finance.fundamental` 校验比文档严**：tag 层强制要 `cn_code`，只给 `symbol` 会 `isError`。
- **endpoint 带 `/v1/search` 会被改写**，别拿改写当「上游换了地址」的证据。

## 探针

两条，各测一层，互不替代：

| 脚本 | 什么时候跑 | 回答什么 | 期望输出 | 退出码 |
|---|---|---|---|---|
| `probe-anysearch-mcp-raw.ts` | 怀疑上游原文变了，或要分清是谁的错 | 上游原文本身对不对——**唯一站在适配器下面**的面 | 一份缩进过的 JSON（`schema:"anysearch/mcp-raw-probe@2"`、`ok:true`、`keySource`、`protocolVersionRequested` / `protocolVersion`（上游不回版本时为 `null`）、`httpStatus:200`、`hasResultsHeader:true`，`textHead` 带回复开头，凭据形状已遮成 `<key>`） | 0 结果形状正常 / 3 回复不是结果形状 / 2 传输或工具失败、参数缺失 |
| `probe-anysearch-provider.ts` | 怀疑映射、错误分类不对 | 适配器的映射和 `errorClass`——唯一打 `errorClass` 的面 | 一行 JSON（`schema:"anysearch/provider-probe@2"`）：成功给 `results` / 调用失败给 `errorName`+`errorClass` / 探针自检失败给 `errorName`+`stage`（没跑调用，所以没有类别），三档都带 `keySource` | 0 通 / 2 失败并给出类别或自检原因 |

和另外两个面的分工：`packages/retriever/test/online/anysearch-mcp.online.ts` 是 CI 的活体冒烟
（`continue-on-error`），只断言正常路径，失败就抛栈、不分类，所以它**说不出是哪一层坏的**；raw 探针
才划得清「原文就坏了」还是「原文好、适配器坏了」。`ans search --json` 隔着融合和别家的臂，更粗。

跑法（仓库根，plain `node`，不装 tsx、不构建）：

```bash
node providers/anysearch/probe-anysearch-mcp-raw.ts
node providers/anysearch/probe-anysearch-mcp-raw.ts --protocol-version 2025-03-26 # 退回旧协议版本
node providers/anysearch/probe-anysearch-provider.ts
ans auth set anysearch && node providers/anysearch/probe-anysearch-provider.ts  # key 存在凭据文件里也照样带
ANS_PROBE_QUERY="rust tokio" node providers/anysearch/probe-anysearch-provider.ts
node providers/anysearch/probe-anysearch-provider.ts --nokey            # 匿名臂
node providers/anysearch/probe-anysearch-provider.ts --default-endpoint # 忽略 env，用写死地址
ANYSEARCH_ENDPOINT=http://127.0.0.1:9/mcp node providers/anysearch/probe-anysearch-provider.ts  # 死端点臂
```

输出只走 stdout，人读、贴进 issue，**不落盘**：provider 探针一行 JSON，raw 探针一份缩进过的 JSON。key
和 endpoint 的值不打印，只打 `endpointSource` / `keySource`（`env` / `user` / `none`）；错误消息和上游
回显里出现的值会遮成 `<endpoint>` / `<key>`。凭据文件坏了会多一个 `credentialWarning`，只说路径和错误，
不含密钥。参数报错（flag 缺值、拼错、形状不对）只打 `schema` / `ok` / `stage` / `errorMessage`
四个字段，没有 `protocolVersionRequested` / `protocolVersion` 那些——那一步还没跑任何请求。
SSE 多帧那条路径（同一条流里夹着别的消息）现在没有自动覆盖，手跑成功只证明单帧。

一个例外：`ANYSEARCH_ENDPOINT` 以 `/v1/search` 结尾时，适配器的 `normalizeEndpoint` 会把改写后的
地址（含 host）打到 stderr。那条不是探针打的，探针也拦不到；要贴进 issue 的话，别用带 `/v1/search`
尾巴的地址（见上面「## 端点」）。

`providers/probe-credentials.mjs` 头上那段 `registerHooks` 是必要的：适配器源码里的相对 import 没写扩展名
（`../contract`），store 的源码写的是 `.js`（`./ans-paths.js`，指到同目录的 `.ts`），tsc 和 tsx 都放行，
Node 的 ESM 解析不放行。钩子只在目标 `.ts` 真的存在时替换一次，坏路径照样报错。它同时把 store 的
`resolveSearchCredentials` 加载进来，所以三条探针（含 tavily 那条 `.mjs`）都只 import 这一个文件，
不再各抄一份解析逻辑。另一个办法是往源码里写 `.ts` 后缀，但那要给三份 `tsconfig`（retriever / kernel /
apps/cli）打开 `allowImportingTsExtensions`——为一个手跑夹具不值得。
它要 Node 22.15+（`module.registerHooks`）；仓库要求的 Node 是 22.19+，没问题，但比这更老的机器上这条
探针在 import 阶段就会炸。

## 最近一次真跑

2026-11-23（协议版本参数化之后，同机同 Node）：raw 探针默认 `protocolVersion:"2025-11-25"`、`ok:true`、
`httpStatus:200`、`textLen:2622`、9 条；`--protocol-version 2025-03-26`、`--protocol-version=2025-03-26`、
`ANS_PROBE_PROTOCOL_VERSION=2025-03-26` 三路各 `protocolVersion:"2025-03-26"`、`ok:true`（9 条）；三种坏参数
（不给值、`=` 后为空、后面紧跟另一个 flag）都退出 2、`stage:"args"`。

2026-11-22（本机 Windows，Node 24.22.1，仓库根，key 在环境变量里）：

- raw 探针：`ok:true`、`httpStatus:200`、`textLen:2610`、9 条、`886ms`（上游自报）。
- provider 探针：`ok:true`、3 条、`elapsedMs:3541`、`serverElapsedMs:1234`、`endpointSource:"default"`。
- 死端点臂（`ANYSEARCH_ENDPOINT=http://127.0.0.1:9/mcp`，2026-11-22 同一天跑的）：两条各退 2；provider
  那条给 `errorClass:"transient"`（记录在 #388）。

三家一次跑的对照基线（含 exa、tavily，同一分钟、同一个查询词）：
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。
