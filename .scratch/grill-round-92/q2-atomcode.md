# R92 Q2 atomcode 调研归档 — T2 复跑凭证注入机制 + 宿主选型 + L3b 取证修订

> 存档 2026-09-29。调研本体经 ctx_batch_execute 派发（concurrency=1，串行纪律），全文 11 来源（8 全文读+3 摘要标），Confidence 高。

## TL;DR

推荐：Q-A pi-ai 自定义路由+隔离 profile；Q-B 0.1.7-rc.2；Q-C 接受等价通道但走 ADR revised 立法+判词降级；Q-D 现做法符工业惯例，加强=preflight 泄漏探针；Q-E 官方目录+capability 过滤为合法来源，本机 404 需先归因。

## 对比矩阵（pi-ai 路由 vs DEEPSEEK_BASE_URL env 覆写）

| 项 | pi-ai 自定义路由 | DEEPSEEK_BASE_URL env |
|---|---|---|
| 协议面 | openai-completions 与 featherless 原生面同构 | 锁 Messages 协议（protocol is not configurable），featherless 无 Anthropic 面 |
| 模型目录 | models:[{id,contextWindow}] 显式声明=冻结程序天然载体 | 无声明位 |
| 凭证 | apiKeyEnv 名引用 credential seam 按名解析，值不落盘 | env 直读，trusted-layers 限制（定义未公开） |
| 污染面 | 新 profile 层 provider 段，不动 deepseek-official | 全局副作用：所有 turn 被劫持到 featherless |
| 判据对齐 | L3a dump-config 可见新增 provider 行 | env 覆写不进 dump-config，装册证据弱 |
| 失败模式 | MISSING_CREDENTIAL 显式失败可归因 | baseURL 校验败/上游 404 混入判词 |

## Q-A：pi-ai 自定义路由 + 新建隔离 profile（推荐）

1. 协议同构硬约束：dsh-llm-deepseek 锁 Messages；featherless 官方只暴露 OpenAI 面。Anthropic-schema 客户端→OpenAI 面上游的翻译层有已知断点（tool calling 语义/cache_control/system 提升——modular handbook、futuresearch、anthropic-max-router 三源）。env 覆写=把 L3b/L3c 成败绑在未声明翻译层上，F-bug 风险从机制转移到协议、判词不可归因。
2. pi-ai 与 ADR-0092 D1 判据天然对齐：provider 段进 dump-config（L3a 装册腿强）；MISSING_CREDENTIAL 显式失败=凭证缺位可判。
3. 隔离 profile（r92-smoke）优于复用 headless：工业供应商 smoke 一致模式=隔离配置验证、失败不污染既有路由（agr_ai_curation provider smoke matrix、llm-proxy live-provider-smoke-tests）；L3a 冷启动全链复验语义只在干净 profile 成立。
反对论据裁定：DEEPSEEK_BASE_URL 隐藏依赖=featherless Anthropic 面，官方文档无 /v1/messages 端点→此路不可达，ADR 记 rejected 非备选。

## Q-B：宿主 0.1.7-rc.2

exact-build claim 下 README 只能写实测版本；0.2.0-rc.2 是跨 minor 平移，R89 已证 breaking-surface 且钉版未动（版本轴/消费轴正交：现钉版本上消费在架 API 不需版本轴动）。0.1.7-rc.2 保留 R91 同环境连续性、L3a 先例判词可承继，变量收敛到唯一（上游+key）。

## Q-C：L3b 等价通道——接受但走 revised 立法+判词降级

- 原则：确定性证据优先于模型依赖证据（ADK evaluate/raftlabs 三层/BuildPulse）。「transcript 出现 ans_* tool_call」是枚举发生的充分不必要条件（枚举=dsh-plugin 侧行为）。
- 三段式：①ADR-0092 D1 走 revised，主判据=载荷显性可见保留；②fallback 判据=载荷不可见但 transcript 现 >=1 个 ans_* tool_call 事件（实名+arguments）→ 记 established-via-fallback（新词汇须预注册进 D4 词汇表，一字不差纪律）；③README claim 措辞在 fallback 路径下收窄（枚举经 tool_call 侧证）。
- 反论据（保留）：替代方案=fallback 直接记 not-established+evidence 附注，零词汇改动。推荐有条件接受：L3b 立法意图是「枚举发生」非「取证通道存在」，通道缺失不应永久惩罚机制本身。

## Q-D：凭证卫生——符合惯例，加强=泄漏探针

- 十二要素 III+AWS/MSFT 惯例：env 存凭证合法；apiKeyEnv 名引用+seam 按名解析=12-factor×runtime-injection 混合（Doppler：runtime injection 为安全导向推荐档）；User-scope→子进程注入与 CI secrets.env 同构。
- 批评面不回避：env 经典风险=崩溃转储/日志整环境外泄。
- 加强按性价比：①preflight 泄漏探针=T2 判词加顺验，transcript 全文 grep key 值 SHA-256 前缀（非 key 本身）确认无泄漏；②env-scoped spawn 为可选（一次性冒烟不值 wrapper）；③命名建议 FEATHERLESS_API_KEY 与迁移态 ANS_LLM_API_KEY 解耦（本论被实测软化：用户已置 DEEPSEEK_API_KEY，apiKeyEnv 按名解析可直指之，无须另置名——但命名串线风险记档）。

## Q-E：模型 id 冻结——官方目录+capability 过滤，先归因

- 事实修正：官方文档明示 GET /v1/models 可匿名+支持 capabilities=chat,tool-use/context_length_min/available_on_current_plan 过滤，detail 返回 features.tool_use。本机 404 Gone 与之冲突→先归因再下「无法枚举」。
- 关键约束（题面未记录）：featherless 官方 Tool Calling 文档明示仅 Kimi-K2 与 Qwen3 家族原生支持 function calling；随便选型 L3c 会败且不可归因。
- 三层冻结程序：①合法来源=官方目录 /v1/models?capabilities=chat,tool-use；②id+contextWindow 跑前定死写入 ADR；③降级路径=文档点名模型（官方示例 Qwen/Qwen3-32B）+直连 chat/completions 验 tool-use——把「模型能 tool call」从 L3c 判词剥离，模型层失败!=dsh 机制失败。
- 判定法双条件：官方 capabilities 过滤 ∩ 直连探针实测 tool_calls 返回（q2bstudio：改 baseURL!=换供应商成功）。

## 信息缺口（如实登记）

1. featherless /v1/models 404 归因：官方文档与本机实测冲突无厂商 changelog 可查。【本地补证：/ 200+models 双态 404+completions 401→端点在服务面真实缺席，归因为厂商侧文档-实现漂移或计划门，降级路径走文档点名】
2. dsh credential seam trusted-layers 精确定义未公开（仅源码注释）；pi-ai 路径不受影响。
3. stream-json 是否含 model-request 载荷：R91 判 not-established，外搜无 dsh 公开取证文档；0.2.0 changelog 公网不可核验（同构缺口 ADR-0090 已记）。
4. established-via-fallback 词汇增补对 T5 机检影响=本地裁决项。

## 来源清单

featherless docs api-reference-models（2026-08-27，证伪枚举前提）/ featherless tool-calling 指南（Kimi-K2+Qwen3 家族约束）/ modular anthropic-compatible handbook / futuresearch llm-provider-quirks（2026-02）/ 12factor config / SO secrets-env 讨论 / Doppler store-secrets-as-code（2025-11）/ q2bstudio provider smoke（2026-07）/ anthropic-max-router GitHub / agr_ai_curation smoke matrix / llm-proxy live-provider-smoke-tests（2026-07，摘要引用）。
