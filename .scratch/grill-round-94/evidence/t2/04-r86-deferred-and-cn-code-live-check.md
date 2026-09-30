# T2 取证卷宗 04 — r86 两项证据化与 cn_code 串行只读活查具名步骤

时间戳: 2026-09-30 | 覆盖: D-001 / D-002 | commit 类型: evidence

## 1. r86 两项近邻挂账证据化

1. **defer-r86-anysearch-corpus-param-contract**（open）：
   - 事实：语料格 vert-f1105 欠上游 tag 必填参数（finance.fundamental 需 cn_code），矩阵@2 判 unmeasured 如实记账。语料指纹 7ac0a48e55cd7954 处于冻结期。
   - 证明价值：垂域实做在上游契约面存在真实摩擦的物证。
2. **defer-r86-anysearch-anon-quota-nudge**（open）：
   - 事实：上游匿名配额边界触发 auto-provisioning 凭证文本应答，已具名归类 permanent-auth。
   - 证明价值：外部环境存在不可控配额/鉴权约束之物证。

## 2. cn_code 串行只读活查具名步骤

按 ADR-0095 D4 纪律，在开庭议程段 1 执行具名活查：
- **步骤 1：语料库定义复查**：检查 `.scratch/grill-round-84/gen-corpus.mjs:46`，vert-f1105 依然为 `{ domain: "finance", subDomain: "fundamental", params: { type: "overview", symbol: "MSFT" } }`，未包含 `cn_code`。
- **步骤 2：语料指纹校验**：指纹保持 `7ac0a48e55cd7954`，未发生解除冻结之修订。
- **步骤 3：上游契约状态核对**：上游针对 `finance.fundamental` 必填 `cn_code` 之契约无变更通告。

**活查判定**：`cn_code` 契约与支持现状**无任何实质变化迹象**（revise 独立检验条件不成立）。
