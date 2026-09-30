# R94 Q1 AtomCode 调研归档 — R94 主轴裁决（开庭轮 vs 轻收口轮 vs 评测轮）

调研时刻: 2026-09-30 | 题面: q1-prompt.txt | 工具: atomcode -p（串行单发）
Sufficiency Gate: searches 6 | angles Official/Comparative/Criticism/Currency/Community | full reads 7（1×403 换源）
信源: AWS Prescriptive Guidance/Azure Well-Architected（ADR lifecycle）/joelparkerhenderson ADR lifecycle/Wikipedia+legislationauthority（sunset 机制）/GitHub API versioning docs+blog 2025（deprecation）/Cato Fall 2026（403 未读）/maintainer Q&A

## ① 推荐：A（垂域死刑复核开庭轮）置信度高

1. **Sunset 法理内核：开庭是义务不是奖励**。成熟 sunset 体制（explicit / review-triggered 两型，美国 35 州、Texas 12 年周期）共同设计=复审本身是终局动作，缺席复审不是合法状态。r88 sunset（D4）属 review-triggered——把开庭压到 R95 是 sunset 头号失效模式「临界期拖延」（PATRIOT Act 历次延期、2020 House 过期一天无表决）。审查质量随临近 deadline 单调下降；R94 开庭=把复审从及格线动作升级为有裕度正式程序（对应 review period 先于 expiration date 的规范结构）。
2. **ADR lifecycle：r88 已进 Reviewing 段，继续候审=lifecycle 违规**。Proposed→review→Accepted/Reworked/Rejected 是有时限评审循环非无限候审队列；sunsetting 是 lifecycle 终段需 owner 周期 review。AWS 指南：证据不足需继续研究的合法动作=留 Proposed+具名 action points+assignee，非搁置。开庭哪怕判「维持 defer」也必须以带 action item 的正式判词落地。
3. **Deprecation policy：证据面已齐，「重开条件可能永远无法原生满足」必须在窗内入账**。L3b primary 判据结构性证伪（dsh stream-json 不暴露 tools 枚举）=|ΔarmHostHit|≳0.4 的一条取证腿永久不可用——支持 retire 或 revise，但不可能支持再候审（再等一轮不改变暴露能力，零信息增量复审）。maintainer 反模式：明知该结束却因证据收集完美主义拖着。
4. **治理节律：开庭轮本身是节拍器**。B 让 R94 沦为纯记账轮打断决策/修复交替节拍；deprecate EOTP 依赖用户亲触本就不可调度——把不可调度杂务当轮主轴是节律错配。D6 复核无论选何皆应作 R94 副议题，不必单独成轮。C 犯 scope 逆转：垂域语料是开庭证据非独立主轴（先做语料轮=开庭时证据仍是旧的）。

## ② 开庭议程设计（AWS ADR review 三段式+Texas sunset 报告前置）

| 段 | 内容 | 产出 |
|---|---|---|
| 0 开庭资格核验 | sunset 四要素在位：deadline(R95)✓/owner(anysearch-eval)✓/carried_log(R93)✓/三果谓词✓。缺任一先补票后开庭 | 资格确认记录 |
| 1 证据面陈述 | 双方证词各一轮：维持 defer/revise vs retire | 证据登记表 |
| 2 判据合法性先审 | **先裁判据后裁方向**——primary 腿结构性不可观测是最大变量；revise 判据≠revise 方向，拆开投票 | 判据裁定（独立 D 号） |
| 3 判词表决 | 三果谓词投票一果一录 | ADR-0095 立法 |
| 4 落地裁定 | retire→归档措辞+复活条件封存；reaffirm→formally-declined+复活条件；维持 defer→assignee 的 action points | registry 状态变更 |

### 取证清单（5 面）

- **面1 重开条件未达实物依据**：r88 登记全文+ADR-0088 拒绝理由原文（0.4 阈值推导语境/对照/样本轮数）；|ΔarmHostHit| 各轮实测序列——「连续低且稳定」与「数据缺失」是不同谓词必须区分。
- **面2 垂域架构现状**：ADR-0084 垂域贯通+0085 vertical-eval leg+0059 D7 domain-ownership 三条现存决策 land/deferred/纸面状态——标的实存性本身是判词证据。
- **面3 判据死亡证明**：stream-json channel 不暴露 tools 枚举的结构证据（3 轮 0 出现观测+dsh dist 包/GitHub 字段面类型定义）——「永久不可观测」vs「暂时没采到」分界；fallback 判据（≥1 ans_* tool_call/轮）等价性评估。
- **面4 近邻挂账证据化**：r86 vert-f1105 cn_code 缺参+r86 anon-quota permanent 归类=吸收为证据（垂域实做摩擦物证）非议题；r84/f17 不吸收（ADR-0029 单题性）。
- **面5 宿主窗口数据**：dsh 无 stable=宿主未定型=「方向暂缓」环境侧辩护词，任何果都要在 ADR-0095 留痕。

### 三果落地形态

- **reaffirm（维持不投入）**：转 formally-declined 态（不再是候审），附具名复活条件（修订后判据如「fallback 连续 K 轮异常」或「dsh 出 stable」）；原 |ΔarmHostHit| 判据废止并留废止理由（取证腿死=条件不可测=不合法判据）。registry：关闭改登 formally-declined。
- **revise（改判据/改范围）**：fallback 判据被裁等价→重开条件改写新判据+新观察窗（如 R96~R99）；revise≠翻案，方向仍缓只是换可测的尺。
- **retire（方向撤销）**：撤出正题候选池（desuetude 工程版：明文废止优于慢性搁置——vague/broad sunset 生成诉讼），附复活条款（什么外部信号可重新立案）。registry：归档，README/CONTEXT 词块标 retired。

## ③ 风险与反方论据

1. **开庭过早/证据不足致判词劣化（B 最强论点）**：反驳=混淆「证据不足」与「负证据充分」；「证据不足继续研究」本身是合法判词（Proposed+action points）仍是一次正式开庭；风险在判词措辞不留复活口——三果全强制附复活条款防之。
2. **判据死亡致判词失锚**：判据先行裁定设计防之；最坏（两尺皆死）退化为定性判（三条垂域 ADR 实存性+dsh 未 stable 两定性信号）+ADR-0095 明示低置信度（Azure confidence 标注）。
3. **吸收近邻挂账致 scope 膨胀**：只吸收有证据关系的 r86 两项且仅作证据；r84/f17 排除。
4. **提前开庭 vs D4 条文冲突**：D4 预通知节奏被开庭替代——需账本显式裁定「开庭即预通知」+ADR-0095 写清，避免解释争议（GitHub advance notice 精神：公告与执行合并，条件是公告具完整证据链）。
5. **「再养一轮」论据本身要复核**：R95 唯一预期新信息=dsh stable 与否——等外部项目发版定自家议程=把治理节律外包上游（sunset 模型标准批评）。

## ④ 信息缺口

1. r88 原始登记全文+ADR-0088 拒绝理由原文（0.4 推导语境）——开庭前必须调档。
2. |ΔarmHostHit| 历史实测序列（R87~R93 原始值，缺失本身入证）。
3. dsh stream-json channel 字段面结构证据（dist 包/GitHub 类型定义）——「永久不可观测」从推断升实锤。
4. fallback 判据等价性论证（语义映射非数据问题）。
5. Cato Fall 2026（What Happens After Sunset?）403 未读——archive.org 补读不阻塞（Wikipedia+legislationauthority 双源已覆盖）。
