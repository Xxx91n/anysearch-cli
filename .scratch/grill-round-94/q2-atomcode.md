# R94 Q2 AtomCode 调研归档 — 开庭执行设计（七子题）

调研时刻: 2026-09-30 | 题面: q2-prompt.txt | 工具: atomcode -p（串行单发，resume=fc01ce6f）
Sufficiency Gate: searches 6+（Exa2/Tavily2/AnySearch2）| angles 五类全用 | full reads 5（ozimmer ADR/AWS Prescriptive/Texas Sunset×2/Nature RR 政策）
信源: Nature Registered Reports 两段制、ozimmer ADR review、AWS Prescriptive Guidance、Texas Sunset Commission、desuetude 法理（Wikipedia/Rutgers/West Virginia Printz 判例）、HITL 判词归属对比

## ① 逐子题裁决

- **a 判词归属=B3 混合制**：对应 Nature RR 两段制（Stage-1 协议预注册+Stage-2 结果审核）；B2 纯呈判违「引预注册条款禁现场拟措辞」铁律（HARKing 复活）；B1 谓词覆盖不全无合法出口；B3 命中=机械落果/未命中=exploratory 区（证据登记表+推荐果+用户收口窗拍板，单独标注不作主结论）。
- **b 三果谓词骨架=方向对需两处加固**（见②）。
- **c stream-json 结构证据=本机勘查为主 GitHub 辅证+版本指纹**：勘查绑定 0.1.7-rc.2 指纹，写「此字段面结论对该版本有效，晋升 stable 时字段面可能变化」——直接服务复活条件①；不跑 headless turn（R91 通道确认已跑过，3 轮 0 出现，重跑=peek 违纪边缘）。
- **d 取证边界=不重跑 delta；串行只读上游复观=批**：规则=「判据/读数用快照，契约/环境现状用活查」；cn_code 复观作开庭议程段 1 内**具名步骤**登记，禁散落判词段临时起意；单次终读纪律=prereg outcome-neutral criteria。
- **e D6 副议题=③分级**：ship-gate 升 blocking + check+test 维持 advisory。心智模型=风险分层分级（Texas sunset statutory/management/appropriations 三分类）：ship-gate 是合入门禁语义，advisory 化=门禁降布告栏（desuetude 批评面：notorious public disregard 腐蚀规则体系公信力）；check+test 是反馈环非门禁，升 blocking 会把 flaky 噪声变硬失败；分级留上升通道（flaky 率够低后续可单独升=revise 模式）。
- **f 预通知形态=双动作**：carried_log 追加一行指针（履行 D4 义务、可机检——「开庭事实自代」失效模式=事后重建叙事无法证明预通知发生在开庭前）+ ADR-0095 立法固化「开庭即预通知」规则（写法演进替代 D4）。
- **g 无 T-B/F-bug 票=确认**：「证据不足→Proposed+具名 action points」本身是合法判词。

## ② 三果谓词骨架加固（R86 实测为负新事实下的边界重画）

核心洞察：R86 负读数后，「维持 defer」与「方向撤销」的证据基础已融合——区别不在证据而在**复活条件可控性**。

- **reaffirm**：|ΔarmHostHit|≳0.4 实测为负 ∧ 标的实存（垂域三 ADR 在案）∧ **存在至少一个可控复活条件**（候选集③④⑤）。语义：方向在射程内，当前尺量不行且未来量得回来；原判据废止留理由。
- **revise**：判据不等价/欠上游契约可测面 ∧ **存在可归因且近程的修复路径**（cn_code 补齐/dsh stable——具名 owner+可检验完成态）。**revise 独立检验条件=活查 cn_code/dsh 版本轴有实质变化迹象**，没有=空转。
- **retire**：标的实存性弱（垂域三 ADR 论证面塌陷或被 supersede）∨ **复活仅剩不可控外部信号**。desuetude 工程直译（Texas sunset「这东西还需要存在吗」+Wikipedia/Rutgers「long non-use+no lever to revive」）；明文废止优于慢性搁置。
- **边界案 tie-breaker（预注册进 ADR-0095，开庭中临时采纳=违规）**：可控锚≥1→reaffirm 优先；可控锚=0→retire。

## ③ 复活条件候选集可控性分类

| # | 候选 | 可控性 | 裁定 |
|---|---|---|---|
| ① | dsh stable 晋升 | 半可控外部（上游节奏但可机检） | 保留；stable 出现即可机检 |
| ② | 上游补垂域结构化参数词表 | 纯外部不可控 | 保留但标 retire 侧信号——单独出现不足立案，需叠加④⑤ |
| ③ | cn_code 契约补齐 | 半可控（defer-r86 open 票有 owner） | 保留；revise 分支主锚 |
| ④ | 新评测矩阵修订版读数 | 完全可控（readout-delta.mjs+matrix@2 在案） | 保留；唯一纯可控锚，reaffirm 主锚 |
| ⑤ | |ΔarmHostHit| 实测显著转正 | 完全可控但依赖④ | 与④合并（④手段⑤读数），防同一事实计两条件 |
| ⑥新增 | 判据等价性证明 | 纯内部锚（fallback 判据与原判据在可测面等价） | 可选；唯一不依赖外部事件的锚，reaffirm→revise 桥 |

裁剪原则：**每个复活条件必须挂 owner 或可机检信号，两者皆无的删除**。

## ④ 风险与信息缺口

风险：1)自动化偏倚——B3 机械落果后收口窗橡皮图章；缓解=收口窗须见未命中登记表全文非仅结论（ozimmer：review 价值取决于 reviewer 真读了）。2)tie-breaker 未预注册的残余裁量——须开庭前冻结进 ADR-0095。3)dsh 版本轴漂移——勘查绑 0.1.7-rc.2；开庭时若有更高 rc/stable 须重新绑指纹。4)carried_log 双写不一致——建议预通知追加先行 commit、ADR-0095 随后 commit，两票同轮完成。
缺口：dsh 0.1.7-rc.2 vs R91 实测 0.1.5-rc.3 字段面变化（开庭段 1 具名步骤可闭）；finance.fundamental cn_code 现状（活查一步可闭）；dsh stable 路线图一手信源未检索到（登记为已知不确定性不阻塞）。
