# Audit Checklist — round 审计模板

每轮代码审计（内部 diff 复核或外部 atomcode 审计）必过此四轴。ADR-0028 D6。

## 1. 安全评审轴（独立)

安全/隐私独立走 code-vulnscan / perseus 检查链，不许被 ponytail review 顺带覆盖。最低清单：新 trust boundary 输入校验、secret 处理面、依赖/供应链变化、fail-open/fail-closed 边界是否被侵蚀。

## 2. Diff 规模纪律

单轮审计覆盖的 diff 超过 500 行或 5 个文件时自动拆轮，先大体量文件逐块过。超出者不许在本轮声称「复核完成」。

## 3. 评审指标

每轮审计收尾向 handoff 写三元组：`发现 N / 修复 M / 遗留 K`，遗留项必须带下一轮的承接说明（进 grill 或债务）。无三元组的审计视为未完成。

## 4. 冲突仲裁

仲裁序：ADR > AGENTS.md > skill 当前实现 > 个人偏好。多个 skill 结论冲突时立即停手问用户，不许自行取舍。

## ADR-0034 Answer Attribution Layer

- [x] 纯逻辑验证全绿（packages/kernel/test/attribution.test.ts 30+ cases）
- [x] 准备（Packages 编译模型验收）
- [x] 后端接口（MCP structuredContent 双通道）
- [x] 前端（CLI --json 输出 + TTY渲染）
- [x] 测试覆盖（attribution / gap-request / abstain / judge-escalation）
- [x] 文档更新（ship-gate assertion 1f-1h / CONTEXT.md）

### 审计要点（ADR-0034-specific)

- [x] attribution.attribution 字段与 verified:false 正交（两条互补通道）
- [x] unsupported 必须是确定性反对（否定关键词 + 高重叠），不是"找不到”（找不到一律归 uncertain）
- [x] judge 升级仅作用于 uncertain 且有证据的 claim（shouldEscalateToJudge）；无证据即诚实 uncertain，不隐式升级为 supported
- [x] MCP 双通道：attribution 同时出现在 content JSON 和 structuredContent
- [x] --json 输出无 ANSI charset（纯结构输出）
- [x] GapRequest 通过 envelope.attribution.gaps 传递（sufficiency-gate reround 触发）

## ADR-0035 KG-lite Relation Layer

- [x] golden `relations` 组先行（8 谓词正例各≥1 含中文引号、fail-closed supersede、配对强负例 no_edge、1-hop hop 观测；53 案 12 组全绿，指纹翻牌后 --calibrate 重基线）
- [x] edges 表 + 部分唯一活性索引 + 谓词 CHECK + edge_patterns 校验表（schema.sql 与 relation.ts PREDICATES 完全一致）
- [x] combine() 三动作（memory_entity 重指 + 边重指 + snapshot redirectedEdges/closedDupEdgeIds）；unmerge 有界恢复（活性冲突防复活守卫）
- [x] 规则优先 + ≤1/写 LLM seam（parse 降级容错，fail-open，relationTel 9 计数含 pendingEdges 派生仪表）
- [x] 第五臂 RRF 0.5 接入（label "relation"，1-hop 邻居 episode 回链，cap 100）
- [x] CLI `ans relation list` / `backfill-relations`（dry-run 默认，keyset 分页，--reprocess 不删行，exit 0/1/2）
- [x] ship-gate 1j 静态断言 + metrics.relation 区 fail-closed

### 审计要点（ADR-0035-specific)

- [x] 无 TTY 也安全：每轮抽取只走规则，LLM seam 仅在规则空时激活一次
- [x] no_edge / hop 指标仅观测不进门槛（预算留白预注册），assert_edge/supersede 走常规 fail-closed 通道
- [x] 谓词表变更 = golden 变更 = 指纹翻牌 + 强制重基线（与 ADR-0027 D9 同一纪律）
- [x] 修复回灌：unmerge 的 memory_entity 恢复按 (memory_id, entity_id) 精确行更新（多实体记忆 UNIQUE 冲突回归）
- [x] dry-run = 回滚事务内的同一条管线，计数为精确预测；apply 同为整轮单事务（r87 F1，r88 措辞翻正）
- [x] --full-refresh 与 --from-id/--limit 互斥守卫：CLI exit 2 + store 层 throw，含 relation-edges.test.ts 回归断言（r88 修复）
- [x] related_to write-once 遥测纯度：首次共现物化边、重复计 relatedToWriteOnce（不混入 dedupSkipped，r87 F2/F7）

## ADR-0036 Relation-Arm Gain Observance

- [x] 单跑反事实消融（D3/D5）：searchMemory 侧捕获 ArmProvenance（labels/lists/weights/fusedIds/texts），runner 丢 relation 列表重算 RRF，paired delta = (rankOff - rankOn)/60，不误伤单跑成本
- [x] 配对统计（D2）：BCa 95% CI（mulberry32 定种 bootstrap + jackknife 加速）+ 单侧 sign-flip 置换检验（B=10000）+ Sakai n 公式（cap 80）+ chi² Wilson-Hilferty sigmaD upper
- [x] 判定规则（D4）：BCa 下界>0 AND mean≥minGain(0.1) AND signFlipP<0.05 才记 PASS→本轮观测 WARN；违反即 FAIL；欠功效/退化/缺基线一律 WARN 不 gate
- [x] sanity 通道（D5）：hop 命中率高但 RoR delta≈0 / 命中率为 0 但 delta 非零 两种组合 → WARN + 人工复核，永不进门槛
- [x] golden 扩案（relations 组 12→78）：30 EN RoR + 8 CN RoR（含 14 干扰记忆防向量臂回流）+ 14 EN 别名 + 8 CN 别名 + 6 no_edge 负例；指纹翻牌后 50 趟 --calibrate 重基线（EVAL_TIMEOUT_MS 需放大）
- [x] 校准实测：sigmaDU=0.102、lockedN=17（rawN=17，pilot n=42 非退化 → 不再锁 cap 80，符合 D2 recalibrate 预注册）；首次 gate 运行 mean=0.148 BCa95=[0.1254,0.1671] signFlipP=0.0001 → observational WARN 落地
- [x] 回归测试 eval-relation-gain.test.ts：mdeForPaired/lockN/sigmaDUpper 公式值、BCa 定种确定性、sign-flip 显著性、判定双向（低于 minGain 必 FAIL）、欠功效 WARN、sanity 组合、真 RoR case 端到端反事实（off>on）

### 审计要点（ADR-0036-specific）

- [x] Track A 消融是唯一因果判定通道；历史裸基线永不 gate（ADR-0027 D9 纪律延伸）
- [x] 命中类指标（hopHitRate）降级为 sanity 参考，不与 RoR 混权
- [x] RoR case 的 corpus 噪声必须足以把向量臂单独能力压出 top-2，否则 paired delta 退化（14 干扰记忆为当前实测标定值，与 distractor 模板强耦合）
- [x] 50 趟校准墙钟 > ADR-0029 D5 默认 600s 看门狗时，用 EVAL_TIMEOUT_MS 显式放大而不改默认值

### r90 审计复核（round 91 落地）

- [x] F1 已修：ADR-0036 D5 与 CONTEXT「Judgment vs Sanity」术语的 RoR delta 符号约定反转（文档写 negative=上推，实现/测试/基线均为 positive=帮助）——改为 positive，消除规范-实现回归陷阱
- [x] F2 已修：BUSY 注入测试锁持 150ms 被 busy_timeout=5000 吸收、退避分支零覆盖 → 改为持 5200ms 强制 SQLITE_BUSY 走指数退避
- [x] F3 已修：失败批计数快照补 relatedToWriteOnce，消除遥测双计
- [ ] F4（观察，不修）：基线 42 deltas 含 6 个零（臂未激活案），mean 被稀释——方向保守，下轮可视需要切 treatment-active 子样本报告
- [ ] F5（观察，待下轮确认归属）：验收 2 所指 ship-gate 新断言本轮未见 ship-gate.mjs diff

### r94 审计复核（ADR-0037，atomcode + 双子代理三轨）

- [x] 总体判定 PASS（D1–D7 全部落地，D7 六断言证据链完整）；atomcode 对 e-branch-2 做新鲜度核验并确认 r93 审计维持有效
- [x] Fixed F1（atomcode Spec-1）：searchMemory 单查询路径 byId 未收 semantic 臂合成负 rowid → 静默丢弃；session-store.ts 已补 byId.set + 回归测试（MCP recall_memory 消费者路径受益）
- [x] Fixed F2（atomcode S1）：kernel llm-init.ts 读 ANS_LLM_API_KEY 违反 "No env reads in kernel" 头契 → 移除，caller 显式传参
- [x] Fixed F3（Bacon P2）：applyArchive 显式 ids 路径补 pinned/valid_until/quarantine 强制点
- [x] Fixed F4（Bacon P2）：consolidateMemoryRun LLM summarize 移出 BEGIN IMMEDIATE（plan/apply 两相，dry-run exact prediction 不变）
- [x] Fixed F5（Pascal P3）：ans consolidate 未知 flag 拒绝（exit 2）
- [x] Fixed F6（Bacon P2 注释）：runner.ts / session-store.ts Phase-1 shadow 陈旧注释同步至 serve 语义
- [x] Fixed F7（Pascal P1/P2）：CHANGELOG 补轮次条目；CONTEXT.md 术语补 `## ` 标题前缀
- [ ] Deferred D1（Bacon P2）：dry-run 报告缺 tier 分解/rrfArmImpact 字段——已写入 ADR-0037 r94 修订记录现状，需要时再补字段
- [ ] Deferred D2（观察）：llm-init.ts 134-136 预存 env 读（OPENAI_/ANTHROPIC_/GOOGLE_API_KEY）属 r93 之前就存在的契约松弛，出本轮 scope，下次 kernel 轮统一收割
- [ ] Deferred D3（Pascal P3）：consolidate 与 forget 的默认 apply/dry-run 不对称文档化为入口差异，行为不动
