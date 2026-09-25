# Q4 atomcode 调研存档——vertical 生效时的 provider 边界（扇出语义）

Date: 2026-09-25. 原题见 q4-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q4）。

## 裁定：A=能力协商 hint 扇出不变（Confidence：高）

三条独立证据链：
1. **EDNS=能力协商+fail-open 教科书先例**（RFC 6891 已读）：扩展方必须 fall back gracefully to unextended；唯一不许 fallback=扩展本身是功能必需（DNSSEC 类）——vertical 不满足（general 引擎对垂域内容仍有真实召回+post-filter 权威闸）。
2. **联邦检索五十年 resource selection + MetaSearchMCP/evidencekit 工程实践**：聚合器价值=扇出+融合归并；selective routing 只在源有结构化独占内容时才收窄；通用引擎不缺垂域内容、缺的是垂域**结构化参数**——参数失效≠源失效。
3. **B/C 强语义误置**：把垂域意图错绑到排除 general 引擎上，侵蚀聚合价值+制造脆性。

## 分点结论（后三点）

5. **B 代价**：vertical 生效时扇出集砍到通常只有一家→MVSS 充分性门交叉验证输入退化为单源，判定失去独立性基础；「垂域意图强=排除通用引擎」是错误推论（用户要垂域相关性非排他性来源）；Exa 一手文档反证——category 与其他过滤参数并行共存同一请求，从未定义为硬路由。
6. **C 代价**：整臂 abstain=可用性被提示性参数劫持——能力位 rollout 滞后直接转全线不可用；EDNS required 例外反向适用（vertical 失效有明确替代语义=general 扇出+post-filter）；唯一可辩护残值（防用户误以为垂域已生效）由审计具名降级+融合层标注解决，代价远小于整臂弃答。
7. **A 案自身风险+既定缓解**：hint 稀释垂域意图风险真实存在——未声明 provider 的 general 结果可能淹没垂域结构化结果；工业界缓解=EDNS prefer capable servers——**融合层对能力位 provider 的垂域命中加权/提位**，配合 D-003 审计记生效值与来源层；意图保真不靠剪枝靠加权——可逆按源评分非请求级硬排他。

## 对比矩阵

| 项 | A 协商 hint | B 限定路由 | C 缺能力 abstain |
|---|---|---|---|
| 聚合价值 | 完整保留 | 单源化 MVSS 退化 | 归零 |
| 垂域意图保真 | 融合加权+审计（软） | 最强但误置 | 形式最强实际最脆 |
| 缺能力行为 | 具名降级照常扇出 | 不参与 | 整臂弃答 |
| 先例 | EDNS hop-by-hop+graceful fallback+prefer capable；evidencekit/MetaSearchMCP partial-failure | 联邦检索无对应物 | 仅 EDNS/DNSSEC required 类，不适用 |
| 脆性 | 低 | 中（单点源故障即空臂） | 高 |

## 信息缺口（辩证）

Tavily 尽（Exa+AnySearch 双引擎覆盖，非主轴点单源）；「abstain 绑架」无直接工业案例=EDNS required 例外类比推导（强推断非实引）；聚合器无「垂域参数+能力位」完全同构先例（能力维度是存活/超时非参数位）——**A 案最近真先例=ADR-0062 D2 自身 includeDomains 模式+EDNS**。

## 来源（节选）

RFC 6891（EDNS）/Exa search reference/Zalando compatibility/evidencekit/MetaSearchMCP/arXiv 1609.04556/Gloria Mark 系打断文献链/WorkingBackwards 等 6 篇全文已读。
