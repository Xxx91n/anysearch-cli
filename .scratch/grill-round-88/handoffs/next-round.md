# R88 常驻任务书 — 搜索面卫生轮（search-surface-hygiene）

> 数据源：.scratch/grill-round-88/decision-ledger.md（D-001~D-005 全 current）+ goal.md。任何与本任务书冲突的口头指令以账本为准；账本未载的结论不许补进文档。

## 轮主题

发布收口后的批次化清债：F-6 probe 脚本 refactor + r83 三票（a03 吞词/a06 三处近重复/a08 死参数）同域纳编。基座=main tip（R87 收口后栈），工作区须净起手。

## 票序（七票，一票一 commit；T5 单文档 commit）

### T0 哨戒续班+基线快照 —— 覆盖 D-004
- dsh 0.1.7-rc.x watch 续班（rc.1 在役、rc.2 候选观察）+CI 观测。
- 基线快照：pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 当前态记录于 reports/baseline-*.md。
- 验收：快照落档，绿/红现状如实记。

### T1 a08 删解构+契约拒收测试 —— 覆盖 D-003
- 删 apps/mcp/src/tools/search-web.tool.ts maxResults 解构+传参（零行为变化）。
- 新增单测断言 SearchWebInput 拒收 maxResults 键（契约不暴露固化显式测试）。
- commit type=refactor。验收：测试绿+解构移除+门禁过。

### T2 a03 位置化旗值消费 —— 覆盖 D-001/D-004
- 先补吞词回归测试（--vertical-domain finance finance 类用例，吞词行为锁死→转绿）再修。
- 修法：位置化旗值消费（--flag 位 i+1 为值位按位置剔除，废值集合剔除）。
- commit type=fix。验收：回归测试绿+其余 flag 路径不破。

### T3 a06 双层归并 —— 覆盖 D-002/D-005
- 前置（D-005②）：为三 surface 错误输出补 golden/快照断言（等价断言已存在则复核豁免并注明）；reason 短码枚举集前置立法写入 ADR-0089 验收判据。
- 运行面：buildVerticalSpec 落 packages/retriever/src/contract.ts，判别联合 {ok,vertical}|{ok:false,reason:短码}；三站接线，错误通道各 surface 渲染且输出 byte-identical。
- schema 面：kernel/tool-schemas.ts 抽 verticalSpecProps 片段供 SearchWebInput/ResearchWebInput，additionalProperties:false+注释随片段。
- commit type=refactor。验收：byte-identical 断言绿+tsc --noEmit+三站行为不变。

### T4 F-6 probe 脚本卫生 —— 覆盖 D-001
- scripts/probe-anysearch-mcp-raw.ts：??/|| 一致化+sanitize 对称遮 endpoint+版本字面量护栏+CHANGELOG 归位。
- commit type=refactor。

### T5 收口件（单文档 commit） —— 覆盖 全条
- docs/adr/0089-*.md（归并边界+判据+a08 注记+熔断/新债闸条款）+CONTEXT 词块已备+CHANGELOG [Unreleased] Removed/Fixed+registry 四票核销（a03/a06/a08/r88-f6-candidate→closed）+closeout-claims+本任务书终态戳。

### T6 门禁+审计 LOOP —— 覆盖 D-004/D-005
- pnpm -r check / test / ship-gate --quick 全绿+惯例审计复核；熔断按 D-005③ 执行。

## 跨票闸（全程生效）

- **新债闸（D-005①）**：发现非预期问题→R84 D-007 三向失真判据分流；发现者无权就地扩票。
- **熔断（D-005③）**：同票连续 2 轮 LOOP 修复失败→回退该票+挂回 registry+缩轮呈报。
- **commit 纪律（D-004）**：一票一 commit；a03=fix 其余=refactor；refactor 不混 behavior fix。
- **byte-identical（D-002/D-005②）**：T3 三 surface 错误输出形状与归并前 byte-identical，golden 断言为唯一真理源。

## 显式范围外

垂域方向重议/广义清债/上游触发债/常驻债×8/0.1.0 钉版动包/外发动作（无 tag/publish/push）/maxResults 契约扩张。

## 汇报纪律

每票毕即报：做了什么+门禁结果+registry/账本是否需要注记；熔断/新债/豁免情形当场回呈用户裁决，不静默吞。

## Suggested skills

- 施工：（tdd at seams——T2 characterization test 先行）/  / -review（收口前）。
- 文档：-modeling（ADR-0089 落成时校对词表）。
- 审计/收口：-freak（T5 一致性核对）。
- 版本控制：（but 全程，一票一 commit）。
- 调研（若施工中遇意外复杂面）：-research。