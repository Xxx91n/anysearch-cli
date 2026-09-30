# Q1 atomcode 调研归档 — R93 主轴裁决

时间戳: 2026-09-30 | 题面: .scratch/grill-round-93/q1-prompt.txt | 命令: atomcode -p | 会话锚: c55f1fcb-3aa6-49cb-a110-0d7ec5b2383d

# R93 主轴裁决调研报告

**Sufficiency Gate**: searches: 7 | angles: Official / Comparative / Criticism / Community / Currency（5 类全覆盖）| full reads: 6 | gaps: ①三态判决（opt-in/default-off/remove）无单一权威框架，由 feature-flag 生命周期实践 + GitHub 日落政策拼合，标注为拼合结论；②「同一目标三次尝试」无直接工业先例文，由 sunk-cost 判据文 + failover 工程文外推，已标注。

## 1) 执行摘要（Tl;dr）

**推荐 A【换模三跑】为主轴，附预注册 kill criteria 和一条硬性 rider**：B（垂域死刑复核）下一轮强制开庭，不得再候审。Confidence **中高**——理由：A 与前两轮复跑有本质区别（根因各不相同且本轮阻塞源已被裸探针实证解除，符合「反转测试」：若今天从零开始，答案是「明知上游可用的三跑，成本 N≤3」，而非「继续撞墙」）；但 A 必须自带止损结构，否则三跑不绿即自动转入 B，把 r88-candidate 的候审轮数从 4 变 6 的风险被结构性封死。

## 2) 分点结论

**结论 1：A 不是 sunk-cost 陷阱——判据是「根因是否更换」而非「尝试次数」。**（来源：docs.rs episteme sunk-cost 词条全文；equalexperts/iRonin 佐证）

工业界对「何时该放弃重试」的成熟判据有三条，逐一对照本仓：

| 判据 | 文献表述 | 本仓 R91→R92→R93 实况 |
|---|---|---|
| 预注册 kill criteria | "Establish predefined kill criteria before they begin" | 已有：N≤3 且严格串行（ADR-0092/0093 立法）✓ |
| 根因是否在更换 | "对比未来成本收益，而非过去投入" | R91=凭证缺失（已修）→ R92=上游 Qwen 服务异常 → R93=换 Kimi-K2-0905（探针实证 tool_calls 200）——每次失败原因不同且可归因，是**系统性排障收敛**而非重复撞墙 ✓ |
| 反转测试 | "If we had not already invested, would we start today?" | 会：今天启动一轮 T2，模型选型证据已齐备，边际成本极低（profile 复用、判据全套现成）✓ |

关键反证也已防住：sunk-cost 词条的 Common Misreadings 节明确警告「把每次延续都当陷阱是危险误读——有些事确实接近完成，收尾成本相对收益很小」。本轮恰好是这种情形：**判据、profile、预注册措辞全部就绪，唯一缺口（可用模型）已被本日裸探针填上**。三跑不是第四跑，是新证据驱动的首次「在已知可用后端上」的跑。

**结论 2：retry-with-different-backend 是成熟可靠性工程先例，且文献明确区分「同端点重试」与「换后端 failover」。**（来源：TrueFoundry 2026-06 全文；Portkey 2025-09 全文；dev.to "Every Way LLM Provider Failover Breaks" 佐证）

TrueFoundry 的失败分类学直接命中本仓两次 F-bug 的形态学：R91 属配置/凭证类（fail-open 修配置即解），R92 属上游硬故障（"hard 5xx / no_response"——文献的处方是**换 provider/model，不是同端点退避重试**）。Portkey 把 status-code 触发的 failover 列为标准策略之一。本仓的「换模三跑」= 把 failover 思想从生产网关移植到验收冒烟：R92 那次复跑失败后**不换模型就是错误操作**。同时文献警告 failover 不是免费的——"validate the fallback's output too"——Kimi-K2-0905 恰好已通过裸探针验证产出合法 tool_calls 载荷，这一步已提前完成。

**结论 3：README 宣称与实物漂移的治理模式 = 「图章必须锚定一次真实验证」是工业共识，且悬空图章的半衰期随轮次递增。**（来源：Nexus Agents Claims Registry 全文；Lespinasse verify-readme-features 全文；franken_engine CLAIM_TO_PROOF_MATRIX 佐证）

三个独立信源给出同构模式：
- Nexus Agents：claim 必须绑定 verification recipe，无法指向活体真相的 claim 要么软化措辞要么标 stale——stale 是显式状态。
- Lespinasse：README 漂移是默认路径；文档≠证据（反对合成标的）。
- franken_engine：claim 语言强度分级门（锚定纪律立法的先例）。

**结论 4：B 的无限候审违反日落治理基线，应设硬截止。**（来源：Vercel feature-flags 全文；GitHub API 版本政策；Unleash flag docs；GitHub npm hooks sunset 先例）

Vercel 对 flag/特性搁置的病理学诊断："the off-state may already be broken, the original author has moved on, and nobody has standing to own the removal"——r88-candidate 连续四轮候审正是此形态：负面证据（净胜率 -0.125/P=0.0378 direction-negative 真阴性）已 stat 显著，每拖一轮，判决所需的 context 重建成本上升、且判决紧迫性被「挂下轮」惯例钝化。GitHub 的政策基线是：deprecation 必须有明确通知期与 sunset 日期（RFC 8594 Sunset header，24 个月硬窗），**从未有过「无限期候审」这个状态**。Unleash 的 stale 标记机制同样要求 stale 态带 Dashboard 可见性与处置期限。

但 B 的机会成本同样真实：B 零外部凭证依赖，随时可开——这意味着**它不因等待而增值**，反而因 A 占用一轮而确定加一轮。唯一让 B 优先的理由是「A 三跑再失败」，而这一点可以被 kill criteria 结构化解决。

**结论 5：C 的「轻收口」是伪渐进——合成标的 + 条件票 = 两条债都不减半衰期。**（综合结论 3/4 推出）

C 的 readme-token 首跑若无 README 真改动，只能造合成标的——文献视角下这是「为跑检查器而跑检查器」；T2 降为纯条件票意味着 T2 债的实质推进为零；锚定纪律立法有独立价值但不足以撑起一轮主轴。C 唯一胜出场景：用户明确表示本周无法提供 deprecate 权限账号且不愿再碰凭证类操作。

## 3) 对比矩阵

| 项 | 外部依赖 | 债务核销面 | 失败后果 | 文献契合点 |
|---|---|---|---|---|
| **A 换模三跑** | featherless 凭证（已在手）+ 严格串行（4 units 配额） | T2 债（可结）+ README 漂移（可结）+ 机器腿首跑（真标的）+ deprecate（条件） | 三跑不绿 → 按 kill criteria 转 B，本轮净损失 1 轮 | failover-换后端（TrueFoundry/Portkey）+ 预注册 kill criteria（sunk-cost 判据） |
| **B 死刑复核** | 零 | r88-candidate（4 轮候审结案）+ corpus-param 修格 | live-verified 悬空至第 4 轮，T2 债进第 3 轮 | GitHub 日落政策（无无限候审态）+ Vercel "nobody has standing" 病理 |
| **C 轻收口** | 低 | 机器腿（合成标的，弱）+ 锚定纪律立法 | T2 债原地，r88 候审至第 5 轮 | 渐进收口无文献支持；「条件票」= Vercel 所述 removal 永远不发生的结构成因 |

## 4) 明确推荐

**主轴 = A【换模三跑】，附四条预注册结构**（全部有文献锚点）：

1. **Kill criteria 预注册**（episteme 判据）：三跑中任一跑复现 R92 签名（server_error/no_response/零 tool_calls）即计入 N；N=3 不绿 → 本轮就地降级为 F-bug 登记 + **立即在本轮内启动 B 的开庭议程**（不让 B 再候审）。这把「A 陷阱」的最大风险——失败后再拖一轮——结构性封死。
2. **profile 新建优于复用**（TrueFoundry："extra keys inside one org usually share a quota"）：r92-smoke profile 若绑定旧模型/旧 base-url 状态，复用会引入隐性耦合；新建 r93-kimi profile 使本轮证据链独立可归因（与 R91/R92 判词的可区分性一致）。此点建议在 ADR-0094 里显式裁决而非默认。
3. **串行纪律写入判词前置条件**：4 units 并发上限 → preflight 与诱导轮之间加显式串行断言，429 出现一律判环境违规重跑而非判据失败（避免把配额错误算进 N）。
4. **Rider（A 绿才触发）**：README 双语行按 ADR-0093 预注册措辞誊抄 + 机器腿首跑（真标的）+ deprecate 再试。A 不绿则 rider 全部顺延，本轮不硬凑收口。

**B 的处置 = 设硬截止而非无限候审**：在 R93 账本里给 r88-candidate 写入 sunset 条款（仿 GitHub 24 个月窗的精神，落到轮数：R95 前必须开庭，无论 T2 状态如何）。这同时消解了「B 再拖一轮」和「A 变陷阱」两个风险——两个债务方向都有了时间盒。

**反驳论据预演**：
- *「三跑是沉没成本谬误」*——不成立：谬误的判据是「根因不变地重复」，本轮根因链已收敛且阻塞源被实证移除；文献原话支持这种情况下的延续（"close to completion, cost to finish is small"）。
- *「B 零依赖应先做」*——B 的价值不因等待增长，而 A 的窗口依赖（上游模型可用性、用户凭证状态）会过期；机会成本方向恰好支持 A 先行。
- *「C 最稳妥」*——C 的合成标的违反本仓自己预注册的图章定义（live-verified 必须对应真实转写），是用形式合规稀释实质验证。

## 5) 信息缺口清单

1. **Kimi-K2-0905 在 featherless 上的计费/units 消耗**：裸探针实证了功能面（tool_calls 200），但该模型是否仍按 4 units/请求计费未实证——若同耗 4 units，串行纪律按现设计即可；若更低，可放宽。建议 preflight 前查一次 plan 文档。
2. **Kimi-K2-0905 的 reasoning 形态**：Qwen3-32B 的问题是 reasoning 形态吞掉 tool_calls 预算；Kimi-K2 系列是否零 reasoning 或混合形态未在探针中专门观测——若诱导轮出现 finish_reason=length 仍需 max-tokens 预算调整判据。
3. **r92-smoke profile 与旧上游的耦合深度**（决定结论中第 2 条建议的力度）：需要本地核对该 profile 的 dump-config 是否硬编码了 Qwen 模型名。
4. **deprecate E401/E404 的具体权限缺口类型**：若是 npm 账号本身无 maintainer 权限，用户亲触 + EOTP 也未必够，可能需要 org owner 转让——建议本轮把「缺什么权限」作为记账字段而非笼统「权限闸」。

## 6) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| Claims Registry Guide (Nexus Agents) | nexus-substrate.github.io/nexus-agents/docs/development/claims_registry/ | Official | — | claim→verification 绑定模式；stale 态立法 |
| Why your feature flags pile up (Vercel) | vercel.com/i/feature-flags-code-lifecycle | Criticism | 2026-07-12 | 搁置债的结构成因；"nobody has standing" 病理 |
| Multi-Provider Failover (TrueFoundry) | truefoundry.com/blog/llm-failover-load-balancing-provider-outages | Official/Comparative | 2026-06-08 | 失败分类学：硬故障→换后端而非重试；quota 共享陷阱 |
| Sunk Cost Fallacy (episteme crate) | docs.rs/episteme/.../sunk-cost-fallacy.md | Official | — | kill criteria 预注册 + 反转测试 + 误用警告 |
| Failover routing strategies (Portkey) | portkey.ai/blog/failover-routing-strategies-for-llms-in-production | Comparative | 2025-09-18 | status-code 触发 failover；failover 需验证 fallback 输出 |
| Verify README Features Skill (Lespinasse) | romainlespinasse.dev/posts/verify-readme-features-skill | Community | 2026-04-02 | README 漂移是默认路径；文档≠证据（反合成标的） |
| GitHub API versioning/deprecation 政策 | docs.github.com/en/rest/about-the-rest-api/api-versions | Official | 2026 | 24 个月硬窗 + Sunset header；无无限候审态 |
| Technical Debt Strategies (Coderio) | coderio.com/blog/.../technical-debt-strategies-business | Comparative | 2026 | 债务排期按「阻塞面 × 复发率」而非先来后到 |
| Every Way LLM Failover Breaks (dev.to) | dev.to/kuldeep_paul/... | Criticism | 2026-09-09 | 同端点 retry vs failover 区分佐证 |
| Sunsetting npm Hooks (GitHub Changelog) | github.blog/changelog/2024-07-16-sunset-notice-npm-hooks-api-endpoints/ | Currency | 2024-07-16 | 低用量特性「直接 sunset」先例（对应 B 的移除选项） |
| Unleash flag docs | docs.getunleash.io/concepts/feature-flags | Official | — | stale 态 + Sunset 90 天期限机制 |
| franken_engine README/Claim gate | github.com/Dicklesworthstone/franken_engine | Community | — | claim 语言强度分级门（锚定纪律立法的先例） |

**结论重申**：主推 A（换模三跑 + 预注册 kill criteria + r93-kimi 新 profile 倾向 + B 的 R95 硬截止 rider）。Confidence 中高——唯一实质不确定性是缺口 1/2（Kimi-K2-0905 的 units 计费与 reasoning 形态），均可在 preflight 内以一次串行探针消除，不构成改选理由。
