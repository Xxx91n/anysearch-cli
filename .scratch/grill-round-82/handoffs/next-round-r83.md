# Round-83 任务书 — 候选主轴征集 + 哨戒续班（R82 收口产物）

Date: 2026-09-24（R82 收口时生成）。上轮账本 `.scratch/grill-round-82/decision-ledger.md`（D-001~D-005）；ADR-0083 定稿。Stack 约定同前：`r83-grill`（本文档+账本）← 实施栈叠其上。

## 状态快照（接手即知）

- **基线**：R82 迁移落地轮完成——AnySearchProvider 已迁 MCP-over-HTTP（POST /mcp，薄 JSON-RPC，eventsource-parser 唯一新 dep）；fail-first 映射收口 OmniRoute 错形静默面；anysearch 臂 anon 实测真结果复活。
- **registry 现况**：defer-r81-provider-shape-validation=closed（ADR-0083）；defer-r81-anysearch-rest-route-removed=open quarterly 监控续；defer-r73-dsh-event-rename=open 双锚续哨；新增 defer-r83-anysearch-vertical-domain-passthrough=open；residual-r82-R1~R5 五卡=closed（四分诊全落位）。
- **CI 新面**：`test-online-anysearch` job（continue-on-error，非阻断）首次给 provider live-search 探针面。
- **用户侧悬挂**：transformers.js #1764 评论外发仍挂（OPEN 趋僵 21d+，不代扣）；ANYSEARCH_ENDPOINT 用户 env 属个人配置域（值不录不代改——R4 域外即销已闭合）。

## 候选主轴（三选一或征集新题）

### 候选 A — fix-r83-anysearch-vertical-domain-passthrough（registry 已立票）

垂域贯通：MCP domain/sub_domain/sub_domain_params 是垂域路由枚举（17 值）≠ includeDomains（host allowlist）。真贯通需：SearchRequest 契约面扩展（新字段非复用 includeDomains）+引擎路由（何时走垂域：get_sub_domains 前置发现）+审计语义（pre-filter 语义从 host 闸变垂域路由——domain_filter.pre 事件语义扩展）。R82 eval 腿实录=evidence/t1-domain-leg.md。半径牵动契约+路由+审计三面——须单独立项裁决，非迁移尾巴。

### 候选 B — TE1 兑现窗（defer-r73-dsh-event-rename）

dsh-agent 0.1.7-rc.2 龄期闸约 2026-09-26T14:02Z 出闸；rc.1 约 09-25T13:25Z。若到时特征锚仍立（tarball 复验 agent/created+source/signal、session-start 缺席）且 changelog 审面可获（上游仓）→双锚齐→预注册票 issues/02 即时成立执行（repin 全族+index.ts 迁 agent/created+guard source!=='startup'——实测枚举无 'fresh'）。执行序钉死当轮主轴后；错过窗口记「已合格未消费」。

### 候选 C — 上轮新债/落选池征集

registry open 项照章征集（defer-r71-transformers-undeclared-dep 等续债）。

## T0 — 哨戒续班（常驻）

1. dsh 出闸复检（rc.1/rc.2 出闸点已过→双锚重判，特征锚 tarball 复验）；
2. #1764 哨（OPEN 趋僵续记）；
3. llm-init.test.ts SSE flake watch（R82 turbo test 窗内未复现）；
4. test-online-anysearch 首周观测（非阻断 job 是否误报/真探）；
5. 格式化结论行+截至戳 → evidence/t0-watch-<date>.md。

## 移交须知

- 验收标准原文承袭：「编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环」。
- 版本控制=GitButler（禁裸 git 写）；报告写 reports/<date>-report.md；closeout-claims.json schema @1 每轮非空。
- 红线承袭：不改用户 env；不重裁已决方向；错形不吞零；live 探针不 blocking。
