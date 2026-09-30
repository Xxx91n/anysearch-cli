# R94 Q3 AtomCode 调研归档 — 票序+commit 结构

调研时刻: 2026-09-30 | 题面: q3-prompt.txt | 工具: atomcode -p（串行单发，resume=5e24fbbc）
Sufficiency Gate: searches 5 | angles 五类全用 | full reads 6（cos.io/Elsevier/Nature/Tesbo/Atlassian/AAAI+rock.so）
信源: Registered Reports 两阶段（COS/Nature/Elsevier）、pipeline gate sequencing（Tesbo）、kanban WIP（Atlassian）、Terminated Registration 机制

## ① 总评

票序骨架健康，与 RR 两阶段模型高度同构：T1 立法批=Stage 1（结果未知即冻结判据）、T2/T3=数据收集+Stage 2 复审（验证无未说明协议偏离）、T4–T7=出版+质检。核心性质：**Stage 2 最终接受不取决于结果方向，只取决于是否忠实执行预注册协议**（Nature 原文）。

## 顺序调整（四点）

- **a. T1 内两 commit 顺序=正确保持**：carried_log 先行→ADR-0095 随后；carried_log commit message 自证时序角色（预通知点/owner 具名/触发规则=ADR-0094 D4/固化见 ADR-0095）——审计 LOOP 不需推理。
- **b. T3 拆 3a/3b + T4 显式硬阻塞**：3a=证据登记表全文落盘（evidence，含未命中条目全文）必先于 3b=判词票（命中机械落果文档/未命中=登记表指针+推荐果+用户子窗口）；T4 票头写显式前置「blocked-by: T3b 用户判词已落」（kanban WIP=1 入列条件=3b 完成，等拍板=板上可见阻塞非隐性跳过）。
- **c. D6 生效时点由 T0 读数决定**：T0 预检逃生舱——ship-gate 基线**跑全量非 quick**（quick 绿全量红残余窗口）；T0 绿→T7 首秀；T0 红→触发 D6 生效时点复议票（降下轮生效）记入风险账本。d3b 不再二选一而是谓词驱动。
- **d. claims 冻结纪律（防 R93-F1 同型）**：①T6③=最后一个可新增/修改 claims 的 commit，此后新发现只进 R95 交接不得追写；②T6⑤ 加「claims 冻结声明」（条目计数 N+各条状态）供 T7 机械比对；③T7 门禁=只读复证——若红走审计 LOOP，修复新 commit 不得改 claims 实物只能在 R95 记 discrepancy（RR Stage 2 纪律：偏差本身不否决，未申报的偏差才否决）。

## ② 四挂项

- d3a=**票内暂停待拍**：推荐果先落 T4 造成「落果在拍板前」时序倒挂；RR 模型结果未知是机制合法性来源；票内暂停=拉高 WIP 等待可见性代价可接受。
- d3b=**T1 生效+T0 逃生舱**（读数决定非二选一）。
- d3c=**T6⑤ 记账处置**：一轮一主题零新增 scope；双态措辞（done/deferred+owner）；**前提=核对三项不含 predicate 修改**——若涉及 predicate 修改则不是低项应移 R95。
- d3d=**默认纯备准**：E401 无有效身份，不代跑不借凭证绕闸；用户轮中亲触才核销更新措辞。

## ③ 缺票两处补

- **T0-F 程序票（真缺，触发式非无条件）**：开庭资格核验失败（如 TC 触发=stable 现身，或 r88 标的被上游实质改变）→全轮降级「复议轮」（不开庭，仅产复议 ADR+R95 议程建议），T0 已耗证据照常归档——对应 RR **Terminated Registration** 机制（终止是可发表正式出路非静默取消）；不补此票 T0 失败时会临场发明程序。
- **用户判词「拍板不可达」出口（形态确认非新票，一行入 T3b 票文）**：收口窗内用户不可达→未命中条目挂账 **pending-user-verdict**，三果均不落，registry 维持待审，R95 交接列第一待办——与「无 T-B」不冲突（这是判词票可达出口集合非记账票型）。

## ④ 风险与信息缺口

风险：1)ship-gate blocking 首秀**必绿>必快**（红 owner 具名进轮报；红→审计 LOOP 非重跑）；2)tie-breaker 残余裁量——锚计数**前移到 T3a 取证时刻预标注**（开庭前冻结），段 3 只求值不计数（预注册 contingencies must be specified in advance）；3)TC 重绑指纹须与 T0 绑定同轴；4)ADR-0095 写明 carried_log 必备字段集（条目/owner/触发规则/时间戳）T6① 机械核对。
缺口：判词子窗口形态无外部先例=纯本地制度设计；ship-gate --quick vs 全量覆盖差异未读→T0 预检跑全量一次（一轮一次成本可接受）；F3/F4/F5 需核对不含 predicate 修改。
