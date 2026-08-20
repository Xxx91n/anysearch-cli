# ADR-0013: Architecture Grill Round 10 — REUSE/COMPRESS NOOP 裁决算法设计

## Status

Accepted

## Context

ADR-0012 D3 实现了 L0 双轨触发（低水位线 128K + 检索后事件），但触发后直接 COMPRESS（调 generateSummaryWithUsage），没有 REUSE 分支——即使新检索结果已被现有 IR 摘要完全覆盖，也会花钱再生成一次增量摘要。REUSE/COMPRESS 判别算法是 ADR-0012 标注的 #1 架构优先级（CONTEXT.md "REUSE/COMPRESS 判别"术语已列为待设计项）。

atomcode 调研（18 篇来源交叉验证：Mem0 论文 arXiv:2504.19413 + 文档、MemGPT 论文 arXiv:2310.08560、Letta 文档+issue #957、Zep 论文 arXiv:2501.13956、Chroma context rot 报告、LOCA-bench arXiv:2606.29718、Anthropic context engineering 指引）确认：Mem0 NOOP（向量检索+LLM 裁决跳过写入）是工业化最成熟的 REUSE 实现；MemGPT 双级阈值（70% warning / 100% flush）是 COMPRESS 触发先例；信息密度度量在整个领域仍是未标准化的开放问题。

## Decision

### D1: Mem0 式 LLM 裁决 NOOP（Q1）

采用 Mem0 NOOP 语义作为 REUSE 判别核心机制。检索工具返回后，用便宜摘要模型裁决"新检索结果是否已被现有 IR 摘要覆盖"：覆盖 → REUSE（跳过摘要生成），有新信息 → COMPRESS（增量生成）。对齐 Mem0 A.U.D.N. 四路裁决的 NOOP 分支，但简化为二元（IR 摘要三段只增补不覆盖，无 DELETE/UPDATE 语义）。废弃 MemGPT 纯阈值方案（无 REUSE 分支）和 Zep bi-temporal 方案（图数据库超出当前架构）。

### D2: Gap 蒸馏 + 现有摘要作为裁决输入（Q2）

裁决 LLM 输入 = 自上次摘要以来的检索工具返回蒸馏内容（gap 蒸馏）+ 现有 IR 摘要全文。不从完整 messages gap 中取对话内容（用户闲聊、assistant 推理）——信息覆盖度判断的输入只有检索结果和现有摘要。对齐 Mem0 "候选事实 + top-k 邻居记忆"的输入构造。Token 成本：gap 蒸馏通常 500-2000 token，远低于完整 messages gap（5K-20K）。

### D3: 二元 function-calling REUSE|COMPRESS（Q3）

裁决 LLM 用 function-calling 返回 `{ decision: "reuse" | "compress" }`，单字段无自由文本。对齐 Mem0 function-calling 四路裁决但简化为二元。不取三元（加 APPEND）——APPEND 直接拼接会破坏 IR 5 段 schema 段落结构。不取自由文本——解析脆弱。

### D4: 双轨触发分流 — 检索后判别 / 低水位线直接压缩（Q4）

NOOP 裁别只挂在检索后轨道（`triggerPostSearch`）：先裁决，REUSE 则跳过压缩，COMPRESS 则调 generateSummaryWithUsage。低水位线轨道（`triggerLowWatermark`）直接 COMPRESS 不判别——窗口管理是硬约束，对齐 MemGPT 100% flush 硬触发语义。两条轨道回答不同问题：检索后判别回答"新信息值不值得花钱再生成摘要"，低水位线回答"窗口要爆了必须腾空间"。

### D5: 两级异步执行模型（Q5）

裁决 LLM 调用 fire-and-forget，裁决结果 .then() 里决定是否 fire-and-forget 压缩。两级异步对齐 ADR-0012 D6 已确立语义和 Letta sleep-time compute 心智模型。最坏延迟从"晚一轮"变成"晚两轮"可接受——IR 摘要价值是跨会话长期资产。shouldStopAfterTurn 内 triggerPostSearch 分支：先 fire-and-forget 裁决，裁决 .then() 里 REUSE 则结束、COMPRESS 则 fire-and-forget generateSummaryWithUsage。

### D6: 裁决 prompt 内联 IR 5 段结构逐段覆盖检查（Q6）

裁决 prompt 明确列出 IR 5 段名称（已查证证据 / 未决假设 / 被否决信源 / 关键数字与来源 / 工具调用与已读状态），让 LLM 逐段判断新检索结果的每个关键信息点是否已落在现有摘要对应段内。全部覆盖 → REUSE，有未覆盖信息 → COMPRESS。对齐 Memanto（arXiv:2604.22085）typed semantic memory 分段独立判断理念。增量 token 成本 ~100 token（5 段名称），可忽略。

### D7: 复用 compaction.model（Q7）

裁决和摘要共用 `domain.toml [compaction].model`（默认 deepseek-v4-fast），一个模型干两件事。裁决是轻量判断任务（~500 token 输入 + ~10 token function-calling 输出），同模型足够。零新增配置面。对齐 Mem0/Letta 同模型复用先例。不新增 `[compaction].judge_model` 配置——裁决误判风险不因模型差异化而降低，增加配置面无收益。

### D8: 连续 REUSE 上限 3 次强制 COMPRESS 兜底（Q8）

维护 `consecutiveReuses` 计数器：REUSE 则递增，COMPRESS 则归零。连续 3 次 REUSE 后第 4 次跳过裁决直接 COMPRESS。防止裁决 LLM 系统性偏差（总判 REUSE）导致摘要长期过期。对齐 LOCA-bench "更高频压缩 → 更少 rot"结论和 Letta issue #957 死循环故障先例。

### D9: 从 messages 过滤 tool_result + 截取上次摘要 anchor 后的 gap（Q9）

gap 蒸馏提取方式：遍历 messages，定位上次 rolling_summary anchor 对应的消息位置，取之后 gap，从中过滤 `role=tool` 且 tool_name 包含 search 的消息内容。最简路径，零新增状态管理。不维护独立 gap buffer（增加状态复杂度），不从 L2 FTS5 查询（引入持久层延迟）。对齐 Mem0 从对话历史提取候选事实的工业做法。

### D10: 裁决失败 → 默认 COMPRESS（Q10）

裁决 LLM 超时/报错/返回不可解析结果时，直接走 COMPRESS 路径调 generateSummaryWithUsage。信息保真保守策略——对齐 Mem0 "不确定就写入"语义。不默认 REUSE（LLM 服务故障时连续 REUSE 触发 Q8 兜底，但兜底走 COMPRESS 也会失败，形成无效循环）。fail-open 的正确语义是"裁决挂了就当没裁决，直接压缩"。

### D11: 四组契约测试覆盖裁决四个出口路径（Q11）

mock LLM 层（fake function-calling 返回），四组测试：
1. REUSE 路径：mock 返回 `{ decision: "reuse" }` → 验证不调 generateSummaryWithUsage、consecutiveReuses 递增、不写新 anchor
2. COMPRESS 路径：mock 返回 `{ decision: "compress" }` → 验证调 generateSummaryWithUsage、consecutiveReuses 归零、写新 anchor
3. 连续 REUSE 兜底：mock 连续 3 次返回 REUSE → 验证第 4 次跳过裁决直接 COMPRESS
4. 裁决失败 fail-open：mock 裁决 LLM 抛错 → 验证走 COMPRESS 路径

对齐 ADR-0012 D15 mock LLM 策略。真实 LLM 集成测试放用户真实环境阶段。

## Alternatives Considered

- **MemGPT 纯阈值双级触发**（Q1 B）：简单可靠零额外 LLM 调用，但完全没有 REUSE 分支——每次触发都 COMPRESS，不省调用。
- **Zep bi-temporal 非破坏性更新**（Q1 C）：最精确（DMR 94.8%）但需要图数据库，远超当前 SQLite+FTS5 架构。时间边缘效应已覆盖部分 bi-temporal 语义。
- **完整 messages gap + 现有摘要**（Q2 B）：更全面但 token 消耗大（5K-20K），对话噪声干扰信息覆盖度判断。
- **三元裁决 REUSE|COMPRESS|APPEND**（Q3 B）：APPEND 直接拼接破坏 IR 5 段 schema 段落结构。
- **两条轨道都走 NOOP 判别**（Q4 B）：低水位线拒绝压缩会加剧 context rot，违反窗口管理硬约束语义。
- **裁决同步 await + 压缩 fire-and-forget**（Q5 B）：同步等裁决阻塞 agent 循环 1-2s。
- **独立裁决模型**（Q7 B）：增加配置面，裁决误判风险不因模型差异化而降低。
- **无连续 REUSE 上限**（Q8 B）：裁决系统性偏差导致摘要永久过期。
- **裁决失败 → 默认 REUSE**（Q10 B）：LLM 服务故障时形成无效循环。

## Consequences

正面:
- REUSE 分支省掉不必要的 LLM 摘要调用——信息专精 Agent 的检索结果经常是对同一主题的渐进深挖，信息覆盖度高，REUSE 命中率预期可观
- 逐段覆盖检查对齐 IR 5 段认知分段理念，信息保真度有结构化保障
- 连续 REUSE 兜底 + fail-open COMPRESS 双安全阀，防止裁决偏差和故障导致摘要过期
- 双轨触发分流语义清晰：信息覆盖度判别（软）vs 窗口管理（硬）

负面:
- 每次检索后多 1 次 LLM 调用（裁决），但用便宜模型 + 短 prompt，成本可控
- 两级异步最坏延迟两轮——IR 摘要晚两轮生效，但跨会话长期资产可接受
- consecutiveReuses 计数器是新增内存状态，agent 重启后归零（可接受——重启本身就是新会话语义）
- 裁决 prompt 的 IR 5 段逐段检查增加裁决 LLM 的推理负担，可能影响裁决速度——但 deepseek-v4-fast 1M 上下文 + 快速推理，预期可控

关联: ADR-0012 (D3 双轨触发 + D5 IR schema + D6 fire-and-forget + D7 compaction.model), ADR-0009 (D6 fail-open), ADR-0010 (D1 热冷路径)。
