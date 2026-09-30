# R94 常驻任务书 — r88-candidate 垂域死刑复核【开庭轮】

编制: 2026-09-30 | 账本: .scratch/grill-round-94/decision-ledger.md（D-001~D-003 全 current）| 调研: q1/q2/q3-atomcode.md | 目标: .scratch/grill-round-94/goal.md

## 开工三件套

1. 读本文件 + decision-ledger.md + goal.md（账本为唯一事实源，对话回忆不作数）。
2. 建 GitButler 工作分支（建议 `r94-court-session`，与其他 lane 并行不互扰）。
3. T0 起步——哨戒+基线+**全量 ship-gate 预检**（D6 生效时点谓词源）先行。

## 已实证事实底账（勿重跑/勿重查）

- R93 已闭环且 **land+push**：main==origin/main==85403a20；判词 `established-via-fallback`/branch A；README 双语行已誊抄版本 B（:227/zh:217）。
- **|ΔarmHostHit| 序列两读数**：R85（ADR-0086）indeterminate—instrument down（anysearch 臂 41/41 格 providersFailed，env 双重缺陷）；R86（ADR-0087）同指纹 57 格 paired 40/41 装置失败 ∅→matrix@2 终读 **direction-negative（P=0.0378、净 −0.125、EL=0.297、rankDiff 中位 0）**。
- **重开条件出处**：ADR-0087 D4——R86 负读数后 registry prefer-capable 条目才附「|ΔarmHostHit|≳0.4」具名重开条件（已知负读数下立的未来反转门槛，非未测项）。
- **atomcode 混淆修正**：armHostHit 判据尺是活的（vertical-delta runner 对 live API 实测，执行体 .scratch/grill-round-85/readout-delta.mjs+matrix@2 在案）；死的是 **L3b/dsh 集成的 stream-json 枚举腿**（model-request tools 枚举 3 轮 0 出现）——属另一轴，开庭作语境证据非重开尺。
- r88-candidate registry 四要素在位：deadline（R95 前）✓/owner（anysearch-eval）✓/carried_log（R93 条）✓/三果谓词（D4 预注册 reaffirm·revise·retire）✓。
- dsh 宿主：latest=0.2.0-rc.2/next=0.2.0-rc.2（仍无 stable）；本机 dsh 0.1.7-rc.2；安装实物在机外 npm 全局目录（`AppData/Roaming/npm/node_modules/@deepseek-ai/dsh`）——stream-json 字段面只读勘查目标。<!-- machine-local: 用户级 npm 全局安装目录为机外路径 @ 2026-09-30 -->
- defer-r86 两项 open：corpus-param-contract（vert-f1105 缺 cn_code）/anon-quota-nudge（permanent）——开庭吸收为证据非议题。
- defer-r93-deprecate-credential-scope open：6 条备准命令在 .scratch/grill-round-93/evidence/t5-deprecate.md §3（EOTP 用户亲触，不代跑）。
- profiles 残留：r92-smoke（R92 证据工件冻结）+r93-kimi（R93 工件）——本轮均零触碰。
- R93 审计坑位全集 14 条：%TEMP%93-handoff-next-round.md（含返修 3 条：门禁输出勿重定向进仓/but commit 显式点名文件/暂存路径拼接核对）。<!-- machine-local: %TEMP% 环境变量路径为机外路径 @ 2026-09-30 -->

## 票序（逐票声明 D-xxx 覆盖）

| 票 | 内容 | 覆盖 | commit 类型 |
|---|---|---|---|
| T0 哨戒+基线 | dsh dist-tags 复观（**TC 谓词=见 stable**，未目击 TC 不启不留痕）；**全量 ship-gate 预检**（D6 谓词源：绿→T7 首秀/红→触发 D6 复议票降下轮生效记风险账本——quick 绿全量红有残余窗口故跑全量）；check/test 基线；grill 期事实归档为 evidence（armHostHit 两读数/重开条件出处/混淆修正/dsh 勘查路径） | D-001/D-003 | chore+evidence |
| T0-F【触发式程序票】 | 开庭资格核验失败（TC 触发=stable 现身/r88 标的被上游实质改变）→全轮降级「复议轮」：不开庭，产复议 ADR+R95 议程建议；T0 已耗证据照常归档（Terminated Registration=可发表出路非静默取消） | D-003 | docs |
| T1 立法批 | **内两 docs commits 顺序**：①carried_log 追加预通知指针条目（先行；message 自证时序角色=预通知点+owner 具名+触发 ADR-0094 D4+固化见 ADR-0095）②ADR-0095（议程五段+B3+exploratory 区+三果谓词+tie-breaker+复活条件集可控性分类+快照/活查分级+cn_code 具名步骤+stream-json 版本指纹+判词词汇冻结+D6 分级落地+开庭即预通知+Known-Non-Goals+dsh 漂移条款+**carried_log 必备字段集**=条目/owner/触发规则/时间戳） | D-001/D-002/D-003 | docs |
| T2 开庭取证 | 段 0 资格核验（四要素）+段 1 五面取证：①ADR-0088 拒绝理由原文+ADR-0087/0086 调档+armHostHit 序列登记（「连续低且稳」vs「从未测过」vs「实测为负」谓词区分）②垂域三 ADR 实存性盘点（0084/0085/0059 land-deferred-纸面）③stream-json dist 只读勘查+版本指纹绑 0.1.7-rc.2（必要时 GitHub 同版本 tag 辅证）④r86 两项证据化+**cn_code 串行只读活查具名步骤**⑤dsh dist-tags 环境面→**证据登记表双侧证词格式**（维持 defer/revise 侧 vs retire 侧） | D-001/D-002/D-003 | evidence |
| T3a 登记表落盘 | 证据登记表**全文**落盘 evidence（含未命中条目全文+**锚计数取证时刻预标注**——每条复活条件标可控性+计数冻结，段 3 只求值不计数） | D-002/D-003 | evidence |
| T3b 判词票 | 段 2 判据先审（重开尺 |ΔarmHostHit|≳0.4 合法性+stream-json 枚举腿死亡证明归档+fallback ≥1 ans_* 等价性论证【⑥锚可选】；revise 判据≠revise 方向拆票）+段 3 判词：充分条件谓词求值→**命中=机械落果文档**；未命中→登记表指针+推荐果→**用户判词子窗口票内暂停待拍**（票文含出口一行：拍板不可达→未命中挂 pending-user-verdict，三果不落，registry 维持待审，列 R95 第一待办） | D-001/D-002/D-003 | docs+evidence |
| T4【blocked-by: T3b 用户判词已落】 | 落地裁定=registry 状态变更按果：reaffirm→formally-declined+具名复活条件+原判据废止留理由；revise→改判据+新观察窗（如 R96~R99）；retire→明文废止+复活条款+词块标 retired | D-001/D-002/D-003 | docs |
| T5 deprecate | 权限到位→执行 6 版本枚举重发（命令在 .scratch/grill-round-93/evidence/t5-deprecate.md §3）；默认纯备准续挂（EOTP 不代跑不借凭证） | D-001/D-003 | chore |
| T6 收口批 | 内分节多 commit（每节独立可 revert）：①ADR-0095 完成体回填（判词果+but-id 双锚+**carried_log 字段集机械核对**）②CONTEXT 词块（R94 8 词已落）+registry 全量更态③**claims+轮报+终态戳=最后一个可增改 claims 的 commit**④CHANGELOG⑤R95 交接件（若 pending-user-verdict 挂账=第一待办）+F3/F4/F5 双态记账+**claims 冻结声明**（计数+各条状态供 T7 机械比对） | D-001/D-003 | docs |
| T7 门禁+审计 | ship-gate **blocking 首秀**（红=真阻塞轮次不可收口；红 owner 具名进轮报；红→审计 LOOP 修复非重跑）+审计 LOOP（≤2）——**T7=只读复证：修复 commit 不得改 claims 实物**，差异以申报偏差落 R95 | D-002/D-003 | — |
| TC【条件】 | T0 目击 dsh stable→字段面重绑指纹（与 T0 绑定同轴新版本勘查）+复活条件①评估注入判词；未目击不启不留痕 | D-001/D-002 | — |

## 跨票闸（硬约束）

1. **一票一 commit 类型不混**；票级熔断 2-LOOP；pathlint 冻结；无 tag/push/publish。
2. **谓词+tie-breaker+判词词汇开庭前冻结进 ADR-0095**——开庭中临时采纳=违规；锚计数 T3a 预标注，T3b 只求值不计数。
3. **快照/活查分级**：判据读数用快照（不重跑 delta/headless），契约环境现状用活查（cn_code 具名步骤在段 1，禁散落判词段）。
4. **B3 判词归属**：命中机械落果；未命中 exploratory 区（登记表全文+推荐果+用户拍板，单独标注非主结论）；收口窗须见未命中登记表全文。
5. **T4 blocked-by T3b** 硬阻塞；拍板不可达→pending-user-verdict 挂账非机械充数。
6. **claims 冻结纪律**：T6③最后增改点+T6⑤冻结声明+T7 只读复证；修复不改实物差异申报偏差落 R95（未申报偏差才否决）。
7. **T0-F 与 pending-user-verdict 是程序出口非 T-B**——本轮无 T-B/F-bug 票（证据不足→Proposed+具名 action points 本身是合法判词）。
8. **D6 生效=T0 全量读数谓词**：绿→T7 首秀必绿>必快；红→复议票降下轮，不得拖到 T7 才发现。
9. **预通知双动作**：carried_log 指针先行 commit（自证时序）+ADR-0095 固化随后——两票同轮防中间态审计断裂。
10. **D-001 微调精修**：carried_log 非「替代」而是追加指针+ADR 固化双动作（D-001 主轴不动保持 current，精修见 D-002 边界）。

## 显式范围外

repin / 垂域语料修复票主体（r86 两项仅作证据）/ web-matrix 主体 / 评测面主体（不重跑 delta）/ 常驻债清理主体 / approval-channel / deprecate 外发（EOTP 不代跑）/ tag·push·publish / pathlint 解冻 / r84·f17 不吸收。reason: 一轮一主题（ADR-0029），本轮主轴=开庭轮。

## 汇报纪律

- 判词词汇预注册冻结（reaffirm/revise/retire 及落地态名一字不差从 ADR-0095 取）。
- 零改动/未命中结果记为 exploratory/rejected evidence，不静默当成功。
- 每票完成呈报：commit but-id+实证索引+判词/产物态；锚定纪律=but-id 唯一稳定锚，sha 均「落笔时值」口径。
- deprecate 外发动作先 EOTP 呈报，用户亲触后才执行。

## Suggested skills

- `gitbutler`（but）：全量版本控制；but-id 锚定；carried_log/ADR 两 commit 序。
- `domain-modeling`：ADR-0095 立法与 CONTEXT 词块一致性。
- `code-review`：轮末双轴复核（开庭轮判词合规性重点）。
- `handoff`：轮末交接件再生成本件同构。
- `atomcode-research`：开庭中断性调研（判据等价性论证⑥锚若启用/复议轮议程起草若 T0-F 启）。
- `implement`：T2 取证执行（勘查/调档/活查具名步骤）。

## 终态戳位

收口完成后在本文件尾追加：「R94 终态 — 开庭判词:___（reaffirm/revise/retire/pending-user-verdict/复议轮降级）| 票序完成:___ | 挂账移交:___」

R94 终态 — 开庭判词: reaffirm（充分条件谓词命中，机械落果） | 票序完成: T0 T1 T2 T3a T3b T4 T5 T6 T7（T0-F/TC 未触发） | 挂账移交: defer-r93-deprecate-credential-scope（6 条备准命令纯备准续挂待用户亲触）· 垂域方向四项复活条件集（owner: anysearch-eval）
