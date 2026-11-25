# 「抓整页」各家给多少字、什么格式、怎么计费（#585）

调研日期：2026-11-25。回答一件事：Exa / Tavily / anysearch 三家抓「整页正文」各自给出什么东西、多长、烧多少钱。
目的是给「consolidate 喂整页一次烧多少 token」算账用。

每条事实标出处。「本机实测」全部是 2026-11-25 真打上游的记录，探针脚本是一次性的（`.scratch/585/`，不进仓库）。
**没有任何一家需要 key 才能验证的部分被跳过不说**——Exa 免费端点和 anysearch 匿名通道都不要 key，全部实跑过；
Tavily 没有 keyless 的抓页面，只查官方文档，没实跑。

---

## 一句话结论

1. **Exa 免费 MCP 的 `web_fetch_exa` 默认只给每页 3000 字符**，「整页」是要自己把 `maxCharacters` 调上去的，上限 600 万字符/页。
2. **Tavily extract 给的是无截断的全文**，markdown 格式，但烧钱：5 个 URL 一次抓算 1 credit（basic）。
3. **anysearch 自己就有一个 `extract` 抓页工具**（仓库 README 没记过它），匿名就能调，回包是 JSON 包着 markdown 正文，大约 5 万字符封顶，不能调长度。
4. 中文正文按 token 计费很贵：1 万汉字正文 ≈ **7600 token（GPT-4o）/ 10000+（Claude 旧分词器）/ 6000（DeepSeek）**。一个默认 3000 字符的 exa 抓页结果反而是便宜的；真按「整页」喂，中型页面就是一万到几万 token 一次。

---

## 一、Exa `web_fetch_exa`（免费 MCP 端点，mcp.exa.ai）

### 1.1 回包是什么形状——markdown 纯文本，不是 HTML

**本机实测**（2026-11-25，免费端点，无 key）。抓 `https://example.com`（`maxCharacters: 500`）的 `content[0].text` 开头：

```text
# Example Domain
URL: https://example.com

Example Domain

This domain is for use in documentation examples without needing permission...
```

结构是：第一份文档以 `# 标题` 开头，第二行 `URL: <地址>`，空行之后是正文。正文是**清洗过的 markdown**——抓 AWS Lambda 文档页能看到 markdown 表格（`| --- |`）、标题层级，不是原始 HTML。一批抓多个 URL 时，所有文档**首尾相接拼在一段 text 里**，每份都以 `# ` 标题行 + `URL:` 行开头（仓库 `providers/exa/README.md`「## 只借 search」取证块早有记录，本次复测一致）。**抓完的文档之间没有分隔符**，要按 `# 标题\nURL:` 这个头自己切。

抓失败的 URL **不让整批失败**：HTTP 照样 200，`isError` 不出现，正文末尾多一行 `Error fetching <url>: CRAWL_UNKNOWN_ERROR`（`providers/exa/README.md`「## 只借 search」取证块，2026-11-24 探针）。

### 1.2 给多少字——默认 3000 字符/页，可调到 600 万

全部本机实测（2026-11-25）：

| 测试 | 结果 |
|---|---|
| 不传 `maxCharacters`，抓 AWS Lambda welcome 页 | 回包 3099 字符，正文在 3000 附近被截断（句子中间切断） |
| `maxCharacters: 20000` 同页 | 5749 字符——这是该页全文的实际长度，不再截断 |
| `maxCharacters: 50000` 同页 | 还是 5749，不会再多 |
| 超长维基页（History of computing）`maxCharacters: 100000` | 45123 字符（该页全文就这么长） |
| RFC 9110（超长规范）`maxCharacters: 100000` | **100101 字符**，贴顶截断——证明截断真按字符数执行 |
| `maxCharacters: 10000000` | `isError: true`，报错原文：`expected number to be <=6000000 at "text.maxCharacters"`——**上限 600 万字符** |
| `maxCharacters: 0` | 不报错，**悄悄按默认 3000 处理**（schema 写 minimum 1，服务端不拦，直接落回默认） |
| `urls` 传空数组 | `isError: true`，报 `expected array to have >=1 items` |

`maxCharacters` 是**每页**的，不是整批合计：抓「AWS 页 + example.com」、`maxCharacters: 4000`，总回包 4316 字符，超过 4000——说明每页各截各的。官方 inputSchema 原文：`"Maximum characters to extract per page (default: 3000)"`（本机实测 `tools/list` 回包）。

批量上限：schema 里 `urls` 没有 maxItems 限制，实测一批 10 个 URL 正常返回（432 字符总长——同域去重后的结果）。Exa 官方 REST API（收费面）的 `/contents` 文档写的是 `urls` 上限 100 个、`text.maxCharacters` 上限 500 万、默认 500 万（<https://exa.ai/docs/reference/get-contents>）——**免费 MCP 工具的上限（600 万）比 REST 文档写的还高，且默认被压到了 3000**，两边不是一套参数，别拿 REST 文档套免费工具。

### 1.3 计费——和 search 同一个每日额度桶，一次调用算一次，不看带几个 URL

这部分仓库早查实了（`providers/exa/README.md`「## 已知异常」），本次没有重撞：

- 三个工具（`web_search_exa` / `web_fetch_exa` / `web_search_advanced_exa`）**烧同一份额度**：按客户端 IP 记账，只有一个每日桶，代码里没有工具维度。
- **一次 `tools/call` 算 1 次，不管它带几个 URL**——一次抓 10 个 URL 和抓 1 个记账相同。反过来一个 JSON-RPC 批量请求里塞几条 `tools/call`，每条各算 1 次。
- 每日额度官方 changelog（2026-02-02）写的是 **150 次/天/IP、3 QPS**；仓库实测两次样本不一致（一次读出 2 QPS、一次 4 并发全过），**规划按 50–150 次/天保守算**。
- `x-ratelimit-limit` / `x-ratelimit-remaining` 被上游**故意置 0**，别看；429 来了看 `retry-after`。

大白话算账：按保守的 50 次/天，如果每次批量抓 5 个 URL，一天免费能抓 250 页；一次一个地抓就只有 50 页。**批量是这个端点上唯一省额度的杠杆**。

### 1.4 接线的现状

仓库**故意没接**这个工具（#530 裁决，记在 `providers/exa/README.md`「## 只借 search」和 `docs/limitations.md:393-405`）：不是端点给不出来，是「读一页」被认定为一个新面（要新的能力位、新的引擎入口、自己的额度闸），裁决押后。

---

## 二、Tavily extract

**没有 keyless 的抓页面**，Tavily 一切都要 key（免费档每月 1000 credit）。以下全部来自官方文档，**没实跑**（本机有 key 但探针只为域过滤设计，这次没动额度）：

来源：<https://docs.tavily.com/documentation/api-reference/endpoint/extract> 和 <https://docs.tavily.com/documentation/api-credits>

### 2.1 端点和格式

`POST https://api.tavily.com/extract`。一次可以抓 1–20 个 URL（数组，`maxItems: 20`）。回包 JSON：

```json
{
  "results": [{ "url": "...", "raw_content": "<正文>", "images": [], "favicon": "..." }],
  "failed_results": [{ "url": "...", "error": "..." }],
  "response_time": 0.5
}
```

- `raw_content` 默认是 **markdown**（`format: "markdown"`），可选 `"text"` 纯文本。
- **默认不截断**：文档原话是 raw_content 给「the full content extracted from the page」。唯一会切碎的情形：你传了 `query` 参数（按查询相关性重排 chunk），这时每块约 800 字符、每源最多 1–5 块（`chunks_per_source`，默认 3），正文变成 `<chunk 1> [...] <chunk 2> [...]`。**不传 query 就是全文**。
- `extract_depth`：`basic`（默认）或 `advanced`——advanced 多抓表格和嵌入内容，更慢更贵。
- 部分失败不影响整批：成功的进 `results`，失败的进 `failed_results`（带 error 串），HTTP 还是 200。

### 2.2 计费——按「成功抓了几个 URL」算，5 个一份

官方 pricing 原文：

- **basic：每 5 个成功 URL 算 1 credit**（不满 5 个的零头文档没写怎么进位，`include_usage` 的注释说「总数没到 5 之前 usage 可能是 0」，读起来是按账号累计成功数凑 5 进 1——**这句是推测**，文档没有逐字写清进位规则）。
- **advanced：每 5 个成功 URL 算 2 credit**。
- 抓失败的 URL 不收钱（「You never get charged if a URL extraction fails」）。
- 单价：免费档每月 1000 credit；付费约 $0.005–0.008/credit。换算：**basic 抓一页 ≈ $0.001–0.0016**，免费额度一个月能抓 5000 页（basic）。

对比：Tavily search 一次 1 credit（basic）。也就是说**抓 5 页的钱 = 搜 1 次的钱**，extract 在 Tavily 家算便宜货。

---

## 三、anysearch——仓库没记过的大发现：它自己有抓页工具

### 3.1 `extract` 工具客观存在，匿名就能调

**本机实测**（2026-11-25，匿名、无 key）：`https://api.anysearch.com/mcp` 的 `tools/list` 回 5 个工具：

```text
batch_search, extract, get_sub_domains, score, search
```

仓库 `providers/anysearch/README.md` 从没提过 `extract`——adapter 和两条探针都只接 `search`。这个工具的官方描述原文开头：「This is Anysearch's URL extraction tool. Use this as the default tool whenever you need to open, read, fetch, or retrieve the content of a web page…」

### 3.2 实测形状

入参 schema 极简：`{url: string}`，**一次只能一个 URL**，没有任何长度/格式参数。

回包：`content[0].text` 是**一段 JSON 字符串**（不是 markdown 信封，和 search 的形状完全不同）：

```json
{"url":"...","title":"...","content":"<正文 markdown>"}
```

本机实测（2026-11-25，匿名）：

| 抓什么 | 结果 |
|---|---|
| `example.com` | content 215 字符，正常 |
| AWS Lambda welcome 页 | content **5773 字符**，markdown 带 `#` 标题、带 `[文字](url)` 链接，无截断（同页 exa 全文 5749，量级一致） |
| 维基 Web scraping 页 | content **49868 字符**，末尾出现字面量 `...(content truncated)`——**存在硬截断，量级约 5 万字符，且没有任何参数能调**（schema 里根本没有长度参数）。同页 exa 给出的是 27166 字符的紧凑版，两边渲染宽度不同，截断点不能直接对比，但「5 万字封顶、不可调」这个结论不受影响 |
| 不存在的域名 | `isError: true`，正文是纯文本两行：`extract_failed` + `Unable to extract content from the URL.`——不是 JSON，也没有 HTTP 层错误 |

### 3.3 计费和配额

- **匿名实测能调通**（本次 4 次调用全部 200），但任何search的匿名配额墙（#532 实测：约 97–100 次累计后封死，至少 1 小时内不恢复）当初只测了 `search` 工具。**`extract` 是否烧同一个匿名桶——没测过，是推测**：墙的形状是「只封 `tools/call search`、`tools/list` 不封」，如果墙按工具名记账，extract 可能独立；如果按 IP 累计，就是同一桶。要验证得拿匿名额度去撞，本次没撞（怕把测试环境的匿名额度烧穿）。
- 带 key 后 anysearch 的计费（按次还是按量）仓库没有任何记录，官方定价页这次没查——**不知道，明说**。

### 3.4 对仓库的意义

`docs/limitations.md:396` 写的「ans cannot read a page」对 Exa 臂成立，但 **anysearch 臂其实一直躺着一条抓页通道**，只是适配器没接。如果 #585 决定接「读一页」，anysearch 这条路连供应商谈判都不用，唯一代价是接受它的 5 万字硬顶和一次一 URL。

---

## 四、字与 token 的换算——本机实测 + 已发表实测

### 4.1 本机实测（2026-11-25）

方法：`js-tiktoken`（o200k_base，GPT-4o/4o-mini/o 系列同款）+ `@huggingface/transformers` 加载各家官方 tokenizer，喂**真实中文文章**（36氪 + 阮一峰周刊的正文，exa 抓回）和真实英文散文。原始数字：

| tokenizer | 10000 中文字符 | 50000 英文字符 | 中文 token/字 |
|---|---|---|---|
| GPT-4o（o200k_base）实测 | **7607** | **8645** | 0.76 |
| DeepSeek-V3.2 官方 tokenizer 实测 | **5966** | —（没测英文） | 0.60 |
| Qwen3 官方 tokenizer 实测 | 6461 | 8645 | 0.65 |
| Claude 旧分词器（Xenova 镜像，Opus 4.6 及之前）实测 | **10066** | 9201 | ≈1.0 |

英文 5 万字符 ≈ **8600–9200 token**（约 6 个字符 1 token，和「1 token ≈ 4 字符英文」的经验值有差距——经验值对应的是带空格的自然文本流，这里的 5 万字符里空格也算字符，实际口径是 1 token ≈ 5.5–6 个含空格字符）。

注意：Claude Opus 4.7 换了新 tokenizer，英文 token 数膨胀 1.24–1.63 倍，**中文基本没变**（36氪实测，见下）；Xenova 镜像是旧版，新版的绝对数**没有公开 tokenizer 可实测**。

### 4.2 交叉验证：36氪/极客公园的 5-tokenizer 平行实测

<https://www.36kr.com/p/3793050208984071>（2026-05-03，22 段平行文本 × 5 个 tokenizer）：Claude（4.6 及之前）中文比英文贵 1.11–1.64 倍；GPT-4o 中文/英文比值 1.0–1.35；Qwen 和 DeepSeek 中文反而比英文便宜（DeepSeek 最低 0.65 倍）。这和我实测的相对顺序完全一致：**Claude 中文最贵（一字一 token），GPT-4o 居中（0.76），DeepSeek/Qwen 最省（0.6–0.65）**。

### 4.3 consolidate 烧 token 速查表

按上面实测比例换算（输入侧，不算输出和系统提示）：

| 正文体量 | GPT-4o | Claude（旧分词器口径） | DeepSeek |
|---|---|---|---|
| 中文 1 万字 | ≈7,600 | ≈10,000 | ≈6,000 |
| 中文 3 万字 | ≈23,000 | ≈30,000 | ≈18,000 |
| 英文 5 万字符（≈8–9 千词） | ≈8,600 | ≈9,200（旧）/ 1.24–1.63 倍于此（4.7 新） | 未测 |
| exa 默认抓页（3000 字符中文页） | ≈2,300 | ≈3,000 | ≈1,800 |
| 典型整页（20,000 字符中文博客） | ≈15,000 | ≈20,000 | ≈12,000 |

大白话：**喂一页整文进 consolidate，一次就是几千到几万 token 的输入**。中文按 Claude 算最贵，3 万字正文光输入就 3 万 token——按 Claude Opus 输入 $5/M token 算是 $0.15/次，按 GPT-4o（$2.5/M）3 万字中文约 $0.06/次。

---

## 五、真实网页正文有多大——有统计来源

### 5.1 大样本统计（有权威数据）

Dan Petrovic（dejan.ai）2025-12-14 发表的 44,684 个真实网页 token 统计（用 Gemini 官方 token 计数器量）：<https://dejan.ai/blog/how-long-are-web-pages>

- **中位数 3,201 token/页**（约 2400 英文词）；**平均值 10,403**——长尾拉上去的；
- 一半页面落在 1,000–5,000 token；18% 的页面在 1–5 万 token；
- 99 分位 141,410 token；最大的一页 300 万 token（整本书/PDF）。
- 95% 的页面装得进 128K 上下文。

按 Gemini/GPT 系 token 与字符的换算（英文 ≈ 5.5–6 字符/token），**中位数页面正文 ≈ 1.8 万字符上下**——注意这比 Exa 免费端点默认的 3000 字符大 6 倍：**默认参数抓回来的只是开头一小段**。

### 5.2 本机实测样本（2026-11-25，exa 全量抓取，`maxCharacters` 给到 30 万）

| 页面 | 正文字符数 |
|---|---|
| AWS Lambda「What is」文档页 | 5,749 |
| AWS Lambda getting started 文档页 | 17,214 |
| 阮一峰周刊 + 36氪长文（两篇合计） | 21,563（其中纯汉字 12,037） |
| martinfowler.com 长技术文 | 20,750 |
| MDN Promise 参考页 | 27,801 |
| 维基百科 Web scraping | 27,166 |
| react.dev useEffect 参考页 | 64,064 |
| Stack Overflow 经典问答（含全部回答评论） | 61,139 |
| HN 热帖（Unison 1.0，95 条评论）+ 另一帖 | 两帖合计 48,900 |
| RFC 9110（HTTP 规范全文单页） | 100,000+（贴顶截断，全文更长） |

规律：**文档站参考页和论坛长帖 2–6 万字符是常态，普通博客 1–2 万，AWS 的概念简介页算短的（5–6 千）**。按中文 0.76 token/字、英文 0.17 token/字符估，一个「典型技术页面」喂进 consolidate 的输入量在 **3,000–15,000 token** 之间，和 5.1 的大样本中位数（3,201 token）互相印证。

---

## 六、对决策有用的对照表

| | Exa 免费 `web_fetch_exa` | Tavily extract | anysearch `extract` |
|---|---|---|---|
| 要不要 key | 不要（免费额度） | **要**（免费档每月 1000 credit） | 不要（匿名可通，有累计墙） |
| 格式 | markdown 文本块，多页拼一段 | JSON，`raw_content` 是 markdown | JSON 字符串，`content` 是 markdown |
| 默认长度 | **3000 字符/页**（截断！） | 全文不截断 | 全文直到 ≈5 万字符硬顶 |
| 长度上限 | 600 万字符/页（可调） | 无上限（无参数，本来就不截） | ≈5 万字符，**不可调** |
| 批量 | 一次 N 个 URL，schema 无上限（实测 10 个 OK；REST 面写 100） | 一次最多 20 个 | **一次只能 1 个** |
| 失败行为 | 整批 200，行内 `Error fetching` | `failed_results` 数组，不成功不收钱 | `isError:true` + 纯文本两行 |
| 计费 | 一次调用算 1 次（不管几个 URL），与 search 共用 50–150 次/天/IP | 5 个成功 URL = 1 credit（basic）/ 2 credit（advanced） | 未知（匿名有累计墙；带 key 计费无记录） |
| 仓库接线现状 | 故意没接（#530） | 不存在（adapter 只用 search） | **工具存在但 adapter 没接，README 也没记** |

---

## 七、明说的不确定项

1. **Tavily 全部没实跑**：免费额度用满时的 extract 行为、不满 5 个 URL 的进位规则，只有文档说法。
2. **anysearch `extract` 和 `search` 是否共用匿名配额墙**：没实测（避免烧穿匿名额度）。墙的形状（#532）只说封 `tools/call search`，是否按工具名记账未知。
3. **Claude 新 tokenizer（Opus 4.7 起）的中文绝对数**：没有公开 tokenizer 可实测；36氪实测说中文较旧版「几乎没变」，本文 Claude 数字基于旧分词器镜像，标注为近似。
4. **exa 免费端点 `urls` 的批量硬顶**：schema 没写，实测到 10 没问题，更多没试（省额度）。
5. **anysearch 带 key 的 extract 计费**：官方定价页未查，仓库无记录。
