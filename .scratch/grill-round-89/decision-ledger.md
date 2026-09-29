# R89 Decision Ledger — grill-round-89

> 数据源纪律：本账本是唯一事实源。每条含 ID/原问题/原回答原文/规范化需求/显式约束/状态。
> 承继：R88 账本 D-001~D-005（全 closed 于搜索面卫生轮+审计 F-a~F-e 修复终态），registry open=13。
> 前态事实：R88 栈已 land——origin/main=846b2eb6（含 ADR-0089+审计收口）；v0.1.0 在架 latest；dsh 上游 next=0.2.0-rc.1 首目击 2026-09-28T12:14Z。

## Current

（D-001 已落账）

## Revised / Stale / Deferred

（空）

## D-001 — R89 主轴裁决：dsh 上游线轮（A′）

- **原问题**：R89 主轴——A dsh 上游线轮（0.2.0 线 repin 裁决+同域纳编 r72 两票）/ B 评测面轮（f17 quarantine 具名填充+语料复核+探针 ??/|| 残余）/ C 垂域方向重议 / D 另指。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：R89=「dsh 上游线轮」。正题=**0.2.0 线 breaking-surface 调研 + repin 时机裁决**（交付物=L1 探针 transcript+迁移面 diff+repin 时机判词），同域纳编 r72 两票（defer-r72-dsh-native-tools / defer-r72-dsh-web-interactive-matrix）**只定形不实现**——定形指解法案/落点/依赖状态随 repin 裁决写明；若轮内裁为提前实现，必须走 L2 安装彩排 expected-RED 闸。「repin 至 rc 还是等 stable」本身=票内裁决点（工业默认等 stable 只 soak；反向锚点=现役 0.1.7-rc.1 已在 unstable 家族，Renovate 例外条款部分适用）。
- **显式约束/负向需求**：B 评测面顺延（f17 无新触发、语料债上游冻结）；C 垂域方向重议候审不复活（|ΔarmHostHit|≳0.4 未达+无新证据，goalpost-shifting 反模式）；上游触发债（r81/r84/r86×2）维持具名触发不主动推进；常驻背景债×5 维持挂账；钉版 0.1.0 产物不动；无外发动作（本轮无 tag/publish）；R88 残余观察项（ANS_PROBE_QUERY ??/|| 不对称、libuv 噪声）维持登记不就地扩票；探针 ??/|| 不对称属搜索面残余不入本轮（域不同）。
- **依据**：atomcode 调研 q1-atomcode.md（Renovate upgrade-best-practices+noise-reduction+discussion#19375 全文/Tuist release-channels 全文/Rust internals 2026-01/johal.in canary war story/jsonic.io/pulp pr-batching/本仓 R77 Adoption Stability Gate+Respect-and-Schedule 召回；最强反对论据=薄轮+rc.2 推翻——反驳：调研结论不随 rc.N 失效，只有采纳决策押后且被 R77 分层吸收；真风险=rc 期过重设计承诺，以「只定形不实现+L2 闸」约束吸收）。信息缺口：0.2.0-rc.1 changelog/.d.ts 公网不可核验须 L1 探针补齐；rc→rc 平移先例单源；Tavily 超限双引擎顶替。
- **状态**：current

## D-002 — repin 时机裁决判据：三锚判词·加固版（A″，预注册入 ADR-0090 验收判据）

- **原问题**：repin 时机裁决判据（L1 探针跑前立法）——A 三锚判词（兼容锚+拉力锚+稳定锚真值表）/ B 大版本线跳一律等 stable / C 复用 R77 双锚 / D 另指。（经 atomcode 调研修订为 A″）
- **用户原回答原文**：采纳
- **规范化需求**：
  - **兼容锚**：已消费子集零破坏漂移——ctx.on(agent/created) payload {agent,source,signal?}+tools/pre-execute|post-execute|result 三事件+ctx.systemPrompt.section+inject=['tools','systemPrompt'] 声明在 0.2.0-rc.1 .d.ts 全在且签名同构；未消费键漂移≠兼容破坏（账本注明）。
  - **拉力锚**：证据形态**枚举化预注册**——r72 票面具名 API 在 0.2.0-rc.1 .d.ts 出现且签名稳定（工具注册面 / web 交互面其一即响）或安全/正确性修复证据；不接受泛化「成熟化」主观解读。
  - **稳定锚**：rc 线在架+2880min 龄期闸+changelog 不可公网核验→降级 tarball diff 自证并如实记缺口（ADR-0084 记分簿诚实化同构）。
  - **真值表（无第三态）**：拉力∧兼容→repin-now；兼容∧零拉力→soak-until-stable（B 吸收为默认兜底分支，高频象限必产出决定不悬置）；兼容破坏→hold。
  - **收口义务**：repin-now 落地后，0.2.0 stable 晋升时只再验一次收口探针即封账，不跟随 rc.N 滚动（防账本退化滚动义务）。
  - rc→rc 跨 minor 平移如实标注为**类推非先例**（Renovate 例外条款严格读法不覆盖跨 minor）。
- **显式约束/负向需求**：不设「可 repin 但不必须」第三态；拉力锚不收泛化成熟化证据；repin-now 不自动跟随后续 rc.N 递增；判据先于 L1 探针立法（防 goalpost-shift）。
- **依据**：atomcode 调研 q2-atomcode.md（Renovate ignoreUnstable+#19375/Tuist channels/Dependabot cooldown/pnpm minimumReleaseAge/consumer-vs-spec contract/Rust internals prerelease 结构批评/Presto 式判据先于窗口公示；最强反对论据=「可 repin 但不必须」软分支+拉力锚弱证伪+滚动义务化——三加固全收编）。信息缺口：0.2.0-rc.1 changelog/.d.ts 公网不可核验须 L1 探针补齐；rc→rc 跨 minor 类推单源；Tavily 超限双引擎顶替。
- **状态**：current

## D-003 — 轮内票序+commit 结构+repin 执行域：七票序+条件票制（A）

- **原问题**：轮内票序+commit 结构+repin 执行域——A 七票序+条件票（判词=repin-now 时轮内执行，R83 TE1 先例）/ B 纯裁决轮（repin 执行一律排下轮）/ C 执行加用户确认闸 / D 另排。
- **用户原回答原文**：a
- **规范化需求**：
  - **T0** 哨戒续班：dsh dist-tags 再观测（L0 续班）+CI/check/test/ship-gate 基线快照。
  - **T1** L1 探针跑批：npm pack 0.2.0-rc.1 全族 tarball→.d.ts 消费子集 diff vs 0.1.7-rc.1 基线快照；transcript+snapshot 落 evidence/；产出=兼容锚真值+拉力锚具名 API 扫描+dep-closure 变化（探针按仓内既有惯例）。
  - **T2** repin 时机判词：按 D-002 真值表出判词+收口义务条款+类推标注→upgrade-ledger v3 记档。
  - **T3** repin 执行条件票：仅当 T2 判词=repin-now 才启（repin+L2 安装彩排+必要迁移+回归，R83 TE1 in-round 先例）；判词≠repin-now 则票不启不留痕；同票连续 2 轮 LOOP 失败→熔断回退挂回。
  - **T4** r72 两票定形：解法案/落点/依赖解除状态随判词与实装态写明（docs 性质，不实现）。
  - **T5** 收口件批：ADR-0090+CONTEXT 词块+registry r72 两票状态更新+claims+任务书终态戳+evidence 终归档（单 docs commit）。
  - **T6** 门禁+审计 LOOP：pnpm -r check/test+ship-gate --quick+惯例复核。
  - **Commit 结构**：T1 evidence（chore/docs）、T2 verdict+ledger v3（docs）、T3 条件 fix、T4 r72 定形（docs）、T5 收口（docs）；一票一 commit；type 纪律承继 R88 D-004（fix/refactor/docs 不混）。
- **显式约束/负向需求**：repin 执行不得越 T2 判词先行；判词≠repin-now 时 T3 不得启（不留空票痕）；T3 若启必须走 L2 expected-RED 彩排不可直 repin；一票一 commit 不混 docs/fix；无 tag/publish 外发动作。
- **依据**：R77 票序三段式先例（轨一探针取证→轨二清算→文书收口）+R83 TE1 in-round repin 先例（fix(r83-te1) 双锚齐响即执行）+R88 任务书形态惯例；未派 atomcode（仓内工序编排+直接先例在案，调研边际收益低）。
- **状态**：current
