# Q2 调研记录 — vert-f1105 处置与修订幅度

日期: 2026-10-01 | 问题: Q2 缺陥格处置（A 降格 / B 改spec换芯 / C 先活查后裁 / D 宽口径体检）

## atomcode 深调（本轮配额可用，完整出报）

**推荐 C（先活查后裁），预注册两分支：复活→零改动；仍拒收→落 A（原位降格+墓碑理由码）；否决 B、D。置信度：高。**

核心论据：
1. C 复用 R94 已立法模式（ADR-0095 快照/活查分级+cn_code 具名取证步），非新发明流程；
2. 所有语料改动都 bump 指纹——「保指纹」不是区分维度，真正要裁的是 id 语义是否被偷换；
3. **行业教义一致否决 B**：数据集版本治理共识——格的期望语义实质变更=新 id+旧格 deprecate，原位换芯使两个不同问题共享同一 id，历史读数静默失真。若需 fundamental×cn_code 覆盖=另立新格新 id，下一语料轮立案；
4. C 符合「修复须先取证、前后对照、分别归因」的 benchmark 修复判读完整性教义——两个待分离事实：①运行期 validator 实况（一次活查定案）②文档契约 vs validator 不一致=上游缺陷登记（走 owner/上游渠道，不随格处置湮灭）；
5. 文档 vs 实现不一致归因：逐案辩证——被测对象是运行期行为，expect 禁落运行期不存在的语义（Pact Golden Rule，ADR-0085 明载）；但文档契约承诺仍登记为上游 finding；
6. D 违 ADR-0029 一轮一题——「全语料契约一致性体检」应登记为具名 backlog 独立轮次（本格案恰是其最佳动机证据）。

来源面：searches 6（web_search×3+tavily×2+anysearch×1），五类角度全覆盖，full reads 3。辩证标注：行业教义引用（AIEvals 数据集治理/Digitalapplied 判读完整性）来自已核验全读与摘要——方向性教义可采，具体表述按转述理解。

## 具名活查结果（C 的取证步，已执行）

2026-10-01 匿名重放 vert-f1105 真实 wire 参数（tools/call search {query:"MSFT analyst ratings and target price overview", domain:"finance", sub_domain:"fundamental", sub_domain_params:{type:"overview",symbol:"MSFT"}}，默认公网端点，无 key）：
- HTTP 200，isError=true，回文：`Missing required params for tag 'finance.fundamental': cn_code.`
- **结论：validator 至今仍拒收**——R86 失败四日后确定性复现，非瞬态；文档契约与运行期校验不一致成立且持续。

同日另一次匿名活查 `get_sub_domains{domains:[finance]}`：词表与 2026-09-26 存档（sub-domains-vocab.json）逐字一致——文档未漂移，漂移在校验层。

## 落点收敛

C 的活查分支已实测走完：validator 仍拒收 → 按预注册落 **A 原位降格**（vert-f1105 移出可测集+墓碑理由码，matrix 57→56，指纹滚动）。上游「文档词表 vs validator」不一致登记为 finding（owner anysearch-eval 上游渠道候选）。

## 环境约束附记

- `ANYSEARCH_ENDPOINT` 本机指向死回环 127.0.0.1:20128（R85 同型缺陷仍在）；`ANYSEARCH_API_KEY` 对公网端点 invalid_api_key。匿名层可用（get_sub_domains/search 均 200），但 delta 腿大跑撞匿名配额边界史有先例（defer-r86-anon-quota-nudge=permanent）。delta 全量重跑的环境前置（端点覆写为默认公网+配额预算）是本轮执行设计须裁事项。
