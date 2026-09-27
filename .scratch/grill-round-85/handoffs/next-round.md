# R85 任务书 — delta 腿全量重跑 + prefer-capable 前置判读（evidence-only 轮）

## 状态快照
- 轮次：Grill Round 85 定稿 · 分支 r85-grill · 基 acaaccb3（R84 栈已审计 PASS 并入）
- 权威源：本目录 decision-ledger.md 四条全 current（D-001~D-004）；本任务书仅为落地视图，冲突时以账本为准
- 前置已满足：ANYSEARCH_API_KEY 在场+live 实测跑通（2026-09-27）→ defer-r84-delta-quota-rerun 触发条件成立
- 工件面：prereg-matrix.md 与判读脚本与输入指纹 T1 commit 先于任何读数；delta.json 驻 .scratch/vertical-eval/ 机器本地通道；存量降格件归档 delta-2026-09-26.degraded.json

## T0 哨戒续班（覆盖：D-003）
- dsh rc.3+ 版本线续 watch（npm 钉版面+事件契约面）
- #1764 用户侧挂账续挂——agent 不代发
- test-online-anysearch CI 腿观测+llm-init SSE flake watch
- 锐评第七轮核账结论归档入 .scratch/grill-round-85/reports/（四处方核销表：dsh-plugin 已上架/派生件新鲜度腿已进 ship-gate/pathlint 事实冻结/R80–R84 换气；未闭=#1764 用户侧）
- 验收谓词：哨戒面核账行落档；无阻断项则续走 T1
- suggested skills：research / atomcode-research（上游词表+版本线核对）；neat-freak（核账归档面）

## T1 预注册件落盘（覆盖：D-001 判读原则 / D-002 全矩阵 / D-003 时序 / D-004 截断记法）
- 写 .scratch/grill-round-85/prereg-matrix.md：覆盖闸（处理层 nPaired≥70% 且 unknown≤30%）+对照层独立闸（non-tied≥4/16 或 unknown>8/16→装置旗标整轮 INCONCLUSIVE）+方向轴（P(better>worse)≥0.8 GO / ≤0.5 或池化≤0 NO-GO / 中间 INCONCLUSIVE）+负向硬闸 2-of-4（四域封闭列表 finance/academic/code/health，域 worse−better≥3 记反向）+四字段（净胜率/P/EL/rankDiff 中位）+**早停规则本体**+单读生效条款+功效注记 |ΔarmHostHit|≳0.4+三处设计声明（0.8≡α0.2 业务选择 / 2-of-4 插值 / per-domain+2-of-4 仓内首创）+截断轮未完成域格记 structural missing 入 unknown
- 判读脚本（确定性查表 .mjs）+输入指纹断言一并本票 commit
- 红线：**commit 必须先于任何读数/任何重跑**——SAP-先于-database-lock 时序，不可并票
- suggested skills：domain-modeling（术语核对）/ writing-for-agents（矩阵文体）/ implement（脚本）

## T2 重跑执行（覆盖：D-001 重跑义务 / D-003 T2 / D-004 调度+驻留+归档）
- run 前断言语料指纹=7ac0a48e55cd7954，漂移→装置旗标停
- 存量 delta.json 归档 delta-2026-09-26.degraded.json（不删，披露其 worse 部分为配额伤非真信号）
- runner 最小改动：条目调度加 control 前置排序位+处理层 vdomain×stratum 轮询交错；commit 注「instrument-health ordering, no sampling-protocol change」；CONCURRENCY 维持 4
- 对照层先行全跑→装置旗标判定（non-tied≥4/16 或 unknown>8/16）→旗标即早停，落 INCONCLUSIVE 流程
- 处理层跑批：配额耗尽截断时记各域完成格数（truncation 注记原料）；跑完产新 .scratch/vertical-eval/delta.json
- boy-scout 同面=hunk 邻接级：argv 序列化重复/kill-timer/fakeSink/marked 遮蔽/isVerticalEntry 五项限触到才修，独立 commit；离面项一律不动
- suggested skills：implement + tdd（runner 改动负径先行）/ code-review（改动面复核）

## T3 判读+决策记录（覆盖：D-001 判读纪律 / D-002 矩阵执行 / D-003 T3）
- 确定性脚本读 delta.json 按矩阵查表出裁决——机器算不人手算，人肉改判=矩阵作废
- decision-record.md 落盘：四字段（净胜率 (better−worse)/nPaired + P(better>worse) + EL + rankDiff 中位）+出口裁决+per-domain/stratum 副列+truncation 注记+对照层健康行+**operator/verified-by 签认字段**+delta.json 路径+指纹引用（不入库本体）
- 单次终读纪律执行：本票只读一次；全程禁中途读数
- suggested skills：implement（判读脚本执行）/ domain-modeling（出口语义核对）

## T4 收口（覆盖：D-001 完成定义 / D-003 T4）
- registry 状态迁移（三出口择一）：GO→defer-r83-prefer-capable-weighting 注记转「数据在手信号正向，下轮设计加权」+具名跟进票；NO-GO→核销附判词（rejected 记 reason）；INCONCLUSIVE→显式 hold 态+具名触发带量化锚（|Δ|≳0.4+n 条件）
- defer-r84-delta-quota-rerun 按重跑实绩核销或转 hold
- CONTEXT 新词已在库（R85 词块）；closeout-claims.json 注册矩阵阈值+指纹断言+出口裁决供派生复核
- GO/NO-GO 终局立 ADR-0086（含三处设计声明+仓内首创标注）；INCONCLUSIVE 不立 ADR 只落报告
- nit 两档+Goodhart 对称警惕（读数面与断言面双向查）；报告档全字段（含降格/截断如实披露）
- suggested skills：domain-modeling（ADR+词表）/ neat-freak（registry 对账收口）/ handoff（下轮交接）

## 红线（全轮适用）
- 预注册 commit 先于任何读数；单次终读禁 peeking；不报 p 不设显著性门禁；INCONCLUSIVE 必附量化锚具名触发；unknown/null 不记 0；稀薄记 coverage 缺口不删层；融合级列只报告不进门；ANYSEARCH_ENDPOINT 用户域不入档；加权实施不在本轮；#1764 用户侧不代发；清障离面项不碰。

## 残余观察位（不动工只记录）
- defer-r84-ip-fifth-domain（上游补 ip 结构化参数再建集）
- 清障轮候场：empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical 边角/MCP 缩进/control 存在性降级口径
- 若判读 GO：下轮=prefer-capable 加权设计轮（本决策记录为输入）
