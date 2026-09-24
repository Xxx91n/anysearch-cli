# R82 常驻任务书（next-round）

> 由 R81 收口生成。Stack 约定：`r82-grill`（本文档+账本+调研存档）← 实施栈叠其上。

## 主题候选（D-002 指示器裁决）

**推荐主轴：provider MCP 迁移落地轮**——R81 spike 已裁决分支 b（ADR-0082 D2）：api.anysearch.com REST 臂死但 `POST /mcp` MCP Streamable HTTP 端点全活（initialize/tools-list/tools-call 867ms 真实结果实证）。迁移落地后 live 验证+去种子化条件同时成立。

备选：若 dsh 0.1.7-rc.1 出闸且 L2 双锚齐（特征锚已入 rc 线，缺 changelog 审+龄期闸过）→ dsh E1 消费票可作同轮辅轴。

## 票序

### T0 哨戒续班（非可选）

- dsh 三包包闸复检：`npm view @deepseek-ai/dsh-{agent,tools,mcp-client} dist-tags time`——rc.1 闸期 09-25T13:25Z 后出闸，出闸即双锚复核（特征锚已在 rc 线实证 + changelog 审）→ L2 合格即列 E1 票。
- #1764 续哨（OPEN 趋僵，无用户动作）。
- llm-init.test.ts flake-watch 续（上窗未复现）。

### T1 主轴票：fix-r82-anysearch-mcp-migration（实施票）

AnySearchProvider REST→MCP-over-HTTP 迁移：

- 端点：`https://api.anysearch.com/mcp`（POST JSON-RPC：initialize → notifications/initialized → tools/call search；R81 实测无 session-id 依赖即通——R3 残余：按 MCP Streamable HTTP spec 全验 session/重连语义）。
- `ANYSEARCH_ENDPOINT` override 语义保留：env 值视作 MCP endpoint base（dead-port 注入兼容，install-smoke 腿不变）。
- 响应形校验同捆落地（fix-r82-provider-shape-validation）：tools/call 返回非预期形/REST 面错形 200 → 按 fail 处理，堵 OmniRoute 静默零结果面（defer-r81-provider-shape-validation 收口条件）。
- 测试闭环（用户验收标准映射）：mock MCP fixture（initialize+tools/call 桩）+ dead-port 注入保留 + **live 测活腿**（打真 /mcp，CI test-online 或 install-smoke 增列——注意 CI 新增探针是本轮分水岭缺席的补课，可选但推荐）。
- NormalizedResult 映射：MCP content[].text 为 markdown 形（## Search Results + ### N. title + URL + snippet）——需解析或请 tools/call 的 structuredContent（若服务端支持，R3 票内验）。

### T2 宣称修正执行票：fix-r82-anysearch-rest-contract

C-1/C-2/C-13 三件套（T1b RESHAPE 携入）：anysearch.ts 端点/契约注释按迁移后形态重写 + test/anysearch.test.ts mock fixture 改 MCP 形 + "Anonymous has lower rate limit" 半句处置（不可验→删或注 "未验"）。验收面=迁移后实测形与宣称一致。

### T3 残余假设 gate 票（原 H#+Test 保留）

| # | 未验面 | Test |
|---|---|---|
| R2 | /mcp anonymous 凭据面/限流 | authed vs anon tools/call 对照实测；若 anon 被封→回退 ADR-0082 分支 c 评估 |
| R3 | MCP transport 细节 | Streamable HTTP spec 合规检查（session-id 语义/SSE 流/断线重连/structuredContent 可用性） |
| R4 | OmniRoute env 语义 | 用户侧确认（ANYSEARCH_ENDPOINT=20128 是否有意路由）；可选 doctor 检测腿提案 |

### T4 文书收口

ADR-0083 + registry 更态（defer-r81-provider-shape-validation/defer-r81-anysearch-rest-route-removed 随处置更态）+ 宣称修正 + 判据↔证据映射 + metrics。

## 插曲协议（standing）

新发布窗口=本轮无 tag 计划；若用户推 v0.0.9+：三扳机规程同 R81（publishing.md 失败分级节已立法，R1 幂等跳过已在岗）。

## 红线（承继）

- 修复码的 spike/推荐仍走「推荐→ADR 裁决」分离（本轮已裁决分支 b，R82 直接实施无重裁）。
- ANYSEARCH_ENDPOINT 本机 env 值属用户配置域——不代改；诊断发现如实记，处置建议进 T3-R4 票。
- live 探针最小化（curl -sv 级/单次调用），不重演业务流量。
