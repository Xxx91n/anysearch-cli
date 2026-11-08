# 等上游才能动的票 — 什么时候能动的清单

Wayfinder 票 #97。每张等上游的票写一段：出现什么具体事实就能开工（解除信号），
以及它跟 `docs/limitations.md` 对不对得上（登记状态）。这些信号来自每张票自己的
文字，以及它点名的代码；写的时候对着 `research/upstream-registry` 从
`main@61d6398f` 分出来的树核过一遍，清单进 `docs/research/` 时（#171）又在
`main@73ada6b` 上核了一遍——登记状态也反映 `docs/limitations.md` 里实际加进去的条目。

## #18 transformers.js 没声明外部依赖（onnxruntime-common）——上游声明后就把补丁删掉

解除信号: `@huggingface/transformers` 的某个版本（现在钉的是 `^3.7.0`，
`packages/embedding/package.json`）在自己的 `dependencies`/`peerDependencies` 里
声明了 `onnxruntime-common`——也就是 `transformers.node.cjs` 里的
`require("onnxruntime-common")` 不再是没声明的外部依赖。确认方法：看新版本发布出来
的包清单；确认后删掉三样东西——作用域内的 `Module._resolveFilename` 补丁
（`patchOnnxruntimeCommonResolve`，`packages/embedding/src/index.ts:31-45`），以及
我们自己声明的 `onnxruntime-common@1.21.0` optionalDependency 和
`packages/embedding/test/transformers-ghost-dep.test.ts`。

登记状态: absent — 建议只留票，不补进 `docs/limitations.md`。理由：这个补丁完全在
内部，用户看不见——它正常工作时用户那边没有任何缺口（pnpm 隔离安装现在也能正确
解析）。`docs/limitations.md` 记的是用户能碰到的限制，不是维护隐患；这个隐患
（补丁或依赖被误删）已经由 `packages/embedding/src/index.ts:17-29` 的文件头注释和
ghost-dep 测试守住，这才是对的护栏。

## #22 transformers ghost-dep 补丁的 ESM 分支——用 module.registerHooks 兜住解析（点名回头票）

解除信号: 两种情况之一：(a) #18 的上游修复落地——transformers.js 的新版本自己声明了
`onnxruntime-common`，那 ESM 分支就彻底不需要了；或者 (b) 我们用 Node 的
`module.registerHooks`（resolve 钩子，Node 22.15 起稳定 / `module.register` 20.x 起有）
覆盖 `.mjs` 路径，现在的补丁够不到那里（`packages/embedding/src/index.ts:26-27` 的注释
写着："the .mjs path uses the ESM resolver which cannot be scoped without loader
hooks"）。真正能动手的时机：本仓真的有消费者用 ESM 导入
`@huggingface/transformers`，或者最低 Node 版本让 `registerHooks` 无条件可用。

登记状态: absent — 建议只留票，不补进 `docs/limitations.md`。理由：发出去的代码里
没有一条路径用 ESM 加载 transformers（`loadTransformers` 用 `createRequire`，只走
CJS），所以没有用户看得见的限制可登记——缺这个分支是一个还没暴露的缺口，不是现在
的缺口。以后要是给 #18 加了条目，这个文件也一起覆盖。

## #23 api.anysearch.com 的 REST `/v1/search` 事实修正（前提不成立，已关闭）

解除信号: 没有——原来那句「REST 路由退了 / 等它复活」的前提就不对，没有可等的东西。
2026-11-07 现场探针：`GET https://api.anysearch.com/v1/search` → 404；
`POST https://api.anysearch.com/v1/search` → 200，返回 `code:0` 的返回包
（带 `request_id`）。适配器仍然只走 MCP
（`packages/retriever/src/providers/anysearch.ts`）；`normalizeEndpoint` 里把
`LEGACY_REST_SUFFIX` 改成 `/mcp` 是给那些端点配置还写着 REST 路由的人用的兼容
补丁，不是 REST 已经退了的证据。这张票按「前提不成立」关掉；REST 分支不在 #203
范围里（真要做，另开产品票）。

登记状态: registered — `docs/limitations.md` L212-220，由 #206 改写（现在用户能
碰到的其实是「只走 MCP、旧地址自动改写」，不是 REST 路由死了）：

```md
- **AnySearch REST `POST /v1/search` is live; this adapter is MCP-only** — live
  probe 2026-11-07: `GET /v1/search` returns 404, while `POST /v1/search` returns
  200 with a `code:0` envelope. The provider speaks MCP Streamable HTTP at
  `POST /mcp` only, so an `ANYSEARCH_ENDPOINT` (or explicit endpoint arg) ending
  in `/v1/search` is auto-rewritten to `base+/mcp` with a once-per-process
  stderr warning — a compatibility shim, not a sign that REST is retired.
  Upstream `request_id` in the reply envelope is a server-generated diagnostic
  UUID (also returned as `X-Request-ID`): a caller-supplied value is ignored,
  and it is not an idempotency key.
```

## #24 建 ip 第五域的语料（触发条件=上游给 ip 子域补了结构化的参数表）

解除信号: 在 `https://api.anysearch.com/mcp` 上调
`get_sub_domains(domain="ip")`，返回 `ip` 域的逐参数词表——也就是 `finance.*` 那些条目
已经在产出的形状（像 `type`/`symbol`/`cn_code` 这样的逐参数表；见
`docs/vertical-domains.md:19-22`）。现在 `ip` 只出现在 17 个顶层域名的枚举里
（`docs/vertical-domains.md:12-14`），`eval-looks.json` 里没有一条 `domain:"ip"`。
探针一打出能用的参数表，就能照 `vert-f11xx`/`vert-f12xx` 的写法往
`eval-looks.json` 写 `vert-i*` 语料。

登记状态: absent — 建议只留票，不补进 `docs/limitations.md`。理由：缺的语料是内部
评测的缺口，没有产品界面；而且 `docs/vertical-domains.md` 已经写明快照要让位给现场
`get_sub_domains` 工具（`docs/vertical-domains.md:3-8`）——再登记一条只是重复那句
免责声明，给不了用户任何能动手的信息。

状态更新 (2026-11-07): 解除信号已触发 —— 现场探针返回唯一子域 `ip.global`
和五参数表（`type`/`keyword`/`applicant`/`ipc`/`date_start`），`vert-i*` /
`ctrl-i*` 语料已经随 #24 写进 `eval-looks.json`（14 条 live-scoped）；原来的
登记状态不变（内部评测缺口，不补进 `docs/limitations.md`）。

## #25 上游匿名配额边界的形态=自动签凭证的文本（200+isError:null+没有结果正文）；provider 已归类为 permanent-auth；改 env/key 是用户那边的事

解除信号: 上游匿名配额边界换形态——也就是在配额边界对一个匿名（没有
`ANYSEARCH_API_KEY`）的 `tools/call search` 探针，不再回自动签凭证的那段内容
（HTTP 200 + `isError:null` + "account ... automatically generated ... api_key=..."），
而是回真正的错误（`isError:true`、401/403，或者结构化的配额错误）。到那时，
`/automatically generated|api_key *=/i` 探测器和「quota/auth nudge」抛
permanent-auth 的那段代码
（`packages/retriever/src/providers/anysearch.ts:148-157`；分类在
`packages/retriever/src/contract.ts:230`；夹具测试
`packages/retriever/test/provider-error-class.test.ts:21`）要跟着改映射。
客户端这边的处理已经完整——这张票关的时候就是再验一遍边界还跟代码写的一样。

登记状态: registered — `docs/limitations.md` L166-170，在 #171 落地（匿名配额墙
用户能碰到：调用方撞上 `permanent-auth`，并被提示设 `ANYSEARCH_API_KEY`）：

```md
- **Anonymous `anysearch` calls hit a quota wall classified `permanent-auth`** —
  upstream answers quota-exhausted anonymous calls with an auto-provisioning
  payload (HTTP 200, `isError:null`, no result body) instead of an error;
  the provider names this `quota/auth nudge` → `permanent-auth`. Fix is
  user-side: set `ANYSEARCH_API_KEY`.
```

## #27 上游 finance.fundamental 的校验器按 tag 级要 cn_code，跟 sub_domains 文档的「按 type」规则对不上（vert-f1105 格降级的根因）

解除信号: 用
`domain="finance", sub_domain="fundamental", sub_domain_params={type:"overview", symbol:"MSFT"}`
调 `tools/call search` 不再回 `isError`——也就是上游校验器在 tag 级接受 `symbol`
而不要求 `cn_code`，跟 `get_sub_domains` 输出里写的「按 type」规则一致
（`docs/vertical-domains.md:21-22`："requires `type` plus `symbol` or `cn_code` per
type"；按 `vert-f1105` 的退役标记（`eval-looks.json:1119`），2026-10-01 现场验证仍被拒）。到那时，用退役
标记里留着的 `prior_spec` / `prior_expected_vertical`，把 `vert-f1105` 从
`tombstone{reason_code:"upstream-validator-vs-doc-mismatch"}`
（`eval-looks.json:1099-1151`）恢复成 live 状态。

登记状态: registered — `docs/limitations.md` L171-176，在 #171 落地（文档说合法的
参数组合被上游拒，用户能碰到：调 finance.fundamental 的人按词表文档传参却收到
`isError`）：

```md
- **Upstream `finance.fundamental` validator over-requires `cn_code`** — the
  `get_sub_domains` vocab documents `type` + `symbol` *or* `cn_code` per
  type, but the live validator demands `cn_code` at the tag level, so
  e.g. `{type:"overview", symbol:"MSFT"}` returns `isError`. Pass `cn_code`
  where the doc implies `symbol` suffices (eval cell `vert-f1105` is
  tombstoned on this; see `eval-looks.json`).
```

## #32 Tavily provider 没法取消：SDK 不暴露 AbortSignal

解除信号: `@tavily/core` 的某个版本（现在钉的是 `^0.7.7`，
`packages/retriever/package.json`）在 `search()` 上（或者请求级 client 配置里）
暴露 abort/`signal` 选项。2026-09 对着 SDK 源码核过："no AbortSignal support in
search options ... SDK uses internal timeout"（注释在
`packages/retriever/src/providers/tavily.ts:33-34`）。到那时，把 `SearchRequest` 的
`signal` 参数（`tavily.ts:30` 按契约是收的，但现在被丢掉）传进 SDK 调用。

登记状态: registered — `docs/limitations.md` L65-67
（"**Tavily does not forward `AbortSignal` (#32)** — provider-side timeouts are not
cancelable through the SDK. The budget guard limits spend, not wall time: the
grace window only aborts stragglers once enough results arrive, so a slow call can still overrun the budget."）。不用新加条目；这张票留着，当盯着上游的把手。

## #33 Tavily 的 usage() 永远是 undefined：只有每次调用的 credits，没有单独的用量接口

解除信号: Tavily 出一个单独的用量/配额 API（账户级的 credits 消耗，不用发起搜索就能
查）。现在的用量只有每次调用回来的 `response.usage.credits`——provider 在返回包里
写死 `usage: undefined`，也没有 `usage()` 方法
（`packages/retriever/src/providers/tavily.ts:68,72-73`；契约里 `usage?` 是可选的）。
Tavily 文档写了、或者真出了这个接口，就能做：把 `usage()` 映射到这个单独接口
（同时也可以先把每次调用的 `credits` 放进返回包）。

登记状态: registered — `docs/limitations.md` L177-179，在 #171 落地：

```md
- **Tavily envelope `usage` is always `undefined`** — `@tavily/core` returns
  credits only per-call (`response.usage.credits`) and offers no standalone
  usage API, so `usage()` is unimplemented (contract field is optional).
```

## #34 Exa 的 usage() 永远是 undefined：只有每次调用的 costDollars，没有单独的用量接口

解除信号: Exa 出一个单独的用量/账单 API（账户级的花销，不用发起搜索就能查）。现在的
花费只有每次调用回来的 `costDollars`——provider 写死 `usage: undefined`，也没有
`usage()` 方法（`packages/retriever/src/providers/exa.ts:82,86-87`；钉的版本
`exa-js@^2.18.1`）。Exa 文档写了、或者真出了这个接口，就能做：把 `usage()` 映射到它
（同时也可以先把 `costDollars` 放进返回包）。

登记状态: registered — `docs/limitations.md` L180-182，在 #171 落地：

```md
- **Exa envelope `usage` is always `undefined`** — `exa-js` returns cost only
  per-call (`costDollars`) and offers no standalone usage API, so `usage()`
  is unimplemented (contract field is optional).
```

## #216 Exa provider 没法取消：装上的版本没转发 exa-js 的 AbortSignal（上游 2.26.0 已经支持）

解除信号: **已经等到了**——`exa-js@2.26.0`（2026-10-19）加了按请求的超时和取消；
请求选项（`signal`、`timeout`、`body`、`headers`、`query`）是每个方法最后多出来的
一个参数。当时本仓钉的还是 `^2.18.1`，装上的类型里没有 `signal` / `AbortSignal`，
适配器虽然接了契约里的 signal，但没往下传
（`packages/retriever/src/providers/exa.ts:36-42,62`）。

现在就能做：把 `exa-js` 升到 >=2.26.0，把 `SearchRequest` 的 signal 当成方法最后
的请求选项传给 `search()` 和 `answer()`，再加一个 mock 测试，用一个已经 abort 的
signal 观察它。Exa 和 Tavily（#32）是两回事：上游不同，票也不同。

登记状态: resolved — `packages/retriever/package.json` 现在钉 `exa-js@^2.26.0`
（lockfile 解析到 2.27.0），`packages/retriever/src/providers/exa.ts` 会把契约里的
signal 当成最后的请求选项传给 `search()` 和 `answer()`；
`packages/retriever/test/exa.test.ts` 用桩 SDK 客户端，在两个调用上都观察一个
已经 abort 的 signal。`docs/limitations.md` 里 Exa AbortSignal 那条已经删了，因为
限制不存在了。Tavily（#32）还开着——上游是另一个。

## 汇总

| 票 | 会变的那个面 | 解除信号（触发事实） | 登记状态 |
|-------|----------------------|--------------------------|----------|
| #18 | `packages/embedding/src/index.ts:31-45` + `package.json` optionalDep | transformers 新版本声明 `onnxruntime-common` | absent — 只留票（内部补丁） |
| #22 | `packages/embedding/src/index.ts` ESM 路径 | #18 修复落地，或者出现 ESM 消费者 / 采用 `module.registerHooks` | absent — 只留票（没有发出去的 ESM 加载路径） |
| #23 | `anysearch.ts` `LEGACY_REST_SUFFIX`/`normalizeEndpoint` | 没有——前提不成立关票（`POST /v1/search` 还活着，只有 GET 是 404） | registered — `docs/limitations.md` L212-220 |
| #24 | `eval-looks.json`（`vert-i*` 条目） | `get_sub_domains(domain="ip")` 返回结构化参数词表 | absent — 只留票（评测内部，文档已让位给现场工具） |
| #25 | `anysearch.ts:148-157` 探测器 + `contract.ts:230` | 匿名配额边界不再回自动签凭证的内容 | registered — `docs/limitations.md` L166-170 |
| #27 | `eval-looks.json` 的 `vert-f1105` 退役标记（L1099-1151） | `{type:"overview",symbol}` 不用 `cn_code` 也能过 | registered — `docs/limitations.md` L171-176 |
| #32 | `tavily.ts:30-34` signal 转发 | `@tavily/core` 暴露 `signal`/abort 选项 | **registered** — limitations.md L65-67 |
| #33 | `tavily.ts:68,72-73` `usage()` | Tavily 有单独的用量接口 | registered — `docs/limitations.md` L177-179 |
| #34 | `exa.ts:82,86-87` `usage()` | Exa 有单独的用量接口 | registered — `docs/limitations.md` L180-182 |
| #216 | `exa.ts:36-42,62` signal 转发 | `exa-js@2.26.0` 暴露 `signal`/abort 选项——等到了 | **resolved** — SDK 升到 `^2.26.0` + 最后参数转发 `{signal}` + 已 abort 的 mock 测试；limitations 条目已删 |

说明：「只留票」那些行，判断依据是票本身加上代码注释和测试已经记够了；再往
`docs/limitations.md` 里登记，只会写一条用户根本碰不到的限制。
