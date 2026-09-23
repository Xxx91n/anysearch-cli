# Q5 atomcode research archive (2026-09-23)

Executed 1 commands (84 lines, 12.8KB). Indexed 8 sections. Searched 5 queries.

## Commands

- atomcode R80 Q5: `cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-80/q5-prompt.txt)"`

## Indexed Sections

- atomcode R80 Q5 (1.1KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 (0.1KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 1) 执行摘要（Tl;dr） (0.8KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 2) 分点结论 (1) (3.3KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 2) 分点结论 (2) (3.0KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 3) 对比矩阵 (1.1KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 4) 完整来源清单 (2.4KB)
- R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 5) 信息缺口 (1.1KB)

## release readiness definition of done evidence audit trail

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 4) 完整来源清单
## 4) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | IF4IT Release Evidence and Audit Trail (ch.31) | if4it.org/best-practices/release-management/release-evidence-and-audit-trail/ | Official | 证据链四维+风险分级政策+证据生命周期 |
| 2 | Archer Knox Policy Exceptions & Risk Acceptance Register | archerknox.com/risk_compliance/policy_exception_register | Official | exception register 字段表+Time-Bound Discipline 指标 |
| 3 | GitHub Blog: Introducing npm package provenance | github.blog/security/supply-chain-security/introducing-npm-package-provenance/ | Official | SLSA provenance 三元结构与 npm 发布官方路径 |
| 4 | AppSec Brief: npm TP & SLSA — Miasma 攻击边界 | appsecbrief.com/articles/npm-trusted-publishing-oidc-slsa-supply-chain-limits/ | Criticism | provenance 证明 origin 非 integrity+补强控制清单 |
| 5 | Notion: ratcheting system (eslint-seatbelt) | notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system | Community/Case | 棘轮基线四组件：只降不升+自动 enforcement |
| 6 | 12-Factor AgentOps Factor VIII: Ratchet the Baseline | 12factoragentops.com/factors/08-ratchet-the-baseline | Community | 基线击穿=stop-everything；verdict 随 change 落地 |
| 7 | imbue-ai/ratchets + Skillsaw Baseline + 12FAO | github.com/imbue-ai/ratchets 等 | Community | 棘轮「只降不升」多源一致（freeze≠业界形态） |
| 8 | MongoDB 8.0: Eating Our Own Dog Food | mongodb.com/company/blog/engineering/mongodb-8-0-eating-our-own-dog-food | Currency/Case | RC 内部生产先行=dogfooding 出闸标准范式 |
| 9 | Splunk: What's Dogfooding | splunk.com/en_us/blog/learn/dogfooding.html | Community | 内部先行是质量环节的通行表述 |
| 10 | slsa-framework/slsa-github-generator generic README | github.com/slsa-framework/slsa-github-generator/blob/main/internal/builders/generic/README.md | Official | provenance 为独立发布步骤+slsa-verifier 验证形态 |
| 11 | yongjip/lfpolicy exception-lifecycle | github.com/yongjip/lfpolicy/blob/main/docs/exception-lifecycle.md | Official(开源实现) | 惰性到期评估+主动告警双轨实现 |
| 12 | 知识库召回：R80 Q1/Q2 + R79 Q4 + LaunchDarkly 五阶段 | ctx_search (batch:atomcode-25-rollout / R80 Q2) | 历史调研 | pass/warn/block gate 三态、evidence-present 判定、DoR/DoD 分层复用 |

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**Confidence：高**。三段草案（取证→就绪→文书）与业界成熟 release-readiness 实践高度同构：取证段对应 evidence chain + sign-off 记档（IF4IT 四维证据政策）、就绪段对应 release gate 的 pass/warn/block 判定面（知识库 R80 Q2 已交叉验证）、文书段对应 ADR + decision log。豁免机制与 Archer Knox / ServiceNow 的 time-bound exception register 完全对齐（五要件几乎是业界 register 字段表的 1:1 映射）。**总体判据充分，无致命漏项**；建议对三个非标项给出判定：dogfooding=业界标准做法（保留）、pathlint 冻结宣告=应改为棘轮表述（改写）、审计红 commit 例外注记=业界无直接同构但符合 fail-closed 治理（保留并写明边界）。

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：发布就绪 DoD 的成熟框架=「分层 DoD + 证据链 + 风险分级」— Confidence：高**
- IF4IT（已读原文）：证据链四维（retention / immutability / attestation / accessibility）应按 Risk Classification 分级、作为常设政策而非逐次临场决定；反模式是「一刀切」。你仓里的三段式固定流程即「常设政策」形态，且本轮 0.0.8 发布属高风险面（首个带 provenance 的 tag），四腿并行与之匹配。
- 知识库召回（batch:atomcode-25-rollout）：LaunchDarkly 五阶段 release checklist、DoR/DoD 分层、PRR（Production Readiness Review）——你的 (i)取证↔DoD 证据侧，(ii)就绪↔gate 判定侧，(iii)文书↔post-release retrospective/ADR 侧，一一对应。
- 证据链生命周期（IF4IT 图注）：persistent identifiers + timestamps + actors + decisions 贯穿 planning→gates→deployment→audit retrieval。草案 (i) 的「transcript 归档+观测窗口截至戳+裁决落 ADR」正是 persistent identifier + timestamp + decision 三要素，**充分**。

**结论 2：time-bound exception 的成熟形态=register 字段表 + 到期惰性判定 + 主动告警 — Confidence：高**
- Archer Knox（已读原文）register 必填字段：Exception_ID / Policy_Reference / Justification（含 considered alternatives）/ Compensating_Controls / **具名 Owner + 具名 Approver** / Start/Review/End_Date / Status / Linked_Incidents。治理指标含「Time-Bound Discipline：逾期复核、多次延期、超 12 个月未闭合」。
- 补充信源（yongjip/lfpolicy，已核摘要）：业界实现是**惰性评估 + 后台 sweep 双轨**——`IsEffectiveAt(now)` 在判定时点检查 `expires_at`，另有 worker 做 7/3/1 天到期告警。对应到你仓：γ 条件阻塞本身就是惰性评估（闸内执法时点查三件），time-bound exception 到期 ≤90 天+复验触发即 End_Date+Review_Date，**续期须新轮立项**=Archer Knox 的「extended more than once 计为告警指标」的更严格版本，**判据完备且偏严（方向正确）**。
- 唯一建议补项：五要件已含具名 acceptor，但业界 register 还有 **Linked_Incidents/Audits**（例外与事故/审计的关联）——你仓可等价映射为「例外 ADR 条目 ↔ 关联本轮 transcript/闸记录的双链」，属文书段低成本低成本补强，非阻塞。

**结论 3：三段充分性总评 — 漏项 1 处、过度项 0 处、非标项判定 3 条**
- **漏项**：三段里没有「**回滚/失败处置预案**」的显式条目。0.0.8 是 tag+publish 的不可变发布（npm unpublish 受限），业界 checklist（beefed.ai go/no-go、kiolo 模板，摘要级）均把「tested rollback plan」列为 go/no-go 必答题。建议在 (ii) 就绪段补一行：「tag 前 pack 拆验失败或 install 脏的处置=顺延不拆清单」（这其实已在 D-003 隐含——「否则顺延不拆清单」就是你的 no-go 分支——建议把它**显式写进判据文本**，使其成为可核验条目而非隐含语义）。
- **过度项识别**：无明显过度。三段每条都有机验锚点（transcript、turbo/ship-gate、.gitignore 白名单），符合 IF4IT「按风险分级定严度」——0.0.8 首发属高风险 tier，全量取证合理。

**非标项判定：**

## exception register expiry re-verification closeout

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 4) 完整来源清单
## 4) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | IF4IT Release Evidence and Audit Trail (ch.31) | if4it.org/best-practices/release-management/release-evidence-and-audit-trail/ | Official | 证据链四维+风险分级政策+证据生命周期 |
| 2 | Archer Knox Policy Exceptions & Risk Acceptance Register | archerknox.com/risk_compliance/policy_exception_register | Official | exception register 字段表+Time-Bound Discipline 指标 |
| 3 | GitHub Blog: Introducing npm package provenance | github.blog/security/supply-chain-security/introducing-npm-package-provenance/ | Official | SLSA provenance 三元结构与 npm 发布官方路径 |
| 4 | AppSec Brief: npm TP & SLSA — Miasma 攻击边界 | appsecbrief.com/articles/npm-trusted-publishing-oidc-slsa-supply-chain-limits/ | Criticism | provenance 证明 origin 非 integrity+补强控制清单 |
| 5 | Notion: ratcheting system (eslint-seatbelt) | notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system | Community/Case | 棘轮基线四组件：只降不升+自动 enforcement |
| 6 | 12-Factor AgentOps Factor VIII: Ratchet the Baseline | 12factoragentops.com/factors/08-ratchet-the-baseline | Community | 基线击穿=stop-everything；verdict 随 change 落地 |
| 7 | imbue-ai/ratchets + Skillsaw Baseline + 12FAO | github.com/imbue-ai/ratchets 等 | Community | 棘轮「只降不升」多源一致（freeze≠业界形态） |
| 8 | MongoDB 8.0: Eating Our Own Dog Food | mongodb.com/company/blog/engineering/mongodb-8-0-eating-our-own-dog-food | Currency/Case | RC 内部生产先行=dogfooding 出闸标准范式 |
| 9 | Splunk: What's Dogfooding | splunk.com/en_us/blog/learn/dogfooding.html | Community | 内部先行是质量环节的通行表述 |
| 10 | slsa-framework/slsa-github-generator generic README | github.com/slsa-framework/slsa-github-generator/blob/main/internal/builders/generic/README.md | Official | provenance 为独立发布步骤+slsa-verifier 验证形态 |
| 11 | yongjip/lfpolicy exception-lifecycle | github.com/yongjip/lfpolicy/blob/main/docs/exception-lifecycle.md | Official(开源实现) | 惰性到期评估+主动告警双轨实现 |
| 12 | 知识库召回：R80 Q1/Q2 + R79 Q4 + LaunchDarkly 五阶段 | ctx_search (batch:atomcode-25-rollout / R80 Q2) | 历史调研 | pass/warn/block gate 三态、evidence-present 判定、DoR/DoD 分层复用 |

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**Confidence：高**。三段草案（取证→就绪→文书）与业界成熟 release-readiness 实践高度同构：取证段对应 evidence chain + sign-off 记档（IF4IT 四维证据政策）、就绪段对应 release gate 的 pass/warn/block 判定面（知识库 R80 Q2 已交叉验证）、文书段对应 ADR + decision log。豁免机制与 Archer Knox / ServiceNow 的 time-bound exception register 完全对齐（五要件几乎是业界 register 字段表的 1:1 映射）。**总体判据充分，无致命漏项**；建议对三个非标项给出判定：dogfooding=业界标准做法（保留）、pathlint 冻结宣告=应改为棘轮表述（改写）、审计红 commit 例外注记=业界无直接同构但符合 fail-closed 治理（保留并写明边界）。

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：发布就绪 DoD 的成熟框架=「分层 DoD + 证据链 + 风险分级」— Confidence：高**
- IF4IT（已读原文）：证据链四维（retention / immutability / attestation / accessibility）应按 Risk Classification 分级、作为常设政策而非逐次临场决定；反模式是「一刀切」。你仓里的三段式固定流程即「常设政策」形态，且本轮 0.0.8 发布属高风险面（首个带 provenance 的 tag），四腿并行与之匹配。
- 知识库召回（batch:atomcode-25-rollout）：LaunchDarkly 五阶段 release checklist、DoR/DoD 分层、PRR（Production Readiness Review）——你的 (i)取证↔DoD 证据侧，(ii)就绪↔gate 判定侧，(iii)文书↔post-release retrospective/ADR 侧，一一对应。
- 证据链生命周期（IF4IT 图注）：persistent identifiers + timestamps + actors + decisions 贯穿 planning→gates→deployment→audit retrieval。草案 (i) 的「transcript 归档+观测窗口截至戳+裁决落 ADR」正是 persistent identifier + timestamp + decision 三要素，**充分**。

**结论 2：time-bound exception 的成熟形态=register 字段表 + 到期惰性判定 + 主动告警 — Confidence：高**
- Archer Knox（已读原文）register 必填字段：Exception_ID / Policy_Reference / Justification（含 considered alternatives）/ Compensating_Controls / **具名 Owner + 具名 Approver** / Start/Review/End_Date / Status / Linked_Incidents。治理指标含「Time-Bound Discipline：逾期复核、多次延期、超 12 个月未闭合」。
- 补充信源（yongjip/lfpolicy，已核摘要）：业界实现是**惰性评估 + 后台 sweep 双轨**——`IsEffectiveAt(now)` 在判定时点检查 `expires_at`，另有 worker 做 7/3/1 天到期告警。对应到你仓：γ 条件阻塞本身就是惰性评估（闸内执法时点查三件），time-bound exception 到期 ≤90 天+复验触发即 End_Date+Review_Date，**续期须新轮立项**=Archer Knox 的「extended more than once 计为告警指标」的更严格版本，**判据完备且偏严（方向正确）**。
- 唯一建议补项：五要件已含具名 acceptor，但业界 register 还有 **Linked_Incidents/Audits**（例外与事故/审计的关联）——你仓可等价映射为「例外 ADR 条目 ↔ 关联本轮 transcript/闸记录的双链」，属文书段低成本低成本补强，非阻塞。

**结论 3：三段充分性总评 — 漏项 1 处、过度项 0 处、非标项判定 3 条**
- **漏项**：三段里没有「**回滚/失败处置预案**」的显式条目。0.0.8 是 tag+publish 的不可变发布（npm unpublish 受限），业界 checklist（beefed.ai go/no-go、kiolo 模板，摘要级）均把「tested rollback plan」列为 go/no-go 必答题。建议在 (ii) 就绪段补一行：「tag 前 pack 拆验失败或 install 脏的处置=顺延不拆清单」（这其实已在 D-003 隐含——「否则顺延不拆清单」就是你的 no-go 分支——建议把它**显式写进判据文本**，使其成为可核验条目而非隐含语义）。
- **过度项识别**：无明显过度。三段每条都有机验锚点（transcript、turbo/ship-gate、.gitignore 白名单），符合 IF4IT「按风险分级定严度」——0.0.8 首发属高风险 tier，全量取证合理。

**非标项判定：**

## dogfooding self-application gate practice

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 4) 完整来源清单
## 4) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | IF4IT Release Evidence and Audit Trail (ch.31) | if4it.org/best-practices/release-management/release-evidence-and-audit-trail/ | Official | 证据链四维+风险分级政策+证据生命周期 |
| 2 | Archer Knox Policy Exceptions & Risk Acceptance Register | archerknox.com/risk_compliance/policy_exception_register | Official | exception register 字段表+Time-Bound Discipline 指标 |
| 3 | GitHub Blog: Introducing npm package provenance | github.blog/security/supply-chain-security/introducing-npm-package-provenance/ | Official | SLSA provenance 三元结构与 npm 发布官方路径 |
| 4 | AppSec Brief: npm TP & SLSA — Miasma 攻击边界 | appsecbrief.com/articles/npm-trusted-publishing-oidc-slsa-supply-chain-limits/ | Criticism | provenance 证明 origin 非 integrity+补强控制清单 |
| 5 | Notion: ratcheting system (eslint-seatbelt) | notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system | Community/Case | 棘轮基线四组件：只降不升+自动 enforcement |
| 6 | 12-Factor AgentOps Factor VIII: Ratchet the Baseline | 12factoragentops.com/factors/08-ratchet-the-baseline | Community | 基线击穿=stop-everything；verdict 随 change 落地 |
| 7 | imbue-ai/ratchets + Skillsaw Baseline + 12FAO | github.com/imbue-ai/ratchets 等 | Community | 棘轮「只降不升」多源一致（freeze≠业界形态） |
| 8 | MongoDB 8.0: Eating Our Own Dog Food | mongodb.com/company/blog/engineering/mongodb-8-0-eating-our-own-dog-food | Currency/Case | RC 内部生产先行=dogfooding 出闸标准范式 |
| 9 | Splunk: What's Dogfooding | splunk.com/en_us/blog/learn/dogfooding.html | Community | 内部先行是质量环节的通行表述 |
| 10 | slsa-framework/slsa-github-generator generic README | github.com/slsa-framework/slsa-github-generator/blob/main/internal/builders/generic/README.md | Official | provenance 为独立发布步骤+slsa-verifier 验证形态 |
| 11 | yongjip/lfpolicy exception-lifecycle | github.com/yongjip/lfpolicy/blob/main/docs/exception-lifecycle.md | Official(开源实现) | 惰性到期评估+主动告警双轨实现 |
| 12 | 知识库召回：R80 Q1/Q2 + R79 Q4 + LaunchDarkly 五阶段 | ctx_search (batch:atomcode-25-rollout / R80 Q2) | 历史调研 | pass/warn/block gate 三态、evidence-present 判定、DoR/DoD 分层复用 |

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 2) 分点结论 (2)
| 非标项 | 业界同构判定 | 推荐 |
|---|---|---|
| **dogfooding 本轮收口过新闸** | **业界标准实践**。MongoDB 8.0（已核原文）：RC 在内部生产系统先跑再出闸，问题在客户前暴露；Splunk（已核摘要）：内部先行是内部 beta 的正式环节。你仓的「用本轮收口跑一遍新 ship-gate 闸」= MongoDB RC 内部升级的同构，且是发布工具链 dogfooding（比产品 dogfooding 更轻）。 | **保留**。建议在 ADR-0081 注明同构先例（MongoDB RC 模式），并把「过新闸发现的 issue 处置」记档，使 dogfooding 也产出证据而非仅通过。 |
| **pathlint 豁免域冻结宣告** | **方向对，措辞应改**。「冻结」在业界是反模式——例外只增不减会被审计判定为规则后门（Archer Knox 豁免治理核心担忧）。成熟形态是**棘轮（ratchet）**：Notion eslint-seatbelt（已读原文）、imbue-ai/ratchets、12-Factor AgentOps Factor VIII（已读原文）——基线只降不升，回归击穿基线=stop-everything 事件。你仓 ADR-0079/0080 已有 stale-marker 棘轮腿，「冻结宣告」与其自相矛盾。 | **保留条目但改写为棘轮表述**：宣告「豁免域为当前基线，标记只减不增，新豁免须走 ADR 修订路径」——比冻结更准确，且与既有棘轮机制闭环。 |
| **审计红 commit 工序例外注记** | **无直接业界同构，但符合治理逻辑**。业界证据链要求 immutability（IF4IT）——git 历史上的「红 commit」（审计标记的临时工序提交）与不可变历史的张力是真实问题，业界的解法是 sanitized-history + 重写映射单一翻译点（你仓 ADR-0074 已落地过：rewrite-map + range-diff 对齐断言）。 | **保留**，注记中引用 ADR-0074 的既有机制作为处置预案，使例外注记指向已验证流程而非开放承诺。 |

**结论 4：dsh-plugin 首发链（TP+OIDC+provenance）的业界校准 — Confidence：高**
- GitHub 官方（已读原文）：provenance = subject + materials + buildConfig 三元，npm `--provenance` 记录 commit SHA/workflow/entryPoint，消费者可验证——草案「tag 后五包 OIDC+provenance」与官方推荐路径一致。
- 批评面（appsecbrief，已读原文，Miasma 事件）：**provenance 证明 origin 不证明 integrity**——有效 OIDC + 有效 SLSA attestation 也挡不住被攻陷账号推恶意 commit。补强控制：branch protection + required reviews、发布 workflow 走 protected environment（required reviewers）、lifecycle script 审查。对应 D-003「用户手发首发→TP 配置」路径：**建议 ADR-0081 注明 provenance 的保证边界**（防「有 provenance=安全」的过度声明），这与 0.0.8 前置条件的顺延逻辑（TP 未就绪不拆清单）互为印证。
- slsa-github-generator generic workflow（已核摘要）确认：provenance 是 publish 流程的独立附加步骤，不阻塞构建本身——支持你把 provenance 放在「tag 后」而非「tag 前」的顺序。

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**Confidence：高**。三段草案（取证→就绪→文书）与业界成熟 release-readiness 实践高度同构：取证段对应 evidence chain + sign-off 记档（IF4IT 四维证据政策）、就绪段对应 release gate 的 pass/warn/block 判定面（知识库 R80 Q2 已交叉验证）、文书段对应 ADR + decision log。豁免机制与 Archer Knox / ServiceNow 的 time-bound exception register 完全对齐（五要件几乎是业界 register 字段表的 1:1 映射）。**总体判据充分，无致命漏项**；建议对三个非标项给出判定：dogfooding=业界标准做法（保留）、pathlint 冻结宣告=应改为棘轮表述（改写）、审计红 commit 例外注记=业界无直接同构但符合 fail-closed 治理（保留并写明边界）。

## missing items gaps recommendation

### atomcode R80 Q5
# atomcode R80 Q5

$ cd /d/Aworker/anysearch-cli && atomcode -p "$(cat .scratch/grill-round-80/q5-prompt.txt)"

先检索知识库召回历史索引，再启动三引擎调研。知识库命中 R80 Q1/Q2 与 R79 历史调研，可复用部分结论。现在启动三引擎外搜补强。继续第二阶段：定点深挖高价值原文，并补足 dogfooding / SLSA 角度。继续深挖：pathlint 冻结同构实践、DoD 分层官方来源，及 npm TP 原文验证。补最后一批原文核验（官方 npm provenance + 供应链批评面 + ratchet 实践文）。最后补一次原文核验（Notion ratchet 实践文），然后综合输出。**Sufficiency Gate**: searches: 7 (web_search ×3, anysearch ×3, ctx_search ×1 召回) | angles: Official / Criticism / Currency / Community / Comparative | full reads: 7 (if4it, archerknox, github.blog, appsecbrief, 12factoragentops, notion blog, MongoDB/Splunk 摘要已核) | gaps: 无板块空缺；Tavily 额度耗尽，三引擎降为双引擎（Exa+AnySearch）+ 知识库历史召回交叉，关键结论均有 ≥2 独立信源。

## freeze declaration contract freeze precedent

### R80 Q5 — 发布就绪轮收口判据（三段式）业界同构评估 > 4) 完整来源清单
## 4) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | IF4IT Release Evidence and Audit Trail (ch.31) | if4it.org/best-practices/release-management/release-evidence-and-audit-trail/ | Official | 证据链四维+风险分级政策+证据生命周期 |
| 2 | Archer Knox Policy Exceptions & Risk Acceptance Register | archerknox.com/risk_compliance/policy_exception_register | Official | exception register 字段表+Time-Bound Discipline 指标 |
| 3 | GitHub Blog: Introducing npm package provenance | github.blog/security/supply-chain-security/introducing-npm-package-provenance/ | Official | SLSA provenance 三元结构与 npm 发布官方路径 |
| 4 | AppSec Brief: npm TP & SLSA — Miasma 攻击边界 | appsecbrief.com/articles/npm-trusted-publishing-oidc-slsa-supply-chain-limits/ | Criticism | provenance 证明 origin 非 integrity+补强控制清单 |
| 5 | Notion: ratcheting system (eslint-seatbelt) | notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system | Community/Case | 棘轮基线四组件：只降不升+自动 enforcement |
| 6 | 12-Factor AgentOps Factor VIII: Ratchet the Baseline | 12factoragentops.com/factors/08-ratchet-the-baseline | Community | 基线击穿=stop-everything；verdict 随 change 落地 |
| 7 | imbue-ai/ratchets + Skillsaw Baseline + 12FAO | github.com/imbue-ai/ratchets 等 | Community | 棘轮「只降不升」多源一致（freeze≠业界形态） |
| 8 | MongoDB 8.0: Eating Our Own Dog Food | mongodb.com/company/blog/engineering/mongodb-8-0-eating-our-own-dog-food | Currency/Case | RC 内部生产先行=dogfooding 出闸标准范式 |
| 9 | Splunk: What's Dogfooding | splunk.com/en_us/blog/learn/dogfooding.html | Community | 内部先行是质量环节的通行表述 |
| 10 | slsa-framework/slsa-github-generator generic README | github.com/slsa-framework/slsa-github-generator/blob/main/internal/builders/generic/README.md | Official | provenance 为独立发布步骤+slsa-verifier 验证形态 |
| 11 | yongjip/lfpolicy exception-lifecycle | github.com/yongjip/lfpolicy/blob/main/docs/exception-lifecycle.md | Official(开源实现) | 惰性到期评估+主动告警双轨实现 |
| 12 | 知识库召回：R80 Q1/Q2 + R79 Q4 + LaunchDarkly 五阶段 | ctx_search (batch:atomcode-25-rollout / R80 Q2) | 历史调研 | pass/warn/block gate 三态、evidence-present 判定、DoR/DoD 分层复用 |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: ctx_search, 12factoragentops, immutability, atomcode-25-rollout, retrospective, justification, eslint-seatbelt, stop-everything, slsa-github-generator, launchdarkly, archerknox, attestation, persistent, transcript, discipline, rewrite-map, anysearch, criticism, community, timestamp, unpublish, ship-gate, 12-factor, integrity, atomcode, official, currency, evidence, lfpolicy, acceptor, adr-0081, imbue-ai, ratchets, agentops, yongjip, publish, install, 本轮收口过新闸, 豁免域冻结宣告, generic