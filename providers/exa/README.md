# exa 档案夹

Exa 的说明。信息源 id 是 `exa`，适配器在
[`packages/retriever/src/providers/exa.ts`](../../packages/retriever/src/providers/exa.ts)。这个夹子
**暂时只有说明，没有探针**——理由写在最后。

## 端点

- `https://api.exa.ai`，是 `exa-js` 构造函数的默认 baseURL；适配器写的是 `new Exa()`，**没有**环境
  变量开关（#421 查实，三家只有 anysearch 有）。

## 认证

- `EXA_API_KEY`。适配器 `new Exa()` 不传 key（产品装配时把 composition 解析出的 key 传进构造函数），
  裸跑时由 SDK 自己从环境变量取。
- 这个夹子没有探针，所以「只读环境变量、不读凭据文件」这条坑在 exa 上**没有实测过**——#422 那轮只
  测了 anysearch 和 tavily；exa 的读取路径和它们同源，按同一套推断，别当已验证。

## 协议版本

REST/JSON，走 `exa-js`（>= 2.26.0），没有 MCP 协议版本协商。适配器的 mode 映射：

| 本仓 mode | Exa `type` | 备注 |
|---|---|---|
| `fast` | `fast` | |
| `index` | `auto` | |
| `deep` | `deep` | |
| `answer` | `auto` + `answer()` | 用 SDK 的 answer 通道，不是 search |

`searchAndContents` 在 2.26 已废弃，适配器用的是 `search(query, { contents: { text: { maxCharacters: 500 } } })`。

## 回复形状

- 成功：`results[]`，每条 `title` / `url` / `text` / `publishedDate` / `score`。`title`、`url` 直接映射；
  `text`（请求的是 `contents.text.maxCharacters: 500`）→ `snippet`；`publishedDate` → `publishedAt`；
  `score` 保留。适配器只要 `text`，不请求也不读 `highlights`。
- `includeDomains` 是 SDK 的一等 typed 字段，所以域过滤可以在上游做（`domainFilterSupported = true`）。
- `usage` **永远 `undefined`**：`exa-js` 只在单次回包里给 `costDollars`，没有独立用量 API。
- `AbortSignal` 是转发的（作为 `RequestOptions` 尾巴传下去，#216）；三家只有 tavily 转发不了。

## 已知异常

- 目前**没有**记到 exa 专属的错误形状：`docs/limitations.md` 里 exa 只占「`usage` 恒 `undefined`」
  这一条，`quota-exhausted` 那套正文匹配是为 tavily 的 432 写的。
- 真遇到 exa 的异常（401 / 429 / 套餐），先把原始回包和 `classifyProviderError` 的判定记进
  `docs/limitations.md`，再回来补这一节——别在 README 里写没查到的东西。

## 探针

没有。exa 还没有一条手工探针，原因很直白：真正需要的取证面（原文 vs 适配器）在 exa 这边还不存在
争议，而临时跑一次的成本很低。要真调用就走产品：

```bash
ANS_PROVIDERS=exa ans search "cloudflare workers" --json
```

或者写个一次性脚本（别提交）。等哪天真需要一条长期夹具，再按这个夹子的形状加：
`providers/exa/probe-exa-*.mjs`，`node 文件名` 能跑，输出 JSON，不打印 key。

## 最近一次真跑

2026-11-22（本机 Windows，Node 24.22.1，`cloudflare workers`、`fast`、`maxResults:3`）：通，3 条结果，
`elapsedMs:1261`，`serverElapsedMs:1260`，三条都落在 `developers.cloudflare.com`。完整三行原始记录在
[`docs/research/real-baseline-2026-11-22.md`](../../docs/research/real-baseline-2026-11-22.md)。
