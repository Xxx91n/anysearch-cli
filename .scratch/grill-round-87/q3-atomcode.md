# R87 Q3 轮结构票序调研报告（atomcode 归档，检索重排）

## 1) 执行摘要（Tl;dr）
**推荐 A（发布先行，记账随收口），Confidence：高。** 工业界心智模型是二元拆开的：**随制品出闸的内容（CHANGELOG、版本号、release notes）必须在 tag 之前进 commit**（多个 checklist 明文要求），而**不进制品的记账件（勘误脚注、defer 注记、下轮登记）属于 post-release housekeeping，业界惯例就是发布之后落**。方案 B 会让 tag 与 tip 分叉一行，违背 D-002「tag 挂 cfb0fff7=当前 tip」的钉定语义，且没有任何对价收益——纯损失。

## 2) 分点结论

### 2.1 cut-then-record vs record-then-cut：取决于「记的账进不进制品」
| 类别 | 内容 | 业界时序 | 证据 |
|---|---|---|---|
| 进制品的 | CHANGELOG 版本段、版本号 bump、release notes（若 CI 从 tagged tree 读取） | tag 之前 commit | Zhortein checklist §5「Before tagging: CHANGELOG contains the release version section」；Qube「Add ## [X.Y.Z] in the same commit you intend to tag」；agentops 真实失败案例：release notes 在 tag 之后才 commit，GoReleaser checkout tagged tree 找不到，被迫重排为 generate→stage→release commit→tag |
| 不进制品的 | Post-release 验证记录、roadmap 更新、后续 issue、审计档案、unreleased 段回填 | 发布之后落 | Zhortein §7「Repository housekeeping」在 tag/publish 之后；DevPlaybook Post-Release 段；Keep a Changelog 的 [Unreleased] 段机制本身预设「发布后新账进 Unreleased」 |

映射到 R87：F-3 勘误脚注、defer-r86 注记、R88 登记——全都不进 npm 包，落在 T5（publish 后）恰恰是标准落点。「写发布时态的文档，要么在 tag 前作为制品内容，要么在发布后作为事实记录——最糟的是在 tag 前写预测态又被发布结果打脸」。

### 2.2 tag 挂非 tip SHA：合法但必须有意为之；B 的分叉是「无收益分叉」
trunkbaseddevelopment.com：「tag does not have to be current HEAD… perfectly legitimate to reach back to an earlier commit—a known-good SHA」；但合法理由全是排除性的（排除 tip 上未结算工作）。B 的分叉一行唯一效果=tag 不再等于 dispatch 验证过的审计 tip，与 D-002 钉定冲突；「先清旧账」收益 A 的 T5 晚几十分钟即可达成。反向佐证：Zhortein failure policy「After publication, never move a stable tag」+ Qube「Do not delete or force-push tags unless nothing was published」。

### 2.3 发布轮与文档收尾分离：正常且常见（post-release housekeeping 惯例）
### 2.4 deprecate 排在验证绿之后：与 npm 生态最佳实践一致

## 3) 对比矩阵
| 项 | A 发布先行记账随收口 | B 记账先行 |
|---|---|---|
| tag 与 tip 关系 | tag=cfb0fff7=tip 零分叉 | 分叉一行无排除性收益，违 D-002 钉定 |
| dispatch 验证一致性 | 验证的树=tagged 树 | 引入「验证对象≠发布对象」缝隙 |
| 记账件时态 | 发布后如实记终态 | tag 前被迫写预测态 |
| 业界惯例吻合度 | 完全吻合（进/不进制品二分） | 部分吻合 |
| 与账本 D 冲突 | 无 | 与 R87-D-002 冲突 |

## 4) 与账本各 D 的冲突清单
- **R87-D-002（tag 挂 cfb0fff7=当前 tip）**：B 直接冲突——T1 记账批使 tip 前进，tag 落 cfb0fff7 即「与 tip 分叉一行」。A 无冲突。
- **R87-D-001（记账件如实记发布已完成终态）**：B 记账发生在发布前，无法如实记「已完成」终态。A 吻合。
- **R87-D-001（不混排工程项）**：B 把记账批插到 dispatch 之前，若触发 ship-gate/pathlint 重跑=把记账混进发布前置链路——灰色地带，A 更干净。
- **R86-D-001~D-005**：两案均不冲突；A 的 T0 哨兵续班与 R86-D-004 票序骨架一致。
- **D-002 D1′（deprecate 验证绿后收口前）**：两案均吻合，无差异。

## 5) 信息缺口
- 未找到「审计账本+发布收口」同构的公开项目先例（grill-round/decision-ledger 是本项目自创），T5/T6 落点判断基于通用 post-release housekeeping 惯例外推。
- npm OIDC trusted publishing 对「首个版本」有限制的已知 issue（npm/cli#8544）出现在搜索结果中——提示 R87 发布后验证（T3）应覆盖首版 OIDC 特殊路径，此点本轮未深挖。

## 来源清单
1. trunkbaseddevelopment.com/branch-for-release — tag 挂非 tip SHA 的合法条件（排除性理由）；release from a tag 具名实践
2. agentops commit 24d9f25「include release notes in tagged commit」真实失败案例（GoReleaser checkout tagged tree 找不到 release notes）
3. Zhortein release checklist §5/§7 + failure policy（tag 不移动）
4. Qube release tagging 惯例（same commit tagged；不删不强推 tag）
5. Keep a Changelog（[Unreleased] 段机制=发布后新账进 Unreleased）
6. DevPlaybook Post-Release 段（verify→close milestone→announce）
7-8. npm deprecating 生态最佳实践（deprecate 时机=fix 在架后）
