# #466 研究笔记：自由文本里的裸域名识别，以及 `ans_*` 字段该扫哪些

- 日期：2026-11-23
- 仓库基线：`e20432d2de18819614c128e60cf2890fdbce792d`（`Xxx91n/anysearch-cli`）
- 运行时验证：Node **v24.22.1**；`linkify-it` **6.1.0**；IANA 根区清单 `Version 2026112200`（2026-11-22）
- 本文所有的“行为”结论都给了规范或源码 URL；库行为另用 npm tarball 在 `$TEMP` 里做过可复现实验（未装包、未改仓库）。

## 结论

### Q1：裸域名

没有一个现成 autolinker 同时满足“能认出 `example.com/a`”和“绝不碰 `main.py`/`README.md`/`foo.bar`/中文粘连”这两件事。CommonMark 只认尖括号里的绝对 URI（`<http://x>`），裸 `https://example.com` 都不算；GFM 的扩展 autolink 只由 `www.`、`http(s)://`、`ftp://`、邮箱等触发，**不认裸 `example.com`**，而且只做结构校验、**没有 TLD 表**；`linkify-it` 打开 `fuzzyLink` 后会把 `main.py`、`README.md` 链成 `http://main.py`，还会把 `看example.com/a这个` 整段吞进 URL；Node 的 `new URL("example.com/a")` 直接抛 `ERR_INVALID_URL`。因此建议自己实现一条**两遍扫描**规则：带 scheme 的用 `new URL()` 取 host；裸域名只在 ASCII 候选串上要求“至少两段 + 每段 LDH/`xn--` + 末段命中 IANA TLD 快照 + 文件扩展名/代码占位 TLD 黑名单”，命中后只提取 host 做策略判断，**永不改写原字段**。这样 ticket 列出的误报都不会被改写、也不会被当成可 fetch 的 URL（`foo.bar` 由占位 TLD 黑名单排除；中文粘连只提取 ASCII host，原文不动）。代价是 `.bar` 等碰撞 TLD 的裸域名、以及无 scheme 的 Unicode IDN 被故意漏掉。

### Q2：扫描范围

只扫“会把文本带向外部 provider 或 agent 工具链”的字段：`search_web.query`、`research_web.question`、`ans_chat.message`，以及 `search_web/research_web` 的 `verticalParams` 里的字符串值。`recall_memory.query` 和 `query_knowledge.query` 走本地 FTS5/知识库，URL 不会触发对该 host 的抓取，且 FTS5 会把 `example.com/a` 拆成 `example`/`com`/`a` 三个词，任何“补 `https://`”或“去掉路径”的重写都会改变召回；`projectPaths`、`sessionId`、枚举、数字、布尔值都不应扫，更不应改写。所有字段都只做“检出/取 host”，不把规范化后的 URL 写回参数。

## 判据/规则

### 1. CommonMark：只有尖括号 autolink，没有裸域名

CommonMark 0.31.2 §6.5 的定义是：autolink 是 `<` 和 `>` 之间的 absolute URI 或 email；URI autolink 是 `<` + scheme + `:` + 除控制字符、空格、`<`、`>` 之外的字符 + `>`；scheme 为 2–32 个字符，首字符 ASCII 字母，后续为字母、数字、`+`、`.`、`-`。规范明确说“很多在这里算 absolute URI 的字符串并不是合法 URI，因为 scheme 未注册或其它语法问题”，例如 `<https://../>` 也算 autolink。([CommonMark §6.5](https://spec.commonmark.org/0.31.2/#autolinks))

关键例子（同节 Example 594–612）：

- `<http://foo.bar.baz>` → 链接；`<foo.bar.baz>` → **不是** autolink（没有 scheme）。
- `<localhost:5001/foo>` → 链接，因为 `localhost:` 被当成 scheme；这和 Node `new URL("localhost:3000")` 的行为同源。
- `<https://../>` → 链接，说明 CommonMark 不做 host 校验。
- 裸 `https://example.com` → **不是** autolink（Example 611）；裸 `foo@bar.example.com` → 不是（Example 612）。
- email autolink 用 HTML5 的非规范正则，语义是 `<foo@bar.example.com>` → `mailto:`。([同节](https://spec.commonmark.org/0.31.2/#autolinks))

结论：CommonMark 只能作为“显式 scheme 的强信号”参考，**不能**用来识别裸域名；它也没有 TLD 概念。

### 2. GFM：`www.` 或 scheme 触发，结构校验，不查 TLD 表

GFM §6.9 的扩展 autolink 只有这些触发方式：

- `www.` 开头，后接 valid domain，自动补 `http://`；
- `http://`、`https://`、`ftp://` 开头，后接 valid domain；
- email（任意文本节点内）；
- `mailto:`、`xmpp:` 协议。

valid domain 的规范原文是：“segments of alphanumeric characters, underscores (`_`) and hyphens (`-`) separated by periods (`.`). There must be at least one period, and no underscores may be present in the last two segments of the domain.” 它**没有**要求末段是真实 TLD，也没有引用任何 TLD 列表。([GFM §6.9](https://github.github.com/gfm/#autolinks-extension-))

因此：

- `www.commonmark.org`、`www.commonmark.org/help` 会被链化；
- `http://commonmark.org`、`https://encrypted.google.com/...` 会被链化；
- **裸 `example.com` / `example.com/a` 不会被 GFM 链化**，因为没有 `www.` 也没有 scheme；
- `www.foo.bar` 这类只要结构合法就会链化，哪怕 `.bar` 不是“常用”后缀；
- 路径尾部标点有专门规则：`? ! . , : * _ ~` 不算链接的一部分；结尾 `)` 若闭括号多于开括号则去掉未配对的那个；结尾 `;` 若像 `&entity;` 则去掉；`<` 立即结束链接。([GFM §6.9](https://github.github.com/gfm/#autolinks-extension-))

结论：`www.` 可以作为强信号；但“裸域名”必须由我们自己的 TLD/黑名单规则补上，不能指望 GFM 契约。cmark-gfm 的实现也印证了这一点：`extensions/autolink.c` 里 `valid_uris[]` 只有 `http://`、`https://`、`ftp://`，另一个入口就是 `www_match()`（`www.` 前缀）；没有“裸域名”入口。([cmark-gfm autolink.c](https://github.com/github/cmark-gfm/blob/master/extensions/autolink.c))

### 3. `linkify-it` / markdown-it 的实际契约

`linkify-it` 是 markdown-it 实际使用的链接识别库（markdown-it 的 linkify 规则直接 `new LinkifyIt()`；见 [markdown-it `src/markdownit.ts#L119`](https://github.com/markdown-it/markdown-it/blob/master/src/markdownit.ts#L119)、[`src/rules_core/linkify.ts`](https://github.com/markdown-it/markdown-it/blob/master/src/rules_core/linkify.ts)）。npm 上没有名为 `markdown-it-link-utils` 的包（registry 返回 Not Found），所以这里以 `linkify-it` + markdown-it 的 linkify 规则为准。

`linkify-it` 的默认契约（[README](https://github.com/markdown-it/linkify-it#readme)、[`src/linkifyit.ts#L106-L133`](https://github.com/markdown-it/linkify-it/blob/master/src/linkifyit.ts#L106-L133)）：

- 默认识别 `http(s)://...`、`ftp://...`、`mailto:...`、`//...`，以及 fuzzy email（`foo@bar.com`）。
- `fuzzyLink` **默认 `false`**（6.0.0 起；见 [CHANGELOG](https://github.com/markdown-it/linkify-it/blob/master/CHANGELOG.md)），打开后才识别“没有 scheme 的 URL”，包括裸域名和 `www.`。
- `fuzzyIP` 默认 `false`；打开后 `1.2.3.4` 这类 IPv4 也会被 fuzzy link 命中。
- `fuzzyEmail` 默认 `true`。
- fuzzy link 的 TLD 默认表不是完整 IANA：所有 2 字母根区 + `biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф` + 编码过的 `xn--...` 根区；需要更全的表时用 `.tlds(list)` 覆盖/合并（README 的 “By default” 段；源码 `tlds_default` 与 `tlds_2ch`）。
- `.tlds(list)` **默认替换**旧表；`.tlds(list, true)` 才是合并。
- 6.0.0 起 Unicode 标点默认终止链接（CJK 标点改善），但汉字字母仍会被当作域名/路径字符。

用 `linkify-it@6.1.0` 实测（默认表 / 完整 IANA 表，`fuzzyLink:true`）：

| 输入 | `fuzzyLink:false`（默认） | `fuzzyLink:true` + 默认 TLD | `fuzzyLink:true` + 完整 IANA |
|---|---|---|---|
| `example.com/a` | null | `http://example.com/a` | 同左 |
| `example.com` | null | `http://example.com` | 同左 |
| `main.py` | null | **`http://main.py`** | **`http://main.py`** |
| `README.md` | null | **`http://README.md`** | **`http://README.md`** |
| `config.toml` | null | null（`.toml` 不是 TLD） | null |
| `v1.2` / `1.2.3` | null | null | null |
| `1.2.3.4` | null | null（除非 `fuzzyIP:true`） | null（除非 `fuzzyIP:true`） |
| `foo.bar` | null | null（`.bar` 不在默认表） | **`http://foo.bar`** |
| `user@example.com` | `mailto:user@example.com` | 同左 | 同左 |
| `localhost:3000` | null | null | null |
| `example.com:3000` | null | **null**（无 scheme 的 port 不识别） | **null** |
| `看example.com/a这个` | null | **raw 包含 `看` 和 `这个`** | **同左** |
| `看 example.com/a 这个` | null | `example.com/a` | 同左 |
| `EXAMPLE.COM` | null | `http://EXAMPLE.COM`（不改大小写） | 同左 |
| `xn--e1afmkfd.xn--p1ai` | null | 命中 | 命中 |
| `例え.中国` | null | null | null（ASCII IANA 表不匹配 Unicode 标签；先 `domainToASCII` 或使用 Unicode 表才可以） |
| `example.com/a.` | null | `example.com/a`（尾点被去掉） | 同左 |
| `example.com.` | null | `example.com`（尾点被去掉） | 同左 |
| `user:pass@example.com` | null | null（裸 userinfo 不识别；只有 `https://` scheme 才解析） | null |
| `(example.com/a)` | null | `example.com/a`（括号剥离） | 同左 |
| `//example.com/a` | `//example.com/a` | 同左 | 同左 |
| `https://example.com:3000/a` | 命中 | 命中 | 命中 |

这张表说明三件事：

1. **不能直接拿 `linkify-it` 的 fuzzyLink 做安全策略**：`main.py`、`README.md` 会命中；`foo.bar` 在完整 IANA 表下也会命中；中文无分隔符会被整段吞掉。
2. 无 scheme 的 `example.com:3000` 不被 `linkify-it` 识别；如果产品要支持“裸域名:端口”，必须自己处理。
3. `fuzzyIP` 打开会把裸 IP 也变成链接，和 ticket 的“裸 IP 不要碰”冲突；不要打开。

markdown-it 侧还有一个容易误判的点：当前 markdown-it 15.0.3 的默认 preset 是 `linkify: false`；即使调用方打开 `linkify: true`，它构造的是默认参数的 `new LinkifyIt()`，而 6.x 的 `fuzzyLink` 默认 `false`，所以**裸域名/`www.` 默认不会变成链接**，除非应用自己执行 `md.linkify.set({ fuzzyLink: true })`。([markdown-it default preset `linkify:false`](https://github.com/markdown-it/markdown-it/blob/master/src/presets/default.ts#L19)、[markdown-it `new LinkifyIt()`](https://github.com/markdown-it/markdown-it/blob/master/src/markdownit.ts#L119)、[linkify-it 6.0.0 changelog](https://github.com/markdown-it/linkify-it/blob/master/CHANGELOG.md))

### 4. Node `new URL()`：必须有 scheme（或 base），`example.com/a` 直接抛

Node 文档对 `new URL(input[, base])` 的说明是：`input` 是 absolute 或 relative URL；如果 `input` 是 relative，则 `base` 必填；如果 `input` 是 absolute，`base` 被忽略；**“A TypeError will be thrown if the input or base are not valid URLs.”** ([Node URL docs](https://nodejs.org/api/url.html#new-urlinput-base))

WHATWG URL 解析器的 `no scheme state` 写得更直接：如果 `base` 为 null（或 base 是 opaque path 且当前字符不是 `#`），报 `missing-scheme-non-relative-URL` validation error 并 **return failure**。([WHATWG URL §4.4](https://url.spec.whatwg.org/#no-scheme-state))

Node v24.22.1 实测：

| 表达式 | 结果 |
|---|---|
| `new URL("example.com/a")` | **Throw `TypeError [ERR_INVALID_URL]`** |
| `new URL("example.com/a", "https://base.test/")` | `https://base.test/example.com/a` —— 被当成**相对路径**，不是 `https://example.com/a` |
| `new URL("www.example.com", "https://base.test/")` | `https://base.test/www.example.com` |
| `new URL("//example.com/a", "https://base.test/")` | `https://example.com/a`（protocol-relative 才会解析成 host） |
| `new URL("localhost:3000")` | 成功，但 `protocol === "localhost:"`、`hostname === ""`、`pathname === "3000"` |
| `new URL("example.com:8080/a")` | 成功，但 `protocol === "example.com:"`、`hostname === ""`、`pathname === "8080/a"` |
| `new URL("http://EXAMPLE.COM.")` | `hostname === "example.com."`（小写化，但**保留尾点**） |
| `new URL("http://例え.中国")` | `hostname === "xn--r8jz45g.xn--fiqs8s"`（special scheme 自动 punycode） |
| `new URL("http://user:pass@example.com:8080/a")` | `username === "user"`、`hostname === "example.com"`、`port === "8080"` |
| `new URL("http://1.2.3.4/a")` | `hostname === "1.2.3.4"`（IPv4） |
| `new URL("http://[::1]:8080/")` | `hostname === "[::1]"`、`port === "8080"`（IPv6） |
| `new URL("http://foo_bar.example.com")` | **成功**，`hostname === "foo_bar.example.com"` |
| `new URL("http://a..b")` | **成功**，`hostname === "a..b"` |

最后两行很重要：`new URL()` 只做 WHATWG 解析，**不是 hostname 校验器**；下划线、空标签都可能通过。因此不能把 `new URL()` 当成“这是不是一个合法域名”的判据。

对 `apps/plugin/src/hooks/preheat.ts` 的直接含义：

- 现在第 187 行只匹配 `https?://...`，所以第 211 行的 `new URL(url)` 永远不会遇到裸域名，行为是对的。([preheat.ts#L186-L211](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/plugin/src/hooks/preheat.ts#L186-L211))
- 如果为了裸域名把 `example.com/a` 也放进 `urls`，**不能**直接 `new URL("example.com/a")`（会抛，随后 `catch { continue; }` 静默跳过策略检查）；必须先 `new URL("http://" + candidate)`。
- 对 `example.com:3000` 或 `localhost:3000`，`new URL(candidate)` 会把它解析成 `scheme = "example.com:"` / `"localhost:"`、`hostname = ""`；必须补 `http://`，否则 `.hostname` 是空的。
- 尾点要在做 allow/deny 比较前去掉：`new URL("http://example.com.").hostname` 是 `example.com.`，而策略条目 `example.com` 的 `host === h || host.endsWith("." + h)` 不会匹配 `example.com.`。([preheat.ts#L218-L222](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/plugin/src/hooks/preheat.ts#L218-L222))
- 大小写和 IDN 要在取 host 后统一：`URL.hostname` 已小写并把 Unicode 转 punycode；裸域名则要自己小写、必要时 `domainToASCII`。策略侧只接受 `[a-z0-9.-]`，不接受 Unicode 标签（`HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/`）。([domain-schema.ts#L217-L224](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/store/src/domain-schema.ts#L217-L224))

### 5. 维护中的 TLD 清单放哪里，TS 代码库该选谁

- **IANA Root Zone Database** 是权威记录：“The Top-Level Domain Registry (also known as the Root Zone Database) is the authoritative record of top-level domains”。([IANA Root Zone](https://www.iana.org/domains/root)、[Root Zone DB](https://www.iana.org/domains/root/db))
- 机器可读清单是 [`https://data.iana.org/TLD/tlds-alpha-by-domain.txt`](https://data.iana.org/TLD/tlds-alpha-by-domain.txt)。文件头带版本/更新时间；本次取到 `Version 2026112200, Last Updated Sun Nov 22 07:07:02 2026 UTC`，共 **1,435** 条 TLD（去掉 `#` 注释行后）。内容是 ASCII/punycode、全大写；用时 `toLowerCase()` 建 `Set`。
- **Public Suffix List 不是 TLD 清单**。PSL 的定义是“a set of DNS names or wildcards concatenated with dots. It represents the part of a domain name which is not under the control of the individual registrant.” 它服务于 cookie/JS 的 eTLD+1 边界，文件里明确分成 `===BEGIN ICANN DOMAINS===` 和 `===BEGIN PRIVATE DOMAINS===` 两段，还包含通配和例外规则。([publicsuffix.org](https://publicsuffix.org/list/)、[public_suffix_list.dat](https://publicsuffix.org/list/public_suffix_list.dat))
- npm 的 [`tlds`](https://www.npmjs.com/package/tlds) 是 IANA 派生清单；它的 `update.js` 直接下载 IANA 的 `tlds-alpha-by-domain.txt`，并把 punycode 解码成 Unicode 后写 `index.json`。([node-tlds `update.js`](https://github.com/stephenmathieson/node-tlds/blob/master/update.js)、[Readme](https://github.com/stephenmathieson/node-tlds/blob/master/Readme.md))
- [`tldts`](https://github.com/remusao/tldts) 是 TypeScript、维护活跃的解析库，但它的数据源是 **PSL**（README 明说 “Continuously updated version of the public suffix list”），适合取 hostname/registrable domain，不适合回答“这个末段是不是被委派的 TLD”。实测 `tldts.parse("main.py")` 会得到 `domain: "main.py", publicSuffix: "py", isIcann: true`，因为 `.py` 是巴拉圭的 ccTLD——它不会帮你避开文件名误报。([tldts README](https://github.com/remusao/tldts)、[npm tldts](https://www.npmjs.com/package/tldts))
- `linkify-it` 的默认表是**手挑子集**（2 字母 + 18 个名字 + `xn--`），不是完整 IANA；它连 `foo.bar` 都不认，但认 `main.py`/`README.md`。([linkify-it `tlds_default`](https://github.com/markdown-it/linkify-it/blob/master/src/linkifyit.ts#L106-L115))

**对 TypeScript 代码库的建议**：不要手写 TLD 表；用脚本把 IANA 的 `tlds-alpha-by-domain.txt` 生成成仓库内的 `tlds.generated.ts`（`Set<string>`，小写 punycode），随代码一起 review/发布，按季度或发版前刷新。这样运行时零网络、结果可复现，也不会被某个依赖的“默认子集”悄悄改变。若还需要 eTLD+1/注册域边界，再用 `tldts`（PSL）单独算；**两件事不要混**。如果一定要用现成包，`tlds` 比手写好，但要注意它给的是 Unicode 解码后的表，和 `domainToASCII` 的 punycode 结果要做一次映射。

### 6. 推荐规则（一句话）

> **显式 `http(s)://` 的候选直接用 `new URL()` 解析取 `hostname`；没有 scheme 的文本只取 ASCII 的 URL 候选串，剥掉首尾标点/未配对括号、可选 `:port` 和结尾一个点后，要求至少两个标签、每段为 LDH 或 `xn--`、末段命中 IANA TLD 快照且不在文件扩展名/代码占位 TLD 黑名单中，才算裸域名；命中后只提取 host 供 allow/deny 判断，绝不改写原字段。**

#### 6.1 两遍扫描

1. **显式 scheme 遍**：``/(?<![\w+.-])https?:\/\/[^\s<>"'`]+/gi``。这段可以包含 Unicode（因此 `https://例え.中国/a` 也能被 `new URL()` 接住），但只接受 `http:`/`https:`；解析失败就丢弃，不要 `continue` 到“无 URL”而放过。
2. **裸域名遍**：只在 ASCII 候选串上跑，正则的 host 部分不允许非 ASCII：
   ``/(?<![A-Za-z0-9@._-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/g``
   负向后行断言负责：不从一个更长 host 的中间开始（`.`/`-`/`_`/字母数字前）、不把 email 的域名部分当裸域名（`@` 前）。
3. 两遍的匹配区间若重叠，裸域名遍跳过显式 scheme 已经覆盖的区间，避免同一 URL 被 gate 两次。

#### 6.2 裸域名的过滤顺序

1. 先 `trimPunct`：去掉首部 `([{<'"` 和尾部 `.,;:!?'"`；若结尾 `)`/`]`/`}` 的闭括号多于开括号，去掉未配对的那个；若结尾是 `&entity;` 形态的 `;`，按 GFM 去掉。`<`、反引号、空白直接终止候选。
2. 切 authority：`candidate.split(/[/?#]/, 1)[0]`；记录是否存在 path/query/fragment。
3. 去可选 port：`/^(.*):(\d{1,5})$/`，port 只用于“强信号”判断，不参与 host 策略（现有策略只存 hostname，无 port）。
4. 含 `@` → 裸域名遍直接跳过（email 或 userinfo；userinfo 只在显式 scheme 遍处理）。
5. `www.` 开头 → 去掉 `www.` 并标记 `strong = true`；否则 `strong = hasPath || hasPort`。
6. 去掉一个结尾点（FQDN 的 `example.com.`）。
7. 不含点 → 跳过（`localhost`、`localhost:3000`）。
8. IPv4（四段全数字）或 `[...]` IPv6 → 跳过；裸 IP 不碰，只有显式 scheme 才 gate。
9. 小写、按 `.` 分段；每段 `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`（`xn--` 也满足；可选再用 `domainToASCII` 验证 punycode 可解码）；总长 ≤253，每段 ≤63；不允许空段、下划线、首尾连字符。
10. 末段必须在 `TLDS` 里；不在就跳过（`v1.2`、`1.2.3`、`config.toml` 都在这里被排除）。
11. 如果 `strong === false`（纯裸 host，没有 path/port/`www.`），末段在 `FILE_EXT_TLDS` 或 `PLACEHOLDER_TLDS` 里就跳过：
    - `FILE_EXT_TLDS`：至少 `py, md, sh, pl, rs, so, cc, zip, mov, toml`（`.toml` 目前不是 TLD，但先放进黑名单，防止将来委派）。
    - `PLACEHOLDER_TLDS`：`bar, foo`（`foo.bar` 这类代码占位符；`.bar`/`.foo` 是真实 gTLD，所以这是有意的取舍）。
    - 因为 `strong` 为 true 时不过黑名单，`main.py:8080`、`main.py/a`、`www.main.py` 仍会被识别；前两者带 port/path，本来就不像文件名，`www.` 则是强信号。真正的 `example.py` 裸域名会被漏掉，这是可接受的代价。
12. 通过后返回 `labels.join(".")`（小写、punycode、无尾点、无 port）；策略比较仍用 `host === h || host.endsWith("." + h)`。

#### 6.3 边界情况

- **尾点**：`example.com.` 去掉一个尾点后按 `example.com` 判 TLD/策略；`new URL` 会保留尾点，所以必须在取 host 后统一去掉。策略条目本身不允许尾点（`HOSTNAME_RE` 末尾必须是 `[a-z0-9]`），不归一化就永远匹配不上。
- **大写**：host 一律小写；`EXAMPLE.COM` 与 `example.com` 同策略。`new URL` 对显式 scheme 已小写；裸域名遍要自己 `toLowerCase()`。
- **IDN / punycode**：裸域名遍只接受 ASCII，所以 `xn--r8jz45g.xn--fiqs8s` 这种 punycode 可以；`例え.中国` 这种 Unicode 裸域名**故意不处理**（见 6.4）。显式 scheme 的 `https://例え.中国/a` 由 `new URL().hostname` 自动转成 `xn--r8jz45g.xn--fiqs8s`，可以正常 gate。
- **端口**：`example.com:3000` 识别为 host `example.com`；`localhost:3000` 因不含点被排除。`new URL("example.com:3000")` 的 `protocol` 是 `example.com:`、`hostname` 为空，这是必须补 `http://` 的原因。
- **userinfo**：裸 `user:pass@example.com` 跳过（含 `@`）；显式 `https://user:pass@example.com/a` 用 `URL.hostname` 取 `example.com`。日志/`permissionReason` 里不要回显原始 userinfo（现有 preheat 的 reason 会带原始 `url`，扩展时建议脱敏）。
- **email**：裸 `foo@bar.com` 含 `@`，跳过；GFM/CommonMark 的 email autolink 是独立规则，不参与 host allow/deny（除非产品另有 email 策略）。
- **裸 IP**：`1.2.3.4`、`1.2.3.4:8080`、`[::1]:3000` 裸形式一律跳过；只有 `http://1.2.3.4/...` 这种显式 scheme 才 gate（策略 host 就是 `1.2.3.4` / `[::1]`）。
- **`localhost`**：裸 `localhost`/`localhost:3000` 不碰；显式 `http://localhost:3000` 是 URL，照常 gate（通常不在 allowlist 里，会 ask）。
- **标点粘连**：`(example.com/a).`、`example.com/a,`、`example.com/a;`、`example.com/a]` 按 6.2 的 trim 规则只取 `example.com/a`；成对括号在 path 内（`.../a_(b)`）保留。
- **中文无分隔符**：`看example.com/a这个` 的 ASCII 候选串是 `example.com/a`；规则会识别 host `example.com`，但**不会**把 `看`/`这个` 放进 URL、也不会改写整段文本。如果产品语义要求“CJK 紧邻时整段不识别”，在裸域名遍加一个“前后字符是 CJK 则跳过”的开关；代价是漏掉嵌在中文里的 URL。建议默认“检出但不改写”，因为这是 gate，不是渲染。
- **文件扩展**：`main.py`、`README.md` 无 path/port/`www.` → 被 `FILE_EXT_TLDS` 拒绝；`src/main.py` 的 host 部分 `src` 没有点，也拒绝。`config.toml` 由 TLD 检查拒绝。
- **版本号**：`v1.2`、`1.2.3` 的末段 `2`/`3` 不在 TLD 表，拒绝；`1.2.3.4` 先被 IPv4 检查拒绝。
- **`foo.bar`**：纯裸 host，末段 `bar` 在 `PLACEHOLDER_TLDS`，拒绝。`foo.bar/a`、`foo.bar:8080`、`www.foo.bar` 仍会被识别；这是有意的，因为 path/port/`www.` 是强信号。代价：真实的裸 `something.bar` 域名不识别；写成 `www.` 或带 path 即可。
- **非 HTTP(S) scheme**：`mailto:`、`ftp:`、`xmpp:`、`irc:`、`file:`、`javascript:` 不进入 host 策略；`javascript:` 尤其不要因为“看起来像 URL”就去 fetch。当前 `https?://` 正则本来就不覆盖它们。
- **畸形 host**：`https://../` 这类 `new URL` 能过但 hostname 是 `..`，建议在显式 scheme 遍额外要求 host 至少有一个非空、非 `.`/`..` 的标签，避免把明显畸形的串送进策略。
- **下划线**：GFM 允许非末两段有 `_`，Node/WHATWG 也可能接受 `foo_bar.example.com`；但策略的 `HOSTNAME_RE` 只允许 `[a-z0-9.-]`，所以裸域名遍直接拒绝 `_`，显式 scheme 遍则取 host 后大概率 ask（无法命中 allowlist）。这是有意的收敛。

#### 6.4 故意不处理的形态

- 无 scheme 的 Unicode IDN 裸域名（`例え.中国`、`пример.рф` 的 Unicode 写法）；只处理 punycode。
- 非 `http(s)` scheme 的 URI（`mailto:`、`ftp:`、`xmpp:`、`file:`、`javascript:` 等）。
- 裸 IPv4/IPv6、裸 `localhost`/`localhost:port`。
- 被空白/换行拆开的 URL（`example.\ncom`）。
- 纯语义歧义：`foo.bar` 这种代码成员表达式，以及 `.bar`/`.foo`/`.py`/`.md` 等碰撞 TLD 的**裸**真实域名；需要 `www.`/path/port 才识别。
- CJK 紧邻的 URL 是否要跳过，取决于产品选择；本文建议“检出但绝不改写”，不把 CJK 吃进 URL。

## 误报清单

下表是 ticket 明确要求“绝不能碰”的输入，以及本规则的行为。这里的“不碰”指**不改写原文、不把它当 URL 去 fetch**；是否触发一次 ask 取决于它是否通过 host 规则。

| 输入 | 为什么危险 | 本规则行为 | 残余风险 |
|---|---|---|---|
| `main.py` | `.py` 是巴拉圭 ccTLD；文件名 | 纯裸 host，末段 `py` 在 `FILE_EXT_TLDS` → 跳过 | `main.py/a` 会被当 URL（有 path 强信号） |
| `README.md` | `.md` 是摩尔多瓦 ccTLD；文件名 | 纯裸 host，末段 `md` 在 `FILE_EXT_TLDS` → 跳过 | 同上，`README.md/a` 会识别 |
| `config.toml` | 配置文件；`.toml` 目前不是 TLD | 末段不在 IANA → 跳过 | 若将来 `.toml` 被委派，黑名单仍兜住 |
| `v1.2` | 版本号 | 末段 `2` 不在 IANA → 跳过 | 无 |
| `1.2.3` | 版本号 | 末段 `3` 不在 IANA → 跳过 | 无 |
| `1.2.3.4` | 裸 IPv4 | IPv4 检查 → 跳过（裸形式） | 显式 `http://1.2.3.4` 会 gate |
| `foo@bar.com` | 邮箱 | 裸域名遍因 `@` 跳过 | 显式 `mailto:` 不在 host 策略 |
| `localhost:3000` | 本地服务；无点 | 无点 → 跳过 | 显式 `http://localhost:3000` 会 gate |
| `foo.bar`（变量） | `.bar` 是真实 gTLD，语法上无法与域名区分 | 纯裸 host，末段 `bar` 在 `PLACEHOLDER_TLDS` → 跳过 | 真实裸 `something.bar` 被漏；`foo.bar/a` 会识别 |
| `看example.com/a这个` | 中文无分隔；朴素 `\S+` 会整段吞 | ASCII 候选串只取 `example.com/a`；CJK 不进 URL、原文不改 | 若要求“CJK 紧邻不识别”，需加开关；否则会检出 host |
| `(example.com/a).` | 标点粘连 | trim 后取 `example.com/a` | 成对括号在 path 内保留 |
| `example.com/a,` | 逗号粘连 | trim 逗号 | 无 |
| `example.com.` | FQDN 尾点 | 去尾点后按 `example.com` 判 TLD/策略 | `new URL` 保留尾点，必须手动归一化 |
| `EXAMPLE.COM` | 大小写 | 小写后判 `com` | `linkify-it` 默认输出保留大写，不能直接依赖它 |
| `xn--fiqs8s` | 只有 TLD 标签 | 少于两段 → 跳过 | 真实单标签 IDN 不存在 |
| `xn--r8jz45g.xn--fiqs8s` | punycode 域名 | 通过；host 为 punycode | Unicode 写法不处理 |
| `例え.中国` | Unicode IDN 裸域名 | 裸域名遍只收 ASCII → 跳过 | `https://例え.中国/a` 由显式 scheme 遍处理 |
| `example.com:3000` | 裸 host + port | 通过（port 是强信号），host `example.com` | `linkify-it` 不识别这种形式 |
| `user:pass@example.com` | userinfo/邮箱歧义 | 裸域名遍因 `@` 跳过 | 显式 scheme 会 gate host；注意日志脱敏 |
| `1.2.3.4:8080` | 裸 IP + port | IPv4 → 跳过 | 显式 scheme 会 gate |
| `[::1]:3000` | 裸 IPv6 + port | `[` 开头 → 跳过 | 显式 scheme 会 gate |
| `https://example.com/a_(b)` | path 内括号 | 显式 scheme 遍保留成对括号，取 host `example.com` | 未配对闭括号按 GFM 去掉 |
| `https://example.com/a).` | 未配对括号 + 点 | trim 后取 `https://example.com/a`，host `example.com` | 无 |

## 范围表

列的含义：

- **URL 可能出现？**：按该字段的语义和代码路径判断，不是“用户理论上能不能乱填”。
- **扫？**：是否对它做 URL/host 检出。
- **改写？**：是否允许把规范化结果写回该字段。本文的建议是**所有字段都不改写**；“否”表示连规范化写回都不做。
- **依据**：工具描述或代码行。

| 工具 | 字段 | 类型/语义 | URL 可能出现？ | 扫？ | 改写？ | 依据 |
|---|---|---|---|---|---|---|
| `search_web` | `query` | 搜索词，发给多个 provider | **是**（用户可能粘 URL、问某个页面） | **是**，仅检出 host | **否**：改 query 会改变 provider 的检索语义 | 描述 “Search the web through several providers at once”；`query` 直接进 `eng.retriever.search({ query })`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L29-L42)、[search-web](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/search-web.tool.ts#L58-L62)、[descriptions](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L165-L170)） |
| `search_web` | `mode` | 枚举 `fast/index/deep/answer` | 否 | 否 | 否 | 枚举，无 URL 语义（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L31-L37)） |
| `search_web` | `verticalDomain` | provider 侧 vertical id（如 `academic`/`finance`/`ip`） | 否（语义上是 id；schema 只查 `minLength`，值由上游 vocabulary 决定） | 否 | 否：改写会破坏路由 | 描述 “Vertical domain id routed provider-side”；`buildVerticalSpec` 只做形状检查（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L17-L26)、[search-web](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/search-web.tool.ts#L47-L51)） |
| `search_web` | `verticalSubDomain` | vertical 子域 id | 否（语义上是 id） | 否 | 否 | 同上（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L21-L23)） |
| `search_web` | `verticalParams` | `Record<string, unknown>`，provider 参数 | **是**（site/feed/URL 过滤值都可能） | **是**，递归扫字符串值 | **否**：改写会改变 provider 参数语义 | 描述 “Vertical sub_domain_params key/value map”；原样进 `buildVerticalSpec`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L24-L26)、[search-web](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/search-web.tool.ts#L47-L51)） |
| `research_web` | `question` | 研究问题；每轮作为 query 发送 | **是** | **是**，仅检出 | **否**：会改变每轮检索和最终引用 | 描述 “Run a deep research query...”；每轮 `query: round === 0 ? question : question + " (round N)"`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L51-L62)、[research-web](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/research-web.tool.ts#L64-L72)、[descriptions](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L165-L170)） |
| `research_web` | `depth` | 枚举 `brief/standard/deep` | 否 | 否 | 否 | 枚举（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L53-L59)） |
| `research_web` | `verticalDomain` / `verticalSubDomain` / `verticalParams` | 同 `search_web` | 同 `search_web` | 同 `search_web` | 同 `search_web` | 共用 `verticalSpecProps`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L17-L27)） |
| `recall_memory` | `query` | 本地 FTS5 召回词 | **是**（用户可能按 URL 找旧结果） | **否**（本地读，不按 host 抓取） | **否**：FTS5 会把 URL 拆词；补 scheme/去路径会改变命中 | 描述 “Search the local research archive (FTS5)”；`eng.store.searchMemory(query, lim)`；`fts5EscapeQuery` 先按 `[^A-Za-z0-9]+` 切成词（[recall](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/recall-memory.tool.ts#L30-L61)、[fts5](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/store/src/fts5.ts#L3-L20)、[descriptions](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L165-L170)） |
| `recall_memory` | `limit` | 整数 | 否 | 否 | 否 | `Type.Integer`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L73-L75)） |
| `recall_memory` | `projectPaths` | 本地项目根（绝对路径） | 否（URL 不是合法项目根） | **否** | **否**：改写会让项目索引查不到 | 描述 “Explicit project roots whose local index should be read”；`resolveRecallProjects` 要求 `isAbsolute`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L76-L80)、[project-index](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/project-index.ts#L50-L71)） |
| `query_knowledge` | `query` | 本地知识库/RAG 查询 | **是**（可能按 URL 找知识） | **否**（仅 `fts` 适配器，读本地研究档案） | **否**：走同一 FTS5 分词，改写会改变召回 | 描述 “Query the knowledge base through the retrieval adapter”；`rag.resolveInjection(domain, query, ...)`；`createFtsRagAdapter` 再调 `store.searchMemory(q, limit)`（[query-knowledge](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/query-knowledge.tool.ts#L35-L54)、[rag-adapter](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/rag-adapter.ts#L146-L152)、[descriptions](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L165-L170)） |
| `ans_chat` | `message` | 发给 agent 的用户消息 | **是**（agent 循环可能按消息里的 URL 取页面） | **是**，仅检出 | **否**：改写会改变用户意图、会话记忆和后续轮次 | 描述 “Run the anysearch agent loop”；`chatMessage = message?.trim()` 后 `runtime.run(chatMessage, attempt)`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L96-L100)、[ans-chat](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/ans-chat.tool.ts#L498-L505)、[ans-chat](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/ans-chat.tool.ts#L670-L677)） |
| `ans_chat` | `sessionId` | 服务端铸造的 opaque handle（1..128 visible ASCII） | 否 | **否** | **否**：改写会破坏 L1/L2 会话续接/consolidate scope | schema 明说 “Opaque session handle”；值故意不做 wire 约束（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L101-L111)） |
| `ans_chat` | `operation` | 枚举 `chat/consolidate` | 否 | 否 | 否 | 枚举（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L113-L118)） |
| `ans_chat` | `memoryIds` | 整数数组 | 否 | 否 | 否 | `Type.Array(Type.Integer(...))`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L119-L122)） |
| `ans_chat` | `allowSingleEvidence` / `dryRun` | 布尔 | 否 | 否 | 否 | `Type.Boolean`（[schema](https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L129-L137)） |

> 表里的“扫=否”是“**不做 host 策略扫描**”，不是“字段里不可能出现 URL”。`recall_memory.query` / `query_knowledge.query` 完全可能包含 URL 文本，但它们只进本地 FTS5/知识库；对一个不发网络请求的字段做 host gate，只会制造误报，而任何“补 scheme/去路径”的改写都会改变召回。若未来 `query_knowledge` 接入远程 adapter，再按那个 adapter 的网络行为重新评估，而不是现在预设。

### 关于“扫描实现”的一个直接建议

现在 `preheat.ts` 是 `JSON.stringify(input.toolInput ?? {}).match(...)`，等于把**所有**字段（包括 `sessionId`、`projectPaths`、枚举）都扫一遍。([preheat.ts#L186-L187](https://github.com/Xxx91n/anysearch-cli/blob/main/apps/plugin/src/hooks/preheat.ts#L186-L187)) 扩展裸域名后，这会把 `sessionId: "abc.def"`、`projectPaths: ["D:/work/example.com"]` 这类值误判成 host。建议改成**按工具/字段的 visitor**：只对范围表里“扫=是”的字段取字符串，`verticalParams` 递归遍历字符串值；其余字段不传给 URL 提取器。这样也避免把“改写后的副本”误写回参数。

## 来源

规范/标准：

1. CommonMark 0.31.2 §6.5 Autolinks（scheme 2–32、尖括号、Example 594–612）—— https://spec.commonmark.org/0.31.2/#autolinks
2. GFM §6.9 Autolinks (extension)（`www.`/`http(s)`/`ftp`/email 触发、valid domain 结构、尾标点规则）—— https://github.github.com/gfm/#autolinks-extension-
3. WHATWG URL Standard, URL parser / no scheme state（无 scheme 且无 base → failure）—— https://url.spec.whatwg.org/#concept-url-parser 、 https://url.spec.whatwg.org/#no-scheme-state
4. Node.js `URL` API（`new URL(input[, base])`、TypeError、WHATWG API）—— https://nodejs.org/api/url.html#new-urlinput-base 、 https://nodejs.org/api/url.html#the-whatwg-url-api
4b. cmark-gfm autolink 扩展源码（`valid_uris[]` 只有 http/https/ftp；`www_match()`）—— https://github.com/github/cmark-gfm/blob/master/extensions/autolink.c

TLD/后缀数据：

5. IANA Root Zone Management（“authoritative record of top-level domains”）—— https://www.iana.org/domains/root
6. IANA Root Zone Database —— https://www.iana.org/domains/root/db
7. IANA TLD 清单（`Version 2026112200`，1,435 条）—— https://data.iana.org/TLD/tlds-alpha-by-domain.txt
8. Public Suffix List 说明（public suffix 定义、ICANN/PRIVATE 分段、通配/例外）—— https://publicsuffix.org/list/
9. Public Suffix List 数据（`VERSION: 2026-11-21...`）—— https://publicsuffix.org/list/public_suffix_list.dat
10. `tlds` npm（IANA 派生；`update.js` 下载 IANA 并解码 punycode）—— https://www.npmjs.com/package/tlds 、 https://github.com/stephenmathieson/node-tlds 、 https://github.com/stephenmathieson/node-tlds/blob/master/update.js
11. `tldts`（TypeScript、PSL 驱动、`isIcann`/`publicSuffix`）—— https://github.com/remusao/tldts 、 https://www.npmjs.com/package/tldts

autolinker 库：

12. `linkify-it` README（默认 schema、`fuzzyLink`/`fuzzyIP`/`fuzzyEmail`、`.tlds()` 语义、默认 TLD 子集）—— https://github.com/markdown-it/linkify-it#readme
13. `linkify-it` 源码（`tlds_default`、`tlds_2ch`、默认 options）—— https://github.com/markdown-it/linkify-it/blob/master/src/linkifyit.ts#L106-L133
14. `linkify-it` CHANGELOG（6.0.0：`fuzzyLink` 默认关闭；Unicode 标点终止）—— https://github.com/markdown-it/linkify-it/blob/master/CHANGELOG.md
15. `linkify-it` 6.1.0 npm registry/tarball（实测版本）—— https://registry.npmjs.org/linkify-it/latest 、 https://registry.npmjs.org/linkify-it/-/linkify-it-6.1.0.tgz
16. markdown-it `new LinkifyIt()` —— https://github.com/markdown-it/markdown-it/blob/master/src/markdownit.ts#L119
17. markdown-it linkify 规则（`linkify:false` 直接 return；`validateLink`）—— https://github.com/markdown-it/markdown-it/blob/master/src/rules_core/linkify.ts
18. markdown-it default preset `linkify:false` —— https://github.com/markdown-it/markdown-it/blob/master/src/presets/default.ts#L19
19. markdown-it 15.0.3 依赖 `linkify-it ^6.1.0` —— https://github.com/markdown-it/markdown-it/blob/master/package.json

仓库代码（仓库 `main`；本地基线 `e20432d2de18819614c128e60cf2890fdbce792d`）：

20. `packages/kernel/src/tool-schemas.ts`：五个工具字段与描述 —— https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/tool-schemas.ts#L17-L170
21. `apps/plugin/src/hooks/preheat.ts`：URL 正则、`new URL`、host allow/deny —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/plugin/src/hooks/preheat.ts#L186-L230
22. `apps/mcp/src/tools/search-web.tool.ts`：`query` 进 retriever —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/search-web.tool.ts#L42-L62
23. `apps/mcp/src/tools/research-web.tool.ts`：`question` 每轮加 round 后缀 —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/research-web.tool.ts#L64-L72
24. `apps/mcp/src/tools/recall-memory.tool.ts`：本地 FTS5 recall/project fallback —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/recall-memory.tool.ts#L26-L61
25. `apps/mcp/src/tools/query-knowledge.tool.ts`：`rag.resolveInjection(domain, query, ...)` —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/query-knowledge.tool.ts#L35-L54
26. `packages/kernel/src/rag-adapter.ts`：`createFtsRagAdapter` → `store.searchMemory` —— https://github.com/Xxx91n/anysearch-cli/blob/main/packages/kernel/src/rag-adapter.ts#L146-L152
27. `packages/store/src/fts5.ts`：`[^A-Za-z0-9]+` 分词、FTS5 查询构造 —— https://github.com/Xxx91n/anysearch-cli/blob/main/packages/store/src/fts5.ts#L3-L20
28. `apps/mcp/src/tools/ans-chat.tool.ts`：`message` → `runtime.run` —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/ans-chat.tool.ts#L498-L505 、 https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/tools/ans-chat.tool.ts#L670-L677
29. `apps/mcp/src/project-index.ts`：`projectPaths` 必须是绝对路径 —— https://github.com/Xxx91n/anysearch-cli/blob/main/apps/mcp/src/project-index.ts#L50-L71
30. `packages/store/src/domain-schema.ts`：策略 hostname 只允许 `[a-z0-9.-]` —— https://github.com/Xxx91n/anysearch-cli/blob/main/packages/store/src/domain-schema.ts#L217-L224

实测环境（可复现）：

31. Node v24.22.1 `new URL(...)` 行为矩阵；`linkify-it@6.1.0` 默认表/IANA 表对比；`tlds@1.261.0` 与 `tldts@7.5.5` 的 `main.py` 行为。实验只在 `$TEMP` 解包 tarball，不涉及仓库改动或包管理器。
