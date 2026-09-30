const fs=require('fs');

const goal=`# Grill Round 94 — 目标（已定稿）

日期: 2026-09-30 | 账本: decision-ledger.md（D-001~D-003 全 current）| 调研: q1/q2/q3-atomcode.md

## 正题

**r88-candidate 垂域死刑复核开庭轮**：registry \`r88-candidate-vertical-direction-redeliberation\` 候审 5 轮（R88→R93），ADR-0094 D4 sunset 条款（R95 前硬顶+R94 预通知义务）已在位——本轮提前一轮开庭兑现（review period 先于 expiration 的规范结构）。议程五段=资格核验→证据面→判据先审→判词表决→落地裁定；三果 reaffirm/revise/retire 皆合法各附复活条款；判词归属=B3 混合制（谓词命中机械落果/未命中=exploratory 区+用户收口窗拍板）。开庭即预通知——终结无限候审态。

## 判据机制（冻结项，开庭前冻结进 ADR-0095）

- 三果谓词：reaffirm=|ΔarmHostHit|≳0.4 实测为负∧标的实存（垂域三 ADR 在案）∧存在≥1 可控复活条件（原判据废止留理由）；revise=判据不等价/欠上游契约可测面∧存在可归因且近程修复路径（活查 cn_code/dsh 版本轴有实质变化迹象——没有=空转）；retire=标的实存性弱（论证面塌陷或被 supersede）∨复活仅剩不可控外部信号
- tie-breaker：可控锚≥1→reaffirm 优先；可控锚=0→retire；开庭中临时采纳=违规；**锚计数 T3a 取证时刻预标注**（裁量前移，段 3 只求值不计数）
- 复活条件集（可控性分类，每条须挂 owner 或可机检信号，皆无则删）：①dsh stable 晋升=半可控可机检 ②上游补垂域参数词表=纯外部标 retire 侧（单独不足立案需叠加④⑤）③cn_code 契约补齐=半可控有 owner=revise 主锚 ④新评测矩阵修订版读数=唯一纯可控锚=reaffirm 主锚 ⑤|ΔarmHostHit| 显著转正并入④（手段 vs 读数）⑥判据等价性证明=纯内部锚（reaffirm→revise 桥）
- 取证边界=快照/活查分级：判据/读数用快照（R85 indeterminate+R86 direction-negative 在案），契约/环境现状用活查（cn_code 复观=段 1 内具名步骤禁散落判词段）；**不重跑 delta/headless turn**（单次终读纪律）；stream-json=本机 dsh dist 只读勘查+版本指纹绑 0.1.7-rc.2（结论对版本有效，stable 可能变）
- 判词归属：充分条件谓词命中=机械落果；未命中=exploratory 区=证据登记表全文+推荐果→用户收口窗拍板（单独标注不作主结论；收口窗须见未命中登记表全文）；拍板不可达出口=未命中挂 pending-user-verdict，三果不落，registry 维持待审，列 R95 第一待办
- D6 副议题：ship-gate 升 blocking（门禁语义不可 advisory 化）+check+test 维持 advisory（反馈环非门禁，留上升通道）；生效时点=**T0 全量 ship-gate 预检谓词**（绿→本轮 T7 首秀；红→触发 D6 复议票降下轮生效记风险账本）

## 同域纳编

- 预通知双动作：carried_log 追加指针条目（先行 commit，message 自证时序角色=预通知点+owner 具名+触发 ADR-0094 D4+固化见 ADR-0095）+ADR-0095 立法固化「开庭即预通知」（两票同轮）
- r86 两项吸收为开庭证据非议题：defer-r86-anysearch-corpus-param-contract（vert-f1105 缺 cn_code=垂域实做摩擦物证）+defer-r86-anon-quota-nudge（permanent=外部环境约束证据）
- defer-r93-deprecate-credential-scope：默认纯备准续挂（EOTP 用户亲触，不代跑不借凭证绕闸）
- F3/F4/F5 低项：T6⑤ 双态记账（done/deferred+owner；前提=核对无 predicate 修改，涉 predicate 则移 R95）
- 新事实归档：|ΔarmHostHit| 两读数序列（R85 indeterminate-instrument-down / R86 direction-negative P=0.0378 净 −0.125 装置洁净）/重开条件出处=ADR-0087 D4（已知负读数下立的未来反转门槛）/atomcode 混淆修正（armHostHit 尺活——delta runner 实测；死的是 L3b stream-json 枚举腿属另一轴）

## 显式范围外

repin / 垂域语料修复票主体（r86 两项仅作证据非议题）/ web-matrix 主体 / 评测面主体（不重跑 delta）/ 常驻债清理主体 / approval-channel / deprecate 外发（EOTP 不代跑）/ tag·push·publish / pathlint 解冻 / r84（ip 域）/ f17（quarantine）不吸收。reason: 一轮一主题（ADR-0029），本轮主轴=开庭轮，上述各项 registry 候审自有通道。

## 治理闸

一票一 commit 类型不混；票级熔断 2-LOOP；pathlint 冻结；无 tag/push/publish；判词词汇+三果谓词+tie-breaker 开庭前冻结进 ADR-0095（开庭中临时采纳=违规）；T1 立法先于取证行为；T4 blocked-by T3b 用户判词已落=硬阻塞；claims 冻结纪律=T6③最后增改点+T6⑤冻结声明+T7 只读复证（修复 commit 不改 claims 实物，差异以申报偏差落 R95）；Stage 2 纪律=接受与否不取决结果方向只取决忠实执行预注册协议，未申报偏差才否决；零改动结果记 rejected evidence 不静默当成功
`;

fs.writeFileSync('.scratch/grill-round-94/goal.md', goal, 'utf8');
console.log('goal.md', goal.length, 'bytes, backtick-check:', goal.includes('`r88-candidate-vertical-direction-redeliberation`'));
