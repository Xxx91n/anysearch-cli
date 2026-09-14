# 深调研报告：install-smoke 离线腿重设计（offline 断言的真实对象是什么）

> atomcode q4 · 2026-09-14 · grill-round-62 Q4（install-smoke offline leg A/B/C）
> Sufficiency Gate：searches 6（Tavily×3/Exa web×2/AnySearch×1）；angles 五类；full reads 7；本地逐行取证（账本 R62 D-001~D-003、R61 全账、ADR-0057/0060/0061/0062、install-smoke.mjs、anysearch.ts、engine.ts、search.ts、CI workflows）

## 1) 执行摘要（Tl;dr）

**推荐 A，但断言形状必须改写**：加 `ANYSEARCH_ENDPOINT` env 覆盖（工业惯例充分支持），offline 腿指死端口做真故障注入；**但断言不能是「exit 1 + Results: 0」**——本地取证证明死端口在 docs 域活跃下产生的是 **abstain / exit 0**（R61 D-003 的一等公民契约），断言应锚 `--json` 的结构化 `abstain:true` + `providersFailed` 含 anysearch。方案 B 按原述（免 key 断言出真结果）**被产品契约本身证伪**：无 key 时只有 anysearch 单臂、`domainFilterSupported=false`、匿名结果不在 docs allowlist → post-filter 全灭 → 结构性 abstain，「出真结果」断言在 docs 域下不可满足，且让阻塞 CI 绑死匿名限速端点。C 的探针可作后续增值（与本仓 Non-Blocking Conformance Heartbeat 同构），MVP 不必。**与账本的显式冲突点：候选 A 原始表述中隐含保留的旧契约（exit 1 + Results: 0）与 R61 D-003 直接冲突，落地时必须以 abstain 契约替换**；除此之外推荐与全部 current 决策一致。Confidence：高。

## 2) 分点结论

**2.1 前提证伪成立，且比描述的更深一层（本地，高置信）**
- `anysearch.ts:16,49-52`：endpoint 硬编码、apiKey 可选、构造不抛错；`composition.ts:30` try/catch 跳过只对会抛错的 provider 生效——CI 无 key 时 anysearch 恒注册，Tavily/Exa 被跳过。offline 腿（install-smoke.mjs:104-107）断言 `code===1 && Results: 0`，真实路径是 anysearch 匿名出真结果 → exit 0 + Results>0 → 双断言红。注释宣称的「documented offline behavior」自 R61 T1 落地起就是 LyingDocs 式幽灵契约。
- 更深层：即使制造了 provider 全灭，旧断言仍不成立。`engine.ts:554-556`：`domainActive && allResults.size===0` → envelope 带 `abstain{gate:"pre"}`；smoke 序列先 `ans domain docs`（ANS_DOMAIN 经 config-env 回灌）→ CLI abstain → **exit 0** + abstain 行。「exit 1 + Results: 0」只存在于「domain 不活跃 + 零结果」路径；`engine.ts:274-275` 的 `No providers registered` throw 是另一条配置错误路径。旧契约三个组成部分（无 key 前提 / 全灭路径 / 断言形状）没有一个是当前现实。

**2.2 方案 A：endpoint env 是成熟惯例，死端口是标准故障注入（外部，高置信）**
- Endpoint-override env 惯例：HF `HF_ENDPOINT`（constants.py 源码级）、Claude Code `ANTHROPIC_BASE_URL`、OpenAI Agents SDK `OPENAI_BASE_URL`、transformers.js PR #1713。命名 `<PRODUCT>_ENDPOINT` 即惯例形。落地成本极低：anysearch.ts 构造器已接受 endpoint 参数，接线 = `endpoint ?? process.env.ANYSEARCH_ENDPOINT ?? ANYSEARCH_ENDPOINT` 一处。与 ADR-0059 D7（api.anysearch.com ownership deferred）无冲突——默认值不动，反解除测试对生产端点的绑死。
- 死端口 = fault injection 最小形态：Microsoft 工程手册 / totalshiftleft / oneuptime 均把「集成层模拟不可达端点」列为 CI 内标准做法（Toxiproxy/WireMock 同族），无需真断网。
- **A 的断言必须重写**：offline 腿设 `ANYSEARCH_ENDPOINT=http://127.0.0.1:<未监听端口>` 跑 `ans search --json`，断言 `abstain===true`（docs 域）且 `providersFailed` 含 anysearch、`results.length===0`。附赠结构性收益：**锚 stdout 结构化字段而非 exit code，正好绕开 R62 D-003 在修的 0xC0000409 teardown 崩溃改写 exit code 的已知缺陷面**。与 R61 D-003「断言锚定结构化 verdict 字段，禁关键词 regex」完全同向。
- no-results（exit 1 + Results: 0）负路径契约：留在 stub 单测层——search-abstain.ts 本就是 pure 可单测面，且 R61 判据 3 已承诺 anysearch degradation golden（stub provider, offline-runnable per ADR-0057 D4）。与 ADR-0061 D3 B2 行「offline 用 fixture、URL 硬断言归 online 层」分层一致：**阻塞安装冒烟里从来不放网络行为断言**。

**2.3 方案 B：按原述不可实现，且方向与账本相反（高置信）**
- 不可实现：免 key 通道在 docs 域下真实契约是 abstain exit 0。B′ 变体（断言 abstain）可行但与 A 形状趋同，而 A 不依赖外网。
- 方向冲突两处：① 阻塞 job 依赖 api.anysearch.com 匿名限速（anysearch.ts:6 注释自认 "Anonymous has lower rate limit"）→ CI 高频触发 429 间歇红，正是 ADR-0057 网络封印纪律要消灭的；② 与 ADR-0061 D3「offline 层用 fixture、URL 硬断言归 online 层」分层相反。

**2.4 方案 C：探针部分与本仓先例同构，作为可选二期**
- 非阻塞「报告存在但不阻断 + baseline 治理」心智模型本仓已有成文先例：CONTEXT.md Non-Blocking Conformance Heartbeat（ADR-0020 D2/D6）。keyless 匿名探针可挂同一模式。**但注意 GitHub 已知坑**（Ken Muse + actions/toolkit #1739）：job 级 continue-on-error 的 needs.result 报 success、UI 红绿语义混乱——探针要真可见需 outcome 透传额外接线。MVP 阶段收益边际，不建议现在做。

**2.5 install-smoke 的 pack→install 骨架本身有 npm 官方先例背书，不需要动**
- npm statusboard #679：npm 自己的 smoke test 就是 pack + install tarball；SO #50206729 同构。本仓七包 pack→clean prefix→drive bin 的结构与业界一致；病只在 search 腿。

## 3) 对比矩阵

| 项 | 断言真实性 | 网络依赖（阻塞 CI） | 与账本 current 冲突 | 落地成本 |
|---|---|---|---|---|
| **A（推荐，断言改 abstain 契约）** | 真故障注入，锚结构化 abstain | 零（死端口） | 无——前提是断言弃用 exit 1+Results:0；保留旧契约则与 R61 D-003 直接冲突 | 低：env 一行接线 + smoke 腿重写 + ADR 承载 |
| B（免 key 实测） | docs 域下断言不可满足 | 高：绑死匿名限速端点，429 间歇红 | 与 R61 D-002/D-003 矛盾；与 ADR-0057 网络封印、ADR-0061 D3 分层相反 | 表面最低，实际不可落地 |
| C（A + keyless 探针） | 同 A + 观测增值 | 主体零；探针外部但非阻塞 | 探针与 heartbeat 先例同构；需处理 continue-on-error 可见性坑 | 中 |

## 4) 完整来源清单

| 标题 | 角度 | 贡献 |
|---|---|---|
| huggingface_hub constants.py（raw 全文） | Official | `HF_ENDPOINT` env 覆盖的源码级实现模式 |
| HF issue #2152 | Community/Criticism | env 覆盖必须在加载时生效的语义细节 |
| transformers.js PR #1713 | Community | JS 生态同模式 PR（后被 #1717 吸收） |
| Claude Code env-vars 官方文档 | Official | `ANTHROPIC_BASE_URL` 官方定义与空值=unset 语义 |
| OpenAI Agents SDK config | Official | `OPENAI_BASE_URL` 官方惯例 |
| Autonoma: Automated Smoke Testing Blocks a Bad Promote（全文） | 方法论 | gate vs advisory 结构判据；exit-code 三分契约；exit code 断言脆弱性 |
| npm statusboard #679 | Official 先例 | npm 官方 smoke = pack + install tarball |
| Ken Muse / actions/toolkit #1739 | Criticism | continue-on-error 的 needs.result/UI 可见性坑 |
| Microsoft 工程手册 / totalshiftleft / oneuptime | 方法论 | CI 内模拟不可达端点 = fault injection 标准做法 |
| SO #50206729 | Community | pack→install 冒烟同构先例 |
| 本地 | 实物 | R62/R61/R60 账本、ADR-0057/0060/0061/0062、install-smoke.mjs、anysearch.ts、engine.ts、search.ts、composition.ts、ci.yml/ship-gate.yml |

## 5) 信息缺口

1. R61 判据 3 的 anysearch/brave degradation stub golden 是否已随 T4 落地未验证——若已有，A 的 no-results stub 断言直接挂那里，零新增测试文件。
2. 「安装冒烟内做 endpoint 死端口隔离」无逐字同名先例——结论建立在 fault-injection 通例 + endpoint-env 惯例的组合上。
3. R62 D-003 修复落地后，offline 腿是否补 exit-code 断言可重新评估——当前建议刻意只锚 stdout 结构化字段。

**一句话落地清单**：① anysearch.ts endpoint 参数接线 `ANYSEARCH_ENDPOINT`（一行）；② install-smoke offline 腿改死端口 + `ans search --json` 断言 `abstain:true && providersFailed∋anysearch && results.length===0`，删除 exit 1 + Results: 0 旧断言；③ no-results 契约留 stub 单测层（挂靠 R61 判据 3 golden）；④ ADR 显式记录与 R61 D-003 的契约替换关系（abstain exit 0 取代 exit 1）。
