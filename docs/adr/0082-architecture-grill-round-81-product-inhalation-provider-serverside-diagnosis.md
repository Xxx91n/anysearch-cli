# ADR-0082: Grill Round 81 — 产品吸气轮（provider-serverside spike 诊断 + 发布插曲协议立法 + R1 幂等跳过）

## Status

Accepted (product-inhalation round r81; release.yml publish-leg patch as the only code-surface change — no package content bump). Records the round-81 decisions per ticket plan T0/TI/T1a/T1b/T2/T3/T4. Ledger: `.scratch/grill-round-81/decision-ledger.md` (D-001~D-005, 无断号). Evidence root: `.scratch/grill-round-81/evidence/`.

## Context

R81 是「产品吸气轮」：把 deferred-registry 落选池里的 `defer-r71-provider-serverside` 吸收为本轮唯一主轴。背景：R71 T1.2 spike 时 provider live search 观测 HTTP 000，彼时改以直接种子 memory 行绕验——server 侧病因从未诊断。同时本轮承担发布插曲协议立法：R80 把五包发布集备齐，用户扳机（手发 dsh-plugin@0.0.7 / npmjs TP 四字段 / 推 v0.0.8 tag）一旦落下，run 失败时的分级处置必须有成文规程。附随义务：T0 上游哨戒（dsh 出闸复检 + #1764 + llm-init flake-watch + dsh-native-tools 触发器）。

## Decision

### D1 主题定界——产品吸气轮（D-001）

本轮=吸收债轮：唯一主轴 provider-serverside spike；发布执行=触发即插的插曲协议，**不是独立工作流**（插曲不占票序槽位，触发时暂停当前票序执行规程后恢复）。

### D2 spike 推荐/裁决分离 + 三分支裁决（D-003/D-002）

红线：spike 产推荐不裁决；本 ADR 为裁决落点。T3 诊断书证据链：

- 已证伪：H2（fake-ip DNS 污染）/H3（代理出口屏蔽）/H4（TLS 病理）——fake-ip 列与真 IP 列同得 CF 应答（X-Amz-Cf-Pop NRT20-P9），TLS 握手健康，新证书 2026-09-22→2027-04-07；「服务全死」亦证伪（/health 200 + apex/status 200）。
- 实测事实：`GET /v1/search` = 路由级 404（双列一致）；`POST /mcp` = 活 MCP Streamable HTTP 端点（initialize → anysearch-mcp-server v1.0.0；tools/list 四工具全列；tools/call search 867ms 真实结果）。
- R71 000 归因收窄：本机 `ANYSEARCH_ENDPOINT` User 级常驻 env（=127.0.0.1:20128/v1/search，OmniRoute 端口）把 provider 钉到本地——dead-port → connection refused → 000 形态在本机精确复现（T2 P-C），无需远端参与。

**裁决：采纳分支 b（死但可修 → 修复路线）**。REST /v1/search 路由下线为外部事实（不归我们复活），但同域 `POST /mcp` 活且全功能——修复=AnySearchProvider 迁 MCP-over-HTTP，纯自侧工程票。分支 a（端点复活）不适用（外部不可控）；分支 c（降级/换 provider）为兜底——若 R82 实施发现 /mcp 凭据门/不稳定则回退评估。修复代码出本轮域（R82 票 `fix-r82-anysearch-mcp-migration`）。

### D3 发布插曲协议 + R1 幂等跳过（D-004）

三扳机定义不变；触发后规程=暂停→用户清单→失败分级→证据 →恢复票序。失败分级（docs/publishing.md 已立法节）：

- **C1** 零发布（首包即失败，如 OIDC/TP）：修因 + 同 tag `gh run rerun`；
- **C2a** 部分发布+基础设施因：修因 + 复跑补全（R1 兜底已落包 skip）；
- **C2b** 部分发布+内容坏：patch-forward，**永不 unpublish**；
- **C3** 全发后冒烟败：deprecate + patch-forward；
- **unpublish 边界**：仅灾难性事故（凭据泄漏/错包/license 违规），永不作首发响应。

R1 幂等跳过（release.yml publish 腿）：每包 publish 前 `npm view <name>@<version>` 已存在→`::notice::` skip；E403 "cannot publish over"/EPUBLISHCONFLICT/already-published 容错兜底（check/publish TOCTOU）；其余错误照旧失败。npm 无内建 skip 开关（rfcs#387），precondition-check 为通行解。**插曲事件 1 已落地实证**：三扳机 2026-09-23 全扣（0.0.7@17:02Z 手发 + run 35894640525 success + 五包 0.0.8+attestations + 装跑冒烟全绿）——evidence/release-interlude-1.md。R1 补丁对同 tag rerun 零副作用（双格实测：已发包→skip 不误伤，未发包→publish 分支正常进入）。

### D4 宣称修正（D-005 衍生）

T1b 审计 PASS=9 / FAIL=0 / RESHAPE=4：

- 本轮内落地（宣称修正票）：`fix-r81-anysearch-live-annotation`——anysearch.ts 注释改写（验证面限定=基础设施层 + cert 新值 2027-04-07 + 404 注记 + /mcp 活面）；`fix-r81-registry-evidence-reshape`——registry evidence 改写为实测精确形（000=本机 env 面而非远端死）。
- 携入 R82：`fix-r82-anysearch-rest-contract`——C-1/C-2/C-13 REST 契约三件套（端点注释/响应形宣称/mock fixture）按迁移落地形态重写。

### D5 落选债续记 + 新债

carried_log r81：9 条 open 债显式续记（落选≠飘过）。closed：`defer-r71-provider-serverside`（本轮裁决）、`defer-r72-dsh-plugin-npm-publish`（三扳机实证）。新增 open：`defer-r81-provider-shape-validation`（200-错形静默零结果面，OmniRoute 发现）、`defer-r81-anysearch-rest-route-removed`（REST 路由下线事实+季度复活监控）。

## Rejected alternatives

- **并行腿**（spike 与哨戒/其他债并发主线）：吸收轮保单主轴——诊断深度优先，并行会稀释 spike 时限窗（D-003 §1 明确否决）。
- **unpublish-first**（部分发布坏时先撤回）：registry 历史不可改语义优先——unpublish 破坏已解析 lockfile 且 72h 窗脆弱；patch-forward 是唯一默认（D-004 §4）。
- **最小收口**（只产诊断不落文书）：三段收口（证据/就绪/文书）为硬结构——省去文书则宣称修正无处落地。
- **分批发布**（按包就绪度拆 tag）：五包一致性优先于灵活度——部分集发布制造版本矩阵地狱。
- **dry-run 验证**（`npm publish --dry-run` 充验收）：不覆盖 auth/版本冲突/TP 真实面——R1 验收必须双格实测（已发包 skip + 未发包不误伤），禁替身。

## Consequences

- 正：provider-serverside 债诊断收口（000 归因本机化+/mcp 活面发现=修复路线可行）；R1 幂等跳过使 C1/C2a 复跑安全；插曲协议有成文分级；宣称审计清零过度宣称。
- 负：anysearch REST 臂当前实际不可用（fail-open 兜底，无用户可见故障但 search_web 的 anysearch 臂静默缺席）——R82 迁移票前维持此态；OmniRoute 错形静默面新暴露。
- 中性：CI 无 provider live-search 探针面的事实未改（分水岭证据缺席如实记）；若 R82 迁移落地，可补 /mcp 测活腿。
