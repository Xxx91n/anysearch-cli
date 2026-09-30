const fs=require('fs');
const tail=`tail -5 CONTEXT.md`;
const terms=`

## Grill Round 94 — Terms (ADR-0095)

### Hybrid Verdict Routing（混合判词路由）
判词归属的两段制结构：三果充分条件谓词开庭前预注册——谓词命中=机械落果（stage-1 协议约束），未命中=exploratory 区（证据登记表全文+推荐果）由用户收口窗拍板，单独标注不作主结论。_Avoid_: 谓词覆盖不全时机械落错果（纯谓词制脆）；全部判词现场裁量（纯呈判制复活 HARKing，违「引预注册条款禁现场拟」铁律）。来源：Nature Registered Reports 两段制+R94 D-002/D-003。

### Exploratory Region（exploratory 区）
谓词未命中时的合法判词暂存区：产证据登记表全文+推荐果，等用户收口窗拍板；此区产出**单独标注不作主结论**。配套纪律：收口窗必须见未命中登记表全文而非仅见结论（防自动化偏倚橡皮图章）。_Avoid_: exploratory 产出被当主结论引用；只呈推荐果不呈登记表。来源：Nature RR exploratory 分析区语义+ozimmer ADR review+atomcode R94-Q2。

### Resurrection-Condition Controllability（复活条件可控性）
reaffirm 与 retire 的边界谓词：证据基础融合时（同一负读数支撑两果），分界不在证据而在复活条件可控性——每条复活条件必须挂 owner 或可机检信号，皆无则删；tie-breaker=可控锚≥1→reaffirm 优先，可控锚=0→retire。_Avoid_: 纯外部不可控信号（等上游施舍）被当 reaffirm 理由；同一事实拆成两条复活条件重复计数。来源：desuetude 法理（long non-use+no lever to revive）+atomcode R94-Q2+R94 D-002。

### Snapshot-vs-Live Evidence Tiering（快照/活查证据分级）
取证纪律的二分规则：**判据/读数用快照**（已落盘实测序列不刷新，单次终读纪律），**契约/环境现状用活查**（上游契约是否已变是 live fact，须串行只读复观且作具名步骤登记）。_Avoid_: 拿快照当现状（上游已修复还在用旧缺论证）；把活查散落到判词段临时起意（须在证据面陈述段内具名）。来源：证据分级纪律+atomcode R94-Q2+R94 D-002。

### Anchor-Count Pre-Registration（锚计数预注册）
裁量前移机制：tie-breaker 所需的「可控锚计数」在取证时刻（T3a）预标注冻结，判词段（T3b）只做谓词求值不做计数——把残余裁量从判词时刻前移到取证时刻。_Avoid_: 段 3 边裁边数（判词时刻发明计数规则=临场裁量）。来源：预注册「contingencies must be specified in advance」+atomcode R94-Q3+R94 D-003。

### Terminated Registration（终止登记路径）
开庭资格核验失败的正式出路：全轮降级「复议轮」（不开庭，产复议 ADR+R95 议程建议），已耗证据照常归档——终止本身是一条可发表的正式出路，不是静默取消。_Avoid_: 资格失败时临场发明程序（审计抓点）；失败后证据丢弃。来源：Elsevier Terminated Registration 机制+atomcode R94-Q3+R94 D-003（T0-F 程序票）。

### Pending-User-Verdict（判词待拍挂账）
判词子窗口的拍板不可达出口：收口窗内用户不可达时，未命中条目挂账 pending-user-verdict——三果均不落，registry 维持待审，列 R95 交接第一待办。_Avoid_: 人不在时机械拍一个果充数；三果落了但缺拍板记录。来源：kanban WIP 等待可见性+atomcode R94-Q3+R94 D-003（T3b 票文一行）。

### Claims Freeze Point（claims 冻结点）
closeout-claims 的登记时序不变量：收口批内「claims+轮报+终态戳」commit 是最后一个可增改 claims 的 commit，此后发现只能进下轮交接不得追写；配套冻结声明（计数+状态）供门禁机械比对；门禁为只读复证——修复 commit 不改 claims 实物，差异以「申报的偏差」落账。_Avoid_: 门禁后补写 claims（R93-F1 同型缺陷）；未申报偏差当正常。来源：R93 审计 F1 教训+RR Stage 2 纪律（偏差本身不否决未申报才否决）+atomcode R94-Q3+R94 D-003。
`;

const ctx=fs.readFileSync('CONTEXT.md','utf8');
if(ctx.includes('Grill Round 94 — Terms')) { console.log('already present'); process.exit(0); }
fs.appendFileSync('CONTEXT.md', terms, 'utf8');
console.log('CONTEXT.md +R94 terms (8), new size', (ctx+terms).length);
