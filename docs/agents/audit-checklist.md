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
- [x] judge 不推荐 unsupported 且证据缺失（会导致呈隐式无关锁到 supported)
- [x] MCP 双通道：attribution 同时出现在 content JSON 和 structuredContent
- [x] --json 输出无 ANSI charset（纯结构输出）
- [x] GapRequest 通过 envelope.attribution.gaps 传递（sufficiency-gate reround 触发）
