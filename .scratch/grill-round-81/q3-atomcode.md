# R81 Q3 — spike 作战方案 atomcode 调研存档

Question 原文：.scratch/grill-round-81/q3-prompt.txt
Date: 2026-09-24 · atomcode（Exa+AnySearch；Tavily 限额缺席）

**Sufficiency Gate** — searches: 8（web_search×4/anysearch×2/ctx_search×1/tavily×1 限额失败已记缺口）| angles: Official/Criticism/Comparative/Currency/Community 五类全覆盖 | full reads: 6（sre.google、jamesshore、mountaingoatsoftware、chenhe.me、artoftroubleshooting、debug-hypothesis SKILL 原文；pm-skills 429 未读=弱证据双源旁证）| gaps: Tavily 限额、pm-skills 429、CI 面 R71 时是否同 000 未取证（→T1a 查 CI 日志存档）。

## 1) 执行摘要

**提案 A 骨架（侦察→重演矩阵→裁决）与业界成熟形态（Google SRE 假设-演绎法+spike→ADR 管线）高度吻合，推荐采纳，但需四处修订**：(1) 存量宣称审计从 T1 代码考古**单列为 T1b 独立腿**——它不是侦察是「已知债务盘点」，验收形态不同；(2) MCP 镜像作对照组**合规且必要**，但写成「同后端不同传输面」差异比较，防把 MCP 路径健康误推为 REST 端点健康；(3) 环境矩阵三面够用但须加**第四维：DNS 解析路径**（fake-ip vs 真实解析）——R71 的 000 首要嫌疑就是 fake-ip 中间层；(4) spike 产出=**推荐不裁决**，裁决权归轮收口 ADR——与业界一致，提案已写对保持。（Confidence：高——SRE 原典+XP/Scrum spike 原典+spike→ADR 工作流+假说驱动调试四路独立收敛。）

## 2) 分点结论

**Q1a 三段结构对，但缺「证伪优先」的腿**：SRE ch12 定义 troubleshooting=hypothetico-deductive method——先列假设再逐个测。debug-hypothesis 更硬：3–5 假设并列（Data/Logic/Environment/State 四类各覆盖），每个写 Supports/Conflicts/Test，先证伪非证实。T1 末尾须**显式产出假设清单**作 T2 输入——T2 不是穷举矩阵是**判别实验**：每格必须区分≥2 假设否则裁掉。TapRooT 批 5-whys/fault-tree：单假设链诱发 confirmation bias（favorite cause-itis）——矩阵须有**预期推翻自己偏爱假设的格子**。

**Q1b 存量宣称审计该单列**：本仓先例纪律——R72 D-003 Blocking Spike Item（spike 项必须 PASS/FAIL/RESHAPE，「T1 不消费 spike 报告则成仪式」）；R68 D-003 Spike-Gated Ticket（门控腿序不可乱）。种子化遗留宣称（install-smoke offline 腿 ANYSEARCH_ENDPOINT 死端注入/memory backfill 断言/文档 provider 健康宣称）是**与端点病因无关的独立事实集**——即使裁决「环境病理服务活着」，去种子化也是独立修复。**T1 拆 T1a（网络/设施侦察）+T1b（宣称审计：种子化位置 grep+每条现存宣称 PASS/FAIL/RESHAPE，RESHAPE 带回流票文名），各自独立 DoD。**

**Q1c MCP 镜像对照组=合规且最优仪器**：对照组要求「除被测变量外其余相同」——MCP 与 CLI 臂共享同后端/同本机/同代理环境，差异只在传输路径（MCP server 出口 vs retriever 臂出口）=SRE divide-and-conquer 的已知好分割点。**合规约束**：结论只能写「后端+本机出口面活着」不能写「anysearch 搜索功能活着」；若 MCP 也 000→假设空间坍缩为「服务死或全出口被断」，诊断更快收敛——双向可用性是它合格的原因。

**Q1d/Q4 最小充分环境矩阵**：R71 的 000 在 fake-ip 下至少四个互斥假设——H1 服务死/路由 404（服务病理）；H2 fake-ip DNS 污染打假 IP（环境病理-中间层）；H3 代理出口被 CloudFront 地理屏蔽（环境病理-出口）；H4 TLS/证书校验失败（客户端病理）。三面矩阵区分 H1 vs H2/H3 但分不了 H2/H3→加第四维 DNS 解析路径（nslookup fake-ip vs DoH/直连真 A 记录）。

| 探针格 | 代理+fake-ip（本机现状） | 代理+真实DNS | 直连（关代理） | CI（runner） |
|---|---|---|---|---|
| DNS 解析观测 | 必测（区分 H2） | 必测（真 A 记录） | 必测 | CI 默认真解析 |
| curl 最小探针（-v TLS+HTTP 码） | 必测（现状 404 已录） | 必测（区分 H3） | 必测（区分 H1 vs H2/H3） | 必测（区分 H3 地理屏蔽） |
| MCP 对照组 | 必测 | 可选 | 可选 | 不可用明示 |
| 真实 CLI 臂调用 | 必测 | 可选 | 可选 | install-smoke 已有腿 |

四列三行**必测格=5 个探针**半天可跑完，每格只答一个假设归属（one variable at a time）。**fake-ip=环境常量非变量**：先测它是什么再恒定/剔除，绝不在探针中途切代理配置（切换本身引入新变量）。

**Q2 产物给推荐不裁决**：业界分层——spike summary 产 findings+recommendation，ADR 持决策权；recommendation+constraints 直接喂 ADR Options Considered 节，多分支各成一 option。「a decision is made」指投入决策非技术裁决。本仓 ADR-0029 已定裁决权归轮收口 ADR——一致不需改。诊断书落 .scratch/<slug>/，裁决落 ADR，票文只引用不复制。

**Q3 timebox 检查点**：spike 标准 timebox 1–3 天。取 debug-hypothesis exit-criteria 形态——**每段书面 exit criteria，不达标不进下段而触发升级**。超时升级=「证据不丢」：(1) 中间产物随做随写进 .scratch/ 诊断书（DEBUG.md 纪律：只活对话里的推理会被 compaction 吃掉）；(2) 检查点超时处理不是延长是**降级收口**——记已证伪集+未测假设+阻塞证据，剩余假设变下轮 spike 门控票（R68 D-003 形态）；(3) 2.5 天分配建议 T0 0.25d/T1 0.75d/T2 1d/T3 0.25d/T4 0.25d；T1 或 T2 超时触发降级收口而非挤压后段——T3 最小可行形态=「假设清单+已证伪集+推荐方向」，不需 T2 全跑完。

**Q5 最终推荐：A′（四段变五段总 timebox 不变）**：

| 段 | 内容 | Exit criteria |
|---|---|---|
| T0 | 哨戒续班（骑缝非腿） | dsh 出闸复检+#1764+flake 完成 |
| T1a | 网络/设施侦察 | 端点现状测绘（证书/DNS/路由/status 子域 vs R58）+假设清单 H1–H4 书面化（≥3 个各带 Supports/Conflicts/Test） |
| T1b | 存量宣称审计（新增独立腿） | 种子化位置 grep 清单+每条现存宣称 PASS/FAIL/RESHAPE，RESHAPE 带回流票文名 |
| T2 | 判别实验矩阵（每格区分≥2 假设否则裁） | 5 必测探针跑完，每假设 VALIDATED/INVALIDATED/INCONCLUSIVE |
| T3+T4 | 裁决书+文书收口（可合一段 0.5d） | 诊断书含已证伪集+推荐+三分支各 feed ADR Options Considered；轮收口 ADR 拍板；超时降级收口 |

B 单票突击违假设并列纪律；C 先裁决后侦察=spike→ADR 管线倒置（裁决需 Options Considered 证据填充，先裁决则 ADR 空转）。A′ 增量成本≈0，结构性收益=最易被牺牲的宣称审计独立化+最可疑的 fake-ip 变量显性化。

## 3) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Google SRE Ch.12 Effective Troubleshooting | https://sre.google/sre-book/effective-troubleshooting/ | Official | 假设-演绎法定义、divide-and-conquer、zebra 谬误、最小探针注入（已读全文） |
| Spike Solutions (Art of Agile Development) | https://www.jamesshore.com/v2/books/aoad1/spike_solutions | Official | spike=信息产出非代码、timebox 惯例（已读） |
| Agile Spikes Deliver Knowledge (Mountain Goat) | https://www.mountaingoatsoftware.com/agile/what-are-agile-spikes | Official | excess uncertainty、timebox 结束即决策（已读） |
| What's Wrong With 5-Why's & Fault Trees (TapRooT) | https://taproot.com/whats-wrong-with-cause-and-effect-5-whys-fault-trees/ | Criticism | confirmation bias/favorite cause-itis |
| DNS Behavior Under Proxy | https://chenhe.me/posts/dns-under-proxy/ | Official(技术) | fake-ip/TUN 机理：DNS 解析路径独立于代理层（已读） |
| Is Troubleshooting A Science? | https://artoftroubleshooting.com/2021/03/05/is-troubleshooting-a-science/ | Community | 对照组/反事实必要性（已读） |
| debug-hypothesis SKILL.md | https://raw.githubusercontent.com/lichamnesia/lich-skills/main/skills/debug-hypothesis/SKILL.md | Community | 3–5 假设并列、exit criteria per phase、证据随做随写（已读） |
| pm-skills technical-discovery | https://github.com/product-on-purpose/pm-skills/blob/main/_workflows/technical-discovery.md | Community | spike→ADR：recommendation 喂 Options Considered（429 弱证据） |
| 本仓 ctx 知识库 R81 Q2+R68/R72 D-003 | （本地） | 项目内 | spike timebox/DoD 惯例、Spike-Gated/Blocking-Spike 纪律 |

## 4) 信息缺口

- pm-skills 原文 429，「recommendation 喂 ADR Options Considered」为摘要级双源旁证。
- Tavily 限额缺席，关键结论仍 ≥2 独立信源。
- CI 面 R71 时是否同 000 未取证——T1a 应查 CI 日志存档（直接区分全环境病理 vs 仅本机病理）。
