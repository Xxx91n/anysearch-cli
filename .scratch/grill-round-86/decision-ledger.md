# Grill Round 86 — Decision Ledger

Slug: grill-round-86
Started: 2026-09-27
Theme: 第八轮锐评辩证核账 + R86 方向裁决（候审）
Status format: current / revised / stale / deferred

---

（记录自此往下追加——每条含 ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态）

---

## D-001 — R86 主轴裁决：绿门装船轮

- **原问题**：R86 主轴裁决——A 纯装船轮（defer-r85 根因→臂复活→全绿→v0.0.9，红门修复作 T0）/ B 纯治理修复轮 / C 复合轮 / D 另指。（经 atomcode 调研修订为 C′）
- **用户原回答原文**：采纳
- **规范化需求**：R86=「绿门装船轮」，ADR 主题=装船前置的根因判别与绿门发布。**原子集五项同轮进主 ADR**：①红门修复（claims 合约错配——kind:"path" 断言指向 gitignore 机器本地通道，修法取舍另题裁决）；②defer-r85-anysearch-arm-providersfailed 根因判别（三候选：携钥 iso 路径/ANS_PROVIDERS 名义匹配/上游当日失效；携钥隔离复跑为第一判别实验）；③NO-GO 裁决行补 provider-failure 限定语（decision-record.md 裁决行本体，非仅勘误段）；④阴性证据最小入库（判读器输入快照+配置 hash+运行环境指纹，使第三方可复核）；⑤.pr-1764-comment.md Status 翻面（评论已外发，草稿行仍写 pending）。
- **铁序**：判别根因 → 臂复活 → 配对 delta 腿复跑一条全绿臂 → 双平台门绿 → v0.0.9 切版。v0.0.9 切版双条件：全绿臂复跑 + 双平台门绿（green head 切 RC 惯例）。
- **显式约束/负向需求**：红门修复为 andon 级绝对前置——不绿门不推进后续工序；根因判别是发布准入条件非可选拖延；带病修复不得直接装船（先发后查被否）；复合仅限「发布合法性原子集」，不扩张；**范围外**：旧 defer 清障（empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical/MCP 缩进/control 口径/Standards 9 smell/finding-8）按既有惯例走独立 refactor commit 或顺延、审计 checklist 加项（进清障候场）、prefer-capable 加权实施（已核销不再开）、ip 第五域（条件未达）、pathlint 维持冻结。
- **依据**：atomcode 调研 q1-atomcode.md（andon/stop-the-line 红门前置、WIP 库存批次经济、根因判别=发布准入、复合合法性=防未记录漂移非防复合、阴性证据最小归档惯例）。
- **状态**：current（局部修订：原子集③形态经 D-004 升级——「补限定语」→「判词降级 indeterminate/instrument-flag」，原记录保留）

---

## D-002 — 红门修法：指纹清单入库 + claim 改指 + checklist 硬项同落

- **原问题**：红门修法裁决——r85-t2-degraded-archived claim（kind:path）断言 gitignore 机器本地通道文件致 CI 红，修法五案：A 指纹清单入库+改指 / B 增 kind:machine-local / C symbol 重述 / D 降格件入库 / E 删 claim；随票项=审计签字 checklist 加「签字 commit 门绿」硬项是否同落。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：新建 .scratch/grill-round-85/ 下证据指纹清单 JSON（每件机器本地证据记 path+sha256+size+来源 commit+判读器配置 hash+运行环境指纹；不记裸 generatedAt——时间戳破坏 diff，时效字段须使消费方可容忍变化或改可重导出字段）；r85-t2-degraded-archived claim 改指该清单文件自身（kind:path 不变，count/path/symbol/field 四 kind 合约面零扩展）；清单内引用原件路径的行复用 ADR-0072 <!-- machine-local: reason @ date --> governed marker；docs/agents/audit-checklist.md 审计签字 checklist 增加硬项「签字 commit 上 ship-gate --quick exit 0」（防「gate 跑了但没人等它」失守模式复发）。该清单同时即原子集④「阴性证据最小入库」首件。
- **显式约束/负向需求**：禁止增 kind:machine-local（不立法只验形状不验内容的不可验断言类）；禁止 symbol 重述指向既有文档 token（expectations 置空=验证器失去牙齿）；禁止降格件/delta.json 原件入库（驻留分级约定不动，跑批产物不入库先例不开）；禁止删 claim 降覆盖；断言对象=清单文件在库+自洽，非原件存在；修好必须双平台门绿实证。
- **依据**：atomcode 调研 q2-atomcode.md（SLSA expectations-MUST-fail 语义、checksum manifest=lockfile/SHA256SUMS/SRI/SBOM 同构、WITNESS receipt 绑定阴性结果一等证据、Momentic 签字绑定 binary evidence 标准）。
- **状态**：current

---

## D-003 — defer-r85 根因判别：四步微分探针矩阵（两批执行）

- **原问题**：defer-r85-anysearch-arm-providersfailed 根因判别实验设计——A 四步微分探针矩阵（先取证后动手）/ B 直接全量复跑赌恢复 / C 只跑 P0 单探针 / D 另指。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：查采纳（=采纳）
- **规范化需求**：侦证改写后的候选根因集——①上游/端点当日失效（官方 /mcp 故障或 ANYSEARCH_ENDPOINT 重定向的本地端点 down，或限流/配额）；②wire schema 漂移（MCP 应答缺 '## Search Results' 头等格式变更→每调用 malformed throw）；③stale dist（跑批所用 apps/cli/dist/index.js 为迁移前旧构建→全打 /v1/search 404）；④Bearer auth/携钥失效（401/403）；⑤ANS_PROVIDERS 名义匹配——**已基本排除**（providersFailedOff 全扇出腿 56/57 同样全灭，失败不特异于 iso 路径）。判别实验=两批微分探针：
  - **第一批（捆绑执行）**：P0=provider 直调取证脚本（new AnySearchProvider().search() catch 打印 e.name+message 截断落档——**产出升长期 fixture**，修补「只记旗标不记错误文本」的 generic-wrapping 缺陷）；P3=dist 构建新鲜度断言（dist 构建 hash 或 git describe 嵌入 vs 工作区 HEAD，不匹配→FAIL 提示重建，非静默跑）——stale dist 为 recent-change prime suspect 先排；
  - **第二批（按需触发）**：P1=env 三分离（原 env / ANYSEARCH_ENDPOINT 置空回官方默认 / ANYSEARCH_API_KEY 置空走匿名——单变量隔离）；P2=raw MCP 探针（绕过应答解析直发 initialize+tools/call，裸应答对 R82 时期 golden 快照归一化 hash diff，按 additive/risky/breaking 三车道判读）；
  - **错误分类层**：错误类别标注 retryable/permanent——5xx/429→transient、401/403→permanent-auth、malformed 缺头→permanent 协议漂移（重试无意义）、404+session→半永久（现 SessionExpiredError 重试一次逻辑已正确）；
  - **臂复活判据**：错误类别归因落档 + iso 探针连续 5/5 providersFailed 空；根因=transient 上游已恢复→零代码修核销票据+ADR 记升级条款（复发则升 P2 wire-schema 长期快照测试入 CI 前置）；根因=缺陷→修复后同判据复验。
- **显式约束/负向需求**：禁止无归因直接复跑（B=重启赌恢复反面模式）；禁止只跑 P0 就收工（无归因票据不能核销）；探针取证不落敏感值（ANYSEARCH_ENDPOINT/KEY 值不记录不入档，只记录存在性/类别）；dist 断言为 FAIL 语义非 SKIP 语义；runner 调度序零改动（R85 instrument-health ordering 已是定稿）。
- **依据**：atomcode 调研 q3-atomcode.md（SRE Ch.12 假设-演绎+反面模式、arika.dev raw client 层、schema drift 三车道、retryable/permanent 契约分类、Datadog hashed-key、GitLab artifact 传递、Gradle/Testim 连续绿区间、error-budget 升级条款）。
- **状态**：current

---

## D-004 — 复跑口径与认识论地位：健康闸验收+判词诚实化降级

- **原问题**：全绿臂复跑口径与认识论地位——A 全量复跑+健康闸+NO-GO 不重开 / A″ 保守变体 / B 缩容冒烟 / C 复跑重判读改裁决；随票项=判读器「臂全灭记 tied」语义修正是否同落。（经 atomcode 调研修订为 A′，含升级版③）
- **用户原回答原文**：采纳
- **规范化需求**：
  1. **判读器/runner 语义修正本轮同落**：providersFailed 非空的臂测量记 unknown/instrument-flag 而非 tied（0-vs-0 空表对不再是有效 tie）；修正方向=收紧向；登记注明「R85 已读数据按旧语义、旧件不复算」；
  2. **R85 decision-record 判词诚实化降级**：「41 对全 tied→NO-GO/direction-negative」修正为「indeterminate — instrument down（预注册终局读出无效数据：41 对实为空表对空表的装置失效格，按修正前语义记 tied，已作废）」；NO-GO 作为预注册终局程序上仍成立，但「tied 实证」依据失效——registry 注明；ADR-0086 相应段加勘误脚注（不溯改正文，加脚注式更正）；
  3. **全绿臂复跑**：原协议原指纹（7ac0a48e55cd7954）57 条全量；判据=装船健康证据非实验裁决——iso 腿 providersFailed=∅ 且臂结果表非空覆盖率 ≥70%；新 delta 数据如实报告，**不回写实验裁决**；
  4. **registry 具名跟进条件**：若 R86 全绿臂复跑出现方向信号（|ΔarmHostHit|≳0.4 量级或 better/worse 显著偏斜），prefer-capable 议题可于下轮 fresh preregistration 重开——registry 注记承载，本轮不改判。
- **显式约束/负向需求**：禁止缩容冒烟冒充全程证据；禁止用新数据直接改判（results-dependent selection）；禁止追溯复算 R85 旧件（只加脚注不溯改）；旧判词修正=记分簿诚实化非裁决重开；复跑前置=D-003 判别实验归因完成且臂复活判据达标（5/5 iso providersFailed 空）。
- **依据**：atomcode 调研 q4-atomcode.md（FDA protocol deviation、GMP 校准计量、Lakens data-independent 偏离、sign-test tie vs informative-missingness 边界、silent-failure 双重混淆、smoke-vs-regression 门槛）。
- **状态**：current

---

## D-005 — R86 轮结构票序 + 装船边界 + 不可复活预案 + 版本号

- **原问题**：轮结构票序（A 七票序）+不可复活预案（B1 仍发/B2 押后/B3 另定）+版本号随票（0.0.9 patch 叙事 vs 0.1.0 功能信号位）。（经 atomcode 调研修订为 A′+B1′+0.1.0）
- **用户原回答原文**：采纳
- **规范化需求**：七票序——T0 哨戒续班（dsh 0.1.7-rc.x watch+CI 观测+锐评第八轮核账归档）→T1 红门修复（D-002 全套，**双平台门绿实证后才推进**，andon 铁序）→T2 defer-r85 判别实验（D-003 两批微分探针）→T3 修复+臂复活（5/5 iso providersFailed 空判据；transient 则零代码核销+ADR 升级条款）→T4 判读器语义修正+记分簿诚实化（D-004①②，**必须先于 T5**——复跑用修正后判读器跑，否则产出需二次重算的失配数据）→T5 全绿臂复跑（D-004③判据）→T6 收口装船（registry 三联+CONTEXT 新词+ADR-0087+closeout-claims+切版）。
- **不可复活预案（B1′）**：若根因=上游长期死/端点不可达不可修复，仍发版——MCP 迁移是对死路由的正确性修复与上游健康正交；anysearch 臂 fail-open 一等降级态装船（kill-switch 型降级先例）；装船条件由「全绿臂复跑」降级为「根因落档+修复正确性实证」（证据降级如实记）；**披露位置纪律**：anysearch 降级态写进 README/装船判词显著位（known-issue 形态：配 workaround+影响范围+修复状态），非埋变更列表。
- **版本号**：v0.1.0（非 0.0.9）——批次含垂域贯通新能力面，0.y.z 内跳 0.1.0 是「首个可感知功能集」信号位；全包钉版承 0.0.8 惯例（cli+store+kernel+retriever+embedding+dsh-plugin）。
- **显式约束/负向需求**：T4→T5 顺序不可颠倒（判定者先于被判定物修订）；门不绿不切版；批次风险以判别链+回滚预案缓解（不拆批次——押后使 WIP 更膨胀）；旧 defer 清障不进本轮主 ADR（独立 refactor commit 惯例）。
- **依据**：atomcode 调研 q5-atomcode.md（持续交付 pipeline 形态、Nautobot release checklist T4 前置先例、Good Docs known-issue 模板、Unleash kill-switch 分类、semver 0.y.z 豁免+0.1.0 信号位、minware Big-Bang 反模式）。
- **状态**：current
