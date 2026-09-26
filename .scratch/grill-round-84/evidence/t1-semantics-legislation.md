# T1 语义立法 — A-02 / A-04（Red 阶段语义决策，非实现细节）

> 立法先于断言（Pact Golden Rule）：断言只许依赖立法后行为。本档是
> expected.vertical* 断言键的独立真理源；ADR-0085 起稿时并入草案段。

## A-02 — 三入口错形行为立法

**裁决方向：fail-fast 拒收报错**（CLI/TOML 对齐 MCP「拒收报错」），不取
「忽略+显式 warn」。

**理由**：(1) 现状主导方向已是 fail-fast——MCP 走 AJV schema 拒收+依赖约束
报错文案，CLI 对 params 非 Record 已 exit 2，TOML 对空 domain/sub_domain 已
throw；取 warn 方向是反向放宽，违背「先严后松」。(2) 仓内先例：ADR-0045 D2
sources.weights 配置错形 fail-fast at load、provider 运行时 fail-open——配置
边界严、运行时宽的既有分层。(3) warn 方向会放过「错形静默」类（TOML 未知键、
CLI 空串 domain）——恰是本立法要消灭的失败模式。

**立法后的行为矩阵**（错形类 × 三入口 → 全格 fail-fast）：

| 错形类 | CLI | MCP 工具面 | TOML sources.vertical |
|---|---|---|---|
| sub/params 无 domain | exit 2（既有） | error 文案拒收（既有） | domain 缺席即 throw（既有） |
| domain 空串 | **新增** exit 2 | AJV minLength:1 拒收（既有） | throw（既有） |
| sub_domain 空串 | **新增** exit 2 | AJV minLength:1 拒收（既有） | throw（既有） |
| flag 无值 / 值以 `--` 开头 | **新增** exit 2 | n/a | n/a |
| params 非 JSON/非 Record | exit 2（既有） | AJV Record 拒收（既有） | n/a（TOML 不承载 params） |
| sources.vertical 未知键 | n/a | additionalProperties:false（既有） | **新增** throw 指名键 |

**MCP「拒收报错」形态**：仓内工具层错误惯例 = `content:[{type:"text",
text:"<tool> error: ..."}]`（不设 isError——与本文件既有 error 路径同构，
见 search-web.tool.ts catch 分支）。保持不变。

**显式范围外**：engine 层对 `q.vertical` 继续信任 TS 类型（程序化调用面不
重校验）；词表合法性仍归上游权威（unknown domain 不本地拒收——ADR-0084
D-006 既有裁定不动）。

## A-04 — sub_domain_params:{} 空参 wire 语义立法

**裁决：空参 ≡ 缺席（empty ≡ absent）**——`params` 仅在「非空 Record」
（≥1 键）时序列化上 wire；`{}`、非对象、数组一律 canonical 化为缺席。

**理由**：(1) 空对象不带信息——发送 `{}` 与不发在语义上等价，选「不发」使
wire 面保持 canonical（protobuf/JSON API 惯例：empty map ≈ unset）；
(2) `params_keys` 断言真理源据此自洽——canonical 化后 `params_keys=[]` 与
wire 键缺席同义，断言永远反映真实 wire 语义；(3) fail-first 不受影响——
合法 params（≥1 键）照常下发。

**canonicalization 单点**：`canonicalizeVertical()`（packages/retriever
contract.ts，纯函数）——engine 解析 `q.vertical ?? repoV` 后调用，CLI/MCP
入口构 vertical spec 时同调（echo 面展示 canonical 形=实际下发形）。

**衍生行为**：CLI `--vertical-params '{}'` → params 键从 vertical spec 消失
（不是错误——空对象是合法 Record，只是 canonical 后无 wire 足迹）；MCP
`verticalParams:{}` 同。`params:{}` 显式出现在仓内 golden 条目 = 合法断言
载体（钉 canonicalization 的确定性用例）。
