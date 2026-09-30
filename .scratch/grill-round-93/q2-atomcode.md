# Q2 atomcode 调研归档 — T2 三跑执行设计

时间戳: 2026-09-30 | 题面: .scratch/grill-round-93/q2-prompt.txt | 命令: atomcode -p | 会话锚: f135ac7f-6eeb-45c9-bc82-331918c61f37

### 1) 执行摘要（Tl;dr）

**Confidence 高**：工业界对「预注册 fallback 链 vs 现场发明」有清晰共识——链必须**预先声明且对链上每一臂独立过判据**（Inworld 明文："Keep fallback arms behaviorally compatible… a system prompt tested against every model in the chain"），否则 failover 是拿可用性换保真度。R93 的 B1（预注册单链 [0905→Kimi-K2-Instruct]，换臂即 preflight 验 tool_calls + N 重置）恰好是社区规范形态；B2 是把单点故障当 kill criteria，过度惩罚。**contextWindow=32768 取托管值**有三重独立先例支撑（Inference-Gateway 的 runtime>provider>native 解析序、Tinker 官方承认 Kimi-K2 托管截断 32k、Kilocode 因声明错误上下文窗导致激进截断而 hotfix）。

### 2) 分点结论（逐子题裁决）

**a. profile 构建参数 — 推荐：按提案冻结，无修改。** Confidence 高。providers.featherless + openai-completions + baseURL/apiKeyEnv 声明模式在 R92 已 established；与 Inference-Gateway 的 `context_window` 解析序（runtime > provider-published > native，"this can be smaller than the model's theoretical maximum and is the limit clients must respect"）完全一致。唯一提醒：0905 模型页只写了 256K 原生能力、未展示托管 Context Size 列（JS 渲染），所以 32768 需在 preflight 用 `/v1/models` 或一次超长探针实证一次并记入 transcript，避免「目录值 vs 实际值」再漂移。

**b. B1 vs B2 — 推荐：B1（预注册单链），但加两条纪律条款。** Confidence 高。论据：
- 支持 B1：Inworld/TrueFoundry/getmaxim 三源一致——fallback 链是标准做法，且「链上每臂预跑同一判据」是行为兼容的前提；R92 的 Qwen3-32B 事故恰好证明「不 preflight 的臂」是灾难源，而 B1 的换臂前 preflight 验 tool_calls 正是把这条教训制度化。
- 反驳 B2：B2 把「托管目录抽风」和「dsh 机制故障」混为一个 F-bug 归因，违反 R92-Q2 已确立的「模型层失败 ≠ 机制失败」归因纯净原则。
- **稀释 kill criteria 风险的防线（必须入判据）**：① 链上第二臂的失败同样计入同一 N 预算（0905 耗 N → Instruct 重新获得 N=3，但两臂合计仍受「全灭即 F-bug+B 议程」硬顶——这正是你的 B1 描述，确认保留）；② 换臂必须写进 transcript（which model handled the request, why the switch occurred——nhimg 的 fallback 审计三件套），禁止静默降级到第二臂后仍声称在测 0905。
- 反方论据（记入 ADR）：inworld 指出第二臂同 provider 同故障域（featherless 上两个 Kimi 变体共享同一托管基础设施），B1 对「featherless 平台级故障」无免疫——但这不是坏事：R93 测的是 dsh 机制而非 featherless SLA，平台级故障落 F-bug 是正确的归因。

**c. 诱导句 — 推荐：复用 R91/R92 冻结句。** Confidence 中高。理由：
- eval 工程惯例（frontier-evals-harness、evalforge）一致：prompt set 版本化+哈希入 run artifact，跨 run 可比性的前提是「prompt 不动」。R91/R92 两轮已用同句，第三轮换句会同时破坏跨轮 transcript 可比性和「R92 签名复现」判据的语义（kill criteria ①判的就是同句同模型的失败复现）。
- 「句型对 Kimi 适配」的担忧证据不足：vLLM 博客实证 Kimi-K2-0905 在正确 chat template 下 tool-call 触发极强（官方 API 1286/1286 零 schema 错误），搜索请求句恰好是 ans_* 工具的最直接意图形态，不需要适配。
- 反方论据：若 0905 与 Instruct 两臂共用一句，而句子碰巧只对 0905 高效，会低估 Instruct——但 L3b/L3c 判据是布尔枚举（≥1 ans_* tool_call 事件），不是质量分数，敏感性差异不构成威胁。
- 条件性豁免：若两臂全灭需要归因，允许**事后追加**一个未冻结的适配句作为诊断探针（evidence, not verdict）——不计入 N、不参与判词，防止「换 prompt 凑绿」。

**d. contextWindow=32768 — 推荐：维持托管值，且这是四子题里证据最硬的。** Confidence 高。三独立信源：
1. Inference-Gateway 官方 API ref：解析序第一优先是「serving runtime 的配置窗，可以小于理论最大值，且是客户端必须遵守的限值」；
2. Tinker issue #296：Kimi-K2 Thinking 托管截断至 32k，官方回复承认并承诺后续放宽——证明 32k 截断是托管 SKU 的普遍选择，不是 featherless 独有；
3. Kilocode PR #5568（反例警示）：声明错误窗（该例是反向——把 32k 低估改 200k）导致激进截断毁掉会话，被迫 hotfix——证明 gateway 层 contextWindow 声明错误的真实后果是静默截断/错误预算。
Community 佐证（reddit r/openrouter 高票）："judge the exposed API limit, not the model's marketing limit"。**判定：托管 32768 是唯一正解；原生 256K 只出现在 capability 说明文，不进 pi-ai models 段。**

**e. r92-smoke 处置 — 推荐：冻结零触碰，无外部新证据需要修改此裁决。** Confidence 高。Kilocode PR 的教训反而是支持证据：证据工件被顺手「修复」会消灭对照组（该 PR 修完连原 issue #5566 的复现路径都需另行构造）。零成本裁决，照旧。

**f. deprecate — 推荐：记账增权限缺口类型字段，本轮纯备准核销。** Confidence 中。R93-Q1 报告缺口 #4 已指出 E401/E404 可能需要 org owner 转让级别的权限，本轮无权限则只记账不硬闯——与 fail-open 原则一致。字段建议按「credential-scope / maintainer / org-owner」三型枚举，避免下一轮再泛化。

**g. R92 签名族扩充（finish_reason=length + 空 content + 零 tool_calls 计入同一签名）— 推荐：采纳，这是本次调研最有价值的一条修正。** Confidence 高。证据：
- Together AI Kimi K3 官方文档明文：*"The reasoning trace and the answer share the same completion budget, and a tight cap spends the whole allowance on reasoning and returns empty or truncated `content`"*——这就是 Qwen3-32B 事故的机制本源，且 Kimi 系同样存在；
- Kimi API Platform thinking 文档：`reasoning_content` 也受 `max_tokens` 管控；
- HF Kimi-K2.5 discussion：间歇性「全部进 reasoning、tool call 失败、content=None」用户报告。
- vLLM 博客的补充教训（对 transcript 取证有用）：Kimi 在 prompt 格式受扰时会表现为 `finish_reason: stop` 纯文本续写而非结构化回复——即签名族其实有三形态（length+空 content / stop+纯文本续写 / 零 tool_calls）。
- **边界条款**：把 length 签名计入 N 之前，判词里应写明它是「模型能力面失败的等价表现」而非环境违规——若 preflight 探针本身就能复现 length 签名，应在诱导前就把 max-tokens/预算判据定死（如 thinking 模型需 ≥16k headroom 的官方建议），避免把「预算设小了」误判成「模型不行」。

### 3) 隐藏风险（调研新发现，未在你列出的清单中）

1. **多轮工具调用历史污染**（vLLM 博客 Problem 3）：Kimi-K2 依赖历史 tool_call ID 符合 `functions.func_name:idx` 格式，被污染历史会诱导其生成非法 ID → 整个合法调用被丢弃。dsh 三跑是单轮诱导，风险低，但若 transcript 重放或多轮，需检查 ID 规范化。**建议入 ADR 的 Known-Non-Goals。**
2. **未声明工具的幻觉调用**：vLLM 实测 0905 有 ~24% schema validation error（318/1325），主因是模型引用历史中出现过但本轮未声明的工具。Moonshot 官方 API 有 Enforcer 约束解码，第三方托管大概率没有。对 R93 的影响：L3c-min「至少一次真调用」不受威胁，但若出现调用**非 ans_* 工具**，不应计为 L3c 绿——建议判词明确「ans_* 载荷」而非「任意 tool_call」。
3. **模型页与 API 目录的值漂移**：featherless 模型页（我抓取的版本）只展示 256K 原生叙事，托管 Context Size 列 JS 渲染未捕获——即 R92-Q2 报告的「官方目录三层冻结程序」（`/v1/models` capabilities 过滤 + 直连探针双条件）仍是跑前必做步骤，32768 声明应以其输出为准而非页面。
4. **fallback 激活率审计**：buildmvpfast 的「secondary 承接 >5% 流量即 primary 有问题」提醒——三跑若出现 2 次以上换臂，即使最终绿了，也应触发 F-bug 复盘而非收工（链绿但 primary 不稳，机制面存疑）。

### 4) 完整来源清单

| 来源 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| TrueFoundry: Multi-Provider Failover | truefoundry.com/blog/llm-failover-load-balancing-provider-outages | Official/Comparative | 2026-06-08 | 失败分类学；fallback 换保真度论；429≠failover |
| Inworld: LLM Failover & A/B | inworld.ai/resources/llm-router-failover-and-ab-testing | Official | 2026 | **"fallback arms behaviorally compatible" 链上每臂过判据**——B1 直接依据 |
| nhimg: fallback vs failover | nhimg.org/faq/what-is-the-difference-between-llm-fallback-and-llm-failover | Official | — | 换臂审计三件套（record which model + why） |
| theroadtoenterprise: fallback layer | theroadtoenterprise.com/blog/model-agnostic-ai-layer-fallbacks | Comparative | — | 链上每臂跑同一 eval；availability vs bad-request 分类 |
| buildmvpfast: fallback strategies | buildmvpfast.com/blog/llm-fallback-strategies-primary-model-secondary-model-2026 | Comparative | 2026 | fallback 激活率审计阈值；链需季度复审 |
| Inference-Gateway REST API ref | docs.inference-gateway.com/api-reference/ | Official | — | **context_window 解析序 runtime>provider>native** |
| Tinker issue #296（Kimi-K2 Thinking 32k 截断） | github.com/thinking-machines-lab/tinker-cookbook/issues/296 | Criticism | 2026-01-09 | 官方承认托管截断 32k，承诺加 max_context_length API |
| Kilocode PR #5568 | github.com/Kilo-Org/kilocode/pull/5568 | Criticism | 2026-02-21 | contextWindow 声明错误→激进截断的 hotfix 反例 |
| r/openrouter 长上下文讨论 | reddit.com/r/openrouter/comments/1tmfesy | Community | 2026-05-24 | "judge the exposed API limit, not the marketing limit" |
| vLLM 博客：Kimi K2 tool-calling 调试 | vllm.ai/blog/2025-10-28-kimi-k2-accuracy | Official | 2025-10-28 | **0905 template 兼容史；历史 ID 污染；未声明工具幻觉 24%；stop 纯文本续写形态** |
| Together AI Kimi K3 quickstart | docs.together.ai/docs/kimi-k3-quickstart | Official | — | **reasoning/content 共享 max_tokens 预算 → 空 content 机制** |
| Kimi API Platform thinking docs | platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model | Official | — | max_tokens ≥16k headroom 建议 |
| HF Kimi-K2.5 discussion | huggingface.co/moonshotai/Kimi-K2.5/discussions/52 | Community | — | 间歇 reasoning 吞 content 用户报告（佐证 g 签名族） |
| Arize: Evaluate Tool-Calling Agents | arize.com/blog/how-to-evaluate-tool-calling-agents/ | Official | 2026-03 | tool selection vs invocation 分离测量——L3b/L3c 分工佐证 |
| frontier-evals-harness | github.com/jsp2195/frontier-evals-harness | Official | — | prompt set 版本化+哈希入 artifact；跨 run 可比性惯例 |
| featherless 0905 模型页 | featherless.ai/models/moonshotai/Kimi-K2-Instruct-0905 | Official | — | 256K 原生叙事 vs 托管列 JS 渲染缺口（值漂移风险） |

## contextWindow hosted SKU 32768

### 5) 信息缺口

1. **featherless 上 0905 的实测 units/req**：R93-Q1 缺口 #1 仍未闭合（页面未展示计费列），preflight 前查 `/v1/plan` 或按 4 units/req 假设执行。
2. **0905 在 featherless 托管栈的 chat template 是否已修**：vLLM 博客的三个问题均在 HF tokenizer 更新后解决，但 featherless 的 serving 栈是否跟进未知——好在裸探针已实证 tool_calls 正常，此风险已被你们的探针消解。
3. **Kimi-K2-Instruct（非 0905）的 tool_calls 未专测**：B1 换臂前 preflight（你的设计已含）是唯一防线，无法提前外部验证。
4. **featherless 托管是否部署 Enforcer 类约束解码**：无公开文档，按「无」假设处理即可（对应隐藏风险 #2 的判词收窄）。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume f135ac7f-6eeb-45c9-bc82-331918c61f37
