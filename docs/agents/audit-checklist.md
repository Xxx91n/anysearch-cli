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

