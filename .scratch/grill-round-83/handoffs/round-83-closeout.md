# Round-83 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-25):
`r83-grill` → `upx`（账本 D-001~D-007+任务书+词表+调研存档）；`r83-te1`（叠于其上）→ `rot`（TE1：dsh 全族 repin 0.1.7-rc.1+agent/created 迁移+startup guard）；`r83-t1` → `puz`（T1：垂域贯通三面+测试面+e2e hermetic 修）；`r83-t4`（叠于其上）→ `mqp`（T0/TE1/T1 证据件+TE1 票消记）→ `muk`（CHANGELOG r83 条目）→ `ykl`（README.zh-CN 镜像节）→ `wss`（nit 两档清算三项即修）→ `mmk`（ADR-0084+registry 核销/新增）→ ADR index 0084 入册（gen-adr-index --write）→ 收口报告+本交接。

主题：垂域贯通轮——defer-r83-anysearch-vertical-domain-passthrough 兑现（vertical 字段独立成轴≠includeDomains）+TE1 双锚齐当日消费 dsh 0.1.7-rc.1（session-start→agent/created）。

## 已完成

- **T0 哨戒续班**：dsh 双锚判定=**齐**——rc.1 龄期 ~49.7h 过闸（闸点实测 ETARGET 前科转实证），特征锚 tarball 复验齐（agent/created 携 source:SessionStartSource+signal，session-start 缺席），changelog 审面=GitHub Release 注记（tarball 无 CHANGELOG）；#1764 OPEN 趋僵 22d+（用户侧挂账不代发）；CI 观测窗最新三 workflow 全绿；llm-init SSE flake 本窗未复现。evidence/t0-watch.md。
- **TE1 闸开先行（fix-r82-dsh-event-created-consumption）**：pnpm-workspace catalog+overrides 枚举重推导 21 名（@deepseek-ai/* 0.1.5-rc.2→0.1.7-rc.1；新增 7 包退役 2 包；cordis→4.0.4）；index.ts session-start→agent/created+source==='startup' guard+显式 undefined 返回；contextMessage 适配 MessageId brand+自有 MessageSourceMap；14/14 测试+tsc+build+pack+L2 彩排（add→dump-config 层验→幂等）全绿；旧宿主静默降级如实记。commit `rot`。
- **T1 主轴（fix-r83-anysearch-vertical-domain-passthrough）**：
  - 契约面：SearchRequest.vertical{domain,subDomain?,params?}+verticalDomainSupported 能力位；DomainSchema sources.vertical{domain,sub_domain?}（section-replace 无深合并）；工具 arg verticalDomain/verticalSubDomain/verticalParams 双工具；CLI 三旗标+params JSON 形状闸。
  - 路由面：engine repoVertical resolver 复用 liveSchema 闭包；查询级整体替换仓级；capable→wire 下发，incapable→general 扇出+degraded 名单；anysearch adapter 映射 domain/sub_domain/sub_domain_params+extra.vertical 标记（fusion 保活）。
  - 审计面：retrieval.vertical.pre 七键 attrs（params_keys 只记键名；source repo|query；sent/degraded 名单）；无 vertical.post；domain_filter.pre 原样不动。
  - 校验面：本地形状校验唯一（词表上游权威，实测矩阵五格留痕）；sub/params 无 domain fail-fast。
  - commit `puz`；README EN/ZH 双语垂域节+17 词表快照（2026-09-25 源注记）。
- **测试面**：kernel test/vertical-domain.test.ts 28 断言（repo/query 优先、整体替换、sent/degraded、isError fail-open、无 post、domain_filter 独立）；store domain-schema 垂域断言组；retriever anysearch 13/13b/13c/13d wire+marker+fail-first；cli e2e 修 hermetic（ANS_LLM_* 剥壳）。
- **T4 收口**：ADR-0084（D1~D8+七件否决）；registry 核销 defer-r83 垂域票+defer-r73 事件票（双 closed by ADR-0084）+新增 defer-r83-prefer-capable-weighting；nit 两档：度量行自指=登记性闭合，JSON id 严格化/clientInfo.version 漂移闸/engines>=22 地板=即修档，cli e2e env 污染=本轮新发即修；closeout-claims.json 10 条机验声明注册；ADR index 0084 入册。
- **验收闭环**：turbo check 8/8；turbo test 13/13（3m02s；kernel 66/66、retriever 7 文件全绿、store 78、cli 3、mcp 2、plugin 10、dsh 14、embedding 2）；turbo build 5/5；ship-gate exit 0 全腿绿（9 步：不变量+静态断言+freshness+canonical+ADR index+supersession+CONTEXT 词+evidence-anchor+closeout-lint+双语 parity+pathlint+turbo 三件套+pack×8+publish shape+npm install smoke+memory-eval 126/126+MCP stdio 起服握手+观测回写+fail-open boot）；CLI 真端点垂域 e2e（`ans search "AAPL earnings" --vertical-domain finance --vertical-sub-domain calendar --vertical-params '{"type":"earnings"}' --json`——stub 端点下 anysearch 臂 fail-first 降级+providersFailed 如实报+其余臂正常，fail-open 实演）。

## 残留呈报

- 真宿主 dsh ≥0.1.7 进程内 agent/created 消费面（source 值域生效）=unverified-at-host——本机宿主仍 0.1.5-rc.2，旧宿主下 guard 自然不注入（非崩坏，静默降级）。
- ANYSEARCH_ENDPOINT 用户配置域不录不代改（D-001 §4）；#1764 评论外发仍挂用户侧。
- prefer-capable 加权调参→defer-r83-prefer-capable-weighting（eval 数据驱动）。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。验收全为本地实录（命令+输出摘要见 reports/2026-09-25-report.md 映射表）。本轮历史相关 run（承继基线绿面，head_sha=栈基祖先）：

- ci / native-smoke / ship-gate（base commit 17e9c3f2）：
  - https://github.com/Xxx91n/anysearch-cli/actions/runs/36084882610 —— ci success
  - https://github.com/Xxx91n/anysearch-cli/actions/runs/36084882552 —— ship-gate success

## 下一轮候选（详见 handoffs/next-round-r84.md）

- **候选 A**：prefer-capable 加权调参评估轮（eval 驱动）。
- **候选 B**：dsh ≥0.1.7 宿主侧 live 验收（TE1 行为面真进程留痕）。
- **候选 C**：征集下一轮主题。
